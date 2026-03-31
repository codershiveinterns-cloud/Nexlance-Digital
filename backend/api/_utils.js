function setApiCors(res, methods = 'GET,POST,OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', methods);
}

function handleOptions(req, res, methods) {
    setApiCors(res, methods);
    if (req.method === 'OPTIONS') {
        res.status(204).end();
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
    return req.headers.origin || `https://${req.headers.host}`;
}

function sendApiError(res, error, fallbackMessage, fallbackStatusCode = 400) {
    res.status(error.statusCode || error.status || fallbackStatusCode).json({
        error: error.message || fallbackMessage
    });
}

module.exports = {
    getRequestOrigin,
    handleOptions,
    normalizeBody,
    sendApiError,
    setApiCors
};
