const AccessControl = require('../../rbac.js');
const {
    getCollectionDocument,
    listCollectionDocuments,
    patchCollectionDocument,
    sanitizeDocumentId,
    upsertCollectionDocument
} = require('./firebase-service');
const { getWorkspaceMemberDocumentId } = require('./workspace-access');

function normalizeProjectAccess(source = {}) {
    const explicitScope = String(
        source.projectAccessScope
        || source.project_access_scope
        || ''
    ).trim().toLowerCase();
    const explicitAllAccess = source.allProjectsAccess === true || source.all_projects_access === true;
    const allProjectsAccess = explicitAllAccess || explicitScope === 'all';
    const assignedProjectIds = allProjectsAccess
        ? []
        : AccessControl.sanitizeAssignedProjectIds(
            source.assignedProjectIds !== undefined
                ? source.assignedProjectIds
                : source.assigned_project_ids
        );

    return {
        allProjectsAccess,
        assignedProjectIds,
        projectAccessScope: allProjectsAccess ? 'all' : 'selected',
        primaryProjectId: allProjectsAccess ? '' : (assignedProjectIds[0] || '')
    };
}

function buildClientAccessFields(source = {}) {
    const normalized = normalizeProjectAccess(source);
    return {
        assigned_project_ids: normalized.assignedProjectIds,
        all_projects_access: normalized.allProjectsAccess,
        project_access_scope: normalized.projectAccessScope,
        project_id: normalized.primaryProjectId,
        primary_project_id: normalized.primaryProjectId
    };
}

function buildInvitationAccessFields(source = {}) {
    const normalized = normalizeProjectAccess(source);
    return {
        assignedProjectIds: normalized.assignedProjectIds,
        allProjectsAccess: normalized.allProjectsAccess,
        projectAccessScope: normalized.projectAccessScope
    };
}

function buildProfileAccessFields(source = {}) {
    const normalized = normalizeProjectAccess(source);
    return {
        assignedProjectIds: normalized.assignedProjectIds,
        allProjectsAccess: normalized.allProjectsAccess,
        projectAccessScope: normalized.projectAccessScope
    };
}

async function syncProjectAssignments({ workspaceId, userId, email, access, role = 'client', inviteType = 'client' }) {
    const normalizedWorkspaceId = String(workspaceId || '').trim();
    const normalizedUserId = String(userId || '').trim();
    const normalizedEmail = AccessControl.normalizeEmail(email);
    const identityToken = normalizedEmail || normalizedUserId;
    if (!normalizedWorkspaceId || (!normalizedUserId && !normalizedEmail)) return;

    const normalizedRole = AccessControl.normalizeRole(role);
    const now = new Date().toISOString();
    const existingAssignments = await listCollectionDocuments('project_assignments', { pageSize: 500 }).catch(() => []);
    const matchingAssignments = existingAssignments.filter(record => {
        const recordWorkspaceId = String(record.workspaceId || record.workspace_id || '').trim();
        const recordUserId = String(record.userId || record.user_id || '').trim();
        const recordEmail = AccessControl.normalizeEmail(record.email || record.user_email);
        const matchesIdentity = normalizedEmail
            ? recordEmail === normalizedEmail
            : (normalizedUserId && recordUserId === normalizedUserId);
        return recordWorkspaceId === normalizedWorkspaceId && matchesIdentity;
    });

    // Single source of truth: deactivate all existing assignments first.
    for (const assignment of matchingAssignments) {
        await patchCollectionDocument('project_assignments', assignment.id, {
            status: 'inactive',
            active: false,
            updatedAt: now,
            updated_at: now
        }).catch(() => undefined);
    }

    if (access.allProjectsAccess) {
        return;
    }

    const validProjectIds = [];
    for (const rawProjectId of access.assignedProjectIds) {
        const projectId = String(rawProjectId || '').trim();
        if (!projectId) continue;
        const projectRecord = await getCollectionDocument('projects', projectId).catch(() => null);
        const projectWorkspaceId = String(projectRecord && projectRecord.data && projectRecord.data.workspace_id || '').trim();

        if (!projectRecord || !projectWorkspaceId || projectWorkspaceId !== normalizedWorkspaceId) {
            console.error('[WorkspaceConsistency] Assignment rejected due to workspace mismatch', {
                workspaceId: normalizedWorkspaceId,
                projectId,
                projectWorkspaceId
            });
            continue;
        }
        validProjectIds.push(projectId);
    }

    for (const projectId of AccessControl.sanitizeAssignedProjectIds(validProjectIds)) {
        const assignmentId = sanitizeDocumentId(`${normalizedWorkspaceId}_${projectId}_${identityToken}`);
        await upsertCollectionDocument('project_assignments', assignmentId, {
            workspaceId: normalizedWorkspaceId,
            workspace_id: normalizedWorkspaceId,
            projectId,
            project_id: projectId,
            userId: normalizedUserId,
            user_id: normalizedUserId,
            email: normalizedEmail,
            user_email: normalizedEmail,
            role: normalizedRole,
            inviteType: String(inviteType || 'client').trim().toLowerCase(),
            status: 'active',
            createdAt: now,
            created_at: now,
            updatedAt: now,
            updated_at: now,
            active: true
        }).catch(() => undefined);
    }
}

