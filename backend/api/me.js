const { requireAuth } = require('../services/request-guards');
const { handleOptions, sendApiError, setApiCors } = require('./_utils');

module.exports = async function handler(req, res) {
    if (handleOptions(req, res, 'GET,OPTIONS')) return;
    setApiCors(res, 'GET,OPTIONS');

    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        const session = await requireAuth(req);
        console.info('[WorkspaceMappingTrace] Session fetched for dashboard', {
            userId: String((session && session.sessionUser && session.sessionUser.uid) || '').trim(),
            email: String((session && session.sessionUser && session.sessionUser.email) || '').trim().toLowerCase(),
            workspaceId: String((session && session.sessionUser && session.sessionUser.workspaceId) || '').trim(),
            assignedProjectIds: Array.isArray(session && session.sessionUser && session.sessionUser.assignedProjectIds)
                ? session.sessionUser.assignedProjectIds
                : []
        });
        res.status(200).json({
            ok: true,
            user: session.sessionUser
        });
    } catch (error) {
        sendApiError(res, error, 'Authentication is required.', 401);
    }
};
