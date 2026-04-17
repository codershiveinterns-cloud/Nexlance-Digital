const AccessControl = require('../../rbac.js');
const { requireAuth } = require('../services/request-guards');
const { handleOptions, sendApiError, setApiCors } = require('./_utils');
const { resolveWorkspaceFromTeamMembership } = require('../services/workspace-access');
const {
    findUserDocumentByEmail,
    getCollectionDocument,
    queryCollectionDocumentsMulti
} = require('../services/firebase-service');

async function countActiveAssignmentsInWorkspace(workspaceId, email, userId) {
    const normalizedWorkspaceId = String(workspaceId || '').trim();
    const normalizedEmail = AccessControl.normalizeEmail(email);
    const normalizedUserId = String(userId || '').trim();
    if (!normalizedWorkspaceId || (!normalizedEmail && !normalizedUserId)) return 0;

    const queries = [];
    if (normalizedEmail) {
        queries.push(queryCollectionDocumentsMulti('project_assignments', [
            { fieldPath: 'workspace_id', op: 'EQUAL', value: normalizedWorkspaceId },
            { fieldPath: 'email', op: 'EQUAL', value: normalizedEmail }
        ], 500).catch(() => []));
        queries.push(queryCollectionDocumentsMulti('project_assignments', [
            { fieldPath: 'workspace_id', op: 'EQUAL', value: normalizedWorkspaceId },
            { fieldPath: 'user_email', op: 'EQUAL', value: normalizedEmail }
        ], 500).catch(() => []));
    }
    if (normalizedUserId) {
        queries.push(queryCollectionDocumentsMulti('project_assignments', [
            { fieldPath: 'workspace_id', op: 'EQUAL', value: normalizedWorkspaceId },
            { fieldPath: 'user_id', op: 'EQUAL', value: normalizedUserId }
        ], 500).catch(() => []));
    }

    const results = await Promise.all(queries);
    const seen = new Set();
    let activeCount = 0;
    for (const batch of results) {
        for (const record of (Array.isArray(batch) ? batch : [])) {
            if (!record || !record.id || seen.has(record.id)) continue;
            seen.add(record.id);
            const data = record.data || {};
            const status = String(data.status || '').trim().toLowerCase();
            const active = data.active !== false && (!status || !['inactive', 'revoked', 'cancelled', 'deleted'].includes(status));
            if (active) activeCount += 1;
        }
    }
    return activeCount;
}

async function countProjectsInWorkspace(workspaceId) {
    const normalizedWorkspaceId = String(workspaceId || '').trim();
    if (!normalizedWorkspaceId) return 0;
    const records = await queryCollectionDocumentsMulti('projects', [
        { fieldPath: 'workspace_id', op: 'EQUAL', value: normalizedWorkspaceId }
    ], 500).catch(() => []);
    return Array.isArray(records) ? records.length : 0;
}

async function listPendingInvitationsForEmail(email) {
    const normalizedEmail = AccessControl.normalizeEmail(email);
    if (!normalizedEmail) return [];
    const records = await queryCollectionDocumentsMulti('invitations', [
        { fieldPath: 'email', op: 'EQUAL', value: normalizedEmail }
    ], 20).catch(() => []);
    return (Array.isArray(records) ? records : []).map(entry => ({
        id: entry.id,
        workspaceId: String(entry.data && entry.data.workspaceId || '').trim(),
        status: String(entry.data && entry.data.status || '').trim().toLowerCase(),
        inviteType: String(entry.data && entry.data.inviteType || '').trim().toLowerCase(),
        role: String(entry.data && entry.data.role || '').trim().toLowerCase(),
        expiresAt: entry.data && entry.data.expiresAt || '',
        usedAt: entry.data && entry.data.usedAt || ''
    }));
}

function buildRecommendation({ userWorkspaceId, authoritativeWorkspaceId, isOwner, activeAssignmentsCurrent, activeAssignmentsAuthoritative, pendingInvitations }) {
    if (isOwner) {
        return 'User is a workspace owner — alignment checks skipped.';
    }
    if (!userWorkspaceId && !authoritativeWorkspaceId) {
        const pending = pendingInvitations.find(inv => inv.status === 'pending');
        if (pending) {
            return `User has a pending invitation (${pending.id}) but has not accepted. No workspaceId on users doc yet. Ask user to open the invitation link.`;
        }
        return 'User has no workspace and no accepted membership. They may need to be invited.';
    }
    if (!userWorkspaceId && authoritativeWorkspaceId) {
        return `users.workspaceId is empty but team_members/clients has workspace ${authoritativeWorkspaceId}. Next /api/me call will self-heal via Fix 4a.`;
    }
    if (userWorkspaceId && !authoritativeWorkspaceId) {
        return `users.workspaceId = ${userWorkspaceId} but no accepted team_members/clients record exists. Fix 4a cannot align (no authoritative source). Check if the admin's record is stuck at 'pending'.`;
    }
    if (userWorkspaceId !== authoritativeWorkspaceId) {
        return `MISMATCH: users.workspaceId=${userWorkspaceId} vs authoritative=${authoritativeWorkspaceId}. Next /api/me call will self-heal via Fix 4a. Session cache will be invalidated automatically.`;
    }
    if (activeAssignmentsCurrent === 0) {
        return `Workspace is aligned (${userWorkspaceId}) but no active project_assignments exist. Dashboard will be empty — admin needs to assign projects to this user.`;
    }
    return `Healthy: workspace aligned (${userWorkspaceId}) with ${activeAssignmentsCurrent} active assignment(s). Projects should be visible.`;
}

