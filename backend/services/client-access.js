const AccessControl = require('../../rbac.js');
const {
    commitBatchedWrites,
    getCollectionDocument,
    patchCollectionDocument,
    queryCollectionDocumentsMulti,
    sanitizeDocumentId,
    upsertCollectionDocument
} = require('./firebase-service');
const {
    getWorkspaceMemberDocumentId,
    invalidateSessionCache,
    resolveScopedAssignedProjectsForLogin
} = require('./workspace-access');

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
    const projectWorkspaceCache = new Map();
    const resolveProjectWorkspaceId = async (projectId = '') => {
        const normalizedProjectId = String(projectId || '').trim();
        if (!normalizedProjectId) return '';
        if (projectWorkspaceCache.has(normalizedProjectId)) {
            return projectWorkspaceCache.get(normalizedProjectId);
        }
        const projectRecord = await getCollectionDocument('projects', normalizedProjectId).catch(() => null);
        const projectWorkspaceId = String(
            projectRecord
            && projectRecord.data
            && (projectRecord.data.workspace_id || projectRecord.data.workspaceId)
            || ''
        ).trim();
        projectWorkspaceCache.set(normalizedProjectId, projectWorkspaceId);
        return projectWorkspaceId;
    };

    // 1) Strict validation: validate incoming project IDs against workspace first.
    const requestedProjectIds = access && access.allProjectsAccess
        ? []
        : AccessControl.sanitizeAssignedProjectIds(access && access.assignedProjectIds);
    const validRequestedProjectIds = [];
    const invalidRequestedProjectIds = [];
    for (const projectId of requestedProjectIds) {
        const projectWorkspaceId = await resolveProjectWorkspaceId(projectId);
        if (!projectWorkspaceId || projectWorkspaceId !== normalizedWorkspaceId) {
            invalidRequestedProjectIds.push(String(projectId || '').trim());
            continue;
        }
        validRequestedProjectIds.push(String(projectId || '').trim());
    }
    const validProjectIdSet = new Set(AccessControl.sanitizeAssignedProjectIds(validRequestedProjectIds));

    // Indexed composite queries (workspace_id + email/user_id) — no full scan
    const assignmentQueries = [];
    if (normalizedEmail) {
        assignmentQueries.push(queryCollectionDocumentsMulti('project_assignments', [
            { fieldPath: 'workspace_id', op: 'EQUAL', value: normalizedWorkspaceId },
            { fieldPath: 'email', op: 'EQUAL', value: normalizedEmail }
        ], 500).catch(() => []));
        assignmentQueries.push(queryCollectionDocumentsMulti('project_assignments', [
            { fieldPath: 'workspace_id', op: 'EQUAL', value: normalizedWorkspaceId },
            { fieldPath: 'user_email', op: 'EQUAL', value: normalizedEmail }
        ], 500).catch(() => []));
    } else if (normalizedUserId) {
        assignmentQueries.push(queryCollectionDocumentsMulti('project_assignments', [
            { fieldPath: 'workspace_id', op: 'EQUAL', value: normalizedWorkspaceId },
            { fieldPath: 'user_id', op: 'EQUAL', value: normalizedUserId }
        ], 500).catch(() => []));
        assignmentQueries.push(queryCollectionDocumentsMulti('project_assignments', [
            { fieldPath: 'workspace_id', op: 'EQUAL', value: normalizedWorkspaceId },
            { fieldPath: 'userId', op: 'EQUAL', value: normalizedUserId }
        ], 500).catch(() => []));
    }
    const assignmentResults = await Promise.all(assignmentQueries);
    const seenAssignmentIds = new Set();
    const matchingAssignments = [];
    for (const batch of assignmentResults) {
        for (const record of (Array.isArray(batch) ? batch : [])) {
            if (!record || !record.id || seenAssignmentIds.has(record.id)) continue;
            seenAssignmentIds.add(record.id);
            matchingAssignments.push({
                id: record.id,
                ...(record.data || {})
            });
        }
    }

    // 2) Deactivate only invalid or out-of-scope existing assignments (batched).
    const deactivateOps = [];
    for (const assignment of matchingAssignments) {
        const assignmentProjectId = String(assignment.projectId || assignment.project_id || '').trim();
        const assignmentProjectWorkspaceId = await resolveProjectWorkspaceId(assignmentProjectId);
        const assignmentIsWorkspaceValid = Boolean(
            assignmentProjectId
            && assignmentProjectWorkspaceId
            && assignmentProjectWorkspaceId === normalizedWorkspaceId
        );
        const assignmentShouldRemainActive = access && access.allProjectsAccess
            ? false
            : (assignmentIsWorkspaceValid && validProjectIdSet.has(assignmentProjectId));
        if (assignmentShouldRemainActive) continue;
        deactivateOps.push({
            collectionId: 'project_assignments',
            docId: assignment.id,
            data: {
                status: 'inactive',
                active: false,
                mismatchReason: assignmentIsWorkspaceValid ? 'not_in_requested_scope' : 'project_workspace_mismatch',
                updatedAt: now,
                updated_at: now
            }
        });
    }
    if (deactivateOps.length) {
        await commitBatchedWrites(deactivateOps).catch(() => undefined);
    }

    if (invalidRequestedProjectIds.length) {
        console.warn('[WorkspaceConsistency] Invalid project assignments dropped before syncProjectAssignments upsert', {
            workspaceId: normalizedWorkspaceId,
            userId: normalizedUserId,
            email: normalizedEmail,
            invalidRequestedProjectIds: AccessControl.sanitizeAssignedProjectIds(invalidRequestedProjectIds)
        });
    }

    // 3) Insert/update only validated project assignments (batched).
    //    Idempotency: for each projectId we look for an existing assignment that
    //    already covers this user (by email OR userId) to avoid creating duplicates
    //    when the identity token changes from email → userId after signup.
    const existingByProject = new Map();
    for (const assignment of matchingAssignments) {
        const pid = String(assignment.projectId || assignment.project_id || '').trim();
        if (!pid) continue;
        if (!existingByProject.has(pid)) {
            existingByProject.set(pid, []);
        }
        existingByProject.get(pid).push(assignment);
    }

    // Also query by userId if we have both email and userId, because the initial
    // query above only searched by email (the `else if` branch was skipped).
    if (normalizedEmail && normalizedUserId) {
        const [byUserId, byLegacyUserId] = await Promise.all([
            queryCollectionDocumentsMulti('project_assignments', [
                { fieldPath: 'workspace_id', op: 'EQUAL', value: normalizedWorkspaceId },
                { fieldPath: 'user_id', op: 'EQUAL', value: normalizedUserId }
            ], 500).catch(() => []),
            queryCollectionDocumentsMulti('project_assignments', [
                { fieldPath: 'workspace_id', op: 'EQUAL', value: normalizedWorkspaceId },
                { fieldPath: 'userId', op: 'EQUAL', value: normalizedUserId }
            ], 500).catch(() => [])
        ]);
        for (const batch of [byUserId, byLegacyUserId]) {
            for (const record of (Array.isArray(batch) ? batch : [])) {
                if (!record || !record.id || seenAssignmentIds.has(record.id)) continue;
                seenAssignmentIds.add(record.id);
                const data = record.data || {};
                const pid = String(data.projectId || data.project_id || '').trim();
                if (!pid) continue;
                if (!existingByProject.has(pid)) {
                    existingByProject.set(pid, []);
                }
                existingByProject.get(pid).push({ id: record.id, ...data });
            }
        }
    }

    const upsertOps = [];
    const duplicateCleanupOps = [];
    for (const projectId of validProjectIdSet) {
        const existingForProject = existingByProject.get(projectId) || [];
        // Prefer the record that already has a userId, then most recent
        const sorted = existingForProject.slice().sort((a, b) => {
            const aHasUser = String(a.userId || a.user_id || '').trim() ? 1 : 0;
            const bHasUser = String(b.userId || b.user_id || '').trim() ? 1 : 0;
            if (bHasUser !== aHasUser) return bHasUser - aHasUser;
            const aTime = new Date(a.updatedAt || a.updated_at || a.createdAt || a.created_at || '').getTime() || 0;
            const bTime = new Date(b.updatedAt || b.updated_at || b.createdAt || b.created_at || '').getTime() || 0;
            return bTime - aTime;
        });
        const primary = sorted[0] || null;
        const duplicates = sorted.slice(1);

        // Deactivate duplicates for this project
        for (const dup of duplicates) {
            if (!dup.id) continue;
            duplicateCleanupOps.push({
                collectionId: 'project_assignments',
                docId: dup.id,
                data: {
                    status: 'inactive',
                    active: false,
                    mismatchReason: 'duplicate_consolidated',
                    updatedAt: now,
                    updated_at: now
                }
            });
        }

        // Stamp workspaceId from the project document itself (source of truth)
        // rather than the caller.  validProjectIdSet was built via
        // resolveProjectWorkspaceId, so the cache already holds it.
        const projectWorkspaceId = projectWorkspaceCache.get(projectId) || normalizedWorkspaceId;
        // Always persist BOTH userId and email when either is known.  Merge
        // with any identifier already on the primary record so single-identifier
        // assignments (email-only invite, uid-only bootstrap) self-heal into
        // dual-identifier records the next time this sync runs.
        const resolvedUserId = normalizedUserId || (primary ? String(primary.userId || primary.user_id || '').trim() : '');
        const resolvedEmail = normalizedEmail || (primary ? AccessControl.normalizeEmail(primary.email || primary.user_email) : '');
        const docId = primary ? primary.id : `${projectWorkspaceId}_${projectId}_${identityToken}`;
        upsertOps.push({
            collectionId: 'project_assignments',
            docId,
            data: {
                workspaceId: projectWorkspaceId,
                workspace_id: projectWorkspaceId,
                projectId,
                project_id: projectId,
                userId: resolvedUserId,
                user_id: resolvedUserId,
                email: resolvedEmail,
                user_email: resolvedEmail,
                role: normalizedRole,
                inviteType: String(inviteType || 'client').trim().toLowerCase(),
                status: 'active',
                createdAt: primary ? (primary.createdAt || primary.created_at || now) : now,
                created_at: primary ? (primary.created_at || primary.createdAt || now) : now,
                updatedAt: now,
                updated_at: now,
                active: true
            }
        });
    }
    if (duplicateCleanupOps.length) {
        await commitBatchedWrites(duplicateCleanupOps).catch(() => undefined);
    }
    if (upsertOps.length) {
        await commitBatchedWrites(upsertOps).catch(() => undefined);
    }

    // 4) Workspace alignment for non-owner users.
    //    When a user is assigned projects in a workspace, their users/{uid} doc
    //    must point at that same workspace.  If an older profile still points at
    //    a different (auto-generated) workspace, auto-correct it here so that
    //    session rehydration and dashboard APIs see a consistent scope.
    //    Workspace owners are exempt — we never flip an owner out of their own
    //    workspace based on a project assignment.
    if (normalizedUserId) {
        try {
            const existingUserDoc = await getCollectionDocument('users', normalizedUserId);
            const existingUserProfile = existingUserDoc && existingUserDoc.data ? existingUserDoc.data : null;
            if (existingUserProfile) {
                const currentWorkspaceId = String(existingUserProfile.workspaceId || '').trim();
                const existingRoleLower = String(existingUserProfile.role || '').trim().toLowerCase();
                const isOwner = existingUserProfile.isWorkspaceOwner === true
                    || existingUserProfile.workspaceOwner === true
                    || existingUserProfile.owner === true
                    || existingRoleLower === 'owner';
                if (!isOwner && currentWorkspaceId && currentWorkspaceId !== normalizedWorkspaceId) {
                    console.warn('[WorkspaceConsistency] Auto-correcting user workspaceId to match project workspace', {
                        userId: normalizedUserId,
                        email: normalizedEmail,
                        previousWorkspaceId: currentWorkspaceId,
                        nextWorkspaceId: normalizedWorkspaceId,
                        role: normalizedRole
                    });
                    await patchCollectionDocument('users', normalizedUserId, {
                        workspaceId: normalizedWorkspaceId,
                        updatedAt: now
                    }).catch(() => undefined);
                    invalidateSessionCache(normalizedUserId);
                }
            }
        } catch (alignmentError) {
            console.warn('[WorkspaceConsistency] Workspace alignment check failed', {
                userId: normalizedUserId,
                workspaceId: normalizedWorkspaceId,
                error: alignmentError && alignmentError.message
            });
        }
    }

    // 5) Canonical post-sync resolution for consistent assignment scope.
    await resolveScopedAssignedProjectsForLogin({
        workspaceId: normalizedWorkspaceId,
        userId: normalizedUserId,
        email: normalizedEmail,
        role: normalizedRole
    }).catch(() => undefined);
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

    // Only require workspaceId and email — userId may not exist yet if the user
    // hasn't accepted the invite.  Project assignments must be created at admin
    // action time so they are ready when the user eventually logs in.
    if (!workspaceId || !email) {
        return {
            id: clientRecord.id,
            data: {
                ...clientRecord.data,
                ...clientAccessFields
            }
        };
    }

    // User profile and session cache updates only possible when userId is known
    if (userId) {
        const userProfile = await getCollectionDocument('users', userId).catch(() => null);
        if (userProfile && userProfile.data) {
            await patchCollectionDocument('users', userId, {
                ...profileAccessFields,
                updatedAt: new Date().toISOString()
            }).catch(() => undefined);
            // Invalidate cached session — project access/permissions just changed
            invalidateSessionCache(userId);
        }
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
