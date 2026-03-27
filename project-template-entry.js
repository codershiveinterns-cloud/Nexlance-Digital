(() => {
    const PENDING_TEMPLATE_KEY = 'nexlance_pending_template_selection';

    function getPendingTemplateSelection() {
        try {
            return JSON.parse(localStorage.getItem(PENDING_TEMPLATE_KEY) || 'null');
        } catch (error) {
            return null;
        }
    }

    function setPendingTemplateSelection(selection) {
        localStorage.setItem(PENDING_TEMPLATE_KEY, JSON.stringify(selection));
    }

    function clearPendingTemplateSelection() {
        localStorage.removeItem(PENDING_TEMPLATE_KEY);
    }

    function getTodayIso() {
        return new Date().toISOString().slice(0, 10);
    }

    function getFutureIso(days) {
        return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    }

    function buildProjectsLandingUrl(projectId) {
        return `projects.html?highlight=${encodeURIComponent(projectId)}&template_unlocked=1`;
    }

    async function createTemplateProject(template) {
        return addProject({
            name: `${template.name} Project`,
            client_name: 'Self',
            start_date: getTodayIso(),
            deadline: getFutureIso(30),
            status: 'Planning',
            assigned_team: 'You',
            progress: 10,
            scope_of_work: `Customize the ${template.name} template inside the dashboard workspace.`,
            deliverables: `Final editable website based on the ${template.name} template.`,
            template_id: template.id,
            template_name: template.name,
            template_page: template.page,
            template_category: template.category,
            template_image: template.image,
            template_description: template.description,
            template_state: { elements: [] },
            template_workflow_status: 'draft',
            template_download_paid: false
        });
    }

    async function maybeLaunchTemplateProject() {
        if ((window.location.pathname.split('/').pop() || 'index.html') !== 'projects.html') return;
        if (localStorage.getItem('nexlance_auth') !== '1') return;

        const params = new URLSearchParams(window.location.search);
        const templateId = params.get('template');
        if (!templateId) return;

        const pendingSelection = getPendingTemplateSelection();
        const template = typeof getTemplateConfig === 'function'
            ? getTemplateConfig(templateId)
            : null;

        if (!template) return;

        try {
            const existingProjects = await fetchProjects();
            const pendingProjectId = pendingSelection && pendingSelection.projectId ? pendingSelection.projectId : '';
            const pendingProject = pendingProjectId
                ? existingProjects.find(project => project.id === pendingProjectId)
                : null;

            if (pendingProject && pendingProject.template_id === template.id) {
                if (typeof trackPlatformActivity === 'function') {
                    await trackPlatformActivity('template_usage', {
                        targetType: 'project',
                        targetId: pendingProject.id,
                        message: `Loaded ${template.name} project from Projects.`,
                        metadata: {
                            template_id: template.id,
                            template_name: template.name,
                            template_page: template.page,
                            action: 'load_existing'
                        }
                    });
                }
                clearPendingTemplateSelection();
                window.location.href = buildProjectsLandingUrl(pendingProject.id);
                return;
            }

            const createdProject = await createTemplateProject(template);
            if (typeof trackPlatformActivity === 'function') {
                await trackPlatformActivity('template_usage', {
                    targetType: 'project',
                    targetId: createdProject.id,
                    message: `Created a project from the ${template.name} template.`,
                    metadata: {
                        template_id: template.id,
                        template_name: template.name,
                        template_page: template.page,
                        action: 'create_project'
                    }
                });
            }
            clearPendingTemplateSelection();
            window.location.href = buildProjectsLandingUrl(createdProject.id);
        } catch (error) {
            console.error('Could not create template project:', error);
            if (typeof showToast === 'function') {
                showToast('Could not open the template in Projects. Please try again.', 'error');
            }
        }
    }

    document.addEventListener('DOMContentLoaded', maybeLaunchTemplateProject);
})();
