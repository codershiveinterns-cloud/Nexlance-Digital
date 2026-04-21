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
        DEVELOPER: 'developer',
        DESIGNER: 'designer',
        // Legacy alias kept for backward compatibility with existing stored records.
        TEAM_MEMBER: 'team_member',
        CLIENT: 'client'
    });

    const USER_KINDS = Object.freeze({
        ADMIN: 'admin',
        TEAM_MEMBER: 'team_member',
        CLIENT: 'client'
    });

    const INTERNAL_TEAM_ROLES = Object.freeze([
        ROLES.DEVELOPER,
        ROLES.DESIGNER,
        ROLES.TEAM_MEMBER
    ]);

    const PERMISSIONS = Object.freeze({
        VIEW_DASHBOARD: 'view_dashboard',
        VIEW_CLIENTS: 'view_clients',
        EDIT_CLIENT_INFO: 'edit_client_info',
        VIEW_PROJECTS: 'view_projects',
        MANAGE_PROJECTS: 'manage_projects',
        VIEW_TEMPLATE_WORKSPACE: 'view_template_workspace',
        EDIT_TEMPLATE: 'edit_template',
        SAVE_TEMPLATE: 'save_template',
        COMPLETE_PROJECT: 'complete_project',
        DOWNLOAD_OUTPUT: 'download_output',
        VIEW_TASK_BOARD: 'view_task_board',
        EDIT_TASK_BOARD: 'edit_task_board',
        EDIT_TASKS: 'edit_tasks',
        DELETE_TASKS: 'delete_tasks',
        VIEW_REVENUE: 'view_revenue',
        CREATE_INVOICES: 'create_invoices',
        VIEW_INVOICES: 'view_invoices',
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
        [ROLES.ADMIN]: ROLES.ADMIN,
        pm: ROLES.DEVELOPER,
        project_manager: ROLES.DEVELOPER,
        'project manager': ROLES.DEVELOPER,
        [ROLES.TEAM_MEMBER]: ROLES.DEVELOPER,
        team_member: ROLES.DEVELOPER,
        'team member': ROLES.DEVELOPER,
        developer: ROLES.DEVELOPER,
        dev: ROLES.DEVELOPER,
        designer: ROLES.DESIGNER,
        'ui_ux_designer': ROLES.DESIGNER,
        'ui/ux designer': ROLES.DESIGNER,
        member: ROLES.DEVELOPER,
        team: ROLES.DEVELOPER,
        [ROLES.CLIENT]: ROLES.CLIENT,
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
            PERMISSIONS.VIEW_TEMPLATE_WORKSPACE,
            PERMISSIONS.EDIT_TEMPLATE,
            PERMISSIONS.SAVE_TEMPLATE,
            PERMISSIONS.COMPLETE_PROJECT,
            PERMISSIONS.DOWNLOAD_OUTPUT,
            PERMISSIONS.VIEW_TASK_BOARD,
            PERMISSIONS.EDIT_TASK_BOARD,
            PERMISSIONS.EDIT_TASKS,
            PERMISSIONS.DELETE_TASKS,
            PERMISSIONS.VIEW_REVENUE,
            PERMISSIONS.CREATE_INVOICES,
            PERMISSIONS.VIEW_INVOICES,
            PERMISSIONS.MANAGE_PAYMENTS,
            PERMISSIONS.UPLOAD_FILES,
            PERMISSIONS.VIEW_SERVICES,
            PERMISSIONS.MANAGE_TEAM_MEMBERS,
            PERMISSIONS.ACCESS_SYSTEM_SETTINGS,
            PERMISSIONS.ACCESS_ADMIN_PANEL,
            PERMISSIONS.ACCESS_INVITATION_CONTROL
        ]),
        [ROLES.DEVELOPER]: Object.freeze([
            PERMISSIONS.VIEW_PROJECTS,
            PERMISSIONS.MANAGE_PROJECTS,
            PERMISSIONS.VIEW_TEMPLATE_WORKSPACE,
            PERMISSIONS.EDIT_TEMPLATE,
            PERMISSIONS.SAVE_TEMPLATE,
            PERMISSIONS.COMPLETE_PROJECT,
            PERMISSIONS.VIEW_TASK_BOARD,
            PERMISSIONS.EDIT_TASK_BOARD,
            PERMISSIONS.EDIT_TASKS,
            PERMISSIONS.DELETE_TASKS,
            PERMISSIONS.UPLOAD_FILES,
            PERMISSIONS.VIEW_SERVICES,
            PERMISSIONS.ACCESS_SYSTEM_SETTINGS
        ]),
        [ROLES.DESIGNER]: Object.freeze([
            PERMISSIONS.VIEW_PROJECTS,
            PERMISSIONS.MANAGE_PROJECTS,
            PERMISSIONS.VIEW_TEMPLATE_WORKSPACE,
            PERMISSIONS.EDIT_TEMPLATE,
            PERMISSIONS.SAVE_TEMPLATE,
            PERMISSIONS.COMPLETE_PROJECT,
            PERMISSIONS.VIEW_TASK_BOARD,
            PERMISSIONS.EDIT_TASK_BOARD,
            PERMISSIONS.EDIT_TASKS,
            PERMISSIONS.DELETE_TASKS,
            PERMISSIONS.UPLOAD_FILES,
            PERMISSIONS.VIEW_SERVICES,
            PERMISSIONS.ACCESS_SYSTEM_SETTINGS
        ]),
        [ROLES.CLIENT]: Object.freeze([
            PERMISSIONS.VIEW_PROJECTS,
            PERMISSIONS.VIEW_TEMPLATE_WORKSPACE,
            PERMISSIONS.VIEW_TASK_BOARD,
            PERMISSIONS.EDIT_TASK_BOARD,
            PERMISSIONS.EDIT_TASKS
        ])
    });

    const OWNER_ONLY_PERMISSIONS = Object.freeze([
        PERMISSIONS.MANAGE_PAYMENTS,
        PERMISSIONS.MANAGE_TEAM_MEMBERS,
        PERMISSIONS.ACCESS_ADMIN_PANEL,
        PERMISSIONS.ACCESS_INVITATION_CONTROL
    ]);

    const PERMISSION_CATALOG = Object.freeze([
        Object.freeze({ key: PERMISSIONS.VIEW_DASHBOARD, label: 'View Dashboard' }),
        Object.freeze({ key: PERMISSIONS.VIEW_CLIENTS, label: 'View Clients' }),
        Object.freeze({ key: PERMISSIONS.EDIT_CLIENT_INFO, label: 'Edit Client Info' }),
        Object.freeze({ key: PERMISSIONS.VIEW_PROJECTS, label: 'View Projects' }),
        Object.freeze({ key: PERMISSIONS.MANAGE_PROJECTS, label: 'Manage Projects' }),
        Object.freeze({ key: PERMISSIONS.VIEW_TEMPLATE_WORKSPACE, label: 'View Template Workspace' }),
        Object.freeze({ key: PERMISSIONS.EDIT_TEMPLATE, label: 'Edit Template Workspace' }),
        Object.freeze({ key: PERMISSIONS.SAVE_TEMPLATE, label: 'Save Template Workspace' }),
        Object.freeze({ key: PERMISSIONS.COMPLETE_PROJECT, label: 'Complete Project Workspace' }),
        Object.freeze({ key: PERMISSIONS.DOWNLOAD_OUTPUT, label: 'Download Project Output' }),
        Object.freeze({ key: PERMISSIONS.VIEW_TASK_BOARD, label: 'View Task Board' }),
        Object.freeze({ key: PERMISSIONS.EDIT_TASK_BOARD, label: 'Edit Task Board' }),
        Object.freeze({ key: PERMISSIONS.EDIT_TASKS, label: 'Edit Tasks' }),
        Object.freeze({ key: PERMISSIONS.DELETE_TASKS, label: 'Delete Tasks' }),
        Object.freeze({ key: PERMISSIONS.VIEW_REVENUE, label: 'View Revenue Data' }),
        Object.freeze({ key: PERMISSIONS.CREATE_INVOICES, label: 'Create Invoices' }),
        Object.freeze({ key: PERMISSIONS.VIEW_INVOICES, label: 'View Invoices' }),
        Object.freeze({ key: PERMISSIONS.MANAGE_PAYMENTS, label: 'Manage Payments' }),
        Object.freeze({ key: PERMISSIONS.UPLOAD_FILES, label: 'Upload Files' }),
        Object.freeze({ key: PERMISSIONS.MANAGE_TEAM_MEMBERS, label: 'Manage Team Members' }),
        Object.freeze({ key: PERMISSIONS.ACCESS_SYSTEM_SETTINGS, label: 'System Settings' }),
        Object.freeze({ key: PERMISSIONS.ACCESS_INVITATION_CONTROL, label: 'Invitation Control' }),
        Object.freeze({ key: PERMISSIONS.ACCESS_SETTINGS, label: 'Access Settings' }),
        Object.freeze({ key: PERMISSIONS.ACCESS_SUPPORT_INFO, label: 'Access Support Info' }),
        Object.freeze({ key: PERMISSIONS.SIGN_OUT, label: 'Sign Out' }),
        Object.freeze({ key: PERMISSIONS.VIEW_SERVICES, label: 'View Services' })
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

    const TEMPLATE_WORKSPACE_CAPABILITIES = Object.freeze({
        VIEW_TEMPLATE_WORKSPACE: 'view_template_workspace',
        EDIT_TEMPLATE: 'edit_template',
        SAVE_TEMPLATE: 'save_template',
        COMPLETE_TEMPLATE_PROJECT: 'complete_template_project',
        DOWNLOAD_TEMPLATE_OUTPUT: 'download_template_output',
        ADMIN_OVERRIDE: 'admin_override'
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

    function getUserKind(user) {
        const role = normalizeRole(user && (user.role || user.workspaceRole || user.dashboardRole));
        if (isWorkspaceOwner(user) || role === ROLES.ADMIN) {
            return USER_KINDS.ADMIN;
        }
        if (role === ROLES.CLIENT) {
            return USER_KINDS.CLIENT;
        }
        return USER_KINDS.TEAM_MEMBER;
    }

    function getExplicitPermissionKeys(user) {
        if (!user || typeof user !== 'object') return [];
        const rawPermissionKeys = Array.isArray(user.permissionKeys)
            ? user.permissionKeys
            : (Array.isArray(user.permission_keys) ? user.permission_keys : []);
        return Array.from(new Set(rawPermissionKeys
            .map(permission => String(permission || '').trim())
            .filter(Boolean)));
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

        const role = normalizeRole(user && (user.role || user.workspaceRole || user.dashboardRole || 'admin'));
        const explicitPermissionKeys = getExplicitPermissionKeys(user);
        const permissionMode = String(user.permissionMode || user.permission_mode || '').trim().toLowerCase();
        const permissionKeys = new Set(GLOBAL_AUTHENTICATED_PERMISSIONS);

        if (permissionMode === 'explicit') {
            explicitPermissionKeys.forEach(permission => permissionKeys.add(permission));
        } else {
            [
                ...(ROLE_PERMISSION_MAP[role] || ROLE_PERMISSION_MAP[ROLES.ADMIN]),
                ...explicitPermissionKeys
            ].forEach(permission => permissionKeys.add(permission));
        }

        // Baseline capabilities that apply to every CLIENT regardless of the
        // permissionMode or the explicit permission keys stored on their
        // invitation record.  This lets clients manage tasks on the project
        // task board even if their stored invitation predates this change.
        if (role === ROLES.CLIENT) {
            permissionKeys.add(PERMISSIONS.EDIT_TASK_BOARD);
            permissionKeys.add(PERMISSIONS.EDIT_TASKS);
        }

        if (isWorkspaceOwner(user)) {
            OWNER_ONLY_PERMISSIONS.forEach(permission => permissionKeys.add(permission));
        }

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
                read: permissionSet.has(PERMISSIONS.VIEW_INVOICES)
            },
            projects: {
                create: permissionSet.has(PERMISSIONS.MANAGE_PROJECTS),
                update: permissionSet.has(PERMISSIONS.MANAGE_PROJECTS),
                delete: canDeleteManagedRecords && permissionSet.has(PERMISSIONS.MANAGE_PROJECTS),
                read: permissionSet.has(PERMISSIONS.VIEW_PROJECTS)
            },
            services: {
                create: isOwner || role === ROLES.ADMIN,
                update: isOwner || role === ROLES.ADMIN,
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
            userKind: getUserKind(user),
            isWorkspaceOwner: isWorkspaceOwner(user),
            permissionKeys,
            permissionMatrix: getPermissionMatrix({ ...(user || {}), role })
        };
    }

    function getRoleDisplayLabel(role) {
        const normalizedRole = normalizeRole(role);
        const labels = {
            [ROLES.ADMIN]: 'Admin',
            [ROLES.DEVELOPER]: 'Developer',
            [ROLES.DESIGNER]: 'Designer',
            [ROLES.TEAM_MEMBER]: 'Developer',
            [ROLES.CLIENT]: 'Client'
        };
        return labels[normalizedRole] || 'Admin';
    }

    function getRolePermissionKeys(role, options = {}) {
        const normalizedRole = normalizeRole(role);
        const pseudoUser = {
            role: normalizedRole,
            workspaceRole: normalizedRole,
            isWorkspaceOwner: options.isWorkspaceOwner === true
        };
        return getAuthenticatedPermissionKeys(pseudoUser);
    }

    function getRoleTogglePermissions(role) {
        const permissionSet = new Set(getRolePermissionKeys(role));
        return {
            canEditTasks: permissionSet.has(PERMISSIONS.EDIT_TASKS),
            canSeeRevenue: permissionSet.has(PERMISSIONS.VIEW_REVENUE),
            canCreateInvoices: permissionSet.has(PERMISSIONS.CREATE_INVOICES),
            canUploadFiles: permissionSet.has(PERMISSIONS.UPLOAD_FILES)
        };
    }

    function createEmptyTemplateWorkspaceCapabilities() {
        return {
            [TEMPLATE_WORKSPACE_CAPABILITIES.VIEW_TEMPLATE_WORKSPACE]: false,
            [TEMPLATE_WORKSPACE_CAPABILITIES.EDIT_TEMPLATE]: false,
            [TEMPLATE_WORKSPACE_CAPABILITIES.SAVE_TEMPLATE]: false,
            [TEMPLATE_WORKSPACE_CAPABILITIES.COMPLETE_TEMPLATE_PROJECT]: false,
            [TEMPLATE_WORKSPACE_CAPABILITIES.DOWNLOAD_TEMPLATE_OUTPUT]: false,
            [TEMPLATE_WORKSPACE_CAPABILITIES.ADMIN_OVERRIDE]: false
        };
    }

    function isTemplateWorkspaceTeamMemberRole(role) {
        const normalizedRole = normalizeRole(role);
        return INTERNAL_TEAM_ROLES.includes(normalizedRole);
    }

    function isInternalTeamRole(role) {
        const normalizedRole = normalizeRole(role);
        return normalizedRole === ROLES.ADMIN
            || normalizedRole === ROLES.DEVELOPER
            || normalizedRole === ROLES.DESIGNER;
    }

    function getTemplateWorkspaceRoleCapabilities(user) {
        const capabilities = createEmptyTemplateWorkspaceCapabilities();
        const normalizedRole = normalizeRole(user && (user.role || user.workspaceRole || user.dashboardRole));
        const isOwner = isWorkspaceOwner(user);
        const isAdmin = isOwner || normalizedRole === ROLES.ADMIN;

        if (isAdmin) {
            Object.keys(capabilities).forEach(capability => {
                capabilities[capability] = true;
            });
            return capabilities;
        }

        if (normalizedRole === ROLES.CLIENT) {
            capabilities[TEMPLATE_WORKSPACE_CAPABILITIES.VIEW_TEMPLATE_WORKSPACE] = true;
            return capabilities;
        }

        if (isTemplateWorkspaceTeamMemberRole(normalizedRole)) {
            capabilities[TEMPLATE_WORKSPACE_CAPABILITIES.VIEW_TEMPLATE_WORKSPACE] = true;
            capabilities[TEMPLATE_WORKSPACE_CAPABILITIES.EDIT_TEMPLATE] = true;
            capabilities[TEMPLATE_WORKSPACE_CAPABILITIES.SAVE_TEMPLATE] = true;
            capabilities[TEMPLATE_WORKSPACE_CAPABILITIES.COMPLETE_TEMPLATE_PROJECT] = true;
            capabilities[TEMPLATE_WORKSPACE_CAPABILITIES.DOWNLOAD_TEMPLATE_OUTPUT] = true;
        }

        return capabilities;
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
        USER_KINDS,
        INTERNAL_TEAM_ROLES,
        PERMISSIONS,
        TEMPLATE_WORKSPACE_CAPABILITIES,
        ROLE_PERMISSION_MAP,
        OWNER_ONLY_PERMISSIONS,
        PERMISSION_CATALOG,
        PAGE_ACCESS_RULES,
        GLOBAL_AUTHENTICATED_PERMISSIONS,
        normalizeEmail,
        normalizeRole,
        getUserKind,
        isWorkspaceOwner,
        getAuthenticatedPermissionKeys,
        getRolePermissionKeys,
        getRoleTogglePermissions,
        createEmptyTemplateWorkspaceCapabilities,
        getPermissionMatrix,
        getAccessProfile,
        getRoleDisplayLabel,
        getTemplateWorkspaceRoleCapabilities,
        hasPermission,
        isTemplateWorkspaceTeamMemberRole,
        isInternalTeamRole,
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
