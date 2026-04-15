const { requireAuth, requireInitializedUser, requireOwnerOnly } = require('../services/request-guards');
const { queryCollectionDocuments } = require('../services/firebase-service');
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
        requireInitializedUser(session);
        requireOwnerOnly(session);
        const invites = await queryCollectionDocuments('invitations', {
            fieldPath: 'workspaceId',
            op: 'EQUAL',
            value: String(session.sessionUser.workspaceId || '').trim(),
            limit: 500
        }).catch(() => []);

        res.status(200).json({
            ok: true,
            records: (Array.isArray(invites) ? invites : []).map(record => ({
                id: record.id,
                ...(record.data || {})
            }))
        });
    } catch (error) {
        sendApiError(res, error, 'Invitations could not be loaded.');
    }
};
