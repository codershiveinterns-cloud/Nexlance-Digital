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
            return JSON.parse(localStorage.getItem('nexlance_plan') || 'null');
        } catch (error) {
            return null;
        }
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

        if (!hasTemplateEntitlement(template)) {
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
