const { requireAuth } = require('../services/request-guards');
const { handleOptions, sendApiError, setApiCors } = require('./_utils');
const { resolveScopedAssignedProjectsForLogin } = require('../services/workspace-access');

module.exports = async function handler(req, res) {
    if (handleOptions(req, res, 'GET,OPTIONS')) return;
    setApiCors(res, 'GET,OPTIONS');

    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        const session = await requireAuth(req);
        const sessionUser = session.sessionUser;
        const workspaceId = String((sessionUser && sessionUser.workspaceId) || '').trim();
        const isOwner = sessionUser && sessionUser.isWorkspaceOwner === true;
        const assignedIds = Array.isArray(sessionUser && sessionUser.assignedProjectIds)
            ? sessionUser.assignedProjectIds
            : [];

        // Hard validation: non-owner users MUST have a workspaceId
        if (!isOwner && !workspaceId && sessionUser && sessionUser.inviteType) {
            console.error('[WorkspaceMappingTrace] BLOCKED: Session has no workspaceId for invited user', {
                userId: String(sessionUser.uid || '').trim(),
                email: String(sessionUser.email || '').trim().toLowerCase(),
                role: sessionUser.role,
                membershipStatus: sessionUser.membershipStatus
            });
            res.status(403).json({
                ok: false,
                error: 'Your workspace membership could not be resolved. Please contact your workspace admin or re-accept the invitation.'
            });
            return;
        }

        // If workspaceId exists but assignedProjectIds is empty for scoped roles, force re-resolve
        if (workspaceId && !assignedIds.length && !isOwner && !sessionUser.allProjectsAccess) {
            const role = String(sessionUser.role || sessionUser.workspaceRole || '').trim().toLowerCase();
            if (role === 'client' || role === 'developer' || role === 'designer') {
                console.info('[WorkspaceMappingTrace] Empty assignedProjectIds for scoped role — forcing re-resolve', {
                    userId: String(sessionUser.uid || '').trim(),
                    email: String(sessionUser.email || '').trim().toLowerCase(),
                    workspaceId,
                    role
                });
                const resolved = await resolveScopedAssignedProjectsForLogin({
                    workspaceId,
                    userId: String(sessionUser.uid || '').trim(),
                    email: String(sessionUser.email || '').trim().toLowerCase(),
                    role
                }).catch(() => ({ assignedProjectIds: [] }));
                if (resolved.assignedProjectIds && resolved.assignedProjectIds.length) {
                    sessionUser.assignedProjectIds = resolved.assignedProjectIds;
                }
            }
        }

        console.info('[WorkspaceMappingTrace] Session fetched for dashboard', {
            userId: String((sessionUser && sessionUser.uid) || '').trim(),
            email: String((sessionUser && sessionUser.email) || '').trim().toLowerCase(),
            workspaceId: String((sessionUser && sessionUser.workspaceId) || '').trim(),
            assignedProjectIds: Array.isArray(sessionUser && sessionUser.assignedProjectIds)
                ? sessionUser.assignedProjectIds
                : []
        });
        res.status(200).json({
            ok: true,
            user: sessionUser
        });
    } catch (error) {
        sendApiError(res, error, 'Authentication is required.', 401);
    }
};
