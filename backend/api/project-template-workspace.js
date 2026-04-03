const { requireAuth } = require('../services/request-guards');
const { fetchTemplateWorkspace } = require('../services/template-workspace');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        const session = await requireAuth(req);
        const requestUrl = new URL(req.url, 'https://nexlance.local');
        const projectId = String(requestUrl.searchParams.get('projectId') || '').trim();
        const payload = await fetchTemplateWorkspace(session, projectId);
        res.status(200).json({ ok: true, ...payload });
    } catch (error) {
        res.status(error.statusCode || 400).json({
            error: error.message || 'Template workspace could not be loaded.',
            errorCode: String(error.code || '').trim() || undefined
        });
    }
};
