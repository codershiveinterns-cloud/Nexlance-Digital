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
    if (!workspaceId || !userId) return;

    const existingAssignments = await listCollectionDocuments('project_assignments', { pageSize: 500 }).catch(() => []);
    const matchingAssignments = existingAssignments.filter(record => (
        String(record.workspaceId || '').trim() === String(workspaceId).trim()
        && String(record.userId || '').trim() === String(userId).trim()
    ));
    const assignedProjectIdSet = new Set(access.assignedProjectIds);

    for (const assignment of matchingAssignments) {
        const projectId = String(assignment.projectId || '').trim();
        const shouldBeActive = access.allProjectsAccess || assignedProjectIdSet.has(projectId);
        if (Boolean(assignment.active) === shouldBeActive) continue;
        await patchCollectionDocument('project_assignments', assignment.id, {
            active: shouldBeActive,
            updatedAt: new Date().toISOString()
        }).catch(() => undefined);
    }

    if (access.allProjectsAccess) {
        return;
    }

    const existingProjectIdSet = new Set(
        matchingAssignments
            .map(record => String(record.projectId || '').trim())
            .filter(Boolean)
    );

    for (const projectId of access.assignedProjectIds) {
        if (existingProjectIdSet.has(projectId)) continue;
        const assignmentId = sanitizeDocumentId(`${workspaceId}_${projectId}_${userId}`);
        await upsertCollectionDocument('project_assignments', assignmentId, {
            workspaceId: String(workspaceId).trim(),
            projectId,
            userId: String(userId).trim(),
            email: AccessControl.normalizeEmail(email),
            role: AccessControl.normalizeRole(role),
            inviteType: String(inviteType || 'client').trim().toLowerCase(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
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
