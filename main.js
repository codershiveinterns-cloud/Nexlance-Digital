/**
 * BuildFlow - Main JavaScript
 * Professional Website Builder Landing Page
 */

document.addEventListener('DOMContentLoaded', function() {
    function getDefaultBillingCurrency() {
        const sharedCurrency = window.NEXLANCE_BILLING_CATALOG
            && typeof window.NEXLANCE_BILLING_CATALOG.DEFAULT_CURRENCY === 'string'
            ? window.NEXLANCE_BILLING_CATALOG.DEFAULT_CURRENCY
            : 'gbp';
        const normalized = String(sharedCurrency || '').trim().toLowerCase();
        return normalized || 'gbp';
    }

    function getDefaultBillingCurrencyUpper() {
        return getDefaultBillingCurrency().toUpperCase();
    }

    const PLAN_CONFIG = {
        plus: {
            name: 'Plus',
            defaultAmountCents: 19900,
            summary: {
                monthly: 'Dashboard access for Projects, Settings, Support Info, Access / Roles, and Services',
                annual: 'Yearly dashboard access for Projects, Settings, Support Info, Access / Roles, and Services'
            },
            productCodes: { monthly: 'plus_monthly', annual: 'plus_yearly' },
            description: 'Nexlance Plus plan access for 30 days',
            successMessage: 'Plus plan payment completed successfully.'
        },
        pro: {
            name: 'Pro',
            defaultAmountCents: 29900,
            summary: {
                monthly: 'Dashboard access plus up to 4 templates',
                annual: 'Yearly dashboard access plus up to 4 templates'
            },
            productCodes: { monthly: 'pro_monthly', annual: 'pro_yearly' },
            description: 'Nexlance Pro plan access for 30 days',
            successMessage: 'Pro plan payment completed successfully.'
        },
        business: {
            name: 'Business',
            defaultAmountCents: 39900,
            summary: {
                monthly: 'Complete dashboard access plus all 8 templates',
                annual: 'Yearly complete dashboard access plus all 8 templates'
            },
            productCodes: { monthly: 'business_monthly', annual: 'business_yearly' },
            description: 'Nexlance Business plan access for 30 days',
            successMessage: 'Business plan payment completed successfully.'
        }
    };
    function isLoggedIn() {
        return localStorage.getItem('nexlance_auth') === '1';
    }

    function getCurrentPlanCode() {
        if (typeof getCurrentPlanRecord === 'function') {
            const plan = getCurrentPlanRecord();
            return plan && plan.code ? plan.code : 'individual';
        }
        try {
            const plan = JSON.parse(localStorage.getItem('nexlance_plan') || 'null');
            return plan && plan.code ? plan.code : 'individual';
        } catch (error) {
            return 'individual';
        }
    }

    function notify(message, type = 'info') {
        if (typeof showToast === 'function') {
            showToast(message, type);
        } else {
            window.alert(message);
        }
    }

    function getApiUrl(pathname) {
        if (window.NexlancePayments && typeof window.NexlancePayments.getApiUrl === 'function') {
            return window.NexlancePayments.getApiUrl(pathname);
        }

        const normalizedPath = String(pathname || '').startsWith('/')
            ? String(pathname)
            : `/${String(pathname || '')}`;
        const configuredBaseUrl = window.NEXLANCE_PAYMENT_CONFIG && window.NEXLANCE_PAYMENT_CONFIG.apiBaseUrl
            ? String(window.NEXLANCE_PAYMENT_CONFIG.apiBaseUrl).trim().replace(/\/+$/, '')
            : '';

        if (configuredBaseUrl) {
            return `${configuredBaseUrl}${normalizedPath}`;
        }

        if (/^https?:$/i.test(window.location.protocol)) {
            return `${window.location.origin}${normalizedPath}`;
        }

        return `http://localhost:4242${normalizedPath}`;
    }

    function isAnnualBillingSelected() {
        return Boolean(
            (document.getElementById('billing-toggle') && document.getElementById('billing-toggle').checked)
            || (document.getElementById('billingToggle') && document.getElementById('billingToggle').checked)
        );
    }

    function getPlanAmountCents(planCode) {
        const config = PLAN_CONFIG[planCode] || PLAN_CONFIG.business;
        const button = document.querySelector(`[data-plan-action="${planCode}"]`);
        const card = button ? button.closest('.pricing-card, .price-card') : null;
        const amountEl = card ? card.querySelector('.amount, .price-num') : null;
        if (!amountEl) return config.defaultAmountCents;

        const monthly = Number.parseFloat(amountEl.dataset.monthly || amountEl.textContent || String(config.defaultAmountCents / 100));
        const annual = Number.parseFloat(amountEl.dataset.annual || monthly);
        return Math.round((isAnnualBillingSelected() ? annual : monthly) * 100);
    }

    function getPlanSummaryText(planCode) {
        const config = PLAN_CONFIG[planCode] || PLAN_CONFIG.business;
        return isAnnualBillingSelected() ? config.summary.annual : config.summary.monthly;
    }

    function getPlanProductCode(planCode) {
        const config = PLAN_CONFIG[planCode] || PLAN_CONFIG.business;
        return isAnnualBillingSelected() ? config.productCodes.annual : config.productCodes.monthly;
    }

    function formatPlanAmount(amountCents) {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: getDefaultBillingCurrencyUpper()
        }).format((Number(amountCents) || 0) / 100);
    }

    function setupPlanCheckout() {
        const params = new URLSearchParams(window.location.search);
        const checkoutPlan = String(params.get('checkout') || '').toLowerCase();

        document.querySelectorAll('[data-plan-action]').forEach(button => {
            button.addEventListener('click', async event => {
                event.preventDefault();
                event.stopPropagation();

                const planCode = String(button.getAttribute('data-plan-action') || '').toLowerCase();
                const config = PLAN_CONFIG[planCode];
                if (!config) return;

                if (!isLoggedIn()) {
                    const redirectTarget = `pricing.html?checkout=${planCode}`;
                    window.location.href = `login.html?mode=register&redirect=${encodeURIComponent(redirectTarget)}`;
                    return;
                }

                if (getCurrentPlanCode() === planCode) {
                    notify(`Your ${config.name} plan is already active.`, 'success');
                    window.location.href = 'dashboard.html';
                    return;
                }

                if (!window.NexlancePayments || typeof window.NexlancePayments.startBusinessCheckout !== 'function') {
                    notify('Secure payment is not available yet. Make sure payment.js is loaded.', 'error');
                    return;
                }

                try {
                    const amountCents = getPlanAmountCents(planCode);
                    const productCode = getPlanProductCode(planCode);
                    const redirectTarget = window.NexlancePayments.getCurrentPageWithQuery({ checkout: planCode });

                    await window.NexlancePayments.startBusinessCheckout({
                        amount: amountCents,
                        currency: getDefaultBillingCurrency(),
                        productCode,
                        redirectTarget,
                        title: `Complete your ${config.name} purchase`,
                        message: `Choose Stripe, Polar, Creem, or Coda to activate the ${config.name} plan on your account.`,
                        summaryTitle: `${config.name} Plan`,
                        summaryText: getPlanSummaryText(planCode),
                        buttonText: `Pay for ${config.name}`,
                        description: config.description
                    });
                } catch (error) {
                    console.error(`${config.name} checkout failed:`, error);
                    notify(error && error.message ? error.message : `Could not complete the ${config.name} plan payment. Please try again.`, 'error');
                }
            });
        });

        if (checkoutPlan && isLoggedIn() && getCurrentPlanCode() !== checkoutPlan) {
            const planButton = document.querySelector(`[data-plan-action="${checkoutPlan}"]`);
            if (planButton) {
                setTimeout(() => planButton.click(), 120);
            }
        }
    }

    window.addEventListener('nexlance-checkout-completed', event => {
        const detail = event && event.detail ? event.detail : {};
        const productCode = String(detail.productCode || '').trim().toLowerCase();
        if (productCode === 'single_template') return;
        if (productCode.startsWith('pro_')) {
            notify('Pro access is now active on your account.', 'success');
            return;
        }
        if (productCode.startsWith('plus_')) {
            notify('Plus plan activated successfully.', 'success');
            return;
        }
        if (productCode.startsWith('business_')) {
            notify('Business plan activated successfully.', 'success');
        }
    });

    window.addEventListener('nexlance-checkout-error', event => {
        const detail = event && event.detail ? event.detail : {};
        if (detail.message) {
            notify(detail.message, 'error');
        }
    });

    function setupPricingSections() {
        const homepageGrid = document.querySelector('.pricing-grid');
        if (homepageGrid) {
            homepageGrid.innerHTML = `
                <div class="pricing-card">
                    <div class="pricing-header">
                        <h3>Plus</h3>
                        <p>Access dashboard pages including Projects, Settings, Support Info, Access/Role, and Services, billed every 30 days</p>
                    </div>
                    <div class="pricing-price">
                        <span class="currency">&pound;</span>
                    <span class="amount" data-monthly="199" data-annual="1910.40">199</span>
                        <span class="period">/month</span>
                    </div>
                    <ul class="pricing-features">
                        <li><span class="check">&#10003;</span> Projects page access</li>
                        <li><span class="check">&#10003;</span> Settings page access</li>
                        <li><span class="check">&#10003;</span> Support Info page access</li>
                        <li><span class="check">&#10003;</span> Access/Role page access</li>
                        <li><span class="check">&#10003;</span> Services page access</li>
                        <li class="disabled"><span class="x">&#10007;</span> No Invoices, Team, or Clients access</li>
                    </ul>
                    <a href="pricing.html?checkout=plus" class="btn-outline btn-full" data-plan-action="plus">Choose Plus</a>
                </div>
                <div class="pricing-card">
                    <div class="pricing-header">
                        <h3>Pro</h3>
                        <p>Access dashboard pages including Projects, Settings, Support Info, Access/Role, Services, Invoices, and Team, plus any 4 templates, billed every 30 days</p>
                    </div>
                    <div class="pricing-price">
                        <span class="currency">&pound;</span>
                    <span class="amount" data-monthly="299" data-annual="2870.40">299</span>
                        <span class="period">/month</span>
                    </div>
                    <ul class="pricing-features">
                        <li><span class="check">&#10003;</span> Projects and Settings access</li>
                        <li><span class="check">&#10003;</span> Support Info and Access/Role access</li>
                        <li><span class="check">&#10003;</span> Services and Invoices access</li>
                        <li><span class="check">&#10003;</span> Team page access</li>
                        <li><span class="check">&#10003;</span> Access to any 4 templates</li>
                        <li class="disabled"><span class="x">&#10007;</span> No Clients page access</li>
                    </ul>
                    <a href="pricing.html?checkout=pro" class="btn-outline btn-full" data-plan-action="pro">Choose Pro</a>
                </div>
                <div class="pricing-card popular">
                    <div class="popular-badge">Most Popular</div>
                    <div class="pricing-header">
                        <h3>Business</h3>
                        <p>Complete dashboard access including Projects, Settings, Support Info, Access/Role, Services, Invoices, Team, Clients, and Reports, plus all 8 templates, billed every 30 days</p>
                    </div>
                    <div class="pricing-price">
                        <span class="currency">&pound;</span>
                    <span class="amount" data-monthly="399" data-annual="3830.40">399</span>
                        <span class="period">/month</span>
                    </div>
                    <ul class="pricing-features">
                        <li><span class="check">&#10003;</span> Complete dashboard access</li>
                        <li><span class="check">&#10003;</span> Projects, Settings, and Support Info</li>
                        <li><span class="check">&#10003;</span> Access/Role, Services, and Invoices</li>
                        <li><span class="check">&#10003;</span> Team, Clients, and Reports access</li>
                        <li><span class="check">&#10003;</span> Access to all 8 templates</li>
                        <li><span class="check">&#10003;</span> Priority support</li>
                    </ul>
                    <a href="pricing.html?checkout=business" class="btn-primary btn-full" data-plan-action="business">Choose Business</a>
                </div>`;
        }

        const pricingGrid = document.querySelector('.price-grid');
        if (pricingGrid) {
            pricingGrid.innerHTML = `
                <div class="price-card">
                    <div class="plan-name">Plus</div>
                    <div class="plan-desc">Access dashboard pages including Projects, Settings, Support Info, Access/Role, and Services, billed every 30 days</div>
                    <div class="price-amount">
                        <div class="price-main">
                            <span class="price-currency">&pound;</span>
                            <span class="price-num" data-monthly="199" data-annual="1910.40">199</span>
                            <span class="price-period">/month</span>
                        </div>
                        <div class="price-note" data-monthly-note="Billed monthly" data-annual-note="Save GBP 477.60 vs monthly">Billed monthly</div>
                    </div>
                    <ul class="feature-list">
                        <li><span class="chk">&#10003;</span> Projects page access</li>
                        <li><span class="chk">&#10003;</span> Settings page access</li>
                        <li><span class="chk">&#10003;</span> Support Info page access</li>
                        <li><span class="chk">&#10003;</span> Access/Role page access</li>
                        <li><span class="chk">&#10003;</span> Services page access</li>
                        <li><span class="crs">&#10007;</span> No Invoices, Team, or Clients access</li>
                    </ul>
                    <a href="pricing.html?checkout=plus" data-plan-action="plus"><button class="plan-cta cta-outline">Choose Plus</button></a>
                </div>
                <div class="price-card">
                    <div class="plan-name">Pro</div>
                    <div class="plan-desc">Access dashboard pages including Projects, Settings, Support Info, Access/Role, Services, Invoices, and Team, plus any 4 templates, billed every 30 days</div>
                    <div class="price-amount">
                        <div class="price-main">
                            <span class="price-currency">&pound;</span>
                            <span class="price-num" data-monthly="299" data-annual="2870.40">299</span>
                            <span class="price-period">/month</span>
                        </div>
                        <div class="price-note" data-monthly-note="Billed every 30 days" data-annual-note="Save GBP 717.60 vs monthly">Billed every 30 days</div>
                    </div>
                    <ul class="feature-list">
                        <li><span class="chk">&#10003;</span> Projects and Settings access</li>
                        <li><span class="chk">&#10003;</span> Support Info and Access/Role access</li>
                        <li><span class="chk">&#10003;</span> Services and Invoices access</li>
                        <li><span class="chk">&#10003;</span> Team page access</li>
                        <li><span class="chk">&#10003;</span> Access to any 4 templates</li>
                        <li><span class="crs">&#10007;</span> No Clients page access</li>
                    </ul>
                    <a href="pricing.html?checkout=pro" data-plan-action="pro"><button class="plan-cta cta-outline">Choose Pro</button></a>
                </div>
                <div class="price-card popular">
                    <div class="popular-badge">Most Popular</div>
                    <div class="plan-name">Business</div>
                    <div class="plan-desc">Complete dashboard access including Projects, Settings, Support Info, Access/Role, Services, Invoices, Team, Clients, and Reports, plus all 8 templates, billed every 30 days</div>
                    <div class="price-amount">
                        <div class="price-main">
                            <span class="price-currency">&pound;</span>
                            <span class="price-num" data-monthly="399" data-annual="3830.40">399</span>
                            <span class="price-period">/month</span>
                        </div>
                        <div class="price-note" data-monthly-note="Billed monthly" data-annual-note="Save GBP 957.60 vs monthly">Billed monthly</div>
                    </div>
                    <ul class="feature-list">
                        <li><span class="chk">&#10003;</span> Complete dashboard access</li>
                        <li><span class="chk">&#10003;</span> Projects, Settings, and Support Info</li>
                        <li><span class="chk">&#10003;</span> Access/Role, Services, and Invoices</li>
                        <li><span class="chk">&#10003;</span> Team, Clients, and Reports access</li>
                        <li><span class="chk">&#10003;</span> Access to all 8 templates</li>
                        <li><span class="chk">&#10003;</span> Priority support</li>
                    </ul>
                    <a href="pricing.html?checkout=business"><button class="plan-cta cta-primary" data-plan-action="business">Choose Business</button></a>
                </div>`;
        }
    }
    
    // =========================================
    // Navbar Scroll Effect
    // =========================================
    const navbar = document.getElementById('navbar');
    const navbarManagedBySharedComponent = Boolean(
        window.NexlanceSiteNavbar && window.NexlanceSiteNavbar.managesBehavior
    );

    if (navbar && !navbarManagedBySharedComponent) {
        window.addEventListener('scroll', function() {
            if (window.pageYOffset > 50) {
                navbar.classList.add('scrolled');
            } else {
                navbar.classList.remove('scrolled');
            }
        });
    }
    
    // =========================================
    // Mobile Navigation Toggle
    // =========================================
    const mobileToggle = document.getElementById('mobile-toggle');
    const navMenu = document.getElementById('nav-menu');
    
    if (mobileToggle && navMenu && !navbarManagedBySharedComponent) {
        mobileToggle.addEventListener('click', function() {
            navMenu.classList.toggle('active');
            this.classList.toggle('active');
        });
    }
    
    // =========================================
    // Smooth Scroll for Anchor Links
    // =========================================
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            e.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));
            if (target) {
                const headerOffset = 80;
                const elementPosition = target.getBoundingClientRect().top;
                const offsetPosition = elementPosition + window.pageYOffset - headerOffset;
                
                window.scrollTo({
                    top: offsetPosition,
                    behavior: 'smooth'
                });
                
                // Close mobile menu
                if (navMenu) {
                    navMenu.classList.remove('active');
                }
                if (mobileToggle) {
                    mobileToggle.classList.remove('active');
                }
            }
        });
    });
    
    // =========================================
    // Pricing Toggle (Monthly/Annual)
    // =========================================
    setupPricingSections();

    const billingToggle = document.getElementById('billing-toggle');
    const priceAmounts = document.querySelectorAll('.amount');
    const labelMonthly = document.getElementById('label-monthly');
    const labelAnnual  = document.getElementById('label-annual');
    const billingNote  = document.getElementById('billing-note');

    if (billingToggle) {
        billingToggle.addEventListener('change', function() {
            const isAnnual = this.checked;

            // Switch price number
            priceAmounts.forEach(amount => {
                amount.textContent = isAnnual ? amount.dataset.annual : amount.dataset.monthly;
            });

            // Switch period label /month to /year
            document.querySelectorAll('.period').forEach(el => {
                el.textContent = el.dataset.fixedPeriod || (isAnnual ? '/year' : '/month');
            });

            // Highlight the active label
            if (labelMonthly && labelAnnual) {
                labelMonthly.classList.toggle('active-label', !isAnnual);
                labelAnnual.classList.toggle('active-label',  isAnnual);
            }

            // Update billing note
            if (billingNote) {
                if (isAnnual) {
                    billingNote.textContent = 'Billed annually - you save 20% compared to monthly';
                    billingNote.classList.add('annual');
                } else {
                    billingNote.textContent = 'Billed monthly - switch to annual and save 20%';
                    billingNote.classList.remove('annual');
                }
            }
        });
    }

    setupPlanCheckout();
    
    // =========================================
    // Template Filter
    // =========================================
    const filterBtns = document.querySelectorAll('.filter-btn');
    const templateCards = document.querySelectorAll('.template-card');
    
    filterBtns.forEach(btn => {
        btn.addEventListener('click', function() {
            // Update active button
            filterBtns.forEach(b => b.classList.remove('active'));
            this.classList.add('active');
            
            const filter = this.dataset.filter;
            
            templateCards.forEach(card => {
                if (filter === 'all' || card.dataset.category === filter) {
                    card.style.display = 'block';
                    setTimeout(() => {
                        card.style.opacity = '1';
                        card.style.transform = 'translateY(0)';
                    }, 50);
                } else {
                    card.style.opacity = '0';
                    card.style.transform = 'translateY(20px)';
                    setTimeout(() => {
                        card.style.display = 'none';
                    }, 300);
                }
            });
        });
    });

    // =========================================
    // Template Preview Redirect
    // =========================================
    const previewRouteMap = {
        'minimal portfolio': 'template-demo.html?template=minimal-portfolio',
        'agency pro': 'template-demo.html?template=agency-pro',
        'fashion store': 'template-demo.html?template=fashion-store',
        "writer's blog": 'template-demo.html?template=writers-blog',
        'photographer': 'template-demo.html?template=photographer',
        'startup landing': 'template-demo.html?template=startup-landing',
        'fine dining': 'template-demo.html?template=fine-dining',
        'electronics store': 'template-demo.html?template=electronics-store',
        'creative agency': 'template-demo.html?template=creative-agency',
        'designer portfolio': 'template-demo.html?template=designer-portfolio',
        'saas product': 'template-demo.html?template=saas-product',
        'cafe & bakery': 'template-demo.html?template=cafe-bakery',
        'cafe & bakery': 'template-demo.html?template=cafe-bakery',
        'tech blog': 'template-demo.html?template=tech-blog',
        'consulting firm': 'template-demo.html?template=consulting-firm',
        'wedding gallery': 'template-demo.html?template=wedding-gallery',
        'digital marketing': 'template-demo.html?template=digital-marketing',
        'jewelry & luxury': 'template-demo.html?template=jewelry-luxury',
        'app download': 'template-demo.html?template=app-download'
    };

    document.querySelectorAll('.btn-preview').forEach(button => {
        button.addEventListener('click', function() {
            const card = this.closest('.template-card, .tpl-card');
            if (!card) return;

            const titleEl = card.querySelector('.template-info h4, .tpl-info h4');
            const rawTitle = card.dataset.name || (titleEl ? titleEl.textContent : '');
            const normalizedTitle = rawTitle.trim().toLowerCase();
            const previewUrl = previewRouteMap[normalizedTitle];

            if (previewUrl) {
                window.location.href = previewUrl;
            }
        });
    });
    
    // =========================================
    // Testimonials Slider
    // =========================================
    const testimonialCards = document.querySelectorAll('.testimonial-card');
    const dots = document.querySelectorAll('.dot');
    let currentSlide = 0;
    let autoSlideInterval;
    
    function showSlide(index) {
        testimonialCards.forEach((card, i) => {
            card.classList.remove('active');
            dots[i].classList.remove('active');
        });
        
        testimonialCards[index].classList.add('active');
        dots[index].classList.add('active');
    }
    
    function nextSlide() {
        currentSlide = (currentSlide + 1) % testimonialCards.length;
        showSlide(currentSlide);
    }
    
    function startAutoSlide() {
        autoSlideInterval = setInterval(nextSlide, 5000);
    }
    
    function stopAutoSlide() {
        clearInterval(autoSlideInterval);
    }
    
    dots.forEach((dot, index) => {
        dot.addEventListener('click', function() {
            currentSlide = index;
            showSlide(currentSlide);
            stopAutoSlide();
            startAutoSlide();
        });
    });
    
    // Start auto-slide
    if (testimonialCards.length > 0) {
        startAutoSlide();
    }
    
    // =========================================
    // Back to Top Button
    // =========================================
    const backToTop = document.getElementById('back-to-top');
    
    window.addEventListener('scroll', function() {
        if (window.pageYOffset > 500) {
            backToTop.classList.add('visible');
        } else {
            backToTop.classList.remove('visible');
        }
    });
    
    if (backToTop) {
        backToTop.addEventListener('click', function() {
            window.scrollTo({
                top: 0,
                behavior: 'smooth'
            });
        });
    }
    
    // =========================================
    // Intersection Observer for Animations
    // =========================================
    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.1
    };
    
    const observer = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, observerOptions);
    
    // Observe elements with fade-up class
    document.querySelectorAll('.fade-up').forEach(el => {
        observer.observe(el);
    });
    
    // Add fade-up to sections
    document.querySelectorAll('.section-header, .feature-card, .template-card, .step-card, .pricing-card').forEach(el => {
        el.classList.add('fade-up');
        observer.observe(el);
    });
    
    // =========================================
    // Dropdown Hover Effect (Desktop)
    // =========================================
    const dropdownItems = document.querySelectorAll('.nav-item.has-dropdown');
    
    dropdownItems.forEach(item => {
        let timeout;
        
        item.addEventListener('mouseenter', function() {
            clearTimeout(timeout);
            this.querySelector('.dropdown').style.opacity = '1';
            this.querySelector('.dropdown').style.visibility = 'visible';
        });
        
        item.addEventListener('mouseleave', function() {
            const dropdown = this.querySelector('.dropdown');
            timeout = setTimeout(() => {
                dropdown.style.opacity = '0';
                dropdown.style.visibility = 'hidden';
            }, 200);
        });
    });
    
    // =========================================
    // Counter Animation for Stats
    // =========================================
    function animateCounter(element, target, duration = 2000) {
        let start = 0;
        const increment = target / (duration / 16);
        
        function updateCounter() {
            start += increment;
            if (start < target) {
                element.textContent = Math.floor(start);
                requestAnimationFrame(updateCounter);
            } else {
                element.textContent = target;
            }
        }
        
        updateCounter();
    }
    
    // =========================================
    // Form Validation (if contact form exists)
    // =========================================
    const forms = document.querySelectorAll('form');
    
    forms.forEach(form => {
        if (form.dataset.managedForm) {
            return;
        }
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            
            // Basic validation
            let isValid = true;
            const inputs = form.querySelectorAll('input[required], textarea[required]');
            
            inputs.forEach(input => {
                if (!input.value.trim()) {
                    isValid = false;
                    input.classList.add('error');
                } else {
                    input.classList.remove('error');
                }
            });
            
            if (isValid) {
                // Submit form
                console.log('Form submitted!');
                // Add your form submission logic here
            }
        });
    });
    
    // =========================================
    // Lazy Loading for Images
    // =========================================
    const lazyImages = document.querySelectorAll('img[data-src]');
    
    const imageObserver = new IntersectionObserver(function(entries) {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                img.src = img.dataset.src;
                img.classList.add('loaded');
                imageObserver.unobserve(img);
            }
        });
    });
    
    lazyImages.forEach(img => {
        imageObserver.observe(img);
    });
    
    // =========================================
    // Keyboard Navigation
    // =========================================
    document.addEventListener('keydown', function(e) {
        // ESC to close mobile menu
        if (e.key === 'Escape') {
            navMenu.classList.remove('active');
            mobileToggle.classList.remove('active');
        }
    });
    
    // =========================================
    // Print Styles Detection
    // =========================================
    window.addEventListener('beforeprint', function() {
        document.body.classList.add('printing');
    });
    
    window.addEventListener('afterprint', function() {
        document.body.classList.remove('printing');
    });
    
    // =========================================
    // Console Welcome Message
    // =========================================
    console.log('%cBuildFlow', 'font-size: 24px; font-weight: bold; color: #4f46e5;');
    console.log('%cBuild beautiful websites without code.', 'font-size: 14px; color: #6b7280;');
    console.log('%c----------------------------------------', 'color: #e5e7eb;');
    
});
