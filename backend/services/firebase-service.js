const crypto = require('crypto');
const { DEFAULT_CURRENCY } = require('../../billing-catalog.js');

const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'nexlance-df59e';
const FIREBASE_CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL || '';
const FIREBASE_PRIVATE_KEY = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const FIRESTORE_BASE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';

let accessTokenCache = null;
const DEFAULT_CURRENCY_CODE = String(DEFAULT_CURRENCY || 'gbp').trim().toUpperCase() || 'GBP';

function assertFirebaseServiceConfig() {
    if (!FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
        throw new Error('Missing FIREBASE_CLIENT_EMAIL or FIREBASE_PRIVATE_KEY environment variables.');
    }
}

function encodeBase64Url(input) {
    return Buffer.from(input)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function createServiceAccountJwt() {
    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        iss: FIREBASE_CLIENT_EMAIL,
        scope: FIRESTORE_SCOPE,
        aud: GOOGLE_TOKEN_URL,
        exp: now + 3600,
        iat: now
    };

    const encodedHeader = encodeBase64Url(JSON.stringify(header));
    const encodedPayload = encodeBase64Url(JSON.stringify(payload));
    const unsignedToken = `${encodedHeader}.${encodedPayload}`;
    const signature = crypto.createSign('RSA-SHA256').update(unsignedToken).sign(FIREBASE_PRIVATE_KEY, 'base64');
    const encodedSignature = signature.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

    return `${unsignedToken}.${encodedSignature}`;
}

async function getGoogleAccessToken() {
    assertFirebaseServiceConfig();

    if (accessTokenCache && accessTokenCache.expiresAt > Date.now() + 60000) {
        return accessTokenCache.token;
    }

    const assertion = createServiceAccountJwt();
    const params = new URLSearchParams();
    params.set('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
    params.set('assertion', assertion);

    const response = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
    });

    const data = await response.json();
    if (!response.ok || !data.access_token) {
        throw new Error(data.error_description || data.error || 'Could not obtain Google access token.');
    }

    accessTokenCache = {
        token: data.access_token,
        expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000
    };

    return accessTokenCache.token;
}

function encodeFirestoreValue(value) {
    if (value === null || value === undefined) return { nullValue: null };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') {
        return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    }
    if (Array.isArray(value)) {
        return { arrayValue: { values: value.map(encodeFirestoreValue) } };
    }
    if (value instanceof Date) {
        return { timestampValue: value.toISOString() };
    }
    if (typeof value === 'object') {
        return {
            mapValue: {
                fields: Object.fromEntries(
                    Object.entries(value).map(([key, nestedValue]) => [key, encodeFirestoreValue(nestedValue)])
                )
            }
        };
    }
    return { stringValue: String(value) };
}

function decodeFirestoreValue(value) {
    if (!value || typeof value !== 'object') return null;
    if (Object.prototype.hasOwnProperty.call(value, 'stringValue')) return value.stringValue;
    if (Object.prototype.hasOwnProperty.call(value, 'booleanValue')) return value.booleanValue;
    if (Object.prototype.hasOwnProperty.call(value, 'integerValue')) return Number(value.integerValue);
    if (Object.prototype.hasOwnProperty.call(value, 'doubleValue')) return Number(value.doubleValue);
    if (Object.prototype.hasOwnProperty.call(value, 'timestampValue')) return value.timestampValue;
    if (Object.prototype.hasOwnProperty.call(value, 'arrayValue')) {
        return Array.isArray(value.arrayValue.values)
            ? value.arrayValue.values.map(decodeFirestoreValue)
            : [];
    }
    if (Object.prototype.hasOwnProperty.call(value, 'mapValue')) {
        const fields = value.mapValue && value.mapValue.fields ? value.mapValue.fields : {};
        return Object.fromEntries(
            Object.entries(fields).map(([key, nestedValue]) => [key, decodeFirestoreValue(nestedValue)])
        );
    }
    if (Object.prototype.hasOwnProperty.call(value, 'nullValue')) return null;
    return null;
}

function decodeFirestoreDocument(doc) {
    const decoded = {};
    const fields = doc && doc.fields ? doc.fields : {};
    Object.keys(fields).forEach(key => {
        decoded[key] = decodeFirestoreValue(fields[key]);
    });
    return decoded;
}

function sanitizeDocumentId(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 140) || `doc_${Date.now()}`;
}

function getDocumentEndpoint(collectionId, docId) {
    return `${FIRESTORE_BASE_URL}/${encodeURIComponent(collectionId)}/${encodeURIComponent(docId)}`;
}

