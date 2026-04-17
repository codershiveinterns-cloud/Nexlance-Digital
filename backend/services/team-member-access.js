const AccessControl = require('../../rbac.js');
const {
    findUserDocumentByEmail,
    getCollectionDocument,
    patchCollectionDocument,
    sanitizeDocumentId,
    upsertCollectionDocument
} = require('./firebase-service');
const {
    buildInvitationAccessFields,
    normalizeProjectAccess,
    syncProjectAssignments
} = require('./client-access');
const {
    buildPermissionFields,
    getWorkspaceMemberDocumentId,
    invalidateSessionCache,
    resolveScopedAssignedProjectsForLogin
} = require('./workspace-access');

function buildTeamPermissionFields(role) {
    const normalizedRole = AccessControl.normalizeRole(role);
    const togglePermissions = AccessControl.getRoleTogglePermissions(normalizedRole);
    return {
        canonical_role: normalizedRole,
        role: AccessControl.getRoleDisplayLabel(normalizedRole),
        can_edit_tasks: togglePermissions.canEditTasks,
        can_see_revenue: togglePermissions.canSeeRevenue,
        can_create_invoices: togglePermissions.canCreateInvoices,
        can_upload_files: togglePermissions.canUploadFiles
    };
}

function getExplicitTeamPermissionState(teamMemberData = {}) {
    const permissionKeys = Array.isArray(teamMemberData.permission_keys)
        ? teamMemberData.permission_keys
        : (Array.isArray(teamMemberData.permissionKeys) ? teamMemberData.permissionKeys : []);
    const permissionMode = String(teamMemberData.permission_mode || teamMemberData.permissionMode || '').trim().toLowerCase();
    return {
        permissionKeys,
        permissionMode: permissionMode === 'explicit' ? 'explicit' : 'default'
    };
}

async function resolveLinkedUser(teamMemberData = {}) {
    const explicitUserId = String(teamMemberData.invited_user_id || teamMemberData.userId || '').trim();
    if (explicitUserId) {
        const user = await getCollectionDocument('users', explicitUserId).catch(() => null);
        if (user && user.data) {
            return {
                id: explicitUserId,
                data: user.data
            };
        }
    }

    const email = AccessControl.normalizeEmail(teamMemberData.email);
    if (!email) return null;

    const user = await findUserDocumentByEmail(email).catch(() => null);
    if (!user || !user.data) return null;

    if (
        teamMemberData.workspace_id
        && user.data.workspaceId
        && String(user.data.workspaceId).trim() !== String(teamMemberData.workspace_id).trim()
    ) {
        return null;
    }

    return user;
}

async function syncWorkspaceMemberRecord({ workspaceId, userId, email, teamMemberData, role, access }) {
    if (!workspaceId || !email) return;

    const memberDocId = getWorkspaceMemberDocumentId(workspaceId, userId, email);
    const existing = await getCollectionDocument('workspace_members', memberDocId).catch(() => null);
    const permissionFields = buildPermissionFields({
        ...(existing && existing.data ? existing.data : {}),
        role,
        workspaceRole: role,
        email,
        isWorkspaceOwner: false,
        permissionKeys: Array.isArray(teamMemberData.permission_keys)
            ? teamMemberData.permission_keys
            : (Array.isArray(teamMemberData.permissionKeys) ? teamMemberData.permissionKeys : []),
        permissionMode: String(teamMemberData.permission_mode || teamMemberData.permissionMode || '').trim().toLowerCase() === 'explicit'
            ? 'explicit'
            : 'default',
        assignedProjectIds: access.assignedProjectIds,
        allProjectsAccess: access.allProjectsAccess,
        projectAccessScope: access.projectAccessScope
    });

    await upsertCollectionDocument('workspace_members', memberDocId, {
        ...(existing && existing.data ? existing.data : {}),
        workspaceId,
        userId: userId || '',
        email,
        name: String(teamMemberData.name || email).trim(),
        role,
        workspaceRole: role,
        isWorkspaceOwner: false,
        permissionKeys: permissionFields.permissionKeys,
        permissions: permissionFields.permissions,
        permissionMode: permissionFields.permissionMode,
        assignedProjectIds: access.assignedProjectIds,
        allProjectsAccess: access.allProjectsAccess,
        projectAccessScope: access.projectAccessScope,
        status: String(
            teamMemberData.invite_status === 'accepted'
                ? 'active'
                : (existing && existing.data && existing.data.status)
                    ? existing.data.status
                    : 'pending'
        ).trim().toLowerCase(),
        inviteType: 'team',
        updatedAt: new Date().toISOString(),
        createdAt: existing && existing.data && existing.data.createdAt
            ? existing.data.createdAt
            : (teamMemberData.created_at || new Date().toISOString())
    }).catch(() => undefined);
}

