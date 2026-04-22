const admin = require('../services/firebase-admin-init');
const { requireAuth } = require('../services/request-guards');

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function getDeletedAccountKey(email) {
    return normalizeEmail(email).replace(/[.#$/\[\]]/g, '_');
}

function send(res, statusCode, payload) {
    if (typeof res.status === 'function' && typeof res.json === 'function') {
        res.status(statusCode).json(payload);
        return;
    }
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
}

module.exports = async function handler(req, res) {
    if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Allow-Methods', 'POST,DELETE,OPTIONS');
        send(res, 204, {});
        return;
    }

    if (req.method !== 'POST' && req.method !== 'DELETE') {
        send(res, 405, { error: 'Method not allowed' });
        return;
    }

    let session;
    try {
        session = await requireAuth(req);
    } catch (error) {
        send(res, error.statusCode || 401, { error: error.message || 'Authentication is required.' });
        return;
    }

    const authUser = session && session.authUser ? session.authUser : {};
    const uid = String(authUser.uid || '').trim();
    const email = normalizeEmail(authUser.email);

    if (!uid) {
        send(res, 400, { error: 'Missing account identifier.' });
        return;
    }

    const db = admin.firestore();

    if (email) {
        try {
            await db.collection('deleted_accounts').doc(getDeletedAccountKey(email)).set({
                email,
                uid,
                deletedAt: new Date().toISOString(),
                trialUsed: true
            });
        } catch (err) {
            console.warn('[AccountDelete] Could not record deleted_accounts entry', {
                uid,
                error: err && err.message
            });
        }
    }

    try {
        await db.collection('users').doc(uid).delete();
    } catch (err) {
        console.warn('[AccountDelete] Could not delete users/{uid} document', {
            uid,
            error: err && err.message
        });
    }

    try {
        await admin.auth().deleteUser(uid);
    } catch (err) {
        const code = err && err.code;
        if (code === 'auth/user-not-found') {
            send(res, 200, { ok: true, alreadyDeleted: true });
            return;
        }
        console.error('[AccountDelete] Firebase Auth deleteUser failed', {
            uid,
            code,
            error: err && err.message
        });
        send(res, 500, {
            error: 'Could not delete Firebase account. Please try again.',
            code: code || 'auth/delete-failed'
        });
        return;
    }

    send(res, 200, { ok: true });
};
