const { resolveInvitationByToken, assertInvitationUsable } = require('../services/invitations');
const { handleOptions, sendApiError, setApiCors } = require('./_utils');

module.exports = async function handler(req, res) {
    if (handleOptions(req, res, 'GET,OPTIONS')) return;
    setApiCors(res, 'GET,OPTIONS');

    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        const token = String((req.query && req.query.token) || '').trim();
        if (!token) {
            res.status(400).json({ error: 'Invitation token is required.' });
            return;
        }

        const invitation = await resolveInvitationByToken(token);
        const record = assertInvitationUsable(invitation);
        res.status(200).json({
            ok: true,
            invitation: {
                id: invitation.id,
                inviteType: record.inviteType,
                inviteeName: record.inviteeName,
                email: record.email,
                role: record.role,
                workspaceId: record.workspaceId,
                expiresAt: record.expiresAt,
                status: record.status,
                assignedProjectIds: record.assignedProjectIds || []
            }
        });
    } catch (error) {
        sendApiError(res, error, 'Invitation is invalid or has expired.');
    }
};
