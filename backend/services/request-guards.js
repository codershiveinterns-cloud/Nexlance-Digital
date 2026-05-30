const AccessControl = require('../../rbac.js');
const { authenticateDashboardRequest } = require('./dashboard-auth');

function normalizeAuthorizationHeader(req) {
    if (!req || !req.headers || typeof req.headers !== 'object') {
        return;
    }

    const headers = req.headers;
    let authorizationHeader = headers.authorization;

    if (!authorizationHeader) {
        authorizationHeader = headers.Authorization || headers.AUTHORIZATION || '';
    }

    if (!authorizationHeader && typeof req.get === 'function') {
        authorizationHeader = req.get('authorization') || req.get('Authorization') || '';
    }

    if (Array.isArray(authorizationHeader)) {
        authorizationHeader = authorizationHeader.find(Boolean) || '';
    }

    const normalizedHeader = String(authorizationHeader || '').trim();
    if (normalizedHeader && !headers.authorization) {
        headers.authorization = normalizedHeader;
    }
}

async function requireAuth(req) {
    normalizeAuthorizationHeader(req);
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

function requireInitializedUser(session) {
    const sessionUser = session && session.sessionUser ? session.sessionUser : null;
    const userId = sessionUser ? String(sessionUser.uid || '').trim() : '';
    const workspaceId = sessionUser ? String(sessionUser.workspaceId || '').trim() : '';
    const membershipStatus = sessionUser
        ? String(sessionUser.membershipStatus || '').trim().toLowerCase()
        : '';
    const role = sessionUser
        ? AccessControl.normalizeRole(sessionUser.role || sessionUser.workspaceRole)
        : '';

    const missing = [];
    if (!workspaceId) missing.push('workspaceId');
    if (membershipStatus !== 'active') missing.push('membershipStatus');
    if (!role) missing.push('role');

    if (missing.length) {
        console.warn('[UserValidation] failed', {
            userId,
            email: sessionUser ? (sessionUser.email || '') : '',
            workspaceId,
            membershipStatus,
            role,
            missingFields: missing
        });
        const error = new Error('User is not fully initialized for this workspace.');
        error.statusCode = 403;
        error.code = 'USER_NOT_INITIALIZED';
        error.missingFields = missing;
        throw error;
    }

    return session;
}

async function requireInitializedAuth(req) {
    const session = await requireAuth(req);
    return requireInitializedUser(session);
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
    normalizeAuthorizationHeader,
    requireAuth,
    requireInitializedAuth,
    requireInitializedUser,
    requireOwnerOnly,
    requirePermission,
    requireRole,
    requireWorkspaceOwner
};
