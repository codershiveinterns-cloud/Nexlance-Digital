const { requireAuth } = require('../services/request-guards');
const { handleOptions, normalizeBody, sendApiError, setApiCors } = require('./_utils');
const {
    ensureMembershipForProfile,
    listMembershipsForUser,
    setActiveWorkspaceForUser
} = require('../services/memberships');
const { invalidateSessionCache } = require('../services/workspace-access');

module.exports = async function handler(req, res) {
    if (handleOptions(req, res, 'GET,POST,OPTIONS')) return;
    setApiCors(res, 'GET,POST,OPTIONS');

    try {
        const session = await requireAuth(req);
        const sessionUser = session.sessionUser || {};
        const userId = String(sessionUser.uid || '').trim();
        const email = String(sessionUser.email || '').trim().toLowerCase();

        if (req.method === 'GET') {
            // Transparent backfill for legacy single-workspace users
            await ensureMembershipForProfile(sessionUser, session.authUser).catch(() => null);

            const memberships = await listMembershipsForUser({ userId, email });
            res.setHeader('Cache-Control', 'private, max-age=15');
            res.status(200).json({
                ok: true,
                activeWorkspaceId: String(sessionUser.workspaceId || '').trim(),
                memberships
            });
            return;
        }

        if (req.method === 'POST') {
            const body = normalizeBody(req.body);
            const targetWorkspaceId = String(body.workspaceId || '').trim();
            if (!targetWorkspaceId) {
                res.status(400).json({ error: 'workspaceId is required.' });
                return;
            }
            const updated = await setActiveWorkspaceForUser(userId, targetWorkspaceId);
            invalidateSessionCache(userId);
            res.status(200).json({ ok: true, activeWorkspaceId: targetWorkspaceId, membership: updated });
            return;
        }

        res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        sendApiError(res, error, 'Could not load workspaces.', error.statusCode || 500);
    }
};
