const PRIVILEGED_EMAILS = new Set([
    'vijaypratap@nexlancedigital.com',
    'mehrahinal113@gmail.com'
]);

const COLLECTION_PERMISSION_MAP = {
    clients: { create: 'clients.create', update: 'clients.update', delete: 'clients.delete' },
    invoices: { create: 'invoices.create', update: 'invoices.update', delete: 'invoices.delete' },
    projects: { create: 'projects.create', update: 'projects.update', delete: 'projects.delete' },
    services: { create: 'services.create', update: 'services.update', delete: 'services.delete' },
    tasks: { create: 'tasks.create', update: 'tasks.update', delete: 'tasks.delete' },
    team_members: { create: 'team.create', update: 'team.update', delete: 'team.delete' }
};

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function normalizeRole(role) {
    return String(role || 'owner')
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_');
}

function createPermissionSet(role) {
    const normalizedRole = normalizeRole(role);
    const all = {
        clients: { create: true, update: true, delete: true },
        invoices: { create: true, update: true, delete: true },
        projects: { create: true, update: true, delete: true },
        services: { create: true, update: true, delete: true },
        tasks: { create: true, update: true, delete: true },
        team: { create: true, update: true, delete: true }
    };

    switch (normalizedRole) {
        case 'owner':
        case 'admin':
            return all;
        case 'project_manager':
            return {
                clients: { create: false, update: true, delete: false },
                invoices: { create: true, update: true, delete: false },
                projects: { create: true, update: true, delete: false },
                services: { create: true, update: true, delete: false },
                tasks: { create: true, update: true, delete: false },
                team: { create: false, update: false, delete: false }
            };
        case 'developer':
        case 'designer':
            return {
                clients: { create: false, update: false, delete: false },
                invoices: { create: false, update: false, delete: false },
                projects: { create: false, update: false, delete: false },
                services: { create: false, update: false, delete: false },
                tasks: { create: false, update: true, delete: false },
                team: { create: false, update: false, delete: false }
            };
        case 'client':
        default:
            return {
                clients: { create: false, update: false, delete: false },
                invoices: { create: false, update: false, delete: false },
                projects: { create: false, update: false, delete: false },
                services: { create: false, update: false, delete: false },
                tasks: { create: false, update: false, delete: false },
                team: { create: false, update: false, delete: false }
            };
    }
}

function mergePermissionSets(basePermissions, overridePermissions) {
    const next = JSON.parse(JSON.stringify(basePermissions || {}));
    if (!overridePermissions || typeof overridePermissions !== 'object') {
        return next;
    }

    Object.keys(overridePermissions).forEach(section => {
        const sourceSection = overridePermissions[section];
        if (!sourceSection || typeof sourceSection !== 'object') {
            return;
        }
        next[section] = { ...(next[section] || {}) };
        Object.keys(sourceSection).forEach(action => {
            next[section][action] = Boolean(sourceSection[action]);
        });
    });

    return next;
}

function getResolvedAccessProfile(userProfile = {}, authUser = {}) {
    const email = normalizeEmail(authUser.email || userProfile.email);
    const role = PRIVILEGED_EMAILS.has(email)
        ? 'owner'
        : normalizeRole(userProfile.role || userProfile.dashboardRole || 'owner');
    const basePermissions = createPermissionSet(role);
    const permissions = mergePermissionSets(basePermissions, userProfile.permissions);
    return {
        role,
        permissions
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
    getResolvedAccessProfile,
    normalizeEmail,
    normalizeRole
};
