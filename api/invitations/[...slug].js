const resolveInvitationHandler = require('../../backend/api/invitations-resolve');
const acceptInvitationHandler = require('../../backend/api/invitations-accept');
const createClientInvitationHandler = require('../../backend/api/invitations-client');
const createTeamInvitationHandler = require('../../backend/api/invitations-team');
const resendInvitationHandler = require('../../backend/api/invitations-resend');

function getSlugParts(req) {
    const source = req && req.query ? req.query.slug : [];
    return (Array.isArray(source) ? source : [source])
        .map(entry => String(entry || '').trim())
        .filter(Boolean);
}

module.exports = async function handler(req, res) {
    const slugParts = getSlugParts(req);

    if (slugParts.length === 1) {
        const [segment] = slugParts;

        if (segment === 'resolve') {
            return resolveInvitationHandler(req, res);
        }

        if (segment === 'accept') {
            return acceptInvitationHandler(req, res);
        }

        if (segment === 'client') {
            return createClientInvitationHandler(req, res);
        }

        if (segment === 'team') {
            return createTeamInvitationHandler(req, res);
        }
    }

    if (slugParts.length === 2 && slugParts[1] === 'resend') {
        req.query = {
            ...(req.query || {}),
            id: slugParts[0]
        };
        return resendInvitationHandler(req, res);
    }

    res.status(404).json({ error: 'Invitation route not found.' });
};