async function syncTeamMemberState(teamMemberInput) {
    const teamMemberRecord = teamMemberInput && teamMemberInput.data
        ? teamMemberInput
        : await getCollectionDocument('team_members', teamMemberInput && teamMemberInput.id ? teamMemberInput.id : teamMemberInput);

    if (!teamMemberRecord || !teamMemberRecord.data) {
        return null;
    }

    const roleFields = buildTeamPermissionFields(teamMemberRecord.data.canonical_role || teamMemberRecord.data.role);
    const access = normalizeProjectAccess({
        assignedProjectIds: teamMemberRecord.data.assigned_project_ids || teamMemberRecord.data.assignedProjectIds || [],
        allProjectsAccess: teamMemberRecord.data.all_projects_access === true || teamMemberRecord.data.allProjectsAccess === true,
        projectAccessScope: teamMemberRecord.data.project_access_scope || teamMemberRecord.data.projectAccessScope || ''
    });

    const teamMemberAccessFields = {
        assigned_project_ids: access.assignedProjectIds,
        all_projects_access: access.allProjectsAccess,
        project_access_scope: access.projectAccessScope,
        project_id: access.primaryProjectId,
        primary_project_id: access.primaryProjectId
    };
    const explicitPermissionState = getExplicitTeamPermissionState(teamMemberRecord.data);

    await patchCollectionDocument('team_members', teamMemberRecord.id, {
        ...roleFields,
        ...teamMemberAccessFields,
        permission_keys: explicitPermissionState.permissionKeys,
        permission_mode: explicitPermissionState.permissionMode,
        updated_at: new Date().toISOString()
    }).catch(() => undefined);

    if (teamMemberRecord.data.invitation_id) {
        await patchCollectionDocument('invitations', teamMemberRecord.data.invitation_id, {
            role: roleFields.canonical_role,
            ...buildInvitationAccessFields(access),
            permissionKeys: explicitPermissionState.permissionKeys,
            permissionMode: explicitPermissionState.permissionMode,
            updatedAt: new Date().toISOString()
        }).catch(() => undefined);
    }

    const workspaceId = String(teamMemberRecord.data.workspace_id || '').trim();
    const email = AccessControl.normalizeEmail(teamMemberRecord.data.email);
    const linkedUser = await resolveLinkedUser(teamMemberRecord.data);
    const linkedUserId = linkedUser && linkedUser.id ? String(linkedUser.id).trim() : '';

    if (linkedUser && linkedUser.data) {
        const permissionFields = buildPermissionFields({
            ...linkedUser.data,
            role: roleFields.canonical_role,
            workspaceRole: roleFields.canonical_role,
            email,
            isWorkspaceOwner: false,
            permissionKeys: explicitPermissionState.permissionKeys,
            permissionMode: explicitPermissionState.permissionMode,
            assignedProjectIds: access.assignedProjectIds,
            allProjectsAccess: access.allProjectsAccess,
            projectAccessScope: access.projectAccessScope
        });

        await patchCollectionDocument('users', linkedUser.id, {
            role: roleFields.canonical_role,
            workspaceRole: roleFields.canonical_role,
            permissionKeys: permissionFields.permissionKeys,
            permissions: permissionFields.permissions,
            permissionMode: permissionFields.permissionMode,
            assignedProjectIds: access.assignedProjectIds,
            allProjectsAccess: access.allProjectsAccess,
            projectAccessScope: access.projectAccessScope,
            updatedAt: new Date().toISOString()
        }).catch(() => undefined);
        // Invalidate cached session — role/permissions just changed for this user
        invalidateSessionCache(linkedUser.id);
    }

    await syncWorkspaceMemberRecord({
        workspaceId,
        userId: linkedUserId,
        email,
        teamMemberData: {
            ...teamMemberRecord.data,
            ...roleFields
        },
        role: roleFields.canonical_role,
        access
    });

    if (workspaceId && (linkedUserId || email)) {
        await syncProjectAssignments({
            workspaceId,
            userId: linkedUserId,
            email,
            access,
            role: roleFields.canonical_role,
            inviteType: 'team'
        }).catch(() => undefined);
    }

    // NOTE: resolveScopedAssignedProjectsForLogin() is already called at the
    // end of syncProjectAssignments() above — calling it a second time here
    // is redundant and doubles the Firestore read/write cost for the same
    // result.  Removed to prevent unnecessary load.

    return {
        id: teamMemberRecord.id,
        data: {
            ...teamMemberRecord.data,
            ...roleFields,
            ...teamMemberAccessFields,
            permission_keys: explicitPermissionState.permissionKeys,
            permission_mode: explicitPermissionState.permissionMode,
            invited_user_id: linkedUserId || String(teamMemberRecord.data.invited_user_id || '').trim()
        }
    };
}

module.exports = {
    buildTeamPermissionFields,
    syncTeamMemberState
};
