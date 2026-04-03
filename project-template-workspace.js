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
    let isWorkspaceEditMode = false;
    let workspaceActionInFlight = false;
    let lastWorkspaceError = { message: '', at: 0 };
    let workspaceCapabilities = createEmptyWorkspaceCapabilities();

    function isServerProject(project) {
        if (!project) return false;
        return project.is_persisted_project !== false && project.project_source !== 'local_fallback';
    }

    function createEmptyWorkspaceCapabilities() {
        return {
            view_template_workspace: false,
            edit_template: false,
            save_template: false,
            complete_template_project: false,
            download_template_output: false,
            admin_override: false
        };
    }

    function normalizeWorkspaceCapabilities(capabilities) {
        const fallback = createEmptyWorkspaceCapabilities();
        if (!capabilities || typeof capabilities !== 'object') {
            return fallback;
        }

        return Object.keys(fallback).reduce((result, key) => {
            result[key] = capabilities[key] === true;
            return result;
        }, { ...fallback });
    }

    function hasWorkspaceCapability(capability) {
        return workspaceCapabilities && workspaceCapabilities[capability] === true;
    }

    function getCurrentProject() {
        if (typeof window.getProjectDetailProject === 'function') {
            return mergeWorkspaceStateIntoProject(resolveWorkspaceProject(window.getProjectDetailProject()));
        }
        return null;
    }

    function getCurrentWorkspaceUserKey() {
        try {
            const currentUser = JSON.parse(localStorage.getItem('nexlance_user') || 'null');
            return String(currentUser && currentUser.email ? currentUser.email : 'guest').trim().toLowerCase() || 'guest';
        } catch (error) {
            return 'guest';
        }
    }

    function getWorkspaceStateStorageKey(projectId) {
        return `nexlance_template_workspace_${getCurrentWorkspaceUserKey()}_${String(projectId || '').trim()}`;
    }

    function getWorkspaceCheckoutStorageKey(projectId) {
        return `nexlance_template_workspace_checkout_${getCurrentWorkspaceUserKey()}_${String(projectId || '').trim()}`;
    }

    function getStoredWorkspaceState(projectId) {
        if (!projectId) return null;
        try {
            return JSON.parse(localStorage.getItem(getWorkspaceStateStorageKey(projectId)) || 'null');
        } catch (error) {
            return null;
        }
    }

    function persistWorkspaceState(projectId, payload) {
        if (!projectId || !payload || typeof payload !== 'object') return;
        localStorage.setItem(getWorkspaceStateStorageKey(projectId), JSON.stringify(payload));
    }

    function persistWorkspaceServerSnapshot(project) {
        if (!project || !project.id) return;
        persistWorkspaceState(project.id, {
            template_state: project.template_state || null,
            template_last_saved_at: project.template_last_saved_at || null,
            template_saved_html: project.template_saved_html || '',
            template_workflow_status: project.template_workflow_status || 'draft',
            template_completed_at: project.template_completed_at || null,
            template_download_paid: project.template_download_paid === true,
            template_download_paid_at: project.template_download_paid_at || null,
            template_download_payment_intent_id: project.template_download_payment_intent_id || '',
            template_download_amount_gbp: project.template_download_amount_gbp || null
        });
    }

    function getPendingWorkspaceCheckout(projectId) {
        if (!projectId) return null;
        try {
            return JSON.parse(localStorage.getItem(getWorkspaceCheckoutStorageKey(projectId)) || 'null');
        } catch (error) {
            return null;
        }
    }

    function persistPendingWorkspaceCheckout(projectId, payload) {
        if (!projectId) return;
        if (!payload) {
            localStorage.removeItem(getWorkspaceCheckoutStorageKey(projectId));
            return;
        }
        localStorage.setItem(getWorkspaceCheckoutStorageKey(projectId), JSON.stringify(payload));
    }

    function getTimestampValue(value) {
        const timestamp = new Date(value || '').getTime();
        return Number.isFinite(timestamp) ? timestamp : 0;
    }

    function mergeWorkspaceStateIntoProject(project) {
        if (!project || typeof project !== 'object' || !project.id) return project;

        const storedWorkspace = getStoredWorkspaceState(project.id);
        if (!storedWorkspace || typeof storedWorkspace !== 'object') {
            return project;
        }

        const storedSavedAt = storedWorkspace.template_last_saved_at || (storedWorkspace.template_state && storedWorkspace.template_state.savedAt) || '';
        const projectSavedAt = project.template_last_saved_at || (project.template_state && project.template_state.savedAt) || '';

        if (getTimestampValue(storedSavedAt) < getTimestampValue(projectSavedAt)) {
            return project;
        }

        return {
            ...project,
            template_state: storedWorkspace.template_state || project.template_state,
            template_last_saved_at: storedSavedAt || project.template_last_saved_at,
            template_saved_html: storedWorkspace.template_saved_html || project.template_saved_html,
            template_workflow_status: storedWorkspace.template_workflow_status || project.template_workflow_status,
            template_completed_at: storedWorkspace.template_completed_at || project.template_completed_at,
            template_download_paid_at: storedWorkspace.template_download_paid_at || project.template_download_paid_at,
            template_download_payment_intent_id: storedWorkspace.template_download_payment_intent_id || project.template_download_payment_intent_id,
            template_download_amount_gbp: storedWorkspace.template_download_amount_gbp || project.template_download_amount_gbp,
            template_download_paid: storedWorkspace.template_download_paid !== undefined
                ? storedWorkspace.template_download_paid
                : project.template_download_paid
        };
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

    function getApiUrl(pathname) {
        if (window.NexlancePayments && typeof window.NexlancePayments.getApiUrl === 'function') {
            return window.NexlancePayments.getApiUrl(pathname);
        }
        const normalizedPath = String(pathname || '').startsWith('/')
            ? String(pathname)
            : `/${String(pathname || '')}`;
        return normalizedPath;
    }

    function wait(ms) {
        return new Promise(resolve => window.setTimeout(resolve, ms));
    }

    async function authorizedWorkspaceRequest(path, method = 'GET', payload = null) {
        if (typeof authorizedApiRequest === 'function') {
            return authorizedApiRequest(path, method, payload);
        }

        if (typeof getDashboardBearerToken !== 'function') {
            throw new Error('Template workspace authentication is unavailable right now.');
        }

        const token = await getDashboardBearerToken();
        const response = await fetch(path, {
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin',
            body: payload !== null ? JSON.stringify(payload) : undefined
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const error = new Error(data.error || data.message || 'Template workspace request failed.');
            error.status = response.status;
            throw error;
        }
        return data;
    }

    function syncProjectDetailRecord(project) {
        if (!project || !project.id) return project;
        const nextProject = resolveWorkspaceProject(project);
        if (typeof upsertLocalEntityRecord === 'function') {
            upsertLocalEntityRecord('projects', nextProject);
        }
        if (typeof window.setProjectDetailProject === 'function') {
            window.setProjectDetailProject(nextProject);
        }
        persistWorkspaceServerSnapshot(nextProject);
        return nextProject;
    }

    async function fetchWorkspaceContext(projectId) {
        const payload = await authorizedWorkspaceRequest(`/api/project-template-workspace?projectId=${encodeURIComponent(projectId)}`, 'GET');
        workspaceCapabilities = normalizeWorkspaceCapabilities(payload && payload.capabilities ? payload.capabilities : null);
        const syncedProject = payload && payload.project
            ? syncProjectDetailRecord(payload.project)
            : getCurrentProject();
        return {
            project: syncedProject,
            capabilities: workspaceCapabilities
        };
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

    async function openWorkspaceTab() {
        const project = getCurrentProject();
        if (!project || !project.template_id || !project.template_page) return;

        if (!workspaceMounted) {
            await loadWorkspaceContextIfServer(project);
        } else {
            const content = document.getElementById('tab-workspace');
            if (!content || !content.querySelector('.workspace-frame-card')) {
                await loadWorkspaceContextIfServer(project);
            }
        }

        ensureWorkspaceLoaded(project);

        const workspaceTab = document.getElementById('templateWorkspaceTab');
        if (workspaceTab && typeof window.switchTab === 'function') {
            window.switchTab(workspaceTab, 'workspace');
        }
    }

    function setWorkspaceDirty(dirty) {
        hasUnsavedChanges = Boolean(dirty);
        const currentProject = getCurrentProject();
        if (currentProject) {
            updateWorkspaceChrome(currentProject);
        }
    }

    function setWorkspaceEditMode(active) {
        isWorkspaceEditMode = Boolean(active);
        const currentProject = getCurrentProject();
        if (currentProject) {
            updateWorkspaceChrome(currentProject);
        }
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
                    kind: String(item && item.kind != null ? item.kind : 'content'),
                    html: String(item && item.html != null ? item.html : ''),
                    src: String(item && item.src != null ? item.src : ''),
                    alt: String(item && item.alt != null ? item.alt : ''),
                    attrs: item && item.attrs && typeof item.attrs === 'object'
                        ? Object.keys(item.attrs).reduce((accumulator, key) => {
                            accumulator[String(key)] = String(item.attrs[key] != null ? item.attrs[key] : '');
                            return accumulator;
                        }, {})
                        : {}
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
        const resolvedProject = mergeWorkspaceStateIntoProject(project);
        const statusEl = document.getElementById('workspaceStatus');
        const saveMetaEl = document.getElementById('workspaceSaveMeta');
        const descriptionEl = document.getElementById('workspaceDescription');
        const editBtn = document.getElementById('workspaceEditBtn');
        const saveBtn = document.getElementById('workspaceSaveBtn');
        const downloadBtn = document.getElementById('workspaceDownloadBtn');
        const completeBtn = document.getElementById('workspaceCompleteBtn');
        if (!statusEl || !saveMetaEl || !editBtn || !saveBtn || !downloadBtn || !completeBtn) return;

        const workflowStatus = resolvedProject.template_workflow_status || 'draft';
        const savedAt = resolvedProject.template_last_saved_at
            || (resolvedProject.template_state && resolvedProject.template_state.savedAt)
            || resolvedProject.updated_at
            || resolvedProject.updatedAt
            || null;
        const completed = workflowStatus === 'completed';
        const needsSave = hasUnsavedChanges || isWorkspaceEditMode;
        const canEdit = hasWorkspaceCapability('edit_template');
        const canSave = hasWorkspaceCapability('save_template');
        const canComplete = hasWorkspaceCapability('complete_template_project');
        const canDownload = hasWorkspaceCapability('download_template_output');
        const canView = hasWorkspaceCapability('view_template_workspace');

        statusEl.textContent = completed ? 'Completed' : (workflowStatus === 'in_progress' ? 'In Progress' : 'Draft');
        if (needsSave) {
            saveMetaEl.textContent = 'Unsaved changes. Save before completing or downloading.';
        } else if (!canView) {
            saveMetaEl.textContent = 'Template workspace access is unavailable for this project.';
        } else if (!canEdit) {
            saveMetaEl.textContent = 'Read-only access. You can preview the template but cannot change it.';
        } else {
            saveMetaEl.textContent = savedAt
                ? `Last saved ${new Date(savedAt).toLocaleString()}`
                : 'No saved changes yet';
        }

        if (descriptionEl) {
            descriptionEl.textContent = !canView
                ? 'Template workspace access is unavailable right now.'
                : (!canEdit
                    ? 'Preview this assigned template in read-only mode.'
                    : 'Edit this template, save your changes, complete the project, and download the final version after payment.');
        }

        editBtn.style.display = canEdit ? '' : 'none';
        saveBtn.style.display = canSave ? '' : 'none';
        completeBtn.style.display = canComplete ? '' : 'none';
        downloadBtn.style.display = canDownload ? '' : 'none';

        editBtn.disabled = workspaceActionInFlight || completed || !canEdit;
        editBtn.textContent = isWorkspaceEditMode ? 'Editing Enabled' : 'Edit Mode';
        saveBtn.disabled = workspaceActionInFlight || !needsSave || completed || !canSave;
        completeBtn.disabled = workspaceActionInFlight || completed || needsSave || !canComplete;
        completeBtn.textContent = completed ? 'Project Completed' : 'Complete Project';
        downloadBtn.disabled = workspaceActionInFlight || !completed || needsSave || !canDownload;
        downloadBtn.textContent = !completed
            ? 'Download After Completion'
            : (resolvedProject.template_download_paid ? 'Download Final Output' : 'Download (Pay GBP 199)');
    }

    async function saveTemplateState(projectId, templateState, options = {}) {
        const currentProject = getCurrentProject();
        if (!currentProject) {
            throw new Error('Project could not be found for saving.');
        }
        if (!hasWorkspaceCapability('save_template')) {
            throw new Error('You have read-only access to this template workspace.');
        }
        const serializableTemplateState = getSerializableTemplateState({
            ...templateState
        }, currentProject);
        const renderedHtml = String(options.renderedHtml || currentProject.template_saved_html || '').trim();
        console.debug('[TemplateWorkspace] Persisting template state', {
            projectId,
            templateState: serializableTemplateState
        });
        const response = await authorizedWorkspaceRequest('/api/project-template-workspace-save', 'POST', {
            projectId,
            templateState: serializableTemplateState,
            renderedHtml
        });
        workspaceCapabilities = normalizeWorkspaceCapabilities(response && response.capabilities ? response.capabilities : workspaceCapabilities);
        const refreshedProject = response && response.project
            ? syncProjectDetailRecord(response.project)
            : getCurrentProject();
        updateWorkspaceChrome(refreshedProject);
        setWorkspaceEditMode(false);
        setWorkspaceDirty(false);
        return refreshedProject;
    }

    async function completeTemplateProject(projectId) {
        const currentProject = getCurrentProject();
        if (!currentProject) {
            throw new Error('Project could not be found for completion.');
        }
        if (!hasWorkspaceCapability('complete_template_project')) {
            throw new Error('You do not have permission to complete this template project.');
        }
        if (hasUnsavedChanges || isWorkspaceEditMode) {
            throw new Error('Save changes before completing the project.');
        }

        const response = await authorizedWorkspaceRequest('/api/project-template-workspace-complete', 'POST', {
            projectId,
            expectedLastSavedAt: currentProject.template_last_saved_at || (currentProject.template_state && currentProject.template_state.savedAt) || '',
            hasUnsavedChanges: hasUnsavedChanges || isWorkspaceEditMode
        });
        workspaceCapabilities = normalizeWorkspaceCapabilities(response && response.capabilities ? response.capabilities : workspaceCapabilities);
        const refreshedProject = response && response.project
            ? syncProjectDetailRecord(response.project)
            : getCurrentProject();

        if (typeof trackPlatformActivity === 'function') {
            await trackPlatformActivity('project_completed', {
                targetType: 'project',
                targetId: projectId,
                message: `Completed template project ${currentProject.template_name || currentProject.name || 'project'}.`,
                metadata: {
                    template_id: currentProject.template_id || '',
                    template_name: currentProject.template_name || '',
                    workflow_status: 'completed'
                }
            });
        }

        updateWorkspaceChrome(refreshedProject);
        setWorkspaceEditMode(false);
        setWorkspaceDirty(false);
        return refreshedProject;
    }

    function downloadBlobFile(filename, blob) {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function parseDownloadFileName(response, fallbackName) {
        const header = response.headers.get('Content-Disposition') || response.headers.get('content-disposition') || '';
        const match = header.match(/filename="?([^"]+)"?/i);
        return match && match[1] ? match[1] : fallbackName;
    }

    async function downloadProjectTemplateBundle(projectId, payload = {}) {
        if (typeof getDashboardBearerToken !== 'function') {
            throw new Error('Project download authentication is unavailable right now.');
        }

        const token = await getDashboardBearerToken();
        const response = await fetch(getApiUrl('/api/project-template-download'), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
            },
            body: JSON.stringify({
                projectId,
                hasUnsavedChanges: hasUnsavedChanges || isWorkspaceEditMode
            })
        });

        if (!response.ok) {
            const errorPayload = await response.json().catch(() => ({}));
            throw new Error(errorPayload.error || 'Project download could not be prepared.');
        }

        const blob = await response.blob();
        const fallbackName = `${slugify((getCurrentProject() || {}).name || 'template-project')}.zip`;
        downloadBlobFile(parseDownloadFileName(response, fallbackName), blob);
    }

    async function unlockTemplateDownload(project, templateName) {
        if (project.template_download_paid) return project;
        if (!hasWorkspaceCapability('download_template_output')) {
            throw new Error('You do not have permission to unlock the final template output.');
        }

        if (!window.NexlancePayments || typeof window.NexlancePayments.startTemplatePayment !== 'function') {
            throw new Error('Secure template checkout is not available right now.');
        }

        const redirectPath = `${window.location.pathname.replace(/^\/+/, '')}${window.location.search}${window.location.hash || ''}`;
        persistPendingWorkspaceCheckout(project.id, {
            projectId: project.id,
            templateId: project.template_id || '',
            templateName: templateName || '',
            createdAt: new Date().toISOString()
        });

        try {
            await window.NexlancePayments.startTemplatePayment({
                amount: TEMPLATE_DOWNLOAD_AMOUNT_CENTS,
                currency: DEFAULT_BILLING_CURRENCY,
                productCode: 'single_template',
                templateId: project.template_id || '',
                templateName,
                successRedirect: redirectPath,
                cancelRedirect: redirectPath,
                title: 'Complete your template payment',
                message: 'Pay GBP 199 to unlock the final template download for this project.',
                summaryTitle: templateName || 'Template Download',
                summaryText: 'Final editable website output',
                buttonText: 'Pay GBP 199',
                metadata: {
                    project_id: project.id,
                    template_id: project.template_id || ''
                },
                onSuccess: async checkoutResult => {
                    const paymentRecord = checkoutResult && checkoutResult.result && checkoutResult.result.paymentRecord
                        ? checkoutResult.result.paymentRecord
                        : {};
                    const providerPaymentId = String(
                        paymentRecord.providerPaymentId
                        || paymentRecord.paymentIntentId
                        || paymentRecord.providerSessionId
                        || ''
                    ).trim();
                    const response = await authorizedWorkspaceRequest('/api/project-template-workspace-unlock', 'POST', {
                        projectId: project.id,
                        providerPaymentId,
                        amount: 199,
                        currency: DEFAULT_BILLING_CURRENCY.toUpperCase(),
                        hasUnsavedChanges: hasUnsavedChanges || isWorkspaceEditMode
                    });
                    workspaceCapabilities = normalizeWorkspaceCapabilities(response && response.capabilities ? response.capabilities : workspaceCapabilities);
                    const refreshedProject = response && response.project
                        ? syncProjectDetailRecord(response.project)
                        : getCurrentProject();
                    persistPendingWorkspaceCheckout(project.id, null);
                    if (typeof recordPaymentRecord === 'function') {
                        await recordPaymentRecord({
                            paymentIntentId: providerPaymentId,
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
                                payment_intent_id: providerPaymentId,
                                template_id: project.template_id || '',
                                template_name: templateName || ''
                            }
                        });
                    }
                    updateWorkspaceChrome(refreshedProject);
                }
            });
        } catch (error) {
            persistPendingWorkspaceCheckout(project.id, null);
            throw error;
        }

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
            if (!hasWorkspaceCapability('edit_template')) {
                showWorkspaceError('You have read-only access to this template workspace.');
                return;
            }
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
            async saveProjectTemplateState(projectId, templateState, renderOptions = {}) {
                return saveTemplateState(projectId, templateState, {
                    renderedHtml: renderOptions && renderOptions.renderedHtml ? renderOptions.renderedHtml : ''
                });
            },
            async completeProjectTemplate(projectId) {
                return completeTemplateProject(projectId);
            },
            async downloadProjectTemplate(projectId, payload) {
                const currentProject = getCurrentProject();
                if (!currentProject || currentProject.id !== projectId) {
                    throw new Error('Project could not be found for download.');
                }
                if (hasUnsavedChanges || isWorkspaceEditMode) {
                    throw new Error('Save changes before downloading the final output.');
                }
                if ((currentProject.template_workflow_status || '') !== 'completed') {
                    throw new Error('Complete the project before downloading the final output.');
                }
                const unlockedProject = await unlockTemplateDownload(currentProject, currentProject.template_name || currentProject.name);
                await downloadProjectTemplateBundle(unlockedProject.id, payload || {});
                showToast('Final template output downloaded successfully.', 'success');
                return unlockedProject;
            },
            setDirtyState: setWorkspaceDirty,
            setEditMode: setWorkspaceEditMode
        };
    }

    async function reconcileWorkspaceCheckoutResult(detail = {}, cancelled = false) {
        const currentProject = getCurrentProject();
        if (!currentProject || !currentProject.id) return;

        const pendingCheckout = getPendingWorkspaceCheckout(currentProject.id);
        if (!pendingCheckout) return;

        if (cancelled) {
            persistPendingWorkspaceCheckout(currentProject.id, null);
            showToast('Template download checkout was cancelled.', 'error');
            return;
        }

        if (String(detail.productCode || '').trim().toLowerCase() !== 'single_template') {
            return;
        }

        if (pendingCheckout.templateId && String(detail.templateId || '').trim() !== String(pendingCheckout.templateId || '').trim()) {
            return;
        }

        const paymentRecord = detail && detail.result && detail.result.paymentRecord
            ? detail.result.paymentRecord
            : {};
        const providerPaymentId = String(
            paymentRecord.providerPaymentId
            || paymentRecord.paymentIntentId
            || paymentRecord.providerSessionId
            || ''
        ).trim();
        const response = await authorizedWorkspaceRequest('/api/project-template-workspace-unlock', 'POST', {
            projectId: currentProject.id,
            providerPaymentId,
            amount: 199,
            currency: DEFAULT_BILLING_CURRENCY.toUpperCase(),
            hasUnsavedChanges: hasUnsavedChanges || isWorkspaceEditMode
        });
        workspaceCapabilities = normalizeWorkspaceCapabilities(response && response.capabilities ? response.capabilities : workspaceCapabilities);
        persistPendingWorkspaceCheckout(currentProject.id, null);

        const refreshedProject = response && response.project
            ? syncProjectDetailRecord(response.project)
            : getCurrentProject();
        updateWorkspaceChrome(refreshedProject);

        await downloadProjectTemplateBundle(currentProject.id);
        showToast('Template payment confirmed. Your final project package is downloading.', 'success');
    }

    function bindWorkspaceCheckoutEvents() {
        if (bindWorkspaceCheckoutEvents.bound) return;
        bindWorkspaceCheckoutEvents.bound = true;

        window.addEventListener('nexlance-checkout-completed', event => {
            reconcileWorkspaceCheckoutResult(event && event.detail ? event.detail : {}, false).catch(error => {
                console.error('Workspace checkout completion could not be reconciled:', error);
                showWorkspaceError(error.message || 'Template payment was confirmed, but the project download could not be prepared.');
            });
        });

        window.addEventListener('nexlance-checkout-cancelled', event => {
            reconcileWorkspaceCheckoutResult(event && event.detail ? event.detail : {}, true).catch(error => {
                console.error('Workspace checkout cancellation could not be reconciled:', error);
            });
        });
    }

    function ensureWorkspaceLoaded(project) {
        if (workspaceMounted || !project || !project.template_id || !project.template_page) return;
        if (!hasWorkspaceCapability('view_template_workspace')) return;

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
        bindWorkspaceCheckoutEvents();
    }

    async function loadWorkspaceContextIfServer(project) {
        if (!isServerProject(project)) {
            showLocalOnlyWorkspaceMessage();
            return null;
        }
        try {
            const result = await fetchWorkspaceContext(project.id);
            updateWorkspaceChrome(getCurrentProject() || project);
            return result;
        } catch (error) {
            console.error('Template workspace could not be loaded:', error);
            const errorMessage = error && error.message ? error.message : '';
            if (errorMessage.includes('not found') || errorMessage.includes('Project could not be found')) {
                showLocalOnlyWorkspaceMessage();
            } else {
                showWorkspaceError(error.message || 'Template workspace could not be loaded.');
            }
            return null;
        }
    }

    function showLocalOnlyWorkspaceMessage() {
        const content = document.getElementById('tab-workspace');
        if (content) {
            content.innerHTML = `
                <div class="workspace-shell">
                    <div class="workspace-toolbar">
                        <div>
                            <h3>Template Workspace</h3>
                        </div>
                    </div>
                    <div class="workspace-frame-card" style="padding: 40px; text-align: center;">
                        <p style="margin-bottom: 12px;">This project is only stored locally.</p>
                        <p>Sync it to the server to use shared workspace features.</p>
                    </div>
                </div>
            `;
        }
        workspaceMounted = true;
    }

    async function initProjectTemplateWorkspace() {
        const pageName = window.location.pathname.split('/').pop() || 'index.html';
        if (pageName !== 'project-detail.html') return;

        const project = resolveWorkspaceProject(await waitForProject());
        if (!project || !project.template_id || !project.template_page) return;
        try {
            await mountWorkspace(project);
        } catch (error) {
            console.error('Template workspace could not be initialized:', error);
            showWorkspaceError(error.message || 'Template workspace could not be loaded.');
        }
    }

    window.addEventListener('beforeunload', event => {
        if (!hasUnsavedChanges) return;
        event.preventDefault();
        event.returnValue = '';
    });

    document.addEventListener('DOMContentLoaded', initProjectTemplateWorkspace);
})();
