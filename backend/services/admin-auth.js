const crypto = require('crypto');

const DEFAULT_ADMIN_EMAIL = 'mehrahinal113@gmail.com';
const SESSION_COOKIE_NAME = 'nexlance_admin_session';
const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;
const DEFAULT_ADMIN_PASSWORD_SALT = 'nexlance-admin-salt-v1';
const DEFAULT_ADMIN_PASSWORD_HASH = 'e69079fbb0df77d781bc63db802dffa35c10392881904fb89a9364d93b81ee6da8480bb7143386bb679f9f0eb5b209f0fd59502dd02aa35102f764ef43262b7f';
const DEFAULT_SESSION_SECRET = 'nexlance-local-admin-session-secret-v1';

function getConfiguredAdminEmail() {
    return String(process.env.ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
}

function getSessionSecret() {
    return String(
        process.env.ADMIN_SESSION_SECRET
        || process.env.FIREBASE_PRIVATE_KEY
        || process.env.STRIPE_SECRET_KEY
        || DEFAULT_SESSION_SECRET
    ).trim();
}

function getPasswordHashConfig() {
    const envPassword = process.env.ADMIN_PASSWORD;
    if (envPassword) {
        const salt = String(process.env.ADMIN_PASSWORD_SALT || getConfiguredAdminEmail());
        const iterations = Number(process.env.ADMIN_PASSWORD_ITERATIONS || 120000);
        const digest = String(process.env.ADMIN_PASSWORD_DIGEST || 'sha512');
        const hash = crypto.pbkdf2Sync(envPassword, salt, iterations, 64, digest).toString('hex');
        return { hash, salt, iterations, digest };
    }

    if (!process.env.ADMIN_PASSWORD_HASH || !process.env.ADMIN_PASSWORD_SALT) {
        return {
            hash: DEFAULT_ADMIN_PASSWORD_HASH,
            salt: DEFAULT_ADMIN_PASSWORD_SALT,
            iterations: 120000,
            digest: 'sha512'
        };
    }

    return {
        hash: String(process.env.ADMIN_PASSWORD_HASH).trim().toLowerCase(),
        salt: String(process.env.ADMIN_PASSWORD_SALT),
        iterations: Number(process.env.ADMIN_PASSWORD_ITERATIONS || 120000),
        digest: String(process.env.ADMIN_PASSWORD_DIGEST || 'sha512')
    };
}

function hashPassword(password, config) {
    return crypto.pbkdf2Sync(String(password || ''), config.salt, config.iterations, 64, config.digest).toString('hex');
}

function safeCompare(a, b) {
    const left = Buffer.from(String(a || ''), 'utf8');
    const right = Buffer.from(String(b || ''), 'utf8');
    if (left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
}

function signSessionPayload(payload) {
    const secret = getSessionSecret();
    if (!secret) {
        throw new Error('Missing ADMIN_SESSION_SECRET or another backend secret for admin sessions.');
    }

    const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto
        .createHmac('sha256', secret)
        .update(encodedPayload)
        .digest('base64url');

    return `${encodedPayload}.${signature}`;
}

function verifySignedSession(token) {
    if (!token || !String(token).includes('.')) return null;
    const [encodedPayload, providedSignature] = String(token).split('.');
    const secret = getSessionSecret();
    if (!secret || !encodedPayload || !providedSignature) return null;

    const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(encodedPayload)
        .digest('base64url');

    if (!safeCompare(expectedSignature, providedSignature)) {
        return null;
    }

    try {
        const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
        if (!payload || payload.email !== getConfiguredAdminEmail()) return null;
        if (!payload.exp || Number(payload.exp) <= Date.now()) return null;
        return payload;
    } catch (error) {
        return null;
    }
}

function parseCookies(cookieHeader) {
    return String(cookieHeader || '')
        .split(';')
        .map(part => part.trim())
        .filter(Boolean)
        .reduce((acc, part) => {
            const separatorIndex = part.indexOf('=');
            if (separatorIndex === -1) return acc;
            const key = part.slice(0, separatorIndex).trim();
            const value = decodeURIComponent(part.slice(separatorIndex + 1).trim());
            acc[key] = value;
            return acc;
        }, {});
}

function getAdminSessionFromRequest(req) {
    const cookies = parseCookies(req && req.headers ? req.headers.cookie : '');
    return verifySignedSession(cookies[SESSION_COOKIE_NAME] || '');
}

function buildSessionCookie(token, maxAgeMs = SESSION_DURATION_MS) {
    const parts = [
        `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${Math.floor(maxAgeMs / 1000)}`
    ];

    if (process.env.NODE_ENV === 'production') {
        parts.push('Secure');
    }

    return parts.join('; ');
}

function buildLogoutCookie() {
    const parts = [
        `${SESSION_COOKIE_NAME}=`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        'Max-Age=0'
    ];

    if (process.env.NODE_ENV === 'production') {
        parts.push('Secure');
    }

    return parts.join('; ');
}

function createAdminSession(email) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const issuedAt = Date.now();
    return signSessionPayload({
        email: normalizedEmail,
        iat: issuedAt,
        exp: issuedAt + SESSION_DURATION_MS
    });
}

function verifyAdminCredentials(email, password) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const passwordConfig = getPasswordHashConfig();

    if (!passwordConfig) {
        throw new Error('Admin password is not configured on the server.');
    }

    if (normalizedEmail !== getConfiguredAdminEmail()) {
        return false;
    }

    const candidateHash = hashPassword(password, passwordConfig);
    return safeCompare(candidateHash, passwordConfig.hash);
}

module.exports = {
    SESSION_COOKIE_NAME,
    buildLogoutCookie,
    buildSessionCookie,
    createAdminSession,
    getAdminSessionFromRequest,
    getConfiguredAdminEmail,
    verifyAdminCredentials
};