module.exports = async function handler(req, res) {
    if (handleOptions(req, res, 'GET,OPTIONS')) return;
    setApiCors(res, 'GET,OPTIONS');

    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        const session = await requireAuth(req);
        const callerEmail = AccessControl.normalizeEmail(session.sessionUser && session.sessionUser.email);
        const callerIsOwner = session.sessionUser && session.sessionUser.isWorkspaceOwner === true;

        // Parse target from query string
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        const targetEmailRaw = String(url.searchParams.get('email') || '').trim();
        const targetUserIdRaw = String(url.searchParams.get('userId') || '').trim();
        const targetEmail = AccessControl.normalizeEmail(targetEmailRaw);

        // Authorization: caller may diagnose themselves; owners may diagnose anyone.
        const targetingSelf = Boolean(
            (targetEmail && targetEmail === callerEmail)
            || (!targetEmail && !targetUserIdRaw)
        );
        if (!targetingSelf && !callerIsOwner) {
            res.status(403).json({ error: 'Only workspace owners can diagnose other users.' });
            return;
        }

        // Resolve user document
        let userDoc = null;
        if (targetUserIdRaw) {
            userDoc = await getCollectionDocument('users', targetUserIdRaw).catch(() => null);
        }
        if (!userDoc) {
            const lookupEmail = targetEmail || callerEmail;
            if (lookupEmail) {
                userDoc = await findUserDocumentByEmail(lookupEmail).catch(() => null);
            }
        }
        if (!userDoc && !targetEmail && session.authUser) {
            userDoc = await getCollectionDocument('users', session.authUser.uid).catch(() => null);
        }

        const userProfile = userDoc && userDoc.data ? userDoc.data : {};
        const resolvedUserId = String((userDoc && userDoc.id) || (targetingSelf && session.authUser && session.authUser.uid) || '').trim();
        const resolvedEmail = AccessControl.normalizeEmail(userProfile.email || targetEmail || callerEmail);
        const userWorkspaceId = String(userProfile.workspaceId || '').trim();
        const userIsWorkspaceOwner = userProfile.isWorkspaceOwner === true
            || userProfile.workspaceOwner === true
            || userProfile.owner === true
            || String(userProfile.role || '').trim().toLowerCase() === 'owner';

        // Authoritative workspace from team_members/clients
        const authoritativeMembership = resolvedEmail
            ? await resolveWorkspaceFromTeamMembership(resolvedEmail).catch(() => null)
            : null;
        const authoritativeWorkspaceId = authoritativeMembership && authoritativeMembership.workspaceId
            ? String(authoritativeMembership.workspaceId).trim()
            : '';

        // Pending / historical invitations
        const invitations = resolvedEmail ? await listPendingInvitationsForEmail(resolvedEmail) : [];

        // Assignment + project counts under each workspace
        const [
            activeAssignmentsCurrent,
            activeAssignmentsAuthoritative,
            projectsCurrent,
            projectsAuthoritative
        ] = await Promise.all([
            countActiveAssignmentsInWorkspace(userWorkspaceId, resolvedEmail, resolvedUserId),
            authoritativeWorkspaceId && authoritativeWorkspaceId !== userWorkspaceId
                ? countActiveAssignmentsInWorkspace(authoritativeWorkspaceId, resolvedEmail, resolvedUserId)
                : Promise.resolve(0),
            countProjectsInWorkspace(userWorkspaceId),
            authoritativeWorkspaceId && authoritativeWorkspaceId !== userWorkspaceId
                ? countProjectsInWorkspace(authoritativeWorkspaceId)
                : Promise.resolve(0)
        ]);

        const workspaceMismatch = Boolean(
            userWorkspaceId
            && authoritativeWorkspaceId
            && userWorkspaceId !== authoritativeWorkspaceId
            && !userIsWorkspaceOwner
        );

        const recommendation = buildRecommendation({
            userWorkspaceId,
            authoritativeWorkspaceId,
            isOwner: userIsWorkspaceOwner,
            activeAssignmentsCurrent,
            activeAssignmentsAuthoritative,
            pendingInvitations: invitations
        });

        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json({
            ok: true,
            target: {
                userId: resolvedUserId,
                email: resolvedEmail,
                userDocumentFound: Boolean(userDoc)
            },
            user: {
                workspaceId: userWorkspaceId,
                role: userProfile.role || '',
                workspaceRole: userProfile.workspaceRole || '',
                isWorkspaceOwner: userIsWorkspaceOwner,
                membershipStatus: userProfile.membershipStatus || '',
                inviteType: userProfile.inviteType || '',
                assignedProjectIds: AccessControl.sanitizeAssignedProjectIds(userProfile.assignedProjectIds),
                allProjectsAccess: userProfile.allProjectsAccess === true
            },
            authoritative: authoritativeMembership
                ? {
                    workspaceId: authoritativeWorkspaceId,
                    role: authoritativeMembership.role,
                    inviteType: authoritativeMembership.inviteType,
                    assignedProjectIds: AccessControl.sanitizeAssignedProjectIds(authoritativeMembership.assignedProjectIds),
                    allProjectsAccess: authoritativeMembership.allProjectsAccess === true
                }
                : null,
            alignment: {
                workspaceMismatch,
                willSelfHealOnNextMeCall: workspaceMismatch,
                activeAssignmentsUnderCurrentWorkspace: activeAssignmentsCurrent,
                activeAssignmentsUnderAuthoritativeWorkspace: activeAssignmentsAuthoritative,
                projectsUnderCurrentWorkspace: projectsCurrent,
                projectsUnderAuthoritativeWorkspace: projectsAuthoritative
            },
            invitations,
            recommendation
        });
    } catch (error) {
        sendApiError(res, error, 'Diagnostic request failed.');
    }
};
