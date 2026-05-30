function setApiCors(res, methods = 'GET,POST,OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', methods);
}

function ensureJsonResponseHelpers(res) {
    if (typeof res.status !== 'function') {
        res.status = function status(statusCode) {
            this.statusCode = statusCode;
            return this;
        };
    }

    if (typeof res.json !== 'function') {
        res.json = function json(payload) {
            const statusCode = this.statusCode || 200;
            this.writeHead(statusCode, {
                'Content-Type': 'application/json; charset=utf-8'
            });
            this.end(JSON.stringify(payload));
            return this;
        };
    }

    return res;
}

function handleOptions(req, res, methods) {
    setApiCors(res, methods);
    if (req.method === 'OPTIONS') {
        ensureJsonResponseHelpers(res).status(204).end();
        return true;
    }
    return false;
}

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

function getRequestOrigin(req) {
    if (req.headers.origin) return req.headers.origin;

    const forwardedProtoHeader = Array.isArray(req.headers['x-forwarded-proto'])
        ? req.headers['x-forwarded-proto'][0]
        : req.headers['x-forwarded-proto'];
    const forwardedHostHeader = Array.isArray(req.headers['x-forwarded-host'])
        ? req.headers['x-forwarded-host'][0]
        : req.headers['x-forwarded-host'];
    const protocol = String(
        forwardedProtoHeader
        || (req.socket && req.socket.encrypted ? 'https' : 'http')
    ).split(',')[0].trim() || 'http';
    const host = String(forwardedHostHeader || req.headers.host || 'localhost:4242').split(',')[0].trim();

    return `${protocol}://${host}`;
}

function sendApiError(res, error, fallbackMessage, fallbackStatusCode = 400) {
    const payload = { error: error.message || fallbackMessage };
    if (error && error.code) payload.code = error.code;
    if (error && Array.isArray(error.missingFields) && error.missingFields.length) {
        payload.missingFields = error.missingFields;
    }
    ensureJsonResponseHelpers(res)
        .status(error.statusCode || error.status || fallbackStatusCode)
        .json(payload);
}

module.exports = {
    getRequestOrigin,
    handleOptions,
    normalizeBody,
    sendApiError,
    setApiCors
};
