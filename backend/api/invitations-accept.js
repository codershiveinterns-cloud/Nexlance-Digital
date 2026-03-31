const { requireAuth } = require('../services/request-guards');
const { acceptInvitation } = require('../services/invitations');
const { handleOptions, normalizeBody, sendApiError, setApiCors } = require('./_utils');

module.exports = async function handler(req, res) {
    if (handleOptions(req, res, 'POST,OPTIONS')) return;
    setApiCors(res, 'POST,OPTIONS');

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        const session = await requireAuth(req);
        const body = normalizeBody(req.body);
        const token = String(body.token || '').trim();
        if (!token) {
            res.status(400).json({ error: 'Invitation token is required.' });
            return;
        }

        const result = await acceptInvitation({ session, token });
        res.status(200).json({
            ok: true,
            ...result
        });
    } catch (error) {
        sendApiError(res, error, 'Invitation could not be accepted.');
    }
};
