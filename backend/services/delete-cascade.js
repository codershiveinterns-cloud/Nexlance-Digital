/**
 * Cascade cleanup on DELETE for dashboard collections.
 *
 * Goal: when a team_member, project, or client is hard-deleted from Firestore,
 * strip stale access/assignment state from related documents so the deleted
 * entity stops appearing in any user's view.  Scope is limited to the owning
 * workspace to avoid cross-workspace side effects.
 *
 * Explicitly does NOT touch: invitations (mail-invitation system),
 * workspace ownership, payments.  Those systems own their own lifecycles.
 */
const admin = require('./firebase-admin-init');
const AccessControl = require('../../rbac.js');
const { normalizeEmail } = require('./dashboard-rbac');

const db = admin.firestore();
const FieldValue = admin.firestore.FieldValue;

const CASCADE_BATCH_LIMIT = 400; // stay below Firestore's 500/batch cap

async function _queryWorkspaceDocs(collectionId, workspaceId, extraFilters = []) {
    const ws = String(workspaceId || '').trim();
    if (!ws) return [];
    let ref = db.collection(collectionId).where('workspace_id', '==', ws);
    for (const filter of extraFilters) {
        if (!filter || !filter.field) continue;
        ref = ref.where(filter.field, filter.op || '==', filter.value);
    }
    const snap = await ref.get().catch(() => null);
    if (!snap || snap.empty) return [];
    return snap.docs;
}

async function _queryWorkspaceIdDocs(collectionId, workspaceId, extraFilters = []) {
    // Some docs use workspaceId (camelCase) rather than workspace_id.
    const ws = String(workspaceId || '').trim();
    if (!ws) return [];
    let ref = db.collection(collectionId).where('workspaceId', '==', ws);
    for (const filter of extraFilters) {
        if (!filter || !filter.field) continue;
        ref = ref.where(filter.field, filter.op || '==', filter.value);
    }
    const snap = await ref.get().catch(() => null);
    if (!snap || snap.empty) return [];
    return snap.docs;
}

async function _commitInChunks(docs, apply) {
    if (!Array.isArray(docs) || !docs.length) return 0;
    let committed = 0;
    for (let i = 0; i < docs.length; i += CASCADE_BATCH_LIMIT) {
        const chunk = docs.slice(i, i + CASCADE_BATCH_LIMIT);
        const batch = db.batch();
        for (const doc of chunk) apply(batch, doc);
        await batch.commit().catch(error => {
            console.warn('[DeleteCascade] batch commit failed', { error: error && error.message });
        });
        committed += chunk.length;
    }
    return committed;
}

function _extractUserIdentity(record = {}) {
    const data = record && record.data ? record.data : record || {};
    const userId = String(data.invited_user_id || data.invitedUserId || data.userId || data.user_id || '').trim();
    const email = normalizeEmail(data.email || data.invited_email || data.invitedEmail || '');
    return { userId, email };
}

/**
 * Cascade for team_member delete.
 * Scope: the member's workspace only.
 */
