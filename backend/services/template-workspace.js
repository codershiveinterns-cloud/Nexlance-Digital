const AccessControl = require('../../rbac.js');
const { getCollectionDocument, patchCollectionDocument } = require('./firebase-service');
const {
    PROJECT_CAPABILITIES,
    canAccessProjectRecord,
    createEmptyProjectCapabilities,
    diagnoseProjectRecordAccess,
    isPersistedProject,
    resolveProjectCapabilities
} = require('./project-access');

const TEMPLATE_WORKSPACE_PROJECT_PATCH_FIELDS = new Set([
    'template_state',
    'template_last_saved_at',
    'template_saved_html',
    'template_workflow_status',
    'template_completed_at',
    'template_download_paid',
    'template_download_paid_at',
    'template_download_payment_intent_id',
    'template_download_amount_gbp',
    'status',
    'progress',
    'updated_at'
]);

const TEMPLATE_WORKSPACE_SERVER_MANAGED_FIELDS = new Set([
    'id',
    'owner_key',
    'owner_email',
    'workspace_id',
    'created_at',
    'updated_at',
    'created_by_user_id',
    'created_by_email'
]);

const TEMPLATE_WORKSPACE_SAVE_REQUEST_FIELDS = new Set([
    'projectId',
    'templateState',
    'renderedHtml'
]);

const TEMPLATE_WORKSPACE_COMPLETE_REQUEST_FIELDS = new Set([
    'projectId',
    'expectedLastSavedAt',
    'hasUnsavedChanges'
]);

const TEMPLATE_WORKSPACE_UNLOCK_REQUEST_FIELDS = new Set([
    'projectId',
    'providerPaymentId',
    'amount',
    'currency',
    'hasUnsavedChanges'
]);

function createHttpError(message, statusCode = 400, code = '') {
    const error = new Error(message);
    error.statusCode = statusCode;
    if (code) {
        error.code = String(code || '').trim();
    }
    return error;
}

function cloneJsonSafe(value) {
    if (value === undefined) return undefined;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (error) {
        throw createHttpError('Template data must be JSON-serializable.', 400);
    }
}

function stripTemplateWorkspaceServerManagedFields(payload = {}) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return {};
    }

    return Object.keys(payload).reduce((result, key) => {
        const normalizedKey = String(key || '').trim();
        if (!normalizedKey || TEMPLATE_WORKSPACE_SERVER_MANAGED_FIELDS.has(normalizedKey)) {
            return result;
        }
        result[normalizedKey] = payload[key];
        return result;
    }, {});
}

function ensureAllowedRequestFields(payload, allowedFields, label) {
    const cleanPayload = stripTemplateWorkspaceServerManagedFields(payload);
    const keys = Object.keys(cleanPayload);
    const unexpectedKey = keys.find(key => !allowedFields.has(String(key || '').trim()));
    if (unexpectedKey) {
        throw createHttpError(`${label} does not allow the field "${unexpectedKey}".`, 400);
    }
    return cleanPayload;
}

function isTemplateWorkspaceProjectPatch(payload) {
    const cleanPayload = stripTemplateWorkspaceServerManagedFields(payload);
    const keys = Object.keys(cleanPayload);
    if (!keys.length) return false;
    return keys.every(key => TEMPLATE_WORKSPACE_PROJECT_PATCH_FIELDS.has(String(key || '').trim()));
}

function resolveTemplateWorkspaceCapabilities(sessionUser = {}, project = {}, projectId = '') {
    const emptyCapabilities = AccessControl.createEmptyTemplateWorkspaceCapabilities();
    const projectCapabilities = resolveProjectCapabilities(sessionUser, projectId, project);
    return {
        ...emptyCapabilities,
        [AccessControl.TEMPLATE_WORKSPACE_CAPABILITIES.VIEW_TEMPLATE_WORKSPACE]: projectCapabilities[PROJECT_CAPABILITIES.VIEW_TEMPLATE_WORKSPACE] === true,
        [AccessControl.TEMPLATE_WORKSPACE_CAPABILITIES.EDIT_TEMPLATE]: projectCapabilities[PROJECT_CAPABILITIES.EDIT_TEMPLATE] === true,
        [AccessControl.TEMPLATE_WORKSPACE_CAPABILITIES.SAVE_TEMPLATE]: projectCapabilities[PROJECT_CAPABILITIES.SAVE_TEMPLATE] === true,
        [AccessControl.TEMPLATE_WORKSPACE_CAPABILITIES.COMPLETE_TEMPLATE_PROJECT]: projectCapabilities[PROJECT_CAPABILITIES.COMPLETE_PROJECT] === true,
        [AccessControl.TEMPLATE_WORKSPACE_CAPABILITIES.DOWNLOAD_TEMPLATE_OUTPUT]: projectCapabilities[PROJECT_CAPABILITIES.DOWNLOAD_OUTPUT] === true,
        [AccessControl.TEMPLATE_WORKSPACE_CAPABILITIES.ADMIN_OVERRIDE]: projectCapabilities[PROJECT_CAPABILITIES.ADMIN_OVERRIDE] === true
    };
}

