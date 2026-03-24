(function () {
    const DEFAULT_TEMPLATE_ID = 'startup-landing-template';

    function getApiUrl(pathname) {
        if (window.NexlancePayments && typeof window.NexlancePayments.getApiUrl === 'function') {
            return window.NexlancePayments.getApiUrl(pathname);
        }

        const normalizedPath = String(pathname || '').startsWith('/')
            ? String(pathname)
            : `/${String(pathname || '')}`;

        if (/^https?:$/i.test(window.location.protocol)) {
            return `${window.location.origin}${normalizedPath}`;
        }

        return `http://localhost:4242${normalizedPath}`;
    }

    function resolveTemplateId() {
        const params = new URLSearchParams(window.location.search);
        const explicit = String(params.get('template') || '').trim().toLowerCase();
        if (explicit) {
            return explicit;
        }
        return DEFAULT_TEMPLATE_ID;
    }

    function getTemplateConfig(templateId) {
        if (typeof window.getTemplateConfig === 'function') {
            return window.getTemplateConfig(templateId);
        }
        return null;
    }

    function getTemplateDisplayName(templateId) {
        const template = getTemplateConfig(templateId);
        return template && template.name ? template.name : 'Startup Landing';
    }

    function getSiteBaseUrl() {
        if (/^https?:$/i.test(window.location.protocol) && window.location.origin) {
            return window.location.origin;
        }

        return getApiUrl('').replace(/\/+$/, '');
    }

    function setStatus(message, type) {
        const status = document.getElementById('templateAccessStatus');
        if (!status) return;
        status.textContent = message || '';
        status.className = `template-access-status${type ? ` ${type}` : ''}`;
    }

    function setBusy(isBusy) {
        const button = document.getElementById('templateAccessSubmit');
        if (!button) return;
        button.disabled = Boolean(isBusy);
        button.textContent = isBusy ? 'Processing...' : 'Continue';
    }

    function updateTemplateLabels() {
        const templateId = resolveTemplateId();
        const templateName = getTemplateDisplayName(templateId);
        const nameEl = document.getElementById('templateAccessTemplateName');
        const inputEl = document.getElementById('templateAccessTemplateId');

        if (nameEl) {
            nameEl.textContent = templateName;
        }
        if (inputEl) {
            inputEl.value = templateId;
        }
    }

    function getCurrentUser() {
        try {
            return JSON.parse(localStorage.getItem('nexlance_user') || 'null');
        } catch (error) {
            return null;
        }
    }

    function isLoggedIn() {
        return localStorage.getItem('nexlance_auth') === '1';
    }

    function syncUserFields() {
        const currentUser = getCurrentUser();
        if (!currentUser) return;

        const nameField = document.getElementById('templateAccessName');
        const emailField = document.getElementById('templateAccessEmail');
        if (nameField && !nameField.value.trim()) {
            nameField.value = currentUser.name || '';
        }
        if (emailField) {
            emailField.value = currentUser.email || '';
        }
    }

    async function postJson(url, payload) {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json().catch(function () {
            return {};
        });

        if (!response.ok) {
            throw new Error(data.error || 'Request failed.');
        }

        return data;
    }

    function triggerDownload(downloadUrl) {
        const anchor = document.createElement('a');
        anchor.href = getApiUrl(downloadUrl);
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
    }

    async function handleFormSubmit(event) {
        event.preventDefault();

        const name = document.getElementById('templateAccessName').value.trim();
        const email = document.getElementById('templateAccessEmail').value.trim();
        const licenseKey = document.getElementById('templateAccessLicenseKey').value.trim();
        const templateId = document.getElementById('templateAccessTemplateId').value.trim();
        const selectedMethod = document.querySelector('input[name="templatePaymentMethod"]:checked');
        const paymentMethod = selectedMethod ? selectedMethod.value : '';

        setBusy(true);
        setStatus('', '');

        try {
            if (!licenseKey && !isLoggedIn()) {
                const redirectTarget = `index.html?template=${encodeURIComponent(templateId)}#template-access`;
                window.location.href = `login.html?mode=register&redirect=${encodeURIComponent(redirectTarget)}`;
                return;
            }

            const payload = await postJson(getApiUrl('/api/template-access-start'), {
                name: name,
                email: email,
                paymentMethod: paymentMethod,
                licenseKey: licenseKey,
                templateId: templateId,
                siteBaseUrl: getSiteBaseUrl()
            });

            if (payload.mode === 'license' && payload.downloadUrl) {
                setStatus('License key validated. Your template download is starting now.', 'success');
                triggerDownload(payload.downloadUrl);
                return;
            }

            if (payload.mode === 'payment' && payload.redirectUrl) {
                window.location.href = payload.redirectUrl;
                return;
            }

            throw new Error('The checkout response did not include a download or redirect URL.');
        } catch (error) {
            setStatus(error.message || 'Could not start template access.', 'error');
        } finally {
            setBusy(false);
        }
    }

    async function handleReturnFromCheckout() {
        const params = new URLSearchParams(window.location.search);
        const status = String(params.get('checkout_result') || params.get('template_access') || '').trim().toLowerCase();
        if (!status) {
            return;
        }

        const provider = String(params.get('provider') || '').trim().toLowerCase();
        const sessionId = String(params.get('session_id') || '').trim();
        const checkoutId = String(params.get('checkout_id') || '').trim();
        const templateId = resolveTemplateId();

        if (status === 'cancelled') {
            setStatus(`The ${provider || 'payment'} checkout was cancelled. You can try again or use a license key instead.`, 'error');
            return;
        }

        if (status !== 'success') {
            return;
        }

        setBusy(true);
        setStatus('Verifying your payment and preparing the download...', 'success');

        try {
            const payload = await postJson(getApiUrl('/api/template-access-complete'), {
                provider: provider,
                sessionId: sessionId,
                checkoutId: checkoutId,
                templateId: templateId
            });

            if (!payload.downloadUrl) {
                throw new Error('Payment was verified, but no download link was returned.');
            }

            if (window.NexlancePayments && typeof window.NexlancePayments.applyCheckoutResultLocally === 'function') {
                window.NexlancePayments.applyCheckoutResultLocally(payload);
            }

            triggerDownload(payload.downloadUrl);
            setStatus(`Payment confirmed for ${payload.templateName || getTemplateDisplayName(templateId)}. Your download is starting now.`, 'success');

            params.delete('template_access');
            params.delete('checkout_result');
            params.delete('provider');
            params.delete('product');
            params.delete('session_id');
            params.delete('checkout_id');
            const nextQuery = params.toString();
            const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ''}${window.location.hash || '#template-access'}`;
            window.history.replaceState({}, document.title, nextUrl);
        } catch (error) {
            setStatus(error.message || 'Could not verify the completed payment.', 'error');
        } finally {
            setBusy(false);
        }
    }

    document.addEventListener('DOMContentLoaded', function () {
        const form = document.getElementById('templateAccessForm');
        if (!form) {
            return;
        }

        updateTemplateLabels();
        syncUserFields();
        form.addEventListener('submit', handleFormSubmit);
        handleReturnFromCheckout();
    });
})();