async function cascadeTeamMemberDeletion({ workspaceId, deletedRecord }) {
    const ws = String(workspaceId || '').trim();
    if (!ws) return { summary: 'no-workspace' };

    const { userId, email } = _extractUserIdentity(deletedRecord);
    if (!userId && !email) return { summary: 'no-identity' };

    const summary = { workspace_members: 0, project_assignments: 0 };

    // 1) Remove workspace_members entries for this user in this workspace.
    const memberQueries = [];
    if (userId) {
        memberQueries.push(_queryWorkspaceIdDocs('workspace_members', ws, [
            { field: 'userId', op: '==', value: userId }
        ]));
    }
    if (email) {
        memberQueries.push(_queryWorkspaceIdDocs('workspace_members', ws, [
            { field: 'email', op: '==', value: email }
        ]));
    }
    const memberResults = await Promise.all(memberQueries);
    const seenMemberIds = new Set();
    const memberDocs = [];
    memberResults.flat().forEach(doc => {
        if (seenMemberIds.has(doc.id)) return;
        seenMemberIds.add(doc.id);
        memberDocs.push(doc);
    });
    summary.workspace_members = await _commitInChunks(memberDocs, (batch, doc) => batch.delete(doc.ref));

    // 2) Deactivate project_assignments for this user in this workspace.
    const assignmentQueries = [];
    if (userId) {
        assignmentQueries.push(_queryWorkspaceDocs('project_assignments', ws, [
            { field: 'user_id', op: '==', value: userId }
        ]));
    }
    if (email) {
        assignmentQueries.push(_queryWorkspaceDocs('project_assignments', ws, [
            { field: 'email', op: '==', value: email }
        ]));
    }
    const assignmentResults = await Promise.all(assignmentQueries);
    const seenAssignmentIds = new Set();
    const assignmentDocs = [];
    assignmentResults.flat().forEach(doc => {
        if (seenAssignmentIds.has(doc.id)) return;
        seenAssignmentIds.add(doc.id);
        assignmentDocs.push(doc);
    });
    summary.project_assignments = await _commitInChunks(assignmentDocs, (batch, doc) => batch.delete(doc.ref));

    console.info('[DeleteCascade] team_member cleanup', { workspaceId: ws, userId, email, summary });
    return { summary };
}

/**
 * Cascade for client delete.
 * Removes client_profiles, workspace_members (for the client), project_assignments.
 */
async function cascadeClientDeletion({ workspaceId, deletedRecord }) {
    const ws = String(workspaceId || '').trim();
    if (!ws) return { summary: 'no-workspace' };

    const { userId, email } = _extractUserIdentity(deletedRecord);
    const summary = { client_profiles: 0, workspace_members: 0, project_assignments: 0 };

    if (email) {
        // 1) client_profiles by workspace + email (primary key is workspaceId_email)
        const clientProfiles = await _queryWorkspaceIdDocs('client_profiles', ws, [
            { field: 'email', op: '==', value: email }
        ]);
        summary.client_profiles = await _commitInChunks(clientProfiles, (batch, doc) => batch.delete(doc.ref));
    }

    // 2) workspace_members (matches by userId or email)
    const memberQueries = [];
    if (userId) {
        memberQueries.push(_queryWorkspaceIdDocs('workspace_members', ws, [
            { field: 'userId', op: '==', value: userId }
        ]));
    }
    if (email) {
        memberQueries.push(_queryWorkspaceIdDocs('workspace_members', ws, [
            { field: 'email', op: '==', value: email }
        ]));
    }
    const memberResults = await Promise.all(memberQueries);
    const seenMemberIds = new Set();
    const memberDocs = [];
    memberResults.flat().forEach(doc => {
        if (seenMemberIds.has(doc.id)) return;
        seenMemberIds.add(doc.id);
        memberDocs.push(doc);
    });
    summary.workspace_members = await _commitInChunks(memberDocs, (batch, doc) => batch.delete(doc.ref));

    // 3) project_assignments for this user/email
    const assignmentQueries = [];
    if (userId) {
        assignmentQueries.push(_queryWorkspaceDocs('project_assignments', ws, [
            { field: 'user_id', op: '==', value: userId }
        ]));
    }
    if (email) {
        assignmentQueries.push(_queryWorkspaceDocs('project_assignments', ws, [
            { field: 'email', op: '==', value: email }
        ]));
    }
    const assignmentResults = await Promise.all(assignmentQueries);
    const seenAssignmentIds = new Set();
    const assignmentDocs = [];
    assignmentResults.flat().forEach(doc => {
        if (seenAssignmentIds.has(doc.id)) return;
        seenAssignmentIds.add(doc.id);
        assignmentDocs.push(doc);
    });
    summary.project_assignments = await _commitInChunks(assignmentDocs, (batch, doc) => batch.delete(doc.ref));

    console.info('[DeleteCascade] client cleanup', { workspaceId: ws, userId, email, summary });
    return { summary };
}

