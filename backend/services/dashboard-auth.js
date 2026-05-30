const AccessControl = require('../../rbac.js');
const { ensureWorkspaceAccessProfile, buildSessionUser } = require('./workspace-access');
const admin = require('./firebase-admin-init');

async function verifyFirebaseIdToken(idToken) {
    const token = String(idToken || '').trim();
    if (!token) {
        const error = new Error('Missing Firebase ID token.');
        error.statusCode = 401;
        throw error;
    }

    let decoded;
    try {
        decoded = await admin.auth().verifyIdToken(token);
    } catch (err) {
        const error = new Error(err.message || 'Invalid Firebase ID token.');
        error.statusCode = 401;
        throw error;
    }

    if (!decoded || !decoded.uid || !decoded.email) {
        const error = new Error('Firebase token did not contain a valid user.');
        error.statusCode = 401;
        throw error;
    }

    return {
        uid: String(decoded.uid),
        email: AccessControl.normalizeEmail(decoded.email),
        emailVerified: Boolean(decoded.email_verified),
        displayName: String(decoded.name || '').trim()
    };
}

function normalizeHeaderValue(value) {
    if (Array.isArray(value)) {
        return String(value.find(Boolean) || '').trim();
    }
    return String(value || '').trim();
}

function extractTokenFromAuthorizationHeader(headerValue) {
    const value = normalizeHeaderValue(headerValue);
    if (!value) return '';

    const bearerMatch = value.match(/^Bearer\s+(.+)$/i);
    if (bearerMatch && bearerMatch[1]) {
        return bearerMatch[1].trim();
    }

    const jwtShape = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
    return jwtShape.test(value) ? value : '';
}

function getBearerToken(req) {
    const headers = req && req.headers && typeof req.headers === 'object' ? req.headers : {};
    const candidates = [
        headers.authorization,
        headers.Authorization,
        headers.AUTHORIZATION,
        headers['x-authorization'],
        headers['x-id-token']
    ];

    if (typeof req.get === 'function') {
        candidates.push(req.get('authorization'));
        candidates.push(req.get('Authorization'));
        candidates.push(req.get('x-id-token'));
    }

    for (const candidate of candidates) {
        const token = extractTokenFromAuthorizationHeader(candidate);
        if (token) return token;
    }

    return '';
}

async function authenticateDashboardRequest(req) {
    const idToken = getBearerToken(req);
    console.info('[AuthContext] Dashboard request token check', {
        hasBearerToken: Boolean(idToken),
        method: String(req && req.method || '').trim().toUpperCase(),
        url: String(req && req.url || '').trim()
    });
    if (!idToken) {
        const error = new Error('Missing Bearer token.');
        error.statusCode = 401;
        throw error;
    }

    const authUser = await verifyFirebaseIdToken(idToken);
    const userProfile = await ensureWorkspaceAccessProfile(authUser);
    // Sanitize workspaceId before building session — filter out empty/whitespace-only values
    if (userProfile) {
        userProfile.workspaceId = String(userProfile.workspaceId || '').trim();
    }
    const sessionUser = buildSessionUser(userProfile, authUser);
    // Ensure assignedProjectIds contains no empty strings
    if (sessionUser && Array.isArray(sessionUser.assignedProjectIds)) {
        sessionUser.assignedProjectIds = sessionUser.assignedProjectIds.filter(id => id && String(id).trim() !== '');
    }
    console.info('[AuthContext] Dashboard session resolved', {
        uid: String(authUser.uid || '').trim(),
        email: AccessControl.normalizeEmail(authUser.email),
        workspaceId: String(sessionUser.workspaceId || '').trim(),
        role: AccessControl.normalizeRole(sessionUser.role || sessionUser.workspaceRole)
    });

    return {
        authUser,
        userProfile,
        sessionUser
    };
}

module.exports = {
    authenticateDashboardRequest,
    getBearerToken,
    verifyFirebaseIdToken
};
