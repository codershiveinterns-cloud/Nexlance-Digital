const { requireAuth } = require('../services/request-guards');
const { completeTemplateWorkspace } = require('../services/template-workspace');

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');

    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        const session = await requireAuth(req);
        const payload = await completeTemplateWorkspace(session, req.body || {});
        res.status(200).json({ ok: true, ...payload });
    } catch (error) {
        res.status(error.statusCode || 400).json({ error: error.message || 'Template project could not be completed.' });
    }
};
