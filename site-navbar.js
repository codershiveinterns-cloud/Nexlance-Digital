(function () {
    if (window.NexlanceSiteNavbar && window.NexlanceSiteNavbar.initialized) {
        return;
    }

    const pageName = (() => {
        const rawPath = window.location.pathname.split('/').pop();
        return rawPath && rawPath.trim() ? rawPath.trim() : 'index.html';
    })();

    const config = {
        darkTheme: false,
        alwaysScrolled: pageName === 'help-center.html',
        activeKey: (() => {
            if (pageName === 'templates.html') return 'templates';
            if (pageName === 'pricing.html') return 'pricing';
            if (new Set([
                'features.html',
                'analytics-dashboard-feature.html',
                'mobile-responsive.html',
                'reliable-performance.html',
                'seo-tools.html'
            ]).has(pageName)) {
                return 'features';
            }
            if (pageName === 'help-center.html') return 'help-center';
            return '';
        })()
    };

    function getTopLevelLinkAttrs(key) {
        return config.activeKey === key ? ' aria-current="page"' : '';
    }

    function buildNavbarMarkup() {
        return `
<nav class="navbar${config.darkTheme ? ' navbar-theme-dark' : ''}${config.alwaysScrolled ? ' scrolled' : ''}" id="navbar" data-shared-navbar="true">
    <div class="nav-container">
        <a href="index.html" class="logo"><span class="logo-icon">&#9670;</span>Nexlance</a>
        <ul class="nav-menu" id="nav-menu">
            <li class="nav-item has-dropdown">
                <a href="templates.html"${getTopLevelLinkAttrs('templates')} aria-expanded="false">Templates <span class="arrow">&#9662;</span></a>
                <div class="dropdown dropdown-templates">
                    <div class="dropdown-grid templates-grid">
                        <a href="templates.html" class="template-thumb"><div class="thumb-img" style="background: linear-gradient(135deg, #667eea, #764ba2);"><img src="images/f2.webp" alt="Portfolio Template" style="width:100%; height:100%; object-fit:cover;"></div><span>Portfolio</span></a>
                        <a href="templates.html" class="template-thumb"><div class="thumb-img" style="background: linear-gradient(135deg, #f093fb, #f5576c);"><img src="images/business.jpg" alt="Business Template" style="width:100%; height:100%; object-fit:cover;"></div><span>Business</span></a>
                        <a href="templates.html" class="template-thumb"><div class="thumb-img" style="background: linear-gradient(135deg, #4facfe, #00f2fe);"><img src="images/creative.jpg" alt="Blog Template" style="width:100%; height:100%; object-fit:cover;"></div><span>Blog</span></a>
                        <a href="templates.html" class="template-thumb"><div class="thumb-img" style="background: linear-gradient(135deg, #43e97b, #38f9d7);"><img src="images/store.avif" alt="Store Template" style="width:100%; height:100%; object-fit:cover;"></div><span>Store</span></a>
                    </div>
                    <a href="templates.html" class="dropdown-view-all">View All Templates &rarr;</a>
                </div>
            </li>
            <li class="nav-item"><a href="pricing.html"${getTopLevelLinkAttrs('pricing')}>Pricing</a></li>
            <li class="nav-item"><a href="features.html"${getTopLevelLinkAttrs('features')}>Features</a></li>
            <li class="nav-item"><a href="help-center.html"${getTopLevelLinkAttrs('help-center')}>Help Center</a></li>
        </ul>
        <div class="nav-actions">
            <a href="login.html" class="btn-text">Log In</a>
            <a href="login.html?mode=register" class="btn-primary">Get Started</a>
        </div>
        <button class="mobile-toggle" id="mobile-toggle" aria-label="Toggle menu" aria-expanded="false" aria-controls="nav-menu">
            <span></span><span></span><span></span>
        </button>
    </div>
</nav>`;
    }

    function createNavbarElement() {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = buildNavbarMarkup().trim();
        return wrapper.firstElementChild;
    }

    function closeDropdowns(navbar) {
        navbar.querySelectorAll('.has-dropdown').forEach(item => {
            item.classList.remove('is-open');
            const trigger = item.querySelector(':scope > a');
            if (trigger) {
                trigger.setAttribute('aria-expanded', 'false');
            }
        });
    }

    function closeMobileMenu(navbar) {
        const mobileToggle = navbar.querySelector('#mobile-toggle');
        const navMenu = navbar.querySelector('#nav-menu');
        if (navMenu) {
            navMenu.classList.remove('active');
        }
        if (mobileToggle) {
            mobileToggle.classList.remove('active');
            mobileToggle.setAttribute('aria-expanded', 'false');
        }
        closeDropdowns(navbar);
    }

    function syncScrolledState(navbar) {
        if (config.alwaysScrolled) {
            navbar.classList.add('scrolled');
            return;
        }

        navbar.classList.toggle('scrolled', window.scrollY > 50);
    }

    function wireNavbarBehavior(navbar) {
        const mobileToggle = navbar.querySelector('#mobile-toggle');
        const navMenu = navbar.querySelector('#nav-menu');

        if (mobileToggle && navMenu) {
            mobileToggle.addEventListener('click', function () {
                const isOpen = navMenu.classList.toggle('active');
                this.classList.toggle('active', isOpen);
                this.setAttribute('aria-expanded', String(isOpen));
                if (!isOpen) {
                    closeDropdowns(navbar);
                }
            });
        }

        navbar.querySelectorAll('.has-dropdown > a').forEach(trigger => {
            trigger.addEventListener('click', event => {
                if (window.innerWidth > 768) {
                    return;
                }

                event.preventDefault();
                const parentItem = trigger.closest('.has-dropdown');
                const willOpen = !parentItem.classList.contains('is-open');
                closeDropdowns(navbar);
                parentItem.classList.toggle('is-open', willOpen);
                trigger.setAttribute('aria-expanded', String(willOpen));
            });
        });

        navbar.querySelectorAll('#nav-menu a').forEach(link => {
            const parentItem = link.parentElement;
            if (parentItem && parentItem.classList.contains('has-dropdown')) {
                return;
            }

            link.addEventListener('click', () => {
                if (window.innerWidth <= 768) {
                    closeMobileMenu(navbar);
                }
            });
        });

        document.addEventListener('click', event => {
            if (!navbar.contains(event.target) && window.innerWidth <= 768) {
                closeMobileMenu(navbar);
            }
        });

        window.addEventListener('resize', () => {
            if (window.innerWidth > 768) {
                closeMobileMenu(navbar);
            }
        });

        window.addEventListener('scroll', () => syncScrolledState(navbar), { passive: true });
        syncScrolledState(navbar);
    }

    function mountNavbar() {
        const placeholder = document.querySelector('[data-site-navbar]');
        const existingNavbar = document.querySelector('nav.navbar, header.navbar');
        const navbar = createNavbarElement();

        if (placeholder) {
            placeholder.replaceWith(navbar);
        } else if (existingNavbar) {
            existingNavbar.replaceWith(navbar);
        } else if (document.body) {
            document.body.insertAdjacentElement('afterbegin', navbar);
        } else {
            return;
        }

        wireNavbarBehavior(navbar);
    }

    if (document.body) {
        mountNavbar();
    } else {
        document.addEventListener('DOMContentLoaded', mountNavbar, { once: true });
    }

    window.NexlanceSiteNavbar = {
        initialized: true,
        managesBehavior: true
    };
})();
