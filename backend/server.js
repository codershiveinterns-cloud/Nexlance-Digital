const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(PROJECT_ROOT, '.env');

function loadEnvFile(envPath = ENV_PATH) {
    if (!fs.existsSync(envPath)) return;

    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;

        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex === -1) return;

        const key = trimmed.slice(0, separatorIndex).trim();
        let value = trimmed.slice(separatorIndex + 1).trim();

        if (!key || process.env[key] !== undefined) return;

        if (
            (value.startsWith('"') && value.endsWith('"'))
            || (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        process.env[key] = value;
    });
}

loadEnvFile();

const { getPaymentConfig, createStripePaymentIntent } = require('./services/payments');
const checkoutCompleteHandler = require('./api/checkout-complete');
const checkoutStartHandler = require('./api/checkout-start');
const confirmBusinessUpgradeHandler = require('./api/confirm-business-upgrade');
const polarWebhookHandler = require('./api/polar-webhook');
const stripeWebhookHandler = require('./api/stripe-webhook');
const templateAccessCompleteHandler = require('./api/template-access-complete');
const templateAccessStartHandler = require('./api/template-access-start');
const templateDownloadHandler = require('./api/template-download');
const {
    buildLogoutCookie,
    buildSessionCookie,
    createAdminSession,
    getAdminSessionFromRequest,
    verifyAdminCredentials
} = require('./services/admin-auth');
const { getAdminAnalytics } = require('./services/admin-analytics');

const PORT = Number(process.env.PORT || 4242);
const MAX_PORT_ATTEMPTS = 10;
const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_MAX_LOGIN_ATTEMPTS = 5;
const adminLoginAttempts = new Map();

const PUBLIC_MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp4': 'video/mp4'
};

const BLOCKED_STATIC_ROOTS = new Set([
    'api',
    'backend',
    'node_modules',
    '.git',
    '.claude',
    '.vscode'
]);

const BLOCKED_STATIC_FILES = new Set([
    '.env',
    '.env.example',
    'package.json',
    'package-lock.json',
    'server.js'
]);

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8'
    });
    res.end(JSON.stringify(payload));
}

function sendRedirect(res, location) {
    res.writeHead(302, { Location: location });
    res.end();
}

function augmentResponse(res) {
    if (typeof res.status === 'function' && typeof res.json === 'function') {
        return res;
    }

    res.status = function status(statusCode) {
        this.statusCode = statusCode;
        return this;
    };

    res.json = function json(payload) {
        sendJson(this, this.statusCode || 200, payload);
    };

    return res;
}

function isBlockedStaticRequest(reqPath) {
    const pathParts = String(reqPath || '')
        .split('/')
        .filter(Boolean);

    if (pathParts.some(part => part.startsWith('.'))) {
        return true;
    }

    if (pathParts.length && BLOCKED_STATIC_ROOTS.has(pathParts[0])) {
        return true;
    }

    const filename = pathParts[pathParts.length - 1] || 'index.html';
    if (BLOCKED_STATIC_FILES.has(filename)) {
        return true;
    }

    const ext = path.extname(filename).toLowerCase();
    return !PUBLIC_MIME_TYPES[ext];
}

function serveFile(reqPath, res) {
    const safePath = reqPath === '/' ? '/index.html' : reqPath;
    const normalizedRequestPath = path.posix.normalize(safePath);

    if (isBlockedStaticRequest(normalizedRequestPath)) {
        sendJson(res, 404, { error: 'File not found' });
        return;
    }

    const filePath = path.join(PROJECT_ROOT, normalizedRequestPath);
    const normalized = path.normalize(filePath);

    if (!normalized.startsWith(PROJECT_ROOT)) {
        sendJson(res, 403, { error: 'Forbidden' });
        return;
    }

    fs.readFile(normalized, (error, data) => {
        if (error) {
            if (error.code === 'ENOENT') {
                sendJson(res, 404, { error: 'File not found' });
                return;
            }
            sendJson(res, 500, { error: 'Could not read file' });
            return;
        }

        const ext = path.extname(normalized).toLowerCase();
        res.writeHead(200, { 'Content-Type': PUBLIC_MIME_TYPES[ext] || 'application/octet-stream' });
        res.end(data);
    });
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', chunk => {
            raw += chunk;
            if (raw.length > 1e6) {
                reject(new Error('Request body too large.'));
            }
        });
        req.on('end', () => {
            try {
                resolve(raw ? JSON.parse(raw) : {});
            } catch (error) {
                reject(new Error('Invalid JSON body.'));
            }
        });
        req.on('error', reject);
    });
}

function getRequestIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return String(forwarded).split(',')[0].trim();
    }
    return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

function getLoginAttemptState(ip) {
    const now = Date.now();
    const existing = adminLoginAttempts.get(ip);
    if (!existing || existing.windowStartedAt + ADMIN_LOGIN_WINDOW_MS < now) {
        const nextState = { count: 0, windowStartedAt: now, blockedUntil: 0 };
        adminLoginAttempts.set(ip, nextState);
        return nextState;
    }
    return existing;
}

function recordFailedAdminLogin(ip) {
    const state = getLoginAttemptState(ip);
    state.count += 1;
    if (state.count >= ADMIN_MAX_LOGIN_ATTEMPTS) {
        state.blockedUntil = Date.now() + ADMIN_LOGIN_WINDOW_MS;
    }
    adminLoginAttempts.set(ip, state);
}

function clearAdminLoginAttempts(ip) {
    adminLoginAttempts.delete(ip);
}

function applyCorsHeaders(req, res) {
    const origin = req && req.headers ? req.headers.origin : '';
    if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}

