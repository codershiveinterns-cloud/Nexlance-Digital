const AccessControl = require('../../rbac.js');
const { ensureWorkspaceAccessProfile, buildSessionUser } = require('./workspace-access');

const FIREBASE_WEB_API_KEY = String(
    process.env.FIREBASE_WEB_API_KEY
    || process.env.FIREBASE_API_KEY
    || 'AIzaSyCv56CN--eQLTCxomNItL2FgLRoIbdsdoM'
).trim();

async function verifyFirebaseIdToken(idToken) {
    if (!FIREBASE_WEB_API_KEY) {
        throw new Error('Missing FIREBASE_WEB_API_KEY or FIREBASE_API_KEY environment variable.');
    }

    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            idToken: String(idToken || '').trim()
        })
    });

    const data = await response.json();
    if (!response.ok) {
        const message = data && data.error && data.error.message
            ? data.error.message
            : 'Invalid Firebase ID token.';
        const error = new Error(message);
        error.statusCode = 401;
        throw error;
    }

    const account = Array.isArray(data.users) ? data.users[0] : null;
    if (!account || !account.localId || !account.email) {
        const error = new Error('Firebase account lookup did not return a valid user.');
        error.statusCode = 401;
        throw error;
    }

    return {
        uid: String(account.localId),
        email: AccessControl.normalizeEmail(account.email),
        emailVerified: Boolean(account.emailVerified),
        displayName: String(account.displayName || '').trim()
    };
}

function getBearerToken(req) {
    const header = req && req.headers ? req.headers.authorization || '' : '';
    const match = String(header).match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : '';
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
    const sessionUser = buildSessionUser(userProfile, authUser);
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