async function syncClientAccessState(clientRecordInput) {
    const clientRecord = clientRecordInput && clientRecordInput.data
        ? clientRecordInput
        : await getCollectionDocument('clients', clientRecordInput && clientRecordInput.id ? clientRecordInput.id : clientRecordInput);

    if (!clientRecord || !clientRecord.data) {
        return null;
    }

    const access = normalizeProjectAccess(clientRecord.data);
    const clientAccessFields = buildClientAccessFields(access);
    const invitationAccessFields = buildInvitationAccessFields(access);
    const profileAccessFields = buildProfileAccessFields(access);

    await patchCollectionDocument('clients', clientRecord.id, {
        ...clientAccessFields,
        updated_at: new Date().toISOString()
    }).catch(() => undefined);

    if (clientRecord.data.invitation_id) {
        await patchCollectionDocument('invitations', clientRecord.data.invitation_id, {
            ...invitationAccessFields,
            updatedAt: new Date().toISOString()
        }).catch(() => undefined);
    }

    const userId = String(clientRecord.data.invited_user_id || '').trim();
    const email = AccessControl.normalizeEmail(clientRecord.data.email);
    const workspaceId = String(clientRecord.data.workspace_id || '').trim();

    if (!userId || !workspaceId || !email) {
        return {
            id: clientRecord.id,
            data: {
                ...clientRecord.data,
                ...clientAccessFields
            }
        };
    }

    const userProfile = await getCollectionDocument('users', userId).catch(() => null);
    if (userProfile && userProfile.data) {
        await patchCollectionDocument('users', userId, {
            ...profileAccessFields,
            updatedAt: new Date().toISOString()
        }).catch(() => undefined);
    }

    const clientProfileId = sanitizeDocumentId(`${workspaceId}_${email}`);
    await upsertCollectionDocument('client_profiles', clientProfileId, {
        workspaceId,
        userId,
        email,
        ...profileAccessFields,
        status: 'active',
        updatedAt: new Date().toISOString()
    }).catch(() => undefined);

    const memberDocId = getWorkspaceMemberDocumentId(workspaceId, userId, email);
    const existingMember = await getCollectionDocument('workspace_members', memberDocId).catch(() => null);
    if (existingMember && existingMember.data) {
        await upsertCollectionDocument('workspace_members', memberDocId, {
            ...existingMember.data,
            ...profileAccessFields,
            updatedAt: new Date().toISOString()
        }).catch(() => undefined);
    }

    await syncProjectAssignments({
        workspaceId,
        userId,
        email,
        access,
        role: 'client',
        inviteType: 'client'
    });

    return {
        id: clientRecord.id,
        data: {
            ...clientRecord.data,
            ...clientAccessFields
        }
    };
}

module.exports = {
    buildClientAccessFields,
    buildInvitationAccessFields,
    buildProfileAccessFields,
    normalizeProjectAccess,
    syncProjectAssignments,
    syncClientAccessState
};
