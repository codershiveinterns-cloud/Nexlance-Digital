(() => {
    const PENDING_TEMPLATE_KEY = 'nexlance_pending_template_selection';

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

    function getStoredTemplateAccess() {
        const email = getCurrentUserEmail();
        const scopedKey = email ? `nexlance_template_access_${email}` : 'nexlance_template_access';
        try {
            return JSON.parse(localStorage.getItem(scopedKey) || localStorage.getItem('nexlance_template_access') || 'null');
        } catch (error) {
            return null;
        }
    }

    function getStoredPlan() {
        try {
            const storedPlan = JSON.parse(localStorage.getItem('nexlance_plan') || 'null');
            if (!storedPlan || !storedPlan.code) {
                return storedPlan;
            }

            const normalizedCode = String(storedPlan.code || '').trim().toLowerCase();
            return {
                ...storedPlan,
                code: normalizedCode,
                allTemplatesAccess: normalizedCode === 'business' && storedPlan.paid === true,
                templateLimit: normalizedCode === 'pro'
                    ? Number(storedPlan.templateLimit || 4)
                    : (normalizedCode === 'business' ? Number(storedPlan.templateLimit || 8) : Number(storedPlan.templateLimit || 0))
            };
        } catch (error) {
            return null;
        }
    }

    function persistTemplateAccessRecord(accessRecord) {
        const email = getCurrentUserEmail();
        const scopedKey = email ? `nexlance_template_access_${email}` : 'nexlance_template_access';
        localStorage.setItem(scopedKey, JSON.stringify(accessRecord));
        localStorage.setItem('nexlance_template_access', JSON.stringify(accessRecord));
    }

    function getPlanTemplateLimit(plan) {
        if (!plan || plan.paid !== true) return 0;
        if (plan.allTemplatesAccess === true) return Number.MAX_SAFE_INTEGER;
        const explicitLimit = Number(plan.templateLimit || 0);
        if (Number.isFinite(explicitLimit) && explicitLimit > 0) {
            return explicitLimit;
        }
        return plan.code === 'pro' ? 4 : 0;
    }

    function hasTemplateEntitlement(template) {
        const access = getStoredTemplateAccess() || {};
        const templateIds = Array.isArray(access.templateIds) ? access.templateIds : [];
        const plan = getStoredPlan() || {};
        return Boolean(
            access.allTemplatesAccess
            || templateIds.includes(template.id)
            || (plan.allTemplatesAccess === true && plan.paid === true)
        );
    }

    function ensureTemplateEntitlement(template) {
        if (hasTemplateEntitlement(template)) {
            return true;
        }

        const access = getStoredTemplateAccess() || {};
        const templateIds = Array.isArray(access.templateIds)
            ? access.templateIds.filter(Boolean)
            : [];
        const plan = getStoredPlan() || {};
        const templateLimit = getPlanTemplateLimit(plan);

        if (!templateLimit || templateIds.length >= templateLimit) {
            return false;
        }

        persistTemplateAccessRecord({
            userEmail: getCurrentUserEmail(),
            allTemplatesAccess: false,
            templateIds: templateIds.concat(template.id),
            sourceProductCode: access.sourceProductCode || plan.code || '',
            endsAt: access.endsAt || plan.endsAt || '',
            updatedAt: new Date().toISOString()
        });

        return true;
    }

    function getProjectsRedirect(slug) {
        return `projects.html?template=${encodeURIComponent(slug)}`;
    }

    function storePendingTemplateSelection(template) {
        localStorage.setItem(PENDING_TEMPLATE_KEY, JSON.stringify({
            templateId: template.id,
            templatePage: template.page,
            templateName: template.name,
            storedAt: new Date().toISOString()
        }));
    }

    function redirectToTemplateWorkspace(template) {
        if (!template) return;

        if (!isLoggedIn()) {
            const redirectTarget = `index.html?template=${encodeURIComponent(template.id)}#template-access`;
            window.location.href = `login.html?mode=register&redirect=${encodeURIComponent(redirectTarget)}`;
            return;
        }

        if (!ensureTemplateEntitlement(template)) {
            window.location.href = `index.html?template=${encodeURIComponent(template.id)}#template-access`;
            return;
        }

        storePendingTemplateSelection(template);
        window.location.href = getProjectsRedirect(template.id);
    }

    function resolveTemplateFromNode(node) {
        if (!node) return null;

        const explicitId = node.getAttribute('data-template-id');
        if (explicitId && typeof getTemplateConfig === 'function') {
            return getTemplateConfig(explicitId);
        }

        const href = node.getAttribute('href') || '';
        if (href && typeof getTemplateConfig === 'function') {
            return getTemplateConfig(href);
        }

        return null;
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('.btn-use, [data-template-use]').forEach(link => {
            const template = resolveTemplateFromNode(link);
            if (!template) return;

            link.setAttribute('data-template-id', template.id);
            link.addEventListener('click', event => {
                event.preventDefault();
                redirectToTemplateWorkspace(template);
            });
        });

        const demoUseButton = document.querySelector('[data-template-demo-action]');
        if (demoUseButton) {
            const template = resolveTemplateFromNode(demoUseButton);
            if (template) {
                demoUseButton.setAttribute('href', getProjectsRedirect(template.id));
                demoUseButton.addEventListener('click', event => {
                    event.preventDefault();
                    redirectToTemplateWorkspace(template);
                });
            }
        }
    });
})();