async function listCollectionDocuments(collectionId, options = {}) {
    const accessToken = await getGoogleAccessToken();
    const pageSize = Number(options.pageSize || 500);
    let pageToken = '';
    const results = [];

    do {
        const url = new URL(`${FIRESTORE_BASE_URL}/${encodeURIComponent(collectionId)}`);
        url.searchParams.set('pageSize', String(pageSize));
        if (pageToken) {
            url.searchParams.set('pageToken', pageToken);
        }

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error((data.error && data.error.message) || `Could not list Firestore collection ${collectionId}.`);
        }

        const documents = Array.isArray(data.documents) ? data.documents : [];
        documents.forEach(doc => {
            results.push({
                id: doc.name.split('/').pop(),
                ...decodeFirestoreDocument(doc),
                __documentName: doc.name,
                __createTime: doc.createTime || '',
                __updateTime: doc.updateTime || ''
            });
        });

        pageToken = data.nextPageToken || '';
    } while (pageToken);

    return results;
}

async function findUserDocumentByEmail(email) {
    const accessToken = await getGoogleAccessToken();
    const response = await fetch(`${FIRESTORE_BASE_URL}:runQuery`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            structuredQuery: {
                from: [{ collectionId: 'users' }],
                where: {
                    fieldFilter: {
                        field: { fieldPath: 'email' },
                        op: 'EQUAL',
                        value: { stringValue: String(email).trim().toLowerCase() }
                    }
                },
                limit: 1
            }
        })
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error((data.error && data.error.message) || 'Could not query Firestore user.');
    }

    const documentEntry = Array.isArray(data) ? data.find(entry => entry.document) : null;
    if (!documentEntry || !documentEntry.document) {
        return null;
    }

    return {
        name: documentEntry.document.name,
        data: decodeFirestoreDocument(documentEntry.document)
    };
}

async function queryCollectionDocuments(collectionId, options = {}) {
    const accessToken = await getGoogleAccessToken();
    const fieldPath = String(options.fieldPath || '').trim();
    const op = String(options.op || 'EQUAL').trim();
    const limit = Number(options.limit || 10);
    const value = options.value;

    if (!collectionId || !fieldPath) {
        throw new Error('Collection and fieldPath are required to query Firestore.');
    }

    const response = await fetch(`${FIRESTORE_BASE_URL}:runQuery`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            structuredQuery: {
                from: [{ collectionId: String(collectionId) }],
                where: {
                    fieldFilter: {
                        field: { fieldPath },
                        op,
                        value: encodeFirestoreValue(value)
                    }
                },
                limit
            }
        })
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error((data.error && data.error.message) || `Could not query Firestore collection ${collectionId}.`);
    }

    return (Array.isArray(data) ? data : [])
        .filter(entry => entry && entry.document)
        .map(entry => ({
            name: entry.document.name,
            data: decodeFirestoreDocument(entry.document)
        }));
}

async function getCollectionDocument(collectionId, docId) {
    const accessToken = await getGoogleAccessToken();
    const response = await fetch(getDocumentEndpoint(collectionId, docId), {
        method: 'GET',
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    });

    if (response.status === 404) {
        return null;
    }

    const data = await response.json();
    if (!response.ok) {
        throw new Error((data.error && data.error.message) || `Could not fetch Firestore document ${collectionId}/${docId}.`);
    }

    return {
        name: data.name,
        data: decodeFirestoreDocument(data)
    };
}

async function patchFirestoreDocument(documentName, fields) {
    const accessToken = await getGoogleAccessToken();
    const updateMask = Object.keys(fields)
        .map(key => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
        .join('&');

    const response = await fetch(`https://firestore.googleapis.com/v1/${documentName}?${updateMask}`, {
        method: 'PATCH',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            fields: Object.fromEntries(
                Object.entries(fields).map(([key, value]) => [key, encodeFirestoreValue(value)])
            )
        })
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error((data.error && data.error.message) || 'Could not update Firestore user.');
    }

    return decodeFirestoreDocument(data);
}

async function upsertCollectionDocument(collectionId, docId, fields) {
    const accessToken = await getGoogleAccessToken();
    const normalizedDocId = sanitizeDocumentId(docId);
    const updateMask = Object.keys(fields)
        .map(key => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
        .join('&');

    const response = await fetch(`${getDocumentEndpoint(collectionId, normalizedDocId)}?${updateMask}`, {
        method: 'PATCH',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            fields: Object.fromEntries(
                Object.entries(fields).map(([key, value]) => [key, encodeFirestoreValue(value)])
            )
        })
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error((data.error && data.error.message) || `Could not upsert Firestore document ${collectionId}/${normalizedDocId}.`);
    }

    return {
        id: normalizedDocId,
        ...decodeFirestoreDocument(data)
    };
}

