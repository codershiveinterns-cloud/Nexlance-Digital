const { createHostedCheckout } = require('../services/payments');

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

function getRequestHeader(req, headerName) {
    const headers = req && req.headers ? req.headers : {};
    const direct = headers[headerName];
    const lower = headers[String(headerName).toLowerCase()];
    const upper = headers[String(headerName).toUpperCase()];
    const value = direct !== undefined ? direct : lower !== undefined ? lower : upper;
    if (Array.isArray(value) && value.length) return String(value[0] || '').trim();
    return value !== undefined && value !== null ? String(value).trim() : '';
}

function getRequestCountry(req) {
    return getRequestHeader(req, 'x-vercel-ip-country')
        || getRequestHeader(req, 'cf-ipcountry')
        || getRequestHeader(req, 'x-country-code')
        || getRequestHeader(req, 'x-client-country');
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
        const payload = await createHostedCheckout({
            ...body,
            country: body.country || body.codaCountry || getRequestCountry(req)
        });
        res.status(200).json(payload);
    } catch (error) {
        if (error && error.publicPayload) {
            res.status(400).json(error.publicPayload);
            return;
        }
        res.status(400).json({ error: error.message || 'Checkout could not be started.' });
    }
};
