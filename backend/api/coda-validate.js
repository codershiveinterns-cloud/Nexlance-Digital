const { buildCodaJsonRpcError, handleCodaValidate } = require('../services/coda');

function readRawBody(req) {
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', chunk => {
            raw += chunk;
            if (raw.length > 1e6) reject(new Error('Request body too large.'));
        });
        req.on('end', () => resolve(raw));
        req.on('error', reject);
    });
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-coda-signature,x-codapay-signature,coda-signature,signature,authorization,x-coda-timestamp,x-codapay-timestamp,coda-timestamp,timestamp');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');

    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json(buildCodaJsonRpcError(null, -32600, 'Method not allowed.'));
        return;
    }

    try {
        const rawBody = await readRawBody(req);
        const payload = await handleCodaValidate({ rawBody, headers: req.headers });
        res.status(200).json(payload);
    } catch (error) {
        res.status(200).json(buildCodaJsonRpcError(null, -32000, error.message || 'Coda validate failed.'));
    }
};
