const { buildTemplateZipBundle, renderDownloadErrorPage, verifyDownloadToken } = require('../services/template-access');

function readQuery(req) {
    if (req && req.query && typeof req.query === 'object') {
        return req.query;
    }

    const host = req && req.headers && req.headers.host ? req.headers.host : 'localhost';
    const url = new URL(req.url || '/', `http://${host}`);
    return Object.fromEntries(url.searchParams.entries());
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');

    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    if (req.method !== 'GET') {
        res.status(405).end('Method not allowed');
        return;
    }

    try {
        const query = readQuery(req);
        const token = String(query.token || '').trim();
        const payload = verifyDownloadToken(token);
        const proto = String((req.headers['x-forwarded-proto'] || '').split(',')[0] || 'https').trim();
        const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').trim();
        const origin = host ? `${proto}://${host}` : '';
        const bundle = await buildTemplateZipBundle(payload.templateId, payload.email, { origin });

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${bundle.fileName}"`);
        res.status(200).end(bundle.buffer);
    } catch (error) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.status(403).end(renderDownloadErrorPage(error.message || 'Template download could not be authorized.'));
    }
};
