const AccessControl = require('../../rbac.js');

const PROJECT_CAPABILITIES = Object.freeze({
    VIEW_PROJECT: 'view_project',
    VIEW_PROJECT_OVERVIEW: 'view_project_overview',
    VIEW_TEMPLATE_WORKSPACE: 'view_template_workspace',
    EDIT_TEMPLATE: 'edit_template',
    SAVE_TEMPLATE: 'save_template',
    COMPLETE_PROJECT: 'complete_project',
    DOWNLOAD_OUTPUT: 'download_output',
    VIEW_TASK_BOARD: 'view_task_board',
    EDIT_TASK_BOARD: 'edit_task_board',
    ADMIN_OVERRIDE: 'admin_override'
});

function createEmptyProjectCapabilities() {
    return Object.keys(PROJECT_CAPABILITIES).reduce((result, key) => {
        result[PROJECT_CAPABILITIES[key]] = false;
        return result;
    }, {});
}

function createProjectNotFoundError() {
    const error = new Error('Project could not be found.');
    error.statusCode = 404;
    return error;
}

function hasAllProjectsAccess(sessionUser = {}) {
    return sessionUser.allProjectsAccess === true
        || sessionUser.all_projects_access === true
        || String(sessionUser.projectAccessScope || sessionUser.project_access_scope || '').trim().toLowerCase() === 'all';
}

function getProjectSource(project = {}) {
    const explicitSource = String(project.project_source || project.projectSource || '').trim().toLowerCase();
    if (explicitSource) return explicitSource;
    if (project.storage_fallback === true || project.local_fallback === true) {
        return 'local_fallback';
    }
    return 'database';
}

function isPersistedProject(project = {}) {
    return getProjectSource(project) === 'database';
}

function diagnoseProjectRecordAccess(sessionUser = {}, projectId, project = {}) {
    const ownerEmail = AccessControl.normalizeEmail(sessionUser.workspaceOwnerEmail || sessionUser.ownerEmail || sessionUser.email);
    const recordOwner = AccessControl.normalizeEmail(project.owner_key || project.owner_email || '');
    const sessionWorkspaceId = String(sessionUser.workspaceId || '').trim();
    const recordWorkspaceId = String(project.workspace_id || '').trim();
    const workspaceMatch = recordWorkspaceId && recordWorkspaceId === sessionWorkspaceId;
    if (!((recordOwner && recordOwner === ownerEmail) || workspaceMatch)) {
        return {
            allowed: false,
            code: 'workspace_mismatch',
            message: 'Access denied: this project belongs to a different workspace or owner account.'
        };
    }

    if (AccessControl.isWorkspaceOwner(sessionUser) || hasAllProjectsAccess(sessionUser)) {
        return {
            allowed: true,
            code: 'owner_or_all_projects'
        };
    }

    const assignedProjectIds = AccessControl.sanitizeAssignedProjectIds(sessionUser.assignedProjectIds);
    const role = AccessControl.normalizeRole(sessionUser.role || sessionUser.workspaceRole || sessionUser.dashboardRole);
    const hasExplicitProjectScope = assignedProjectIds.length > 0;
    const shouldRestrictProjects = role === AccessControl.ROLES.CLIENT || hasExplicitProjectScope;

    if (!shouldRestrictProjects) {
        return {
            allowed: true,
            code: 'unscoped_team_member'
        };
    }

    const normalizedProjectId = String(projectId || '').trim();
    const isAssigned = assignedProjectIds.includes(normalizedProjectId);
    if (isAssigned) {
        return {
            allowed: true,
            code: 'assigned_project'
        };
    }

    return {
        allowed: false,
        code: 'project_not_assigned',
        message: 'Access denied: this project is not assigned to your account. Ask the workspace owner to assign it or grant all-project access.'
    };
}

function canAccessProjectRecord(sessionUser = {}, projectId, project = {}) {
    return diagnoseProjectRecordAccess(sessionUser, projectId, project).allowed === true;
}

function resolveProjectCapabilities(sessionUser = {}, projectId, project = {}) {
    const capabilities = createEmptyProjectCapabilities();
    if (!canAccessProjectRecord(sessionUser, projectId, project)) {
        return capabilities;
    }

    const hasProjectView = AccessControl.hasPermission(sessionUser, AccessControl.PERMISSIONS.VIEW_PROJECTS);
    if (!hasProjectView) {
        return capabilities;
    }

    capabilities[PROJECT_CAPABILITIES.VIEW_PROJECT] = true;
    capabilities[PROJECT_CAPABILITIES.VIEW_PROJECT_OVERVIEW] = true;
    capabilities[PROJECT_CAPABILITIES.VIEW_TEMPLATE_WORKSPACE] = AccessControl.hasPermission(sessionUser, AccessControl.PERMISSIONS.VIEW_TEMPLATE_WORKSPACE);
    capabilities[PROJECT_CAPABILITIES.EDIT_TEMPLATE] = AccessControl.hasPermission(sessionUser, AccessControl.PERMISSIONS.EDIT_TEMPLATE);
    capabilities[PROJECT_CAPABILITIES.SAVE_TEMPLATE] = AccessControl.hasPermission(sessionUser, AccessControl.PERMISSIONS.SAVE_TEMPLATE);
    capabilities[PROJECT_CAPABILITIES.COMPLETE_PROJECT] = AccessControl.hasPermission(sessionUser, AccessControl.PERMISSIONS.COMPLETE_PROJECT);
    capabilities[PROJECT_CAPABILITIES.DOWNLOAD_OUTPUT] = AccessControl.hasPermission(sessionUser, AccessControl.PERMISSIONS.DOWNLOAD_OUTPUT);
    capabilities[PROJECT_CAPABILITIES.VIEW_TASK_BOARD] = AccessControl.hasPermission(sessionUser, AccessControl.PERMISSIONS.VIEW_TASK_BOARD);
    capabilities[PROJECT_CAPABILITIES.EDIT_TASK_BOARD] = AccessControl.hasPermission(sessionUser, AccessControl.PERMISSIONS.EDIT_TASK_BOARD);
    capabilities[PROJECT_CAPABILITIES.ADMIN_OVERRIDE] = AccessControl.isWorkspaceOwner(sessionUser) || AccessControl.getUserKind(sessionUser) === AccessControl.USER_KINDS.ADMIN;
    return capabilities;
}

module.exports = {
    PROJECT_CAPABILITIES,
    canAccessProjectRecord,
    diagnoseProjectRecordAccess,
    createEmptyProjectCapabilities,
    createProjectNotFoundError,
    getProjectSource,
    hasAllProjectsAccess,
    isPersistedProject,
    resolveProjectCapabilities
};
