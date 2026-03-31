const AccessControl = require('../../rbac.js');

const COLLECTION_PERMISSION_MAP = {
    clients: { create: 'clients.create', read: 'clients.read', update: 'clients.update', delete: 'clients.delete' },
    invoices: { create: 'invoices.create', read: 'invoices.read', update: 'invoices.update', delete: 'invoices.delete' },
    projects: { create: 'projects.create', read: 'projects.read', update: 'projects.update', delete: 'projects.delete' },
    services: { create: 'services.create', read: 'services.read', update: 'services.update', delete: 'services.delete' },
    tasks: { create: 'tasks.create', read: 'tasks.read', update: 'tasks.update', delete: 'tasks.delete' },
    team_members: { create: 'team.create', read: 'team.read', update: 'team.update', delete: 'team.delete' }
};

function normalizeEmail(email) {
    return AccessControl.normalizeEmail(email);
}

function normalizeRole(role) {
    return AccessControl.normalizeRole(role);
}

function createPermissionSet(userOrRole = {}) {
    const user = typeof userOrRole === 'string'
        ? { role: userOrRole }
        : (userOrRole || {});
    return AccessControl.getPermissionMatrix(user);
}

function getResolvedAccessProfile(userProfile = {}, authUser = {}) {
    const mergedUser = {
        ...userProfile,
        email: normalizeEmail(userProfile.email || authUser.email),
        uid: authUser.uid || userProfile.uid || userProfile.userId || '',
        role: normalizeRole(userProfile.role || userProfile.workspaceRole || userProfile.dashboardRole || 'admin')
    };

    const accessProfile = AccessControl.getAccessProfile(mergedUser);
    return {
        ...mergedUser,
        role: accessProfile.role,
        isWorkspaceOwner: accessProfile.isWorkspaceOwner,
        permissionKeys: accessProfile.permissionKeys,
        permissions: accessProfile.permissionMatrix
    };
}

function getPermissionPathForCollection(collectionId, action) {
    const collectionPermissions = COLLECTION_PERMISSION_MAP[String(collectionId || '').trim()];
    return collectionPermissions ? collectionPermissions[action] : '';
}

function canPerformCollectionAction({ collectionId, action, authUser, userProfile }) {
    const permissionPath = getPermissionPathForCollection(collectionId, action);
    if (!permissionPath) {
        return false;
    }

    const resolvedProfile = getResolvedAccessProfile(userProfile, authUser);
    const [section, permissionAction] = permissionPath.split('.');
    return Boolean(
        resolvedProfile.permissions
        && resolvedProfile.permissions[section]
        && resolvedProfile.permissions[section][permissionAction]
    );
}

module.exports = {
    COLLECTION_PERMISSION_MAP,
    canPerformCollectionAction,
    createPermissionSet,
    getPermissionPathForCollection,
    getResolvedAccessProfile,
    normalizeEmail,
    normalizeRole
};
