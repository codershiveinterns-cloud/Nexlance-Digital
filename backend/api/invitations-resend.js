const { requireAuth, requireOwnerOnly } = require('../services/request-guards');
const { resendInvitation } = require('../services/invitations');
const { handleOptions, sendApiError, setApiCors, getRequestOrigin } = require('./_utils');

module.exports = async function handler(req, res) {
    if (handleOptions(req, res, 'POST,OPTIONS')) return;
    setApiCors(res, 'POST,OPTIONS');

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        const session = await requireAuth(req);
        requireOwnerOnly(session);
        const invitationId = String((req.query && req.query.id) || '').trim();
        if (!invitationId) {
            res.status(400).json({ error: 'Invitation ID is required.' });
            return;
        }

        const invitation = await resendInvitation({
            invitationId,
            session,
            origin: getRequestOrigin(req)
        });

        res.status(200).json({
            ok: true,
            invitation
        });
    } catch (error) {
        sendApiError(res, error, 'Invitation could not be resent.');
    }
};
