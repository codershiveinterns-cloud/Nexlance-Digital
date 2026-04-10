const { requireAuth } = require('../services/request-guards');
const { handleOptions, sendApiError, setApiCors } = require('./_utils');
const { resolveScopedAssignedProjectsForLogin } = require('../services/workspace-access');

module.exports = async function handler(req, res) {
    if (handleOptions(req, res, 'POST,OPTIONS')) return;
    setApiCors(res, 'POST,OPTIONS');

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        const session = await requireAuth(req);
        const { sessionUser } = session;
        
        console.info('[SyncProjectAssignments] Starting force sync', {
            userId: sessionUser.uid,
            email: sessionUser.email,
            workspaceId: sessionUser.workspaceId
        });

        const scope = await resolveScopedAssignedProjectsForLogin({
            workspaceId: sessionUser.workspaceId,
            userId: sessionUser.uid,
            email: sessionUser.email,
            role: sessionUser.role
        });

        console.info('[SyncProjectAssignments] Force sync complete', {
            userId: sessionUser.uid,
            workspaceId: sessionUser.workspaceId,
            assignedProjectIds: scope.assignedProjectIds,
            count: scope.assignedProjectIds ? scope.assignedProjectIds.length : 0
        });

        res.status(200).json({
            ok: true,
            assignedProjectIds: scope.assignedProjectIds || []
        });
    } catch (error) {
        console.error('[SyncProjectAssignments] Error', { error: error.message });
        sendApiError(res, error, 'Project assignment sync failed.', 500);
    }
};