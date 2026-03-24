const { completeTemplateAccess } = require('../services/template-access');

function normalizeBody(body) {
    if (!body) return {};
    if (typeof body === 'string') {
        try {
            return JSON.parse(body);
        } catch (error) {
            throw new Error('Invalid JSON body.');
        }
    }
    return body;
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
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
        const body = normalizeBody(req.body);
        const payload = await completeTemplateAccess(body);
        res.status(200).json(payload);
    } catch (error) {
        res.status(400).json({ error: error.message || 'Template checkout could not be verified.' });
    }
};