function requireTemplateWorkspaceCapability(context, capability) {
    if (!context || !context.capabilities || context.capabilities[capability] !== true) {
        throw createHttpError('You do not have permission for this template workspace action.', 403);
    }
}

async function loadTemplateWorkspaceContext(session, projectId) {
    const normalizedProjectId = String(projectId || '').trim();
    if (!normalizedProjectId) {
        throw createHttpError('Project ID is required.', 400);
    }

    console.log('[DEBUG TemplateWorkspace] Loading context for project:', {
        projectId: normalizedProjectId,
        sessionUserUid: session.sessionUser?.uid,
        sessionUserEmail: session.sessionUser?.email,
        sessionUserWorkspaceId: session.sessionUser?.workspaceId,
        sessionUserRole: session.sessionUser?.role,
        sessionUserAssignedProjectIds: session.sessionUser?.assignedProjectIds,
        sessionUserAllProjectsAccess: session.sessionUser?.allProjectsAccess
    });

    let projectRecord = null;
    try {
        projectRecord = await getCollectionDocument('projects', normalizedProjectId);
    } catch (error) {
        console.error('[DEBUG TemplateWorkspace] Failed to load project:', error);
        throw createHttpError('Template workspace backend is temporarily unavailable. Please try again.', 503);
    }

    if (!projectRecord || !projectRecord.data) {
        console.error('[DEBUG TemplateWorkspace] Project not found:', normalizedProjectId);
        throw createHttpError('Project not found or not yet synced to server.', 404);
    }

    if (!isPersistedProject(projectRecord.data)) {
        console.error('[DEBUG TemplateWorkspace] Project not persisted:', normalizedProjectId);
        throw createHttpError('Project not yet synced to server. Save project to backend to use workspace features.', 404, 'project_not_synced');
    }

    console.log('[DEBUG TemplateWorkspace] Project data:', {
        projectId: projectRecord.id,
        projectWorkspaceId: projectRecord.data.workspace_id,
        projectOwnerKey: projectRecord.data.owner_key,
        projectOwnerEmail: projectRecord.data.owner_email
    });

    const accessDiagnosis = diagnoseProjectRecordAccess(session.sessionUser, normalizedProjectId, projectRecord.data);
    console.log('[DEBUG TemplateWorkspace] Access diagnosis:', accessDiagnosis);
    if (!accessDiagnosis.allowed) {
        throw createHttpError(
            accessDiagnosis.message || 'You do not have access to this template workspace.',
            403,
            accessDiagnosis.code || 'project_access_denied'
        );
    }

    const capabilities = resolveTemplateWorkspaceCapabilities(session.sessionUser, projectRecord.data, normalizedProjectId);
    if (capabilities[AccessControl.TEMPLATE_WORKSPACE_CAPABILITIES.VIEW_TEMPLATE_WORKSPACE] !== true) {
        const hasProjectView = AccessControl.hasPermission(session.sessionUser, AccessControl.PERMISSIONS.VIEW_PROJECTS);
        const hasWorkspaceView = AccessControl.hasPermission(session.sessionUser, AccessControl.PERMISSIONS.VIEW_TEMPLATE_WORKSPACE);
        if (!hasProjectView) {
            throw createHttpError(
                'Access denied: your role is missing "View Projects" permission.',
                403,
                'missing_view_projects_permission'
            );
        }
        if (!hasWorkspaceView) {
            throw createHttpError(
                'Access denied: your role is missing "View Template Workspace" permission.',
                403,
                'missing_template_workspace_permission'
            );
        }
        throw createHttpError(
            'Access denied: template workspace capability is disabled for your account.',
            403,
            'template_workspace_capability_denied'
        );
    }

    return {
        projectId: normalizedProjectId,
        projectRecord,
        project: {
            id: projectRecord.id,
            ...projectRecord.data
        },
        session,
        capabilities
    };
}

