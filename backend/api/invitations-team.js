const { requireAuth, requireOwnerOnly } = require('../services/request-guards');
const { createInvitation } = require('../services/invitations');
const {
    handleOptions,
    normalizeBody,
    sendApiError,
    setApiCors,
    getRequestOrigin
} = require('./_utils');

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
        const body = normalizeBody(req.body);
        const result = await createInvitation({
            session,
            inviteType: 'team',
            inviteeName: String(body.name || body.memberName || '').trim(),
            email: String(body.email || body.memberEmail || '').trim(),
            role: String(body.role || '').trim(),
            assignedProjectIds: Array.isArray(body.assignedProjectIds) ? body.assignedProjectIds : [],
            origin: getRequestOrigin(req),
            metadata: body.metadata || {}
        });

        res.status(200).json({
            ok: true,
            invitation: result.invitation,
            record: result.targetRecord
        });
    } catch (error) {
        sendApiError(res, error, 'Team invitation could not be sent.');
    }
};