async function createCollectionDocument(collectionId, fields, docId = '') {
    const accessToken = await getGoogleAccessToken();
    const normalizedDocId = docId ? sanitizeDocumentId(docId) : '';
    const url = normalizedDocId
        ? `${FIRESTORE_BASE_URL}/${encodeURIComponent(collectionId)}?documentId=${encodeURIComponent(normalizedDocId)}`
        : `${FIRESTORE_BASE_URL}/${encodeURIComponent(collectionId)}`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            fields: Object.fromEntries(
                Object.entries(fields).map(([key, value]) => [key, encodeFirestoreValue(value)])
            )
        })
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error((data.error && data.error.message) || `Could not create Firestore document in ${collectionId}.`);
    }

    return {
        id: data.name.split('/').pop(),
        ...decodeFirestoreDocument(data)
    };
}

async function patchCollectionDocument(collectionId, docId, fields) {
    const accessToken = await getGoogleAccessToken();
    const normalizedDocId = sanitizeDocumentId(docId);
    const updateMask = Object.keys(fields)
        .map(key => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
        .join('&');

    const response = await fetch(`${getDocumentEndpoint(collectionId, normalizedDocId)}?${updateMask}`, {
        method: 'PATCH',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            fields: Object.fromEntries(
                Object.entries(fields).map(([key, value]) => [key, encodeFirestoreValue(value)])
            )
        })
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error((data.error && data.error.message) || `Could not update Firestore document ${collectionId}/${normalizedDocId}.`);
    }

    return {
        id: normalizedDocId,
        ...decodeFirestoreDocument(data)
    };
}

async function deleteCollectionDocument(collectionId, docId) {
    const accessToken = await getGoogleAccessToken();
    const normalizedDocId = sanitizeDocumentId(docId);
    const response = await fetch(getDocumentEndpoint(collectionId, normalizedDocId), {
        method: 'DELETE',
        headers: {
            Authorization: `Bearer ${accessToken}`
        }
    });

    if (response.status === 404) {
        return false;
    }

    if (!response.ok) {
        let data = null;
        try {
            data = await response.json();
        } catch (error) {
            data = null;
        }
        throw new Error((data && data.error && data.error.message) || `Could not delete Firestore document ${collectionId}/${normalizedDocId}.`);
    }

    return true;
}

async function updateUserByEmail(email, updatesOrResolver) {
    const userDoc = await findUserDocumentByEmail(email);
    if (!userDoc) {
        throw new Error(`No Firebase user document found for ${email}.`);
    }

    const nextFields = typeof updatesOrResolver === 'function'
        ? updatesOrResolver(userDoc.data || {})
        : updatesOrResolver;
    if (!nextFields || typeof nextFields !== 'object') {
        throw new Error('User updates must resolve to an object.');
    }

    const updated = await patchFirestoreDocument(userDoc.name, {
        ...nextFields
    });

    return {
        id: userDoc.name.split('/').pop(),
        ...userDoc.data,
        ...updated
    };
}

async function updateUserPlanByEmail(email, planRecord) {
    return updateUserByEmail(email, currentUser => {
        const existingTemplateIds = Array.isArray(currentUser.ownedTemplateIds) ? currentUser.ownedTemplateIds : [];
        const dashboardAccess = Boolean(planRecord.dashboardAccess);
        const allTemplatesAccess = Boolean(planRecord.allTemplatesAccess);

        return {
            currentPlan: planRecord.name,
            planCode: planRecord.code,
            planPaid: planRecord.paid,
            planStatus: planRecord.status,
            dashboardAccess,
            allTemplatesAccess,
            templateLimit: Number(planRecord.templateLimit || 0),
            fullAccess: dashboardAccess,
            paymentAmount: planRecord.price,
            planStartedAt: planRecord.startedAt || '',
            planEndsAt: planRecord.endsAt || '',
            planBillingCycle: planRecord.billingCycle || '',
            upgradedAt: planRecord.startedAt || '',
            lastPaymentIntentId: planRecord.paymentIntentId || '',
            lastCheckoutSessionId: planRecord.checkoutSessionId || '',
            paymentProvider: planRecord.provider || '',
            providerCustomerId: planRecord.providerCustomerId || '',
            providerSubscriptionId: planRecord.providerSubscriptionId || '',
            templateAccessSource: planRecord.templateAccessSource || (allTemplatesAccess ? planRecord.code : ''),
            templateAccessEndsAt: planRecord.templateAccessEndsAt || '',
            ownedTemplateIds: existingTemplateIds,
            updatedAt: new Date().toISOString()
        };
    });
}

