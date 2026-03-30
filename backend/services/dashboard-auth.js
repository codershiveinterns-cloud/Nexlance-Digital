const {
    findUserDocumentByEmail,
    getCollectionDocument,
    patchCollectionDocument
} = require('./firebase-service');
const {
    createPermissionSet,
    normalizeEmail,
    normalizeRole
} = require('./dashboard-rbac');

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
        email: normalizeEmail(account.email),
        emailVerified: Boolean(account.emailVerified)
    };
}

function getBearerToken(req) {
    const header = req && req.headers ? req.headers.authorization || '' : '';
    const match = String(header).match(/^Bearer\s+(.+)$/i);
    return match ? match[1].trim() : '';
}

async function ensureDashboardUserProfile(authUser) {
    let profileDocument = await getCollectionDocument('users', authUser.uid);

    if (!profileDocument && authUser.email) {
        const emailDocument = await findUserDocumentByEmail(authUser.email);
        if (emailDocument && emailDocument.id) {
            profileDocument = {
                name: emailDocument.name || '',
                data: emailDocument.data || {},
                id: emailDocument.id
            };
        }
    }

    const existingProfile = profileDocument && profileDocument.data ? profileDocument.data : {};
    const role = normalizeRole(existingProfile.role || existingProfile.dashboardRole || 'owner');
    const permissions = existingProfile.permissions && typeof existingProfile.permissions === 'object'
        ? existingProfile.permissions
        : createPermissionSet(role);

    if (profileDocument && (!existingProfile.role || !existingProfile.permissions)) {
        try {
            await patchCollectionDocument('users', profileDocument.id || authUser.uid, {
                role,
                permissions,
                updatedAt: new Date().toISOString()
            });
        } catch (error) {
            // Avoid blocking the request if the profile cannot be backfilled.
        }
    }

    return {
        id: profileDocument ? (profileDocument.id || authUser.uid) : authUser.uid,
        ...existingProfile,
        email: normalizeEmail(existingProfile.email || authUser.email),
        role,
        permissions
    };
}

async function authenticateDashboardRequest(req) {
    const idToken = getBearerToken(req);
    if (!idToken) {
        const error = new Error('Missing Bearer token.');
        error.statusCode = 401;
        throw error;
    }

    const authUser = await verifyFirebaseIdToken(idToken);
    const userProfile = await ensureDashboardUserProfile(authUser);
    return {
        authUser,
        userProfile
    };
}

module.exports = {
    authenticateDashboardRequest
};
