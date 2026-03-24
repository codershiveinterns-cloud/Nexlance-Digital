(function () {
    const inferredApiBaseUrl = (function () {
        if (window.location.protocol === 'file:') {
            return 'http://localhost:4242';
        }
        if (/^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname) && window.location.port && window.location.port !== '4242') {
            return 'http://localhost:4242';
        }
        return '';
    })();

    const DEFAULT_CONFIG = {
        apiBaseUrl: inferredApiBaseUrl
    };

    const config = Object.assign({}, DEFAULT_CONFIG, window.NEXLANCE_PAYMENT_CONFIG || {});
    let activeCheckoutOptions = null;
    let paymentConfigCache = null;
    let paymentConfigPromise = null;

    function normalizeApiBaseUrl(baseUrl) {
        return String(baseUrl || '').trim().replace(/\/+$/, '');
    }

    function getApiBaseUrl() {
        const configuredBaseUrl = normalizeApiBaseUrl(config.apiBaseUrl);
        if (configuredBaseUrl) {
            return configuredBaseUrl;
        }

        if (/^https?:$/i.test(window.location.protocol)) {
            return window.location.origin;
        }

        return 'http://localhost:4242';
    }

    function getApiUrl(pathname) {
        const normalizedPath = String(pathname || '').startsWith('/')
            ? String(pathname)
            : `/${String(pathname || '')}`;
        return `${getApiBaseUrl()}${normalizedPath}`;
    }

    async function fetchPaymentConfig() {
        if (paymentConfigCache) {
            return paymentConfigCache;
        }

        if (!paymentConfigPromise) {
            paymentConfigPromise = fetch(getApiUrl('/api/payment-config'))
                .then(async response => {
                    const data = await response.json().catch(() => ({}));
                    if (!response.ok) {
                        throw new Error(data.error || 'Payment configuration could not be loaded.');
                    }
                    paymentConfigCache = data;
                    return data;
                })
                .finally(() => {
                    paymentConfigPromise = null;
                });
        }

        return paymentConfigPromise;
    }

    function getGatewayAvailabilityForProduct(paymentConfig, productCode) {
        if (!paymentConfig || !paymentConfig.products) {
            return null;
        }

        const product = paymentConfig.products[String(productCode || '').trim().toLowerCase()];
        if (!product || !product.gateways) {
            return null;
        }

        return {
            stripe: product.gateways.stripe !== false,
            polar: product.gateways.polar !== false
        };
    }

    function getCurrentPageWithQuery(extraParams) {
        const url = new URL(window.location.href);
        if (extraParams) {
            Object.keys(extraParams).forEach(key => {
                if (extraParams[key] === null || extraParams[key] === undefined) {
                    url.searchParams.delete(key);
                } else {
                    url.searchParams.set(key, extraParams[key]);
                }
            });
        }
        return `${url.pathname.split('/').pop() || 'index.html'}${url.search}${url.hash || ''}`;
    }

    function isLoggedIn() {
        return localStorage.getItem('nexlance_auth') === '1';
    }

    function getCurrentUser() {
        try {
            return JSON.parse(localStorage.getItem('nexlance_user') || 'null');
        } catch (error) {
            return null;
        }
    }

    function getCurrentUserEmail() {
        const user = getCurrentUser();
        return user && user.email ? String(user.email).trim().toLowerCase() : '';
    }

    function getCurrentUserName() {
        const user = getCurrentUser();
        return user && user.name ? String(user.name).trim() : '';
    }

    function getTemplateAccessStorageKey(email) {
        const normalized = String(email || '').trim().toLowerCase();
        return normalized ? `nexlance_template_access_${normalized}` : 'nexlance_template_access';
    }

    function getStoredTemplateAccess(email) {
        try {
            return JSON.parse(localStorage.getItem(getTemplateAccessStorageKey(email)) || localStorage.getItem('nexlance_template_access') || 'null');
        } catch (error) {
            return null;
        }
    }

    function persistTemplateAccess(email, accessRecord) {
        const key = getTemplateAccessStorageKey(email);
        localStorage.setItem(key, JSON.stringify(accessRecord));
        localStorage.setItem('nexlance_template_access', JSON.stringify(accessRecord));
    }

    function buildTemplateAccessRecord(options) {
        const existing = getStoredTemplateAccess(options.userEmail) || {};
        const existingTemplateIds = Array.isArray(existing.templateIds) ? existing.templateIds.filter(Boolean) : [];
        const nextTemplateIds = options.templateId && !existingTemplateIds.includes(options.templateId)
            ? existingTemplateIds.concat(options.templateId)
            : existingTemplateIds;

        return {
            userEmail: options.userEmail,
            allTemplatesAccess: Boolean(options.allTemplatesAccess || existing.allTemplatesAccess),
            templateIds: nextTemplateIds,
            sourceProductCode: options.sourceProductCode || existing.sourceProductCode || '',
            endsAt: options.endsAt || existing.endsAt || '',
            updatedAt: new Date().toISOString()
        };
    }

    function applyCheckoutResultLocally(payload) {
        const result = payload && payload.result ? payload.result : {};
        const paymentRecord = result.paymentRecord || {};
        const userRecord = result.userRecord || {};
        const productCode = String(payload && payload.productCode || '').trim().toLowerCase();
        const templateId = String(payload && payload.templateId || '').trim().toLowerCase();
        const userEmail = String(payload && payload.userEmail || getCurrentUserEmail()).trim().toLowerCase();
        const billingCycle = String(paymentRecord.billingCycle || '').trim().toLowerCase();
        const planCode = productCode.startsWith('plus_')
            ? 'plus'
            : (productCode.startsWith('business_') ? 'business' : (productCode === 'pro_onetime' ? 'pro' : ''));

        if (productCode === 'single_template') {
            persistTemplateAccess(userEmail, buildTemplateAccessRecord({
                userEmail,
                templateId,
                sourceProductCode: productCode
            }));
        }

        if (productCode === 'pro_onetime' || productCode.startsWith('business_')) {
            persistTemplateAccess(userEmail, buildTemplateAccessRecord({
                userEmail,
                allTemplatesAccess: true,
                sourceProductCode: productCode,
                endsAt: userRecord.templateAccessEndsAt || paymentRecord.endsAt || ''
            }));
        }

        if (planCode && typeof window.activatePaidPlanAccess === 'function') {
            window.activatePaidPlanAccess(planCode, {
                price: Number(paymentRecord.amount || 0),
                currency: paymentRecord.currency || 'EUR',
                startedAt: paymentRecord.createdAt || new Date().toISOString(),
                endsAt: userRecord.planEndsAt || '',
                billingCycle: billingCycle === 'yearly' ? 'annual' : (billingCycle || 'monthly'),
                dashboardAccess: planCode !== 'pro',
                allTemplatesAccess: planCode === 'pro' || planCode === 'business'
            });
        }
    }

    function ensureStyles() {
        if (document.getElementById('nexlance-payment-styles')) return;

        const style = document.createElement('style');
        style.id = 'nexlance-payment-styles';
        style.textContent = `
            .nl-modal-overlay {
                position: fixed;
                inset: 0;
                background: rgba(15, 23, 42, 0.72);
                backdrop-filter: blur(6px);
                display: none;
                align-items: center;
                justify-content: center;
                z-index: 12000;
                padding: 20px;
            }
            .nl-modal-overlay.show {
                display: flex;
            }
            .nl-modal {
                width: min(100%, 560px);
                background: #ffffff;
                border-radius: 24px;
                box-shadow: 0 30px 80px rgba(15, 23, 42, 0.28);
                overflow: hidden;
                position: relative;
            }
            .nl-modal-header {
                padding: 24px 24px 12px;
            }
            .nl-modal-header h3 {
                margin: 0 0 8px;
                font-size: 1.5rem;
                color: #0f172a;
            }
            .nl-modal-header p {
                margin: 0;
                color: #475569;
                line-height: 1.6;
            }
            .nl-modal-body {
                padding: 0 24px 24px;
            }
            .nl-payment-summary {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 16px;
                background: #f8fafc;
                border: 1px solid #e2e8f0;
                border-radius: 16px;
                padding: 16px 18px;
                margin-bottom: 18px;
            }
            .nl-payment-summary strong {
                display: block;
                color: #0f172a;
                font-size: 1rem;
                margin-bottom: 4px;
            }
            .nl-payment-summary span {
                color: #64748b;
                font-size: 0.95rem;
            }
            .nl-payment-amount {
                font-size: 1.3rem;
                font-weight: 700;
                color: #4f46e5;
                white-space: nowrap;
            }
            .nl-auth-actions,
            .nl-provider-actions {
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 12px;
                margin-top: 22px;
            }
            .nl-btn {
                border: none;
                border-radius: 999px;
                padding: 13px 18px;
                font-weight: 700;
                cursor: pointer;
                text-decoration: none;
                text-align: center;
                transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
            }
            .nl-btn:hover {
                transform: translateY(-1px);
            }
            .nl-btn-primary {
                background: linear-gradient(135deg, #4f46e5, #7c3aed);
                color: #ffffff;
                box-shadow: 0 14px 28px rgba(79, 70, 229, 0.25);
            }
            .nl-btn-secondary {
                background: #e2e8f0;
                color: #0f172a;
            }
            .nl-provider-card {
                border: 1px solid #e2e8f0;
                border-radius: 18px;
                padding: 16px;
                background: #fff;
                text-align: left;
            }
            .nl-provider-card:disabled {
                opacity: 0.55;
                cursor: not-allowed;
                transform: none;
                box-shadow: none;
            }
            .nl-provider-card strong {
                display: block;
                margin-bottom: 4px;
                color: #0f172a;
            }
            .nl-provider-card span {
                color: #64748b;
                font-size: 0.92rem;
                line-height: 1.5;
            }
            .nl-payment-message {
                margin-top: 14px;
                min-height: 22px;
                font-size: 0.95rem;
            }
            .nl-payment-message.error {
                color: #dc2626;
            }
            .nl-payment-message.success {
                color: #059669;
            }
            .nl-close {
                position: absolute;
                top: 16px;
                right: 16px;
                width: 36px;
                height: 36px;
                border: none;
                border-radius: 50%;
                background: #eef2ff;
                color: #4338ca;
                font-size: 1.1rem;
                cursor: pointer;
            }
            @media (max-width: 640px) {
                .nl-auth-actions,
                .nl-provider-actions {
                    grid-template-columns: 1fr;
                }
                .nl-payment-summary {
                    flex-direction: column;
                    align-items: flex-start;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function ensureMarkup() {
        if (document.getElementById('nexlanceAuthOverlay')) return;

        ensureStyles();

        const authOverlay = document.createElement('div');
        authOverlay.id = 'nexlanceAuthOverlay';
        authOverlay.className = 'nl-modal-overlay';
        authOverlay.innerHTML = `
            <div class="nl-modal" role="dialog" aria-modal="true" aria-labelledby="nexlanceAuthTitle">
                <button type="button" class="nl-close" data-close-auth>&times;</button>
                <div class="nl-modal-header">
                    <h3 id="nexlanceAuthTitle">Create an account or log in first</h3>
                    <p id="nexlanceAuthText">You need to sign in before continuing to secure checkout.</p>
                </div>
                <div class="nl-modal-body">
                    <div class="nl-auth-actions">
                        <a id="nexlanceAuthRegister" class="nl-btn nl-btn-primary" href="login.html?mode=register">Create Account</a>
                        <a id="nexlanceAuthLogin" class="nl-btn nl-btn-secondary" href="login.html">Log In</a>
                    </div>
                </div>
            </div>
        `;

        const providerOverlay = document.createElement('div');
        providerOverlay.id = 'nexlanceProviderOverlay';
        providerOverlay.className = 'nl-modal-overlay';
        providerOverlay.innerHTML = `
            <div class="nl-modal" role="dialog" aria-modal="true" aria-labelledby="nexlanceProviderTitle">
                <button type="button" class="nl-close" data-close-provider>&times;</button>
                <div class="nl-modal-header">
                    <h3 id="nexlanceProviderTitle">Choose your payment gateway</h3>
                    <p id="nexlanceProviderText">Select Stripe or Polar to continue to secure hosted checkout.</p>
                </div>
                <div class="nl-modal-body">
                    <div class="nl-payment-summary">
                        <div>
                            <strong id="nexlanceProviderSummaryTitle">Checkout</strong>
                            <span id="nexlanceProviderSummaryText">Hosted secure payment</span>
                        </div>
                        <div class="nl-payment-amount" id="nexlanceProviderAmount">EUR 0.00</div>
                    </div>
                    <div class="nl-provider-actions">
                        <button type="button" class="nl-btn nl-provider-card" data-provider="stripe">
                            <strong>Stripe</strong>
                            <span>Hosted card checkout with Stripe.</span>
                        </button>
                        <button type="button" class="nl-btn nl-provider-card" data-provider="polar">
                            <strong>Polar</strong>
                            <span>Hosted checkout with Polar.</span>
                        </button>
                    </div>
                    <div id="nexlanceProviderMessage" class="nl-payment-message"></div>
                </div>
            </div>
        `;

        document.body.appendChild(authOverlay);
        document.body.appendChild(providerOverlay);

        authOverlay.addEventListener('click', event => {
            if (event.target === authOverlay) hideOverlay(authOverlay);
        });
        providerOverlay.addEventListener('click', event => {
            if (event.target === providerOverlay) closeProviderModal();
        });
        document.querySelector('[data-close-auth]').addEventListener('click', () => hideOverlay(authOverlay));
        document.querySelector('[data-close-provider]').addEventListener('click', closeProviderModal);
        providerOverlay.querySelectorAll('[data-provider]').forEach(button => {
            button.addEventListener('click', () => handleProviderSelection(button.getAttribute('data-provider')));
        });
    }

    function showOverlay(overlay) {
        ensureMarkup();
        overlay.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    function hideOverlay(overlay) {
        overlay.classList.remove('show');
        if (!document.querySelector('.nl-modal-overlay.show')) {
            document.body.style.overflow = '';
        }
    }

    function formatAmount(amountCents, currency) {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: String(currency || 'eur').toUpperCase()
        }).format((Number(amountCents) || 0) / 100);
    }

    function setProviderMessage(message, type) {
        const el = document.getElementById('nexlanceProviderMessage');
        if (!el) return;
        el.textContent = message || '';
        el.className = 'nl-payment-message' + (type ? ` ${type}` : '');
    }

    function applyProviderAvailability(availability) {
        const buttons = Array.from(document.querySelectorAll('#nexlanceProviderOverlay [data-provider]'));
        buttons.forEach(button => {
            const provider = button.getAttribute('data-provider');
            const isAvailable = !availability || availability[provider] !== false;
            button.disabled = !isAvailable;
            button.setAttribute('aria-disabled', isAvailable ? 'false' : 'true');
        });
    }

    function getAvailabilityMessage(availability) {
        if (!availability) return '';
        if (availability.stripe === false && availability.polar === false) {
            return 'Secure hosted checkout is not configured right now. Please try again later.';
        }
        if (availability.stripe === false) {
            return 'Stripe checkout is unavailable right now. Please choose Polar.';
        }
        if (availability.polar === false) {
            return 'Polar checkout is unavailable right now. Please choose Stripe.';
        }
        return '';
    }

    function showAuthPrompt(options) {
        ensureMarkup();
        const overlay = document.getElementById('nexlanceAuthOverlay');
        const title = document.getElementById('nexlanceAuthTitle');
        const text = document.getElementById('nexlanceAuthText');
        const registerLink = document.getElementById('nexlanceAuthRegister');
        const loginLink = document.getElementById('nexlanceAuthLogin');
        const redirectTarget = options && options.redirectTarget ? options.redirectTarget : getCurrentPageWithQuery();

        title.textContent = (options && options.title) || 'Create an account or log in first';
        text.textContent = (options && options.message) || 'You need to sign in before continuing to secure checkout.';
        registerLink.href = `login.html?mode=register&redirect=${encodeURIComponent(redirectTarget)}`;
        loginLink.href = `login.html?redirect=${encodeURIComponent(redirectTarget)}`;
        showOverlay(overlay);
    }

    function openProviderModal(options) {
        ensureMarkup();
        activeCheckoutOptions = Object.assign({}, options);
        document.getElementById('nexlanceProviderTitle').textContent = options.title || 'Choose your payment gateway';
        document.getElementById('nexlanceProviderText').textContent = options.message || 'Select Stripe or Polar to continue to secure hosted checkout.';
        document.getElementById('nexlanceProviderSummaryTitle').textContent = options.summaryTitle || 'Checkout';
        document.getElementById('nexlanceProviderSummaryText').textContent = options.summaryText || 'Hosted secure payment';
        document.getElementById('nexlanceProviderAmount').textContent = formatAmount(options.amount, options.currency || 'eur');
        applyProviderAvailability(options.gatewayAvailability || null);
        const availabilityMessage = getAvailabilityMessage(options.gatewayAvailability || null);
        setProviderMessage(availabilityMessage, availabilityMessage ? 'error' : '');
        showOverlay(document.getElementById('nexlanceProviderOverlay'));
    }

    function closeProviderModal() {
        const overlay = document.getElementById('nexlanceProviderOverlay');
        if (overlay) hideOverlay(overlay);
        activeCheckoutOptions = null;
        setProviderMessage('', '');
    }

    async function handleProviderSelection(provider) {
        if (!activeCheckoutOptions) return;
        if (activeCheckoutOptions.gatewayAvailability && activeCheckoutOptions.gatewayAvailability[provider] === false) {
            setProviderMessage(getAvailabilityMessage(activeCheckoutOptions.gatewayAvailability), 'error');
            return;
        }

        const buttons = Array.from(document.querySelectorAll('#nexlanceProviderOverlay [data-provider]'));
        buttons.forEach(button => {
            button.disabled = true;
        });
        setProviderMessage('Creating secure checkout...', '');

        try {
            const response = await fetch(getApiUrl('/api/checkout-start'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    provider,
                    productCode: activeCheckoutOptions.productCode,
                    userEmail: getCurrentUserEmail(),
                    userName: getCurrentUserName(),
                    templateId: activeCheckoutOptions.templateId || '',
                    templateName: activeCheckoutOptions.templateName || '',
                    siteBaseUrl: /^https?:$/i.test(window.location.protocol) && window.location.origin && window.location.origin !== 'null'
                        ? window.location.origin
                        : getApiBaseUrl()
                })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                throw new Error(data.error || 'Checkout could not be started.');
            }
            if (!data.redirectUrl) {
                throw new Error('The payment gateway did not return a redirect URL.');
            }
            setProviderMessage('Redirecting to secure checkout...', 'success');
            window.location.href = data.redirectUrl;
        } catch (error) {
            setProviderMessage(error.message || 'Checkout could not be started.', 'error');
            applyProviderAvailability(activeCheckoutOptions.gatewayAvailability || null);
        }
    }

    async function startHostedCheckout(options) {
        const redirectTarget = (options && options.redirectTarget) || getCurrentPageWithQuery();

        if (!isLoggedIn()) {
            showAuthPrompt({
                title: 'Create an account or log in first',
                message: 'Please create your account first. After that, secure checkout will open automatically.',
                redirectTarget
            });
            return;
        }

        let gatewayAvailability = null;
        try {
            const paymentConfig = await fetchPaymentConfig();
            gatewayAvailability = getGatewayAvailabilityForProduct(paymentConfig, options.productCode);
        } catch (error) {
            console.warn('Payment config could not be loaded:', error);
        }

        openProviderModal({
            amount: options.amount,
            currency: options.currency || 'eur',
            productCode: options.productCode,
            templateId: options.templateId || '',
            templateName: options.templateName || '',
            gatewayAvailability,
            title: options.title || 'Choose your payment gateway',
            message: options.message || 'Select Stripe or Polar to continue to secure hosted checkout.',
            summaryTitle: options.summaryTitle || 'Checkout',
            summaryText: options.summaryText || 'Hosted secure payment'
        });
    }

    async function completeCheckoutFromQuery(options) {
        const params = new URLSearchParams(window.location.search);
        const status = String(params.get('checkout_result') || '').trim().toLowerCase();
        const provider = String(params.get('provider') || '').trim().toLowerCase();
        if (!status || !provider) {
            return null;
        }

        if (status === 'cancelled') {
            if (typeof options.onCancel === 'function') {
                options.onCancel({ provider, productCode: params.get('product') || '' });
            }
            return { cancelled: true, provider };
        }

        if (status !== 'success') {
            return null;
        }

        const sessionId = String(params.get('session_id') || '').trim();
        const checkoutId = String(params.get('checkout_id') || '').trim();
        const response = await fetch(getApiUrl('/api/checkout-complete'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                provider,
                sessionId,
                checkoutId
            })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || 'Checkout could not be verified.');
        }

        if (typeof options.onSuccess === 'function') {
            await options.onSuccess(data);
        }

        applyCheckoutResultLocally(data);

        return data;
    }

    async function autoHandleHostedCheckoutReturn() {
        const params = new URLSearchParams(window.location.search);
        const status = String(params.get('checkout_result') || '').trim().toLowerCase();
        const provider = String(params.get('provider') || '').trim().toLowerCase();
        const pageName = window.location.pathname.split('/').pop() || 'index.html';

        if (!status || !provider) {
            return;
        }

        if (pageName === 'index.html' && params.get('template')) {
            return;
        }

        try {
            const payload = await completeCheckoutFromQuery({
                onSuccess: async data => {
                    window.dispatchEvent(new CustomEvent('nexlance-checkout-completed', { detail: data }));
                },
                onCancel: detail => {
                    window.dispatchEvent(new CustomEvent('nexlance-checkout-cancelled', { detail }));
                }
            });

            if (payload && !payload.cancelled) {
                params.delete('checkout_result');
                params.delete('provider');
                params.delete('session_id');
                params.delete('checkout_id');
                params.delete('product');
                const nextQuery = params.toString();
                const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash || ''}`;
                window.history.replaceState({}, document.title, nextUrl);
            }
        } catch (error) {
            console.error('Hosted checkout return failed:', error);
            window.dispatchEvent(new CustomEvent('nexlance-checkout-error', { detail: { message: error.message || 'Checkout could not be verified.' } }));
        }
    }

    ensureMarkup();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', autoHandleHostedCheckoutReturn);
    } else {
        autoHandleHostedCheckoutReturn();
    }

    window.NexlancePayments = {
        applyCheckoutResultLocally,
        closeProviderModal,
        completeCheckoutFromQuery,
        getApiUrl,
        getCurrentPageWithQuery,
        getCurrentUser,
        getCurrentUserEmail,
        isLoggedIn,
        showAuthPrompt,
        startBusinessCheckout: startHostedCheckout,
        startHostedCheckout,
        startTemplatePayment: startHostedCheckout
    };
})();
