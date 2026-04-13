const { DEFAULT_CURRENCY } = require('../../billing-catalog.js');
const admin = require('./firebase-admin-init');

const db = admin.firestore();
const DEFAULT_CURRENCY_CODE = String(DEFAULT_CURRENCY || 'gbp').trim().toUpperCase() || 'GBP';

function sanitizeDocumentId(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 140) || `doc_${Date.now()}`;
}

async function listCollectionDocuments(collectionId, options = {}) {
    const collectionRef = db.collection(collectionId);
    const snapshot = await collectionRef.get();
    const results = [];

    snapshot.forEach(doc => {
        results.push({
            id: doc.id,
            ...doc.data(),
            __createTime: doc.createTime ? doc.createTime.toDate().toISOString() : '',
            __updateTime: doc.updateTime ? doc.updateTime.toDate().toISOString() : ''
        });
    });

    return results;
}

async function findUserDocumentByEmail(email) {
    const normalizedEmail = String(email).trim().toLowerCase();
    const snapshot = await db.collection('users')
        .where('email', '==', normalizedEmail)
        .limit(1)
        .get();

    if (snapshot.empty) {
        return null;
    }

    const doc = snapshot.docs[0];
    return {
        id: doc.id,
        name: doc.ref.path,
        data: doc.data()
    };
}

async function queryCollectionDocuments(collectionId, options = {}) {
    const fieldPath = String(options.fieldPath || '').trim();
    const limit = Number(options.limit || 10);
    const value = options.value;

    if (!collectionId || !fieldPath) {
        throw new Error('Collection and fieldPath are required to query Firestore.');
    }

    const opMap = {
        'EQUAL': '==',
        'NOT_EQUAL': '!=',
        'LESS_THAN': '<',
        'LESS_THAN_OR_EQUAL': '<=',
        'GREATER_THAN': '>',
        'GREATER_THAN_OR_EQUAL': '>=',
        'ARRAY_CONTAINS': 'array-contains',
        'IN': 'in',
        'ARRAY_CONTAINS_ANY': 'array-contains-any',
        'NOT_IN': 'not-in'
    };

    const op = String(options.op || 'EQUAL').trim();
    const firestoreOp = opMap[op] || '==';

    const snapshot = await db.collection(collectionId)
        .where(fieldPath, firestoreOp, value)
        .limit(limit)
        .get();

    return snapshot.docs.map(doc => ({
        id: doc.id,
        name: doc.ref.path,
        data: doc.data()
    }));
}

async function getCollectionDocument(collectionId, docId) {
    const docRef = db.collection(collectionId).doc(docId);
    const doc = await docRef.get();

    if (!doc.exists) {
        return null;
    }

    return {
        id: doc.id,
        name: doc.ref.path,
        data: doc.data()
    };
}

async function upsertCollectionDocument(collectionId, docId, fields) {
    const normalizedDocId = sanitizeDocumentId(docId);
    const docRef = db.collection(collectionId).doc(normalizedDocId);
    await docRef.set(fields, { merge: true });

    return {
        id: normalizedDocId,
        ...fields
    };
}

async function createCollectionDocument(collectionId, fields, docId = '') {
    if (docId) {
        const normalizedDocId = sanitizeDocumentId(docId);
        const docRef = db.collection(collectionId).doc(normalizedDocId);
        await docRef.set(fields);
        return {
            id: normalizedDocId,
            ...fields
        };
    }

    const docRef = await db.collection(collectionId).add(fields);
    return {
        id: docRef.id,
        ...fields
    };
}

async function patchCollectionDocument(collectionId, docId, fields) {
    const docRef = db.collection(collectionId).doc(docId);
    await docRef.update(fields);

    return {
        id: docId,
        ...fields
    };
}

async function deleteCollectionDocument(collectionId, docId) {
    const docRef = db.collection(collectionId).doc(docId);
    const doc = await docRef.get();

    if (!doc.exists) {
        return false;
    }

    await docRef.delete();
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

    const docRef = db.collection('users').doc(userDoc.id);
    await docRef.update(nextFields);

    return {
        id: userDoc.id,
        ...userDoc.data,
        ...nextFields
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
    updateUserPlanByEmail,
    upsertCollectionDocument,
    upsertPaymentAttempt,
    upsertPaymentRecord,
    upsertWebhookEvent,
    getWebhookEvent
};
