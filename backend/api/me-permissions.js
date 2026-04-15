const AccessControl = require('../../rbac.js');
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
        res.setHeader('Cache-Control', 'private, max-age=30');
        res.status(200).json({
            ok: true,
            role: session.sessionUser.role,
            isWorkspaceOwner: session.sessionUser.isWorkspaceOwner,
            permissionKeys: session.sessionUser.permissionKeys,
            permissions: session.sessionUser.permissions,
            allowedPages: AccessControl.getAllowedPages(session.sessionUser)
        });
    } catch (error) {
        sendApiError(res, error, 'Authentication is required.', 401);
    }
};