async function upsertPaymentAttempt(record) {
    const attemptId = sanitizeDocumentId(record.attemptId || record.referenceId || `attempt_${Date.now()}`);
    return upsertCollectionDocument('payment_attempts', attemptId, {
        attemptId,
        provider: String(record.provider || ''),
        requestedProvider: String(record.requestedProvider || record.provider || ''),
        fallbackProvider: String(record.fallbackProvider || ''),
        productCode: String(record.productCode || ''),
        userEmail: String(record.userEmail || '').trim().toLowerCase(),
        userName: String(record.userName || ''),
        templateId: String(record.templateId || ''),
        status: String(record.status || 'pending'),
        amount: Number(record.amount || 0),
        currency: String(record.currency || DEFAULT_CURRENCY_CODE).toUpperCase(),
        siteBaseUrl: String(record.siteBaseUrl || ''),
        redirectUrl: String(record.redirectUrl || ''),
        providerReferenceId: String(record.providerReferenceId || ''),
        metadata: record.metadata && typeof record.metadata === 'object' ? record.metadata : {},
        createdAt: record.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });
}

async function upsertPaymentRecord(record) {
    const paymentId = sanitizeDocumentId(record.paymentId || `${record.provider || 'payment'}_${record.referenceId || Date.now()}`);
    return upsertCollectionDocument('payments', paymentId, {
        paymentId,
        provider: String(record.provider || ''),
        status: String(record.status || 'pending'),
        productCode: String(record.productCode || ''),
        planCode: String(record.planCode || ''),
        billingType: String(record.billingType || ''),
        billingCycle: String(record.billingCycle || ''),
        userEmail: String(record.userEmail || '').trim().toLowerCase(),
        userName: String(record.userName || ''),
        templateId: String(record.templateId || ''),
        amount: Number(record.amount || 0),
        currency: String(record.currency || DEFAULT_CURRENCY_CODE).toUpperCase(),
        providerPaymentId: String(record.providerPaymentId || ''),
        providerSessionId: String(record.providerSessionId || ''),
        providerSubscriptionId: String(record.providerSubscriptionId || ''),
        providerCustomerId: String(record.providerCustomerId || ''),
        metadata: record.metadata && typeof record.metadata === 'object' ? record.metadata : {},
        createdAt: record.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });
}

async function upsertWebhookEvent(record) {
    const eventId = sanitizeDocumentId(`${record.provider || 'provider'}_${record.eventId || Date.now()}`);
    return upsertCollectionDocument('webhook_events', eventId, {
        eventId: String(record.eventId || ''),
        provider: String(record.provider || ''),
        eventType: String(record.eventType || ''),
        processed: Boolean(record.processed),
        payloadHash: String(record.payloadHash || ''),
        paymentId: String(record.paymentId || ''),
        metadata: record.metadata && typeof record.metadata === 'object' ? record.metadata : {},
        createdAt: record.createdAt || new Date().toISOString(),
        processedAt: record.processed ? (record.processedAt || new Date().toISOString()) : '',
        updatedAt: new Date().toISOString()
    });
}

async function getWebhookEvent(provider, eventId) {
    return getCollectionDocument('webhook_events', `${provider}_${eventId}`);
}

async function recordTemplateEntitlement(record) {
    const docId = sanitizeDocumentId(`${record.userEmail}_${record.templateId || record.scope || 'all'}`);
    return upsertCollectionDocument('template_entitlements', docId, {
        entitlementId: docId,
        userEmail: String(record.userEmail || '').trim().toLowerCase(),
        templateId: String(record.templateId || ''),
        scope: String(record.scope || (record.templateId ? 'single_template' : 'all_templates')),
        sourceProductCode: String(record.sourceProductCode || ''),
        provider: String(record.provider || ''),
        providerReferenceId: String(record.providerReferenceId || ''),
        active: record.active !== false,
        startsAt: record.startsAt || new Date().toISOString(),
        endsAt: record.endsAt || '',
        metadata: record.metadata && typeof record.metadata === 'object' ? record.metadata : {},
        updatedAt: new Date().toISOString()
    });
}

module.exports = {
    createCollectionDocument,
    deleteCollectionDocument,
    findUserDocumentByEmail,
    getCollectionDocument,
    queryCollectionDocuments,
    listCollectionDocuments,
    patchCollectionDocument,
    recordTemplateEntitlement,
    sanitizeDocumentId,
    updateUserByEmail,
    updateUserPlanByEmail
    ,
    upsertCollectionDocument,
    upsertPaymentAttempt,
    upsertPaymentRecord,
    upsertWebhookEvent,
    getWebhookEvent
};
