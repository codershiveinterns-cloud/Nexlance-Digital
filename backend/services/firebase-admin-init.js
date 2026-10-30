const fs = require('fs');
const path = require('path');

// Support loading .env from both backend/ and root directories
require('dotenv').config({ path: path.join(__dirname, '../.env') });
require('dotenv').config({ path: path.join(__dirname, '../../.env') });

const admin = require('firebase-admin');

let FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID;
let FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
let FIREBASE_PRIVATE_KEY_RAW = process.env.FIREBASE_PRIVATE_KEY;
let FIREBASE_PRIVATE_KEY_BASE64 = process.env.FIREBASE_PRIVATE_KEY_BASE64;

// Auto-fallback: check for local service account JSON if env vars are missing
if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || (!FIREBASE_PRIVATE_KEY_RAW && !FIREBASE_PRIVATE_KEY_BASE64)) {
    const candidateDirs = [path.resolve(__dirname, '../..'), path.resolve(__dirname, '..')];
    for (const dir of candidateDirs) {
        if (!fs.existsSync(dir)) continue;
        try {
            const files = fs.readdirSync(dir);
            const saFile = files.find(f => f.toLowerCase().includes('firebase-adminsdk') && f.endsWith('.json'));
            if (saFile) {
                const sa = JSON.parse(fs.readFileSync(path.join(dir, saFile), 'utf8'));
                if (sa.project_id && sa.client_email && sa.private_key) {
                    FIREBASE_PROJECT_ID = FIREBASE_PROJECT_ID || sa.project_id;
                    FIREBASE_CLIENT_EMAIL = FIREBASE_CLIENT_EMAIL || sa.client_email;
                    FIREBASE_PRIVATE_KEY_RAW = FIREBASE_PRIVATE_KEY_RAW || sa.private_key;
                    break;
                }
            }
        } catch (e) {
            console.warn('[firebase-admin-init] Service account file check warning:', e.message);
        }
    }
}

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
