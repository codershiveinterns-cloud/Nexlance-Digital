const { requireAuth } = require('../services/request-guards');
const { handleOptions, sendApiError, setApiCors } = require('./_utils');
const { getCollectionDocument, patchCollectionDocument } = require('../services/firebase-service');

const ALLOWED_PREFERENCE_KEYS = new Set([
    'theme',
    'language',
    'quickOpen',
    'notificationsProjectUpdates',
    'notificationsBillingAlerts',
    'notificationsProductTips',
    'privacyProfileVisibility',
    'privacyUsageAnalytics',
    'privacySearchIndexing'
]);

function sanitizePreferences(input) {
    if (!input || typeof input !== 'object') return {};
    const sanitized = {};
    for (const [key, value] of Object.entries(input)) {
        if (!ALLOWED_PREFERENCE_KEYS.has(key)) continue;
        if (key === 'theme') {
            sanitized.theme = value === 'dark' ? 'dark' : 'light';
        } else if (key === 'language') {
            const lang = String(value || '').trim();
            sanitized.language = ['en-IN', 'hi-IN', 'en-US'].includes(lang) ? lang : 'en-IN';
        } else {
            sanitized[key] = Boolean(value);
        }
    }
    return sanitized;
}

module.exports = async function handler(req, res) {
    if (handleOptions(req, res, 'GET,PATCH,OPTIONS')) return;
    setApiCors(res, 'GET,PATCH,OPTIONS');

    if (req.method !== 'GET' && req.method !== 'PATCH') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        const session = await requireAuth(req);
        const uid = session.authUser.uid;

        if (req.method === 'GET') {
            const userDoc = await getCollectionDocument('users', uid);
            const preferences = (userDoc && userDoc.data && userDoc.data.dashboardPreferences) || {};
            res.status(200).json({ ok: true, preferences });
            return;
        }

        // PATCH
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
        const incoming = sanitizePreferences(body.preferences || body);

        if (!Object.keys(incoming).length) {
            res.status(400).json({ error: 'No valid preference fields provided.' });
            return;
        }

        // Merge with existing preferences
        const userDoc = await getCollectionDocument('users', uid);
        const existing = (userDoc && userDoc.data && userDoc.data.dashboardPreferences) || {};
        const merged = { ...existing, ...incoming, updatedAt: new Date().toISOString() };

        await patchCollectionDocument('users', uid, {
            dashboardPreferences: merged
        });

        res.status(200).json({ ok: true, preferences: merged });
    } catch (error) {
        const statusCode = error.statusCode || error.status || 0;
        if (statusCode === 401 || statusCode === 403) {
            sendApiError(res, error, 'Authentication is required.', statusCode);
        } else {
            console.error('[API /user-preferences] Error:', { message: error.message });
            sendApiError(res, error, 'Could not save preferences.', 500);
        }
    }
};
