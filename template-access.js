(function () {
    const DEFAULT_TEMPLATE_ID = 'startup-landing-template';
    const TEMPLATE_ACCESS_MODAL_ID = 'templateAccessSuccessModal';
    const TEMPLATE_ACCESS_MODAL_STYLE_ID = 'templateAccessSuccessStyles';

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

    function getCurrentUserEmail() {
        const currentUser = getCurrentUser();
        return currentUser && currentUser.email ? String(currentUser.email).trim().toLowerCase() : '';
    }

    function isLoggedIn() {
        return localStorage.getItem('nexlance_auth') === '1';
    }

    function getTemplateAccessStorageKey(email) {
        const normalized = String(email || '').trim().toLowerCase();
        return normalized ? `nexlance_template_access_${normalized}` : 'nexlance_template_access';
    }

    function buildProjectsAccessUrl(templateId) {
        return `projects.html?template=${encodeURIComponent(templateId)}&template_source=license`;
    }

    function getStoredTemplateAccess(email) {
        try {
            return JSON.parse(localStorage.getItem(getTemplateAccessStorageKey(email)) || localStorage.getItem('nexlance_template_access') || 'null');
        } catch (error) {
            return null;
        }
    }

    function persistTemplateAccess(templateId) {
        const email = getCurrentUserEmail();
        const existing = getStoredTemplateAccess(email) || {};
        const templateIds = Array.isArray(existing.templateIds) ? existing.templateIds.filter(Boolean) : [];
        const nextTemplateIds = templateIds.includes(templateId) ? templateIds : templateIds.concat(templateId);
        const accessRecord = {
            userEmail: email,
            allTemplatesAccess: false,
            templateIds: nextTemplateIds,
            sourceProductCode: existing.sourceProductCode || 'license_key',
            endsAt: existing.endsAt || '',
            updatedAt: new Date().toISOString()
        };
        localStorage.setItem(getTemplateAccessStorageKey(email), JSON.stringify(accessRecord));
        localStorage.setItem('nexlance_template_access', JSON.stringify(accessRecord));
    }

    function ensureSuccessModal() {
        if (!document.getElementById(TEMPLATE_ACCESS_MODAL_STYLE_ID)) {
            const style = document.createElement('style');
            style.id = TEMPLATE_ACCESS_MODAL_STYLE_ID;
            style.textContent = `
                .template-access-success-overlay {
                    position: fixed;
                    inset: 0;
                    background: rgba(15, 23, 42, 0.7);
                    display: none;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                    z-index: 12050;
                    backdrop-filter: blur(6px);
                }
                .template-access-success-overlay.show {
                    display: flex;
                }
                .template-access-success-modal {
                    width: min(100%, 520px);
                    background: #ffffff;
                    border-radius: 24px;
                    box-shadow: 0 30px 70px rgba(15, 23, 42, 0.25);
                    padding: 28px;
                    position: relative;
                }
                .template-access-success-modal h3 {
                    margin: 0 0 12px;
                    font-size: 1.9rem;
                    color: #111827;
                }
                .template-access-success-modal p {
                    margin: 0 0 14px;
                    color: #475569;
                    line-height: 1.7;
                }
                .template-access-success-actions {
                    display: flex;
                    gap: 12px;
                    flex-wrap: wrap;
                    margin-top: 20px;
                }
                .template-access-success-actions button,
                .template-access-success-actions a {
                    border: none;
                    border-radius: 999px;
                    padding: 13px 18px;
                    font-weight: 700;
                    text-decoration: none;
                    cursor: pointer;
                    text-align: center;
                }
                .template-access-success-primary {
                    background: #111111;
                    color: #ffffff;
                    flex: 1 1 220px;
                }
                .template-access-success-secondary {
                    background: #eef2ff;
                    color: #4338ca;
                    flex: 1 1 160px;
                }
                .template-access-success-close {
                    position: absolute;
                    top: 14px;
                    right: 14px;
                    width: 36px;
                    height: 36px;
                    border-radius: 50%;
                    border: none;
                    background: #f8fafc;
                    color: #475569;
                    cursor: pointer;
                }
            `;
            document.head.appendChild(style);
        }

        if (document.getElementById(TEMPLATE_ACCESS_MODAL_ID)) {
            return document.getElementById(TEMPLATE_ACCESS_MODAL_ID);
        }

        const overlay = document.createElement('div');
        overlay.id = TEMPLATE_ACCESS_MODAL_ID;
        overlay.className = 'template-access-success-overlay';
        overlay.innerHTML = `
            <div class="template-access-success-modal" role="dialog" aria-modal="true" aria-labelledby="templateAccessSuccessTitle">
                <button type="button" class="template-access-success-close" data-template-access-close>&times;</button>
                <h3 id="templateAccessSuccessTitle">Template unlocked</h3>
                <p id="templateAccessSuccessMessage">Your template is now available in the Projects section on your dashboard.</p>
                <div class="template-access-success-actions">
                    <a href="projects.html" class="template-access-success-primary" id="templateAccessSuccessGo">Go to Projects</a>
                    <button type="button" class="template-access-success-secondary" data-template-access-close>Stay Here</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        overlay.addEventListener('click', function (event) {
            if (event.target === overlay) {
                overlay.classList.remove('show');
                document.body.style.overflow = '';
            }
        });
        overlay.querySelectorAll('[data-template-access-close]').forEach(function (button) {
            button.addEventListener('click', function () {
                overlay.classList.remove('show');
                document.body.style.overflow = '';
            });
        });

        return overlay;
    }

    function showTemplateUnlockedModal(templateId, templateName) {
        const overlay = ensureSuccessModal();
        const message = document.getElementById('templateAccessSuccessMessage');
        const primaryAction = document.getElementById('templateAccessSuccessGo');
        if (message) {
            message.textContent = `${templateName} is now available in the Projects section on your dashboard.`;
        }
        if (primaryAction) {
            primaryAction.href = buildProjectsAccessUrl(templateId);
        }
        overlay.classList.add('show');
        document.body.style.overflow = 'hidden';
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
            if (!isLoggedIn()) {
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

            if (payload.mode === 'license') {
                const unlockedTemplateId = payload.templateId || templateId;
                persistTemplateAccess(unlockedTemplateId);
                setStatus('License key validated. Redirecting you to Projects...', 'success');
                window.location.href = payload.redirectUrl || buildProjectsAccessUrl(unlockedTemplateId);
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