const server = http.createServer(async (req, res) => {
    if (!req.url) {
        sendJson(res, 400, { error: 'Invalid request' });
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const adminSession = getAdminSessionFromRequest(req);
    applyCorsHeaders(req, res);

    if (req.method === 'GET' && url.pathname === '/admin.html' && !adminSession) {
        sendRedirect(res, '/admin-login.html?redirect=admin.html');
        return;
    }

    if (req.method === 'GET' && url.pathname === '/admin-login.html' && adminSession) {
        sendRedirect(res, '/admin.html');
        return;
    }

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (url.pathname.startsWith('/api/admin/') && url.pathname !== '/api/admin/login' && !adminSession) {
        sendJson(res, 401, { error: 'Admin authentication is required.' });
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/login') {
        try {
            const ip = getRequestIp(req);
            const attemptState = getLoginAttemptState(ip);
            if (attemptState.blockedUntil && attemptState.blockedUntil > Date.now()) {
                sendJson(res, 429, { error: 'Too many admin login attempts. Please try again later.' });
                return;
            }

            const body = await readBody(req);
            const email = String(body.email || '').trim().toLowerCase();
            const password = String(body.password || '');
            const isValid = verifyAdminCredentials(email, password);

            if (!isValid) {
                recordFailedAdminLogin(ip);
                sendJson(res, 401, { error: 'Invalid admin credentials.' });
                return;
            }

            clearAdminLoginAttempts(ip);
            const token = createAdminSession(email);
            res.setHeader('Set-Cookie', buildSessionCookie(token));
            sendJson(res, 200, {
                ok: true,
                email
            });
        } catch (error) {
            sendJson(res, 400, { error: error.message || 'Admin login failed.' });
        }
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/session') {
        sendJson(res, 200, {
            authenticated: Boolean(adminSession),
            email: adminSession ? adminSession.email : '',
            expiresAt: adminSession ? adminSession.exp : 0
        });
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
        res.setHeader('Set-Cookie', buildLogoutCookie());
        sendJson(res, 200, { ok: true });
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/analytics') {
        try {
            const payload = await getAdminAnalytics({
                search: url.searchParams.get('search') || ''
            });
            sendJson(res, 200, payload);
        } catch (error) {
            sendJson(res, 500, { error: error.message || 'Admin analytics could not be loaded.' });
        }
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/create-payment-intent') {
        try {
            const body = await readBody(req);
            const payload = await createStripePaymentIntent(body);
            sendJson(res, 200, payload);
        } catch (error) {
            sendJson(res, 400, { error: error.message || 'Payment intent could not be created.' });
        }
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/checkout-start') {
        try {
            req.body = await readBody(req);
            await checkoutStartHandler(req, augmentResponse(res));
        } catch (error) {
            sendJson(res, 400, { error: error.message || 'Checkout could not be started.' });
        }
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/checkout-complete') {
        try {
            req.body = await readBody(req);
            await checkoutCompleteHandler(req, augmentResponse(res));
        } catch (error) {
            sendJson(res, 400, { error: error.message || 'Checkout could not be verified.' });
        }
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/confirm-business-upgrade') {
        try {
            req.body = await readBody(req);
            await confirmBusinessUpgradeHandler(req, augmentResponse(res));
        } catch (error) {
            sendJson(res, 400, { error: error.message || 'Business upgrade could not be confirmed.' });
        }
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/stripe-webhook') {
        await stripeWebhookHandler(req, augmentResponse(res));
        return;
    }

    if (
        url.pathname === '/api/polar-webhook'
        || url.pathname === '/api/webhooks/polar'
    ) {
        await polarWebhookHandler(req, augmentResponse(res));
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/payment-config') {
        sendJson(res, 200, getPaymentConfig());
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/template-access-start') {
        try {
            req.body = await readBody(req);
            await templateAccessStartHandler(req, augmentResponse(res));
        } catch (error) {
            sendJson(res, 400, { error: error.message || 'Template checkout could not be started.' });
        }
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/template-access-complete') {
        try {
            req.body = await readBody(req);
            await templateAccessCompleteHandler(req, augmentResponse(res));
        } catch (error) {
            sendJson(res, 400, { error: error.message || 'Template checkout could not be verified.' });
        }
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/template-download') {
        await templateDownloadHandler(req, augmentResponse(res));
        return;
    }

    if (req.method === 'GET') {
        serveFile(url.pathname, res);
        return;
    }

    sendJson(res, 405, { error: 'Method not allowed' });
});

function startServer(preferredPort, attemptsLeft = MAX_PORT_ATTEMPTS) {
    server.listen(preferredPort, () => {
        console.log(`Nexlance server running at http://localhost:${preferredPort}`);
        if (preferredPort !== PORT) {
            console.log(`Preferred port ${PORT} was busy, so the server started on ${preferredPort} instead.`);
        }
    });

    server.once('error', error => {
        if (error.code === 'EADDRINUSE' && attemptsLeft > 0) {
            const nextPort = preferredPort + 1;
            console.warn(`Port ${preferredPort} is already in use. Trying port ${nextPort}...`);
            server.close(() => {
                startServer(nextPort, attemptsLeft - 1);
            });
            return;
        }

        if (error.code === 'EADDRINUSE') {
            console.error(`Could not start the server because ports ${PORT}-${preferredPort} are all in use.`);
            console.error('Stop the existing process or set a free port with the PORT environment variable.');
            process.exit(1);
        }

        console.error('Server failed to start:', error.message || error);
        process.exit(1);
    });
}

startServer(PORT);
