(function initNexlanceAccessControl(root, factory) {
    const api = factory();

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }

    if (root && typeof root === 'object') {
        root.NexlanceAccessControl = api;
    }
}(typeof globalThis !== 'undefined' ? globalThis : this, function createNexlanceAccessControl() {
    const ROLES = Object.freeze({
        ADMIN: 'admin',
        PM: 'pm',
        DEVELOPER: 'developer',
        DESIGNER: 'designer',
        CLIENT: 'client'
    });

    const PERMISSIONS = Object.freeze({
        VIEW_DASHBOARD: 'view_dashboard',
        VIEW_CLIENTS: 'view_clients',
        EDIT_CLIENT_INFO: 'edit_client_info',
        VIEW_PROJECTS: 'view_projects',
        MANAGE_PROJECTS: 'manage_projects',
        EDIT_TASKS: 'edit_tasks',
        DELETE_TASKS: 'delete_tasks',
        VIEW_REVENUE: 'view_revenue',
        CREATE_INVOICES: 'create_invoices',
        MANAGE_PAYMENTS: 'manage_payments',
        UPLOAD_FILES: 'upload_files',
        MANAGE_TEAM_MEMBERS: 'manage_team_members',
        ACCESS_SYSTEM_SETTINGS: 'access_system_settings',
        ACCESS_ADMIN_PANEL: 'access_admin_panel',
        ACCESS_INVITATION_CONTROL: 'access_invitation_control',
        ACCESS_SETTINGS: 'access_settings',
        ACCESS_SUPPORT_INFO: 'access_support_info',
        SIGN_OUT: 'sign_out',
        VIEW_SERVICES: 'view_services'
    });

    const ROLE_ALIASES = Object.freeze({
        owner: ROLES.ADMIN,
        workspace_owner: ROLES.ADMIN,
        workspaceowner: ROLES.ADMIN,
        admin_owner: ROLES.ADMIN,
        adminowner: ROLES.ADMIN,
        administrator: ROLES.ADMIN,
        project_manager: ROLES.PM,
        'project manager': ROLES.PM,
        pm: ROLES.PM,
        developer: ROLES.DEVELOPER,
        designer: ROLES.DESIGNER,
        client: ROLES.CLIENT,
        admin: ROLES.ADMIN
    });

    const GLOBAL_AUTHENTICATED_PERMISSIONS = Object.freeze([
        PERMISSIONS.ACCESS_SETTINGS,
        PERMISSIONS.ACCESS_SUPPORT_INFO,
        PERMISSIONS.SIGN_OUT
    ]);

    const ROLE_PERMISSION_MAP = Object.freeze({
        [ROLES.ADMIN]: Object.freeze([
            PERMISSIONS.VIEW_DASHBOARD,
            PERMISSIONS.VIEW_CLIENTS,
            PERMISSIONS.EDIT_CLIENT_INFO,
            PERMISSIONS.VIEW_PROJECTS,
            PERMISSIONS.MANAGE_PROJECTS,
            PERMISSIONS.EDIT_TASKS,
            PERMISSIONS.DELETE_TASKS,
            PERMISSIONS.VIEW_REVENUE,
            PERMISSIONS.CREATE_INVOICES,
            PERMISSIONS.UPLOAD_FILES,
            PERMISSIONS.VIEW_SERVICES
        ]),
        [ROLES.PM]: Object.freeze([
            PERMISSIONS.VIEW_DASHBOARD,
            PERMISSIONS.VIEW_CLIENTS,
            PERMISSIONS.EDIT_CLIENT_INFO,
            PERMISSIONS.VIEW_PROJECTS,
            PERMISSIONS.MANAGE_PROJECTS,
            PERMISSIONS.EDIT_TASKS,
            PERMISSIONS.DELETE_TASKS,
            PERMISSIONS.VIEW_REVENUE,
            PERMISSIONS.CREATE_INVOICES,
            PERMISSIONS.UPLOAD_FILES,
            PERMISSIONS.VIEW_SERVICES
        ]),
        [ROLES.DEVELOPER]: Object.freeze([
            PERMISSIONS.VIEW_DASHBOARD,
            PERMISSIONS.VIEW_PROJECTS,
            PERMISSIONS.EDIT_TASKS,
            PERMISSIONS.UPLOAD_FILES,
            PERMISSIONS.VIEW_SERVICES
        ]),
        [ROLES.DESIGNER]: Object.freeze([
            PERMISSIONS.VIEW_DASHBOARD,
            PERMISSIONS.VIEW_PROJECTS,
            PERMISSIONS.EDIT_TASKS,
            PERMISSIONS.UPLOAD_FILES,
            PERMISSIONS.VIEW_SERVICES
        ]),
        [ROLES.CLIENT]: Object.freeze([
            PERMISSIONS.VIEW_PROJECTS
        ])
    });

    const OWNER_ONLY_PERMISSIONS = Object.freeze([
        PERMISSIONS.MANAGE_PAYMENTS,
        PERMISSIONS.MANAGE_TEAM_MEMBERS,
        PERMISSIONS.ACCESS_SYSTEM_SETTINGS,
        PERMISSIONS.ACCESS_ADMIN_PANEL,
        PERMISSIONS.ACCESS_INVITATION_CONTROL
    ]);

    const PAGE_ACCESS_RULES = Object.freeze({
        'dashboard.html': PERMISSIONS.VIEW_DASHBOARD,
        'clients.html': PERMISSIONS.VIEW_CLIENTS,
        'client-detail.html': PERMISSIONS.VIEW_CLIENTS,
        'projects.html': PERMISSIONS.VIEW_PROJECTS,
        'project-detail.html': PERMISSIONS.VIEW_PROJECTS,
        'invoices.html': PERMISSIONS.CREATE_INVOICES,
        'invoice-create.html': PERMISSIONS.CREATE_INVOICES,
        'services.html': PERMISSIONS.VIEW_SERVICES,
        'reports.html': PERMISSIONS.VIEW_REVENUE,
        'team.html': PERMISSIONS.MANAGE_TEAM_MEMBERS,
        'access-roles.html': PERMISSIONS.ACCESS_INVITATION_CONTROL,
        'owner-control.html': PERMISSIONS.ACCESS_ADMIN_PANEL,
        'admin.html': PERMISSIONS.ACCESS_ADMIN_PANEL,
        'settings.html': PERMISSIONS.ACCESS_SETTINGS,
        'developer-info.html': PERMISSIONS.ACCESS_SUPPORT_INFO
    });

    function normalizeEmail(email) {
        return String(email || '').trim().toLowerCase();
    }

    function normalizeRole(role) {
        const normalized = String(role || '')
            .trim()
            .toLowerCase()
            .replace(/[\s-]+/g, '_');
        return ROLE_ALIASES[normalized] || ROLES.ADMIN;
    }

    function isWorkspaceOwner(user) {
        if (!user || typeof user !== 'object') return false;
        if (user.isWorkspaceOwner === true || user.workspaceOwner === true || user.owner === true) {
            return true;
        }

        const userEmail = normalizeEmail(user.email);
        const ownerEmail = normalizeEmail(user.workspaceOwnerEmail || user.ownerEmail);
        const userId = String(user.uid || user.userId || '').trim();
        const ownerUserId = String(user.workspaceOwnerUserId || user.ownerUserId || '').trim();

        if (ownerUserId && userId && ownerUserId === userId) {
            return true;
        }

        return Boolean(userEmail && ownerEmail && userEmail === ownerEmail);
    }

    function getAuthenticatedPermissionKeys(user) {
        if (!user || typeof user !== 'object') return [];

        const role = normalizeRole(user.role || user.workspaceRole || user.dashboardRole);
        const permissionKeys = new Set([
            ...(ROLE_PERMISSION_MAP[role] || ROLE_PERMISSION_MAP[ROLES.ADMIN]),
            ...GLOBAL_AUTHENTICATED_PERMISSIONS
        ]);

        if (isWorkspaceOwner(user)) {
            OWNER_ONLY_PERMISSIONS.forEach(permission => permissionKeys.add(permission));
        }

        const explicitPermissions = Array.isArray(user.permissionKeys)
            ? user.permissionKeys
            : (Array.isArray(user.permissions) ? user.permissions : []);
        explicitPermissions.forEach(permission => {
            if (permission) permissionKeys.add(String(permission));
        });

        return Array.from(permissionKeys);
    }

    function hasPermission(user, permission) {
        return getAuthenticatedPermissionKeys(user).includes(String(permission || '').trim());
    }

    function getPermissionMatrix(user) {
        const permissionSet = new Set(getAuthenticatedPermissionKeys(user));
        const isOwner = isWorkspaceOwner(user);
        const role = normalizeRole(user && (user.role || user.workspaceRole || user.dashboardRole));
        const canDeleteManagedRecords = isOwner || role === ROLES.ADMIN;

        return {
            clients: {
                create: permissionSet.has(PERMISSIONS.EDIT_CLIENT_INFO),
                update: permissionSet.has(PERMISSIONS.EDIT_CLIENT_INFO),
                delete: canDeleteManagedRecords && permissionSet.has(PERMISSIONS.EDIT_CLIENT_INFO),
                read: permissionSet.has(PERMISSIONS.VIEW_CLIENTS)
            },
            invoices: {
                create: permissionSet.has(PERMISSIONS.CREATE_INVOICES),
                update: permissionSet.has(PERMISSIONS.CREATE_INVOICES),
                delete: canDeleteManagedRecords && permissionSet.has(PERMISSIONS.CREATE_INVOICES),
                read: permissionSet.has(PERMISSIONS.CREATE_INVOICES) || permissionSet.has(PERMISSIONS.VIEW_REVENUE)
            },
            projects: {
                create: permissionSet.has(PERMISSIONS.MANAGE_PROJECTS),
                update: permissionSet.has(PERMISSIONS.MANAGE_PROJECTS),
                delete: canDeleteManagedRecords && permissionSet.has(PERMISSIONS.MANAGE_PROJECTS),
                read: permissionSet.has(PERMISSIONS.VIEW_PROJECTS)
            },
            services: {
                create: isOwner || role === ROLES.ADMIN || role === ROLES.PM,
                update: isOwner || role === ROLES.ADMIN || role === ROLES.PM,
                delete: isOwner || role === ROLES.ADMIN,
                read: permissionSet.has(PERMISSIONS.VIEW_SERVICES)
            },
            tasks: {
                create: permissionSet.has(PERMISSIONS.EDIT_TASKS),
                update: permissionSet.has(PERMISSIONS.EDIT_TASKS),
                delete: permissionSet.has(PERMISSIONS.DELETE_TASKS),
                read: permissionSet.has(PERMISSIONS.VIEW_PROJECTS)
            },
            team: {
                create: permissionSet.has(PERMISSIONS.MANAGE_TEAM_MEMBERS),
                update: permissionSet.has(PERMISSIONS.MANAGE_TEAM_MEMBERS),
                delete: permissionSet.has(PERMISSIONS.MANAGE_TEAM_MEMBERS),
                read: permissionSet.has(PERMISSIONS.MANAGE_TEAM_MEMBERS)
            }
        };
    }

    function getAccessProfile(user) {
        const role = normalizeRole(user && (user.role || user.workspaceRole || user.dashboardRole));
        const permissionKeys = getAuthenticatedPermissionKeys(user);
        return {
            role,
            isWorkspaceOwner: isWorkspaceOwner(user),
            permissionKeys,
            permissionMatrix: getPermissionMatrix({ ...(user || {}), role })
        };
    }

    function getRoleDisplayLabel(role) {
        const normalizedRole = normalizeRole(role);
        const labels = {
            [ROLES.ADMIN]: 'Admin',
            [ROLES.PM]: 'PM',
            [ROLES.DEVELOPER]: 'Developer',
            [ROLES.DESIGNER]: 'Designer',
            [ROLES.CLIENT]: 'Client'
        };
        return labels[normalizedRole] || 'Admin';
    }

    function canAccessAdminPanel(user) {
        return hasPermission(user, PERMISSIONS.ACCESS_ADMIN_PANEL);
    }

    function canManagePayments(user) {
        return hasPermission(user, PERMISSIONS.MANAGE_PAYMENTS);
    }

    function canManageTeamMembers(user) {
        return hasPermission(user, PERMISSIONS.MANAGE_TEAM_MEMBERS);
    }

    function canViewDashboard(user) {
        return hasPermission(user, PERMISSIONS.VIEW_DASHBOARD);
    }

    function canViewClients(user) {
        return hasPermission(user, PERMISSIONS.VIEW_CLIENTS);
    }

    function canEditClientInfo(user) {
        return hasPermission(user, PERMISSIONS.EDIT_CLIENT_INFO);
    }

    function canViewProjects(user) {
        return hasPermission(user, PERMISSIONS.VIEW_PROJECTS);
    }

    function canManageProjects(user) {
        return hasPermission(user, PERMISSIONS.MANAGE_PROJECTS);
    }

    function canEditTasks(user) {
        return hasPermission(user, PERMISSIONS.EDIT_TASKS);
    }

    function canDeleteTasks(user) {
        return hasPermission(user, PERMISSIONS.DELETE_TASKS);
    }

    function canViewRevenue(user) {
        return hasPermission(user, PERMISSIONS.VIEW_REVENUE);
    }

    function canCreateInvoices(user) {
        return hasPermission(user, PERMISSIONS.CREATE_INVOICES);
    }

    function canUploadFiles(user) {
        return hasPermission(user, PERMISSIONS.UPLOAD_FILES);
    }

    function canAccessSystemSettings(user) {
        return hasPermission(user, PERMISSIONS.ACCESS_SYSTEM_SETTINGS);
    }

    function canAccessSettings(user) {
        return hasPermission(user, PERMISSIONS.ACCESS_SETTINGS);
    }

    function canAccessSupportInfo(user) {
        return hasPermission(user, PERMISSIONS.ACCESS_SUPPORT_INFO);
    }

    function canAccessInvitationControl(user) {
        return hasPermission(user, PERMISSIONS.ACCESS_INVITATION_CONTROL);
    }

    function canAccessPage(user, pageName) {
        const normalizedPage = String(pageName || '').trim().toLowerCase();
        const requiredPermission = PAGE_ACCESS_RULES[normalizedPage];
        if (!requiredPermission) {
            return Boolean(user);
        }
        return hasPermission(user, requiredPermission);
    }

    function getAllowedPages(user) {
        return Object.keys(PAGE_ACCESS_RULES).filter(page => canAccessPage(user, page));
    }

    function sanitizeAssignedProjectIds(projectIds) {
        return Array.from(new Set((Array.isArray(projectIds) ? projectIds : [])
            .map(projectId => String(projectId || '').trim())
            .filter(Boolean)));
    }

    return {
        ROLES,
        PERMISSIONS,
        ROLE_PERMISSION_MAP,
        OWNER_ONLY_PERMISSIONS,
        PAGE_ACCESS_RULES,
        GLOBAL_AUTHENTICATED_PERMISSIONS,
        normalizeEmail,
        normalizeRole,
        isWorkspaceOwner,
        getAuthenticatedPermissionKeys,
        getPermissionMatrix,
        getAccessProfile,
        getRoleDisplayLabel,
        hasPermission,
        canAccessAdminPanel,
        canManagePayments,
        canManageTeamMembers,
        canViewDashboard,
        canViewClients,
        canEditClientInfo,
        canViewProjects,
        canManageProjects,
        canEditTasks,
        canDeleteTasks,
        canViewRevenue,
        canCreateInvoices,
        canUploadFiles,
        canAccessSystemSettings,
        canAccessSettings,
        canAccessSupportInfo,
        canAccessInvitationControl,
        canAccessPage,
        getAllowedPages,
        sanitizeAssignedProjectIds
    };
}));
