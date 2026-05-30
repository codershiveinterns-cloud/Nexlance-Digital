const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const admin = require('firebase-admin');

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
const FIREBASE_PRIVATE_KEY_RAW = process.env.FIREBASE_PRIVATE_KEY;
const FIREBASE_PRIVATE_KEY_BASE64 = process.env.FIREBASE_PRIVATE_KEY_BASE64;

if (!FIREBASE_PROJECT_ID) {
    throw new Error('Missing FIREBASE_PROJECT_ID environment variable.');
}
if (!FIREBASE_CLIENT_EMAIL) {
    throw new Error('Missing FIREBASE_CLIENT_EMAIL environment variable.');
}
if (!FIREBASE_PRIVATE_KEY_RAW && !FIREBASE_PRIVATE_KEY_BASE64) {
    throw new Error('Missing FIREBASE_PRIVATE_KEY environment variable.');
}

// Normalize the private key: handle double-escaped \\n then single-escaped \n
const FIREBASE_PRIVATE_KEY_SOURCE = FIREBASE_PRIVATE_KEY_RAW
    || (FIREBASE_PRIVATE_KEY_BASE64
        ? Buffer.from(String(FIREBASE_PRIVATE_KEY_BASE64), 'base64').toString('utf8')
        : '');

const FIREBASE_PRIVATE_KEY = String(FIREBASE_PRIVATE_KEY_SOURCE || '')
    .replace(/\r\n/g, '\n')
    .replace(/\\\\n/g, '\\n')
    .replace(/\\n/g, '\n')
    .trim();

if (!FIREBASE_PRIVATE_KEY.includes('-----BEGIN PRIVATE KEY-----')) {
    throw new Error(
        'FIREBASE_PRIVATE_KEY does not contain a valid PEM private key. '
        + 'Ensure the environment variable contains the full key starting with -----BEGIN PRIVATE KEY-----'
    );
}

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: FIREBASE_PROJECT_ID,
            clientEmail: FIREBASE_CLIENT_EMAIL,
            privateKey: FIREBASE_PRIVATE_KEY
        })
    });
}

module.exports = admin;
