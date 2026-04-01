const resolveInvitationHandler = require('../../backend/api/invitations-resolve');
const acceptInvitationHandler = require('../../backend/api/invitations-accept');
const createClientInvitationHandler = require('../../backend/api/invitations-client');
const createTeamInvitationHandler = require('../../backend/api/invitations-team');
const resendInvitationHandler = require('../../backend/api/invitations-resend');

function getRequestPathname(req) {
    const directRequestUrl = String((req && req.url) || '').trim();
    const matchedPathHeader = req && req.headers
        ? (req.headers['x-matched-path'] || req.headers['x-invoke-path'])
        : '';
    const requestUrl = directRequestUrl || String(matchedPathHeader || '').trim();

    if (!requestUrl) {
        return '';
    }

    try {
        return new URL(requestUrl, 'https://nexlance.local').pathname;
    } catch (error) {
        return requestUrl.split('?')[0].trim();
    }
}

function getSlugParts(req) {
    const source = req && req.query ? req.query.slug : [];
    const slugFromQuery = (Array.isArray(source) ? source : [source])
        .map(entry => String(entry || '').trim())
        .filter(Boolean);

    if (slugFromQuery.length) {
        return slugFromQuery;
    }

    const pathname = getRequestPathname(req);
    const routePrefix = '/api/invitations/';
    if (!pathname.startsWith(routePrefix)) {
        return [];
    }

    return pathname
        .slice(routePrefix.length)
        .split('/')
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