function normalizeTemplateState(templateState, project = {}) {
    const normalizedState = cloneJsonSafe(templateState);
    if (!normalizedState || typeof normalizedState !== 'object' || Array.isArray(normalizedState)) {
        throw createHttpError('Template state must be an object.', 400);
    }

    const elements = Array.isArray(normalizedState.elements) ? normalizedState.elements : [];
    return {
        templateId: String(normalizedState.templateId || project.template_id || '').trim(),
        templatePage: String(normalizedState.templatePage || project.template_page || '').trim(),
        templateName: String(normalizedState.templateName || project.template_name || project.name || '').trim(),
        savedAt: String(normalizedState.savedAt || new Date().toISOString()).trim(),
        elements: elements.map(item => ({
            key: String(item && item.key != null ? item.key : '').trim(),
            kind: String(item && item.kind != null ? item.kind : 'content').trim() || 'content',
            html: String(item && item.html != null ? item.html : ''),
            src: String(item && item.src != null ? item.src : ''),
            alt: String(item && item.alt != null ? item.alt : ''),
            attrs: item && item.attrs && typeof item.attrs === 'object' && !Array.isArray(item.attrs)
                ? Object.keys(item.attrs).reduce((result, key) => {
                    const normalizedKey = String(key || '').trim();
                    if (!normalizedKey) return result;
                    result[normalizedKey] = String(item.attrs[key] != null ? item.attrs[key] : '');
                    return result;
                }, {})
                : {}
        })).filter(item => item.key)
    };
}

function buildTemplateWorkspaceSavePatch(context, payload = {}) {
    requireTemplateWorkspaceCapability(context, AccessControl.TEMPLATE_WORKSPACE_CAPABILITIES.SAVE_TEMPLATE);
    const cleanPayload = ensureAllowedRequestFields(payload, TEMPLATE_WORKSPACE_SAVE_REQUEST_FIELDS, 'Template save');
    const templateState = normalizeTemplateState(cleanPayload.templateState, context.project);
    const renderedHtml = String(cleanPayload.renderedHtml || '').trim();
    if (!renderedHtml) {
        throw createHttpError('Rendered template output is required before saving.', 400);
    }

    const currentProject = context.project;
    const now = new Date().toISOString();
    const alreadyCompleted = String(currentProject.template_workflow_status || '').trim().toLowerCase() === 'completed';
    // Completed projects remain editable — users can keep saving changes
    // after marking the project complete.

    const nextWorkflowStatus = alreadyCompleted ? 'completed' : 'in_progress';
    return {
        template_state: {
            ...templateState,
            savedAt: now
        },
        template_last_saved_at: now,
        template_saved_html: renderedHtml,
        template_workflow_status: nextWorkflowStatus,
        template_completed_at: alreadyCompleted ? (currentProject.template_completed_at || now) : null,
        status: alreadyCompleted
            ? (currentProject.status || 'Live')
            : (currentProject.status === 'Planning' ? 'Development' : (currentProject.status || 'Development')),
        progress: alreadyCompleted
            ? Math.max(Number(currentProject.progress || 0), 100)
            : Math.max(Number(currentProject.progress || 0), 50),
        updated_at: now
    };
}