/**
 * Cascade for project delete.
 * Removes project_assignments for the project, prunes the project id from
 * assigned_project_ids arrays on team_members and clients, and deletes tasks
 * tied to the project.
 */
async function cascadeProjectDeletion({ workspaceId, deletedProjectId }) {
    const ws = String(workspaceId || '').trim();
    const projectId = String(deletedProjectId || '').trim();
    if (!ws || !projectId) return { summary: 'no-scope', affectedUserIds: [] };

    const summary = { project_assignments: 0, team_member_arrays: 0, client_arrays: 0, tasks: 0 };

    // 1) Delete project_assignments rows for this project in this workspace.
    const assignments = await _queryWorkspaceDocs('project_assignments', ws, [
        { field: 'project_id', op: '==', value: projectId }
    ]);
    // Collect user ids before deletion so the caller can invalidate each
    // user's cached session scope — otherwise they'd keep the deleted
    // project in their assignedProjectIds until the 5-minute TTL expires.
    const affectedUserIds = Array.from(new Set(
        assignments
            .map(doc => {
                const data = doc.data() || {};
                return String(data.user_id || data.userId || '').trim();
            })
            .filter(Boolean)
    ));
    summary.project_assignments = await _commitInChunks(assignments, (batch, doc) => batch.delete(doc.ref));

    // 2) Prune project id from any assigned_project_ids arrays on team_members.
    const teamMembers = await _queryWorkspaceDocs('team_members', ws, [
        { field: 'assigned_project_ids', op: 'array-contains', value: projectId }
    ]);
    summary.team_member_arrays = await _commitInChunks(teamMembers, (batch, doc) => {
        batch.update(doc.ref, { assigned_project_ids: FieldValue.arrayRemove(projectId) });
    });

    // 3) Same for clients.
    const clients = await _queryWorkspaceDocs('clients', ws, [
        { field: 'assigned_project_ids', op: 'array-contains', value: projectId }
    ]);
    summary.client_arrays = await _commitInChunks(clients, (batch, doc) => {
        batch.update(doc.ref, { assigned_project_ids: FieldValue.arrayRemove(projectId) });
    });

    // 4) Delete tasks belonging to the project.
    const tasks = await _queryWorkspaceDocs('tasks', ws, [
        { field: 'project_id', op: '==', value: projectId }
    ]);
    summary.tasks = await _commitInChunks(tasks, (batch, doc) => batch.delete(doc.ref));

    console.info('[DeleteCascade] project cleanup', { workspaceId: ws, projectId, summary, affectedUserIds });
    return { summary, affectedUserIds };
}

async function cascadeDashboardDeletion({ collectionId, workspaceId, deletedRecord, deletedDocumentId }) {
    try {
        if (collectionId === 'team_members') {
            return await cascadeTeamMemberDeletion({ workspaceId, deletedRecord });
        }
        if (collectionId === 'clients') {
            return await cascadeClientDeletion({ workspaceId, deletedRecord });
        }
        if (collectionId === 'projects') {
            return await cascadeProjectDeletion({ workspaceId, deletedProjectId: deletedDocumentId });
        }
        // invoices / services / tasks: no cascade required
        return { summary: 'no-op' };
    } catch (error) {
        // Cascade failures must never break the primary delete response; log
        // so ops can clean up stragglers offline.
        console.error('[DeleteCascade] cleanup failed', {
            collectionId,
            workspaceId,
            deletedDocumentId,
            error: error && error.message
        });
        return { summary: 'error', error: String(error && error.message || 'unknown') };
    }
}

module.exports = {
    cascadeDashboardDeletion,
    cascadeTeamMemberDeletion,
    cascadeClientDeletion,
    cascadeProjectDeletion
};
