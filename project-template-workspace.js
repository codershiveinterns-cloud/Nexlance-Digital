(() => {
    const TEMPLATE_DOWNLOAD_AMOUNT_CENTS = 19900;
    const DEFAULT_BILLING_CURRENCY = (() => {
        const sharedCurrency = window.NEXLANCE_BILLING_CATALOG
            && typeof window.NEXLANCE_BILLING_CATALOG.DEFAULT_CURRENCY === 'string'
            ? window.NEXLANCE_BILLING_CATALOG.DEFAULT_CURRENCY
            : 'gbp';
        const normalized = String(sharedCurrency || '').trim().toLowerCase();
        return normalized || 'gbp';
    })();
    let workspaceMounted = false;
    let hasUnsavedChanges = false;
    let workspaceActionInFlight = false;
    let lastWorkspaceError = { message: '', at: 0 };

    function getCurrentProject() {
        if (typeof window.getProjectDetailProject === 'function') {
            return resolveWorkspaceProject(window.getProjectDetailProject());
        }
        return null;
    }

    function normalizeTemplateLookupValue(value) {
        return String(value || '')
            .trim()
            .toLowerCase()
            .replace(/\.html$/, '')
            .replace(/\s+project$/, '');
    }

    function resolveWorkspaceProject(project) {
        if (!project || typeof project !== 'object') return null;

        const explicitCandidates = [
            project.template_id,
            project.template_page,
            project.template_name
        ];

        let templateConfig = null;
        if (typeof window.getTemplateConfig === 'function') {
            templateConfig = explicitCandidates
                .map(candidate => window.getTemplateConfig(candidate))
                .find(Boolean) || null;
        }

        if (!templateConfig && window.NEXLANCE_TEMPLATE_REGISTRY) {
            const registry = Object.values(window.NEXLANCE_TEMPLATE_REGISTRY);
            const projectName = normalizeTemplateLookupValue(project.name);
            const deliverables = normalizeTemplateLookupValue(project.deliverables);
            const scope = normalizeTemplateLookupValue(project.scope_of_work);

            templateConfig = registry.find(template => {
                const templateId = normalizeTemplateLookupValue(template.id);
                const templatePage = normalizeTemplateLookupValue(template.page);
                const templateName = normalizeTemplateLookupValue(template.name);
                return (
                    projectName === templateId
                    || projectName === templatePage
                    || projectName === templateName
                    || (deliverables && deliverables.includes(templateName))
                    || (scope && scope.includes(templateName))
                );
            }) || null;
        }

        if (!templateConfig) {
            return project;
        }

        return {
            ...project,
            template_id: project.template_id || templateConfig.id,
            template_name: project.template_name || templateConfig.name,
            template_page: project.template_page || templateConfig.page,
            template_category: project.template_category || templateConfig.category,
            template_image: project.template_image || templateConfig.image,
            template_description: project.template_description || templateConfig.description
        };
    }

    function slugify(value) {
        return String(value || 'template-project')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'template-project';
    }

    function wait(ms) {
        return new Promise(resolve => window.setTimeout(resolve, ms));
    }

    async function waitForProject() {
        for (let attempt = 0; attempt < 80; attempt += 1) {
            if (typeof window.getProjectDetailProject === 'function') {
                const project = window.getProjectDetailProject();
                if (project) return project;
            }
            await wait(120);
        }
        return null;
    }

    function ensureWorkspaceStyles() {
        if (document.getElementById('projectTemplateWorkspaceStyles')) return;

        const style = document.createElement('style');
        style.id = 'projectTemplateWorkspaceStyles';
        style.textContent = `
            .workspace-shell {
                display: grid;
                gap: 18px;
            }

            .workspace-toolbar {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 16px;
                padding: 18px 20px;
                border-radius: 18px;
                background: linear-gradient(135deg, #f5f3ff, #ffffff);
                border: 1px solid #e6defa;
            }

            .workspace-toolbar h3 {
                margin: 0 0 6px;
                color: #2d1b69;
            }

            .workspace-toolbar p {
                margin: 0;
                color: #706b84;
                line-height: 1.6;
            }

            .workspace-actions {
                display: flex;
                flex-wrap: wrap;
                gap: 10px;
                justify-content: flex-end;
            }

            .workspace-actions button {
                border: none;
                border-radius: 999px;
                padding: 11px 16px;
                font-weight: 700;
                cursor: pointer;
            }

            .workspace-actions button:disabled {
                cursor: not-allowed;
                opacity: 0.55;
                box-shadow: none;
            }

            .workspace-actions .primary {
                background: linear-gradient(135deg, #4b3fbf, #6c5ce7);
                color: #fff;
            }

            .workspace-actions .secondary {
                background: #eef2ff;
                color: #4338ca;
            }

            .workspace-actions .success {
                background: linear-gradient(135deg, #0f8b5f, #00b894);
                color: #fff;
            }

            .workspace-actions .ghost {
                background: #f3f4f6;
                color: #374151;
            }

            .workspace-frame-card {
                background: #fff;
                border-radius: 22px;
                border: 1px solid #ece7fb;
                box-shadow: 0 14px 32px rgba(76, 63, 191, 0.08);
                overflow: hidden;
            }

            .workspace-meta {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 12px;
                padding: 14px 18px;
                border-bottom: 1px solid #ece7fb;
                background: #faf8ff;
                color: #655f7a;
                font-size: 0.88rem;
            }

            .workspace-meta strong {
                color: #2d1b69;
            }

            .workspace-frame {
                width: 100%;
                min-height: 1100px;
                border: none;
                background: #fff;
            }

            @media (max-width: 900px) {
                .workspace-toolbar {
                    flex-direction: column;
                    align-items: stretch;
                }

                .workspace-actions {
                    justify-content: flex-start;
                }
            }
        `;
        document.head.appendChild(style);
    }

    function injectWorkspaceTab() {
        if (document.getElementById('templateWorkspaceTab')) return;

        const tabs = document.querySelector('.tabs');
        const overviewTab = tabs ? tabs.querySelector('.tab.active') : null;
        if (!tabs || !overviewTab) return;

        const tab = document.createElement('div');
        tab.className = 'tab';
        tab.id = 'templateWorkspaceTab';
        tab.textContent = 'Template Workspace';
        tab.addEventListener('click', () => {
            openWorkspaceTab();
        });
        tabs.appendChild(tab);

        const content = document.createElement('div');
        content.className = 'tab-content';
        content.id = 'tab-workspace';
        content.innerHTML = `
            <div class="workspace-shell">
                <div class="workspace-toolbar">
                    <div>
                        <h3 id="workspaceTitle">Template Workspace</h3>
                        <p id="workspaceDescription">Edit this template, save your changes, complete the project, and download the final version after payment.</p>
                    </div>
                    <div class="workspace-actions">
                        <button type="button" class="secondary" id="workspaceEditBtn">Edit Mode</button>
                        <button type="button" class="primary" id="workspaceSaveBtn">Save Changes</button>
                        <button type="button" class="success" id="workspaceCompleteBtn">Complete Project</button>
                        <button type="button" class="ghost" id="workspaceDownloadBtn">Download</button>
                    </div>
                </div>
                <div class="workspace-frame-card">
                    <div class="workspace-meta">
                        <span><strong>Status:</strong> <span id="workspaceStatus">Draft</span></span>
                        <span id="workspaceSaveMeta">No saved changes yet</span>
                    </div>
                    <iframe id="templateWorkspaceFrame" class="workspace-frame" title="Template workspace preview"></iframe>
                </div>
            </div>
        `;

        const kanbanTab = document.getElementById('tab-kanban');
        if (kanbanTab && kanbanTab.parentNode) {
            kanbanTab.parentNode.appendChild(content);
        }
    }

    function openWorkspaceTab() {
        const project = getCurrentProject();
        if (!project || !project.template_id || !project.template_page) return;

        ensureWorkspaceLoaded(project);

        const workspaceTab = document.getElementById('templateWorkspaceTab');
        if (workspaceTab && typeof window.switchTab === 'function') {
            window.switchTab(workspaceTab, 'workspace');
        }
    }

    function setWorkspaceDirty(dirty) {
        hasUnsavedChanges = Boolean(dirty);
    }

    function normalizeTemplateState(templateState, project) {
        const fallbackState = {
            templateId: project && project.template_id ? project.template_id : '',
            templatePage: project && project.template_page ? project.template_page : '',
            templateName: project && (project.template_name || project.name) ? (project.template_name || project.name) : '',
            savedAt: new Date().toISOString(),
            elements: []
        };
        const baseState = templateState && typeof templateState === 'object' ? templateState : {};
        const sourceElements = Array.isArray(baseState.elements) ? baseState.elements : [];

        return {
            templateId: String(baseState.templateId || fallbackState.templateId || ''),
            templatePage: String(baseState.templatePage || fallbackState.templatePage || ''),
            templateName: String(baseState.templateName || fallbackState.templateName || ''),
            savedAt: String(baseState.savedAt || fallbackState.savedAt),
            elements: sourceElements
                .map(item => ({
                    key: String(item && item.key != null ? item.key : ''),
                    html: String(item && item.html != null ? item.html : '')
                }))
                .filter(item => item.key !== '')
        };
    }

    function getSerializableTemplateState(templateState, project) {
        const normalized = normalizeTemplateState(templateState, project);
        try {
            return JSON.parse(JSON.stringify(normalized));
        } catch (error) {
            console.warn('Could not JSON-serialize template state directly, using shared sanitizer.', error);
            if (typeof sanitizeFirestoreData === 'function') {
                return sanitizeFirestoreData(normalized);
            }
            return normalized;
        }
    }

    function getWorkspaceButtons() {
        return [
            document.getElementById('workspaceEditBtn'),
            document.getElementById('workspaceSaveBtn'),
            document.getElementById('workspaceCompleteBtn'),
            document.getElementById('workspaceDownloadBtn')
        ].filter(Boolean);
    }

    function setWorkspaceBusy(isBusy) {
        getWorkspaceButtons().forEach(button => {
            button.disabled = Boolean(isBusy);
        });
    }

    function showWorkspaceError(message) {
        const nextMessage = String(message || 'Could not save the template changes.');
        const now = Date.now();
        if (lastWorkspaceError.message === nextMessage && now - lastWorkspaceError.at < 2500) {
            return;
        }
        lastWorkspaceError = { message: nextMessage, at: now };
        showToast(nextMessage, 'error');
    }

    async function runWorkspaceAction(action) {
        if (workspaceActionInFlight) return;
        workspaceActionInFlight = true;
        setWorkspaceBusy(true);
        try {
            return await action();
        } finally {
            workspaceActionInFlight = false;
            setWorkspaceBusy(false);
            const currentProject = getCurrentProject();
            if (currentProject) {
                updateWorkspaceChrome(currentProject);
            }
        }
    }

    function updateWorkspaceChrome(project) {
        const statusEl = document.getElementById('workspaceStatus');
        const saveMetaEl = document.getElementById('workspaceSaveMeta');
        const downloadBtn = document.getElementById('workspaceDownloadBtn');
        const completeBtn = document.getElementById('workspaceCompleteBtn');
        if (!statusEl || !saveMetaEl || !downloadBtn || !completeBtn) return;

        const workflowStatus = project.template_workflow_status || 'draft';
        const savedAt = project.template_last_saved_at || project.updated_at || project.updatedAt || null;
        const completed = workflowStatus === 'completed';

        statusEl.textContent = completed ? 'Completed' : (workflowStatus === 'in_progress' ? 'In Progress' : 'Draft');
        saveMetaEl.textContent = savedAt
            ? `Last saved ${new Date(savedAt).toLocaleString()}`
            : 'No saved changes yet';
        completeBtn.disabled = completed;
        completeBtn.textContent = completed ? 'Project Completed' : 'Complete Project';
        downloadBtn.disabled = !completed;
        downloadBtn.textContent = project.template_download_paid ? 'Download Final Output' : 'Download (Pay GBP 199)';
    }

    async function saveTemplateState(projectId, templateState, options = {}) {
        const currentProject = getCurrentProject();
        const serializableTemplateState = getSerializableTemplateState(templateState, currentProject);
        const nextProgress = options.completed ? 100 : Math.max(Number(currentProject.progress || 0), 50);
        const nextStatus = options.completed ? 'Live' : (currentProject.status === 'Planning' ? 'Development' : currentProject.status || 'Development');
        const nextWorkflow = options.completed ? 'completed' : 'in_progress';
        console.debug('[TemplateWorkspace] Persisting template state', {
            projectId,
            completed: Boolean(options.completed),
            templateState: serializableTemplateState
        });
        await updateProject(projectId, {
            template_state: serializableTemplateState,
            template_last_saved_at: new Date().toISOString(),
            template_workflow_status: nextWorkflow,
            template_completed_at: options.completed ? new Date().toISOString() : (currentProject.template_completed_at || null),
            status: nextStatus,
            progress: nextProgress
        });

        const refreshedProject = typeof window.refreshProjectDetailProject === 'function'
            ? await window.refreshProjectDetailProject()
            : window.getProjectDetailProject();
        if (options.completed && typeof trackPlatformActivity === 'function') {
            await trackPlatformActivity('project_completed', {
                targetType: 'project',
                targetId: projectId,
                message: `Completed template project ${currentProject.template_name || currentProject.name || 'project'}.`,
                metadata: {
                    template_id: currentProject.template_id || '',
                    template_name: currentProject.template_name || '',
                    workflow_status: nextWorkflow
                }
            });
        }
        updateWorkspaceChrome(refreshedProject);
        setWorkspaceDirty(false);
        return refreshedProject;
    }

    function downloadHtmlFile(project, payload) {
        const filename = `${slugify(project.name || project.template_name || 'template-project')}.html`;
        const blob = new Blob([payload.html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async function unlockTemplateDownload(project, templateName) {
        if (project.template_download_paid) return project;

        if (!window.NexlancePayments || typeof window.NexlancePayments.startTemplatePayment !== 'function') {
            throw new Error('Secure template checkout is not available right now.');
        }

        await window.NexlancePayments.startTemplatePayment({
            amount: TEMPLATE_DOWNLOAD_AMOUNT_CENTS,
            currency: DEFAULT_BILLING_CURRENCY,
            productCode: 'template_download',
            templateId: project.template_id || '',
            templateName,
            title: 'Complete your template payment',
            message: 'Pay GBP 199 to unlock the final template download for this project.',
            summaryTitle: templateName || 'Template Download',
            summaryText: 'Final editable website output',
            buttonText: 'Pay GBP 199',
            metadata: {
                project_id: project.id,
                template_id: project.template_id || ''
            },
            onSuccess: async paymentIntent => {
                await updateProject(project.id, {
                    template_download_paid: true,
                    template_download_paid_at: new Date().toISOString(),
                    template_download_payment_intent_id: paymentIntent.id,
                    template_download_amount_gbp: 199
                });
                if (typeof recordPaymentRecord === 'function') {
                    await recordPaymentRecord({
                        paymentIntentId: paymentIntent.id,
                        amount: 199,
                        currency: DEFAULT_BILLING_CURRENCY.toUpperCase(),
                        paymentType: 'template_download',
                        templateId: project.template_id || '',
                        templateName: templateName || '',
                        projectId: project.id,
                        status: 'succeeded'
                    });
                }
                if (typeof trackPlatformActivity === 'function') {
                    await trackPlatformActivity('template_download_unlocked', {
                        targetType: 'project',
                        targetId: project.id,
                        message: `Unlocked download for ${templateName || project.template_name || 'template project'}.`,
                        metadata: {
                            payment_intent_id: paymentIntent.id,
                            template_id: project.template_id || '',
                            template_name: templateName || ''
                        }
                    });
                }
                const refreshedProject = typeof window.refreshProjectDetailProject === 'function'
                    ? await window.refreshProjectDetailProject()
                    : window.getProjectDetailProject();
                updateWorkspaceChrome(refreshedProject);
            }
        });

        return window.getProjectDetailProject();
    }

    function bindWorkspaceButtons(project) {
        const iframe = document.getElementById('templateWorkspaceFrame');
        const editBtn = document.getElementById('workspaceEditBtn');
        const saveBtn = document.getElementById('workspaceSaveBtn');
        const completeBtn = document.getElementById('workspaceCompleteBtn');
        const downloadBtn = document.getElementById('workspaceDownloadBtn');
        if (!iframe || !editBtn || !saveBtn || !completeBtn || !downloadBtn) return;

        editBtn.onclick = () => {
            if (workspaceActionInFlight) return;
            if (iframe.contentWindow && typeof iframe.contentWindow.enterTemplateWorkspaceEditMode === 'function') {
                iframe.contentWindow.enterTemplateWorkspaceEditMode();
            }
        };

        saveBtn.onclick = async () => runWorkspaceAction(async () => {
            try {
                if (!iframe.contentWindow || typeof iframe.contentWindow.saveTemplateWorkspaceChanges !== 'function') return;
                await iframe.contentWindow.saveTemplateWorkspaceChanges();
                showToast('Template changes saved to your project.', 'success');
            } catch (error) {
                console.error('Save failed:', error);
                showWorkspaceError(error.message || 'Could not save the template changes.');
            }
        });

        completeBtn.onclick = async () => runWorkspaceAction(async () => {
            try {
                if (!iframe.contentWindow || typeof iframe.contentWindow.completeTemplateWorkspaceProject !== 'function') return;
                await iframe.contentWindow.completeTemplateWorkspaceProject();
                showToast('Project marked as completed. Download is now available.', 'success');
            } catch (error) {
                console.error('Complete failed:', error);
                showWorkspaceError(error.message || 'Could not complete this project.');
            }
        });

        downloadBtn.onclick = async () => runWorkspaceAction(async () => {
            try {
                if (!iframe.contentWindow || typeof iframe.contentWindow.downloadTemplateWorkspaceOutput !== 'function') return;
                await iframe.contentWindow.downloadTemplateWorkspaceOutput();
            } catch (error) {
                console.error('Download failed:', error);
                showWorkspaceError(error.message || 'Could not download this template.');
            }
        });
    }

    function registerWorkspaceBridge() {
        window.NexlanceProjectWorkspace = {
            getProjectState(projectId) {
                const currentProject = getCurrentProject();
                if (!currentProject || currentProject.id !== projectId) return null;
                return getSerializableTemplateState(currentProject.template_state, currentProject);
            },
            async saveProjectTemplateState(projectId, templateState) {
                return saveTemplateState(projectId, templateState, { completed: false });
            },
            async completeProjectTemplate(projectId, templateState) {
                return saveTemplateState(projectId, templateState, { completed: true });
            },
            async downloadProjectTemplate(projectId, payload) {
                const currentProject = window.getProjectDetailProject();
                if (!currentProject || currentProject.id !== projectId) {
                    throw new Error('Project could not be found for download.');
                }
                if ((currentProject.template_workflow_status || '') !== 'completed') {
                    throw new Error('Complete the project before downloading the final output.');
                }
                const unlockedProject = await unlockTemplateDownload(currentProject, currentProject.template_name || currentProject.name);
                if (!payload || !payload.html) {
                    throw new Error('No project output is ready to download yet.');
                }
                downloadHtmlFile(unlockedProject, payload);
                showToast('Final template output downloaded successfully.', 'success');
                return unlockedProject;
            },
            setDirtyState: setWorkspaceDirty
        };
    }

    function ensureWorkspaceLoaded(project) {
        if (workspaceMounted || !project || !project.template_id || !project.template_page) return;

        const iframe = document.getElementById('templateWorkspaceFrame');
        if (!iframe) return;

        const pageUrl = `${project.template_page}?workspace=1&project=${encodeURIComponent(project.id)}`;
        iframe.src = pageUrl;
        bindWorkspaceButtons(project);
        workspaceMounted = true;
    }

    async function mountWorkspace(project) {
        if (!project || !project.template_id || !project.template_page) return;

        ensureWorkspaceStyles();
        injectWorkspaceTab();
        updateWorkspaceChrome(project);
        registerWorkspaceBridge();
    }

    async function initProjectTemplateWorkspace() {
        const pageName = window.location.pathname.split('/').pop() || 'index.html';
        if (pageName !== 'project-detail.html') return;

        const project = resolveWorkspaceProject(await waitForProject());
        if (!project || !project.template_id || !project.template_page) return;
        await mountWorkspace(project);
    }

    window.addEventListener('beforeunload', event => {
        if (!hasUnsavedChanges) return;
        event.preventDefault();
        event.returnValue = '';
    });

    document.addEventListener('DOMContentLoaded', initProjectTemplateWorkspace);
})();
