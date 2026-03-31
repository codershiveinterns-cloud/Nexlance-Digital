const AccessControl = require('../../rbac.js');
const { authenticateDashboardRequest } = require('./dashboard-auth');

async function requireAuth(req) {
    return authenticateDashboardRequest(req);
}

function requireWorkspaceOwner(session) {
    if (!session || !session.sessionUser || !AccessControl.isWorkspaceOwner(session.sessionUser)) {
        const error = new Error('Workspace owner access is required.');
        error.statusCode = 403;
        throw error;
    }
    return session;
}

function requireOwnerOnly(session) {
    return requireWorkspaceOwner(session);
}

function requireRole(session, allowedRoles = []) {
    const role = AccessControl.normalizeRole(session && session.sessionUser && session.sessionUser.role);
    const normalizedAllowedRoles = (Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles])
        .map(allowedRole => AccessControl.normalizeRole(allowedRole));

    if (!normalizedAllowedRoles.includes(role)) {
        const error = new Error('You do not have the required role for this action.');
        error.statusCode = 403;
        throw error;
    }

    return session;
}

function requirePermission(session, permission) {
    if (!session || !session.sessionUser || !AccessControl.hasPermission(session.sessionUser, permission)) {
        const error = new Error('You do not have permission for this action.');
        error.statusCode = 403;
        throw error;
    }
    return session;
}

module.exports = {
    requireAuth,
    requireOwnerOnly,
    requirePermission,
    requireRole,
    requireWorkspaceOwner
};