function buildTemplateWorkspaceCompletePatch(context, payload = {}) {
    requireTemplateWorkspaceCapability(context, AccessControl.TEMPLATE_WORKSPACE_CAPABILITIES.COMPLETE_TEMPLATE_PROJECT);
    const cleanPayload = ensureAllowedRequestFields(payload, TEMPLATE_WORKSPACE_COMPLETE_REQUEST_FIELDS, 'Template completion');
    if (cleanPayload.hasUnsavedChanges === true) {
        throw createHttpError('Save changes before completing the project.', 409);
    }

    const currentProject = context.project;
    if (!String(currentProject.template_last_saved_at || '').trim() || !String(currentProject.template_saved_html || '').trim()) {
        throw createHttpError('Save the template before completing the project.', 409);
    }

    const expectedLastSavedAt = String(cleanPayload.expectedLastSavedAt || '').trim();
    if (expectedLastSavedAt && expectedLastSavedAt !== String(currentProject.template_last_saved_at || '').trim()) {
        throw createHttpError('Template workspace changed since you last loaded it. Refresh and try again.', 409);
    }

    const now = new Date().toISOString();
    return {
        template_workflow_status: 'completed',
        template_completed_at: currentProject.template_completed_at || now,
        status: 'Live',
        progress: 100,
        updated_at: now
    };
}

function buildTemplateWorkspaceUnlockPatch(context, payload = {}) {
    requireTemplateWorkspaceCapability(context, AccessControl.TEMPLATE_WORKSPACE_CAPABILITIES.DOWNLOAD_TEMPLATE_OUTPUT);
    const cleanPayload = ensureAllowedRequestFields(payload, TEMPLATE_WORKSPACE_UNLOCK_REQUEST_FIELDS, 'Template download unlock');
    if (cleanPayload.hasUnsavedChanges === true) {
        throw createHttpError('Save changes before unlocking the final output.', 409);
    }

    const currentProject = context.project;
    if (String(currentProject.template_workflow_status || '').trim().toLowerCase() !== 'completed') {
        throw createHttpError('Complete the project before unlocking the final output.', 409);
    }

    const now = new Date().toISOString();
    return {
        template_download_paid: true,
        template_download_paid_at: now,
        template_download_payment_intent_id: String(cleanPayload.providerPaymentId || currentProject.template_download_payment_intent_id || '').trim(),
        template_download_amount_gbp: Number(cleanPayload.amount || currentProject.template_download_amount_gbp || 199),
        updated_at: now
    };
}

async function applyTemplateWorkspacePatch(context, patch) {
    const nextRecord = await patchCollectionDocument('projects', context.projectId, patch);
    return {
        id: context.projectId,
        ...(nextRecord || {}),
        ...(nextRecord && nextRecord.id ? {} : { id: context.projectId })
    };
}

async function fetchTemplateWorkspace(session, projectId) {
    const context = await loadTemplateWorkspaceContext(session, projectId);
    return {
        project: context.project,
        capabilities: context.capabilities
    };
}

async function saveTemplateWorkspace(session, payload = {}) {
    const context = await loadTemplateWorkspaceContext(session, payload.projectId);
    const patch = buildTemplateWorkspaceSavePatch(context, payload);
    const project = await applyTemplateWorkspacePatch(context, patch);
    return {
        project,
        capabilities: context.capabilities
    };
}

async function completeTemplateWorkspace(session, payload = {}) {
    const context = await loadTemplateWorkspaceContext(session, payload.projectId);
    const patch = buildTemplateWorkspaceCompletePatch(context, payload);
    const project = await applyTemplateWorkspacePatch(context, patch);
    return {
        project,
        capabilities: context.capabilities
    };
}

async function unlockTemplateWorkspaceDownload(session, payload = {}) {
    const context = await loadTemplateWorkspaceContext(session, payload.projectId);
    const patch = buildTemplateWorkspaceUnlockPatch(context, payload);
    const project = await applyTemplateWorkspacePatch(context, patch);
    return {
        project,
        capabilities: context.capabilities
    };
}

module.exports = {
    TEMPLATE_WORKSPACE_PROJECT_PATCH_FIELDS,
    TEMPLATE_WORKSPACE_SERVER_MANAGED_FIELDS,
    buildTemplateWorkspaceCompletePatch,
    buildTemplateWorkspaceSavePatch,
    buildTemplateWorkspaceUnlockPatch,
    canAccessProjectRecord,
    completeTemplateWorkspace,
    createHttpError,
    fetchTemplateWorkspace,
    isTemplateWorkspaceProjectPatch,
    loadTemplateWorkspaceContext,
    requireTemplateWorkspaceCapability,
    resolveTemplateWorkspaceCapabilities,
    saveTemplateWorkspace,
    stripTemplateWorkspaceServerManagedFields,
    unlockTemplateWorkspaceDownload
};
