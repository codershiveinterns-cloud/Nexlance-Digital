/* ============================================================
   FIREBASE CONFIG - Nexlance Agency Platform
   ============================================================ */

// const firebaseConfig = {
//     apiKey: "AIzaSyCv56CN--eQLTCxomNItL2FgLRoIbdsdoM",
//     authDomain: "nexlance-df59e.firebaseapp.com",
//     projectId: "nexlance-df59e",
//     storageBucket: "nexlance-df59e.firebasestorage.app",
//     messagingSenderId: "480679982312",
//     appId: "1:480679982312:web:2eb0d840f03c81db49055d",
//     measurementId: "G-0XG3807L8Q"
// };

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCv56CN--eQLTCxomNItL2FgLRoIbdsdoM",
  authDomain: "nexlance-df59e.firebaseapp.com",
  projectId: "nexlance-df59e",
  storageBucket: "nexlance-df59e.firebasestorage.app",
  messagingSenderId: "480679982312",
  appId: "1:480679982312:web:2eb0d840f03c81db49055d",
  measurementId: "G-0XG3807L8Q"
};

let auth = null;
let db = null;

try {
    if (typeof firebase !== 'undefined') {
        if (!firebase.apps || !firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        auth = firebase.auth();
        db = firebase.firestore();
    }
} catch (e) {
    console.log('Firebase init failed, using sample data:', e.message);
}

const isFirebaseConfigured = db !== null && !firebaseConfig.apiKey.includes('YOUR_');
const isSupabaseConfigured = isFirebaseConfigured;
const PRIVILEGED_EMAILS = [
    'vijaypratap@nexlancedigital.com',
    'mehrahinal113@gmail.com'
];
const EMAILJS_CONFIG = {
    publicKey: '5UAtxwDsYDz1wJJBL',
    serviceId: 'service_9f3cook',
    templateId: 'template_69wbe5g',
    fromName: 'Nexlance',
    otpExpiryMinutes: 10
};

function _snap(querySnap) {
    return querySnap.docs.map(d => ({ id: d.id, ...d.data() }));
}

function normalizeEmail(email) {
    // Preserve internal whitespace so validation can reject malformed emails.
    return (email || '').trim().toLowerCase();
}

function isPrivilegedEmail(email) {
    return PRIVILEGED_EMAILS.includes(normalizeEmail(email));
}

function getCurrentSessionUser() {
    try {
        return JSON.parse(localStorage.getItem('nexlance_user') || 'null');
    } catch (error) {
        return null;
    }
}

function getStoredTrialRecord() {
    try {
        const ownerKey = getCurrentOwnerKey();
        const scopedKey = ownerKey ? `nexlance_trial_${ownerKey}` : 'nexlance_trial';
        return JSON.parse(localStorage.getItem(scopedKey) || localStorage.getItem('nexlance_trial') || 'null');
    } catch (error) {
        return null;
    }
}

function isPaidPlanCode(planCode) {
    return ['plus', 'business'].includes(String(planCode || '').trim().toLowerCase());
}

function normalizeTrialRecord(trialRecord = getStoredTrialRecord()) {
    if (!trialRecord) return null;

    const endsAtMs = trialRecord.endsAt ? new Date(trialRecord.endsAt).getTime() : NaN;
    const hasTimedTrialWindow = Number.isFinite(endsAtMs) && trialRecord.status !== 'active';
    const inferredStatus = hasTimedTrialWindow
        ? (endsAtMs > Date.now() ? 'trial' : 'expired')
        : (trialRecord.status || 'free');

    return {
        ...trialRecord,
        status: inferredStatus,
        label: inferredStatus === 'trial'
            ? '3-day dashboard trial'
            : (inferredStatus === 'expired'
                ? '3-day dashboard trial expired'
                : (trialRecord.label || 'Individual plan access'))
    };
}

function getTrialAccessState() {
    const trialRecord = normalizeTrialRecord();
    if (!trialRecord) {
        return { isActive: false, record: null };
    }

    const endsAtMs = trialRecord.endsAt ? new Date(trialRecord.endsAt).getTime() : NaN;
    const isTimedTrial = Number.isFinite(endsAtMs) && trialRecord.status !== 'active';
    const isActive = isTimedTrial && endsAtMs > Date.now();

    return {
        isActive,
        record: trialRecord
    };
}

function buildIndividualPlanRecord(options = {}) {
    return {
        code: 'individual',
        name: 'Individual',
        paid: false,
        price: 0,
        currency: 'EUR',
        startedAt: options.startedAt || new Date().toISOString(),
        status: options.status || 'free'
    };
}

function buildPaidPlanRecord(planCode, options = {}) {
    const normalizedCode = String(planCode || 'business').trim().toLowerCase();
    const planNames = { plus: 'Plus', pro: 'Pro', business: 'Business' };
    const defaultPrices = { plus: 599, pro: 1499, business: 1799 };
    const startedAt = options.startedAt || new Date().toISOString();
    const dashboardAccess = options.dashboardAccess !== undefined
        ? Boolean(options.dashboardAccess)
        : ['plus', 'business'].includes(normalizedCode);
    const allTemplatesAccess = options.allTemplatesAccess !== undefined
        ? Boolean(options.allTemplatesAccess)
        : ['pro', 'business'].includes(normalizedCode);
    return {
        code: normalizedCode,
        name: planNames[normalizedCode] || 'Business',
        paid: true,
        price: Number(options.price || defaultPrices[normalizedCode] || defaultPrices.business),
        currency: options.currency || 'EUR',
        startedAt,
        endsAt: options.endsAt || null,
        status: 'active',
        billingCycle: options.billingCycle || 'monthly',
        paymentIntentId: options.paymentIntentId || '',
        dashboardAccess,
        allTemplatesAccess
    };
}

function buildBusinessPlanRecord(options = {}) {
    return buildPaidPlanRecord('business', options);
}

function getScopedStorageKey(baseKey, ownerKey = getCurrentOwnerKey()) {
    return ownerKey ? `${baseKey}_${ownerKey}` : baseKey;
}

function getStoredPlanRecord() {
    try {
        const scopedKey = getScopedStorageKey('nexlance_plan');
        return JSON.parse(localStorage.getItem(scopedKey) || localStorage.getItem('nexlance_plan') || 'null');
    } catch (error) {
        return null;
    }
}

function persistPlanRecord(planRecord) {
    const scopedKey = getScopedStorageKey('nexlance_plan');
    localStorage.setItem(scopedKey, JSON.stringify(planRecord));
    localStorage.setItem('nexlance_plan', JSON.stringify(planRecord));
}

function persistTrialRecordScoped(trialRecord) {
    const scopedKey = getScopedStorageKey('nexlance_trial');
    localStorage.setItem(scopedKey, JSON.stringify(trialRecord));
    localStorage.setItem('nexlance_trial', JSON.stringify(trialRecord));
}

function isPlanExpired(planRecord) {
    if (!planRecord || !planRecord.paid) return false;
    if (!planRecord.endsAt) return false;
    const endsAt = new Date(planRecord.endsAt).getTime();
    return Number.isFinite(endsAt) && endsAt <= Date.now();
}

function getCurrentPlanRecord() {
    if (isPrivilegedEmail(getCurrentOwnerKey())) {
        return buildBusinessPlanRecord();
    }
    const storedPlan = getStoredPlanRecord();
    if (isPlanExpired(storedPlan)) {
        return activateIndividualPlanAccess({
            reason: 'expired',
            preserveStartedAt: storedPlan && storedPlan.startedAt ? storedPlan.startedAt : null
        });
    }
    if (storedPlan) {
        const trialState = getTrialAccessState();
        if (!storedPlan.paid && trialState.isActive) {
            return {
                ...storedPlan,
                status: 'trial',
                startedAt: storedPlan.startedAt || (trialState.record && trialState.record.startedAt) || new Date().toISOString()
            };
        }
        if (!storedPlan.paid && trialState.record && trialState.record.status === 'expired') {
            return {
                ...storedPlan,
                status: 'expired',
                startedAt: storedPlan.startedAt || trialState.record.startedAt || new Date().toISOString()
            };
        }
    }
    if (!storedPlan) {
        const trialState = getTrialAccessState();
        if (trialState.isActive) {
            return buildIndividualPlanRecord({
                startedAt: trialState.record && trialState.record.startedAt ? trialState.record.startedAt : new Date().toISOString(),
                status: 'trial'
            });
        }
        if (trialState.record && trialState.record.status === 'expired') {
            return buildIndividualPlanRecord({
                startedAt: trialState.record.startedAt || new Date().toISOString(),
                status: 'expired'
            });
        }
    }
    return storedPlan || buildIndividualPlanRecord();
}

function hasBusinessPlanAccess() {
    const plan = getCurrentPlanRecord();
    return plan.code === 'business' && plan.paid === true;
}

function hasPaidDashboardAccess() {
    const plan = getCurrentPlanRecord();
    return Boolean(plan && plan.paid === true && plan.dashboardAccess === true && !isPlanExpired(plan));
}

function hasDashboardAccess() {
    return hasPaidDashboardAccess() || isTrialStillActive();
}

function isIndividualPlanActive() {
    return !hasPaidDashboardAccess();
}

function getCurrentPageName() {
    return window.location.pathname.split('/').pop() || 'index.html';
}

function isFreePlanPageAllowed(pageName = getCurrentPageName()) {
    return ['projects.html', 'project-detail.html', 'developer-info.html', 'settings.html'].includes(pageName);
}

function isRestrictedPreviewPage(pageName = getCurrentPageName()) {
    return [
        'dashboard.html',
        'clients.html',
        'team.html',
        'invoices.html',
        'invoice-create.html',
        'services.html',
        'access-roles.html',
        'reports.html',
        'client-detail.html'
    ].includes(pageName);
}

function hasExpiredRestrictedPreviewAccess() {
    if (hasPaidDashboardAccess() || isTrialStillActive()) return false;
    const currentPlan = getCurrentPlanRecord();
    const trialState = getTrialAccessState();
    return Boolean(
        (currentPlan && currentPlan.status === 'expired')
        || (trialState.record && trialState.record.status === 'expired')
    );
}

function shouldShowRestrictedPreview(pageName = getCurrentPageName()) {
    return hasExpiredRestrictedPreviewAccess() && isRestrictedPreviewPage(pageName);
}

function syncPlanRecordToUserStore(planRecord) {
    const currentUser = getCurrentSessionUser();
    const email = normalizeEmail(currentUser && currentUser.email);
    if (!email) return;

    try {
        const users = JSON.parse(localStorage.getItem('nexlance_users') || '[]');
        const userIndex = users.findIndex(user => normalizeEmail(user.email) === email);
        if (userIndex > -1) {
            users[userIndex] = {
                ...users[userIndex],
                currentPlan: planRecord.name,
                planCode: planRecord.code,
                planPaid: planRecord.paid,
                planStatus: planRecord.status || (planRecord.paid ? 'active' : 'free'),
                paymentAmount: planRecord.price || 0,
                planStartedAt: planRecord.startedAt || null,
                planEndsAt: planRecord.endsAt || null,
                dashboardAccess: planRecord.dashboardAccess === true,
                allTemplatesAccess: planRecord.allTemplatesAccess === true,
                fullAccess: planRecord.dashboardAccess === true
            };
            localStorage.setItem('nexlance_users', JSON.stringify(users));
        }
    } catch (error) {
        console.error('Could not sync plan to local users:', error);
    }
}

function syncPlanRecordToFirebase(planRecord) {
    if (!(typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser && db)) return;
    db.collection('users').doc(firebase.auth().currentUser.uid).set({
        currentPlan: planRecord.name,
        planCode: planRecord.code,
        planPaid: planRecord.paid,
        planStatus: planRecord.status || (planRecord.paid ? 'active' : 'free'),
        dashboardAccess: planRecord.dashboardAccess === true,
        allTemplatesAccess: planRecord.allTemplatesAccess === true,
        fullAccess: planRecord.dashboardAccess === true,
        paymentAmount: planRecord.price || 0,
        planStartedAt: planRecord.startedAt || null,
        planEndsAt: planRecord.endsAt || null
    }, { merge: true }).catch(error => {
        console.error('Could not sync plan to Firebase:', error);
    });
}

function activateBusinessPlanAccess(options = {}) {
    const planRecord = buildBusinessPlanRecord(options);
    persistPlanRecord(planRecord);
    syncPlanRecordToUserStore(planRecord);
    syncPlanRecordToFirebase(planRecord);
    persistTrialRecordScoped({
        status: 'active',
        label: 'Business plan access',
        permanent: !planRecord.endsAt,
        planName: 'Business',
        startedAt: planRecord.startedAt,
        endsAt: planRecord.endsAt || null
    });
    return planRecord;
}

function activatePaidPlanAccess(planCode, options = {}) {
    const planRecord = buildPaidPlanRecord(planCode, options);
    persistPlanRecord(planRecord);
    syncPlanRecordToUserStore(planRecord);
    syncPlanRecordToFirebase(planRecord);
    persistTrialRecordScoped(planRecord.dashboardAccess ? {
        status: 'active',
        label: `${planRecord.name} plan access`,
        permanent: !planRecord.endsAt,
        planName: planRecord.name,
        startedAt: planRecord.startedAt,
        endsAt: planRecord.endsAt || null
    } : {
        status: 'free',
        label: `${planRecord.name} template access`,
        planName: planRecord.name,
        startedAt: planRecord.startedAt,
        endsAt: planRecord.endsAt || null
    });
    return planRecord;
}

function activateIndividualPlanAccess(options = {}) {
    const trialRecord = options && options.trialRecord ? options.trialRecord : null;
    const trialEndsAt = trialRecord && trialRecord.endsAt ? new Date(trialRecord.endsAt).getTime() : NaN;
    const hasActiveTrial = Boolean(
        trialRecord &&
        trialRecord.status === 'trial' &&
        Number.isFinite(trialEndsAt) &&
        trialEndsAt > Date.now()
    );
    const planRecord = buildIndividualPlanRecord({
        startedAt: options && options.preserveStartedAt
            ? options.preserveStartedAt
            : (trialRecord && trialRecord.startedAt ? trialRecord.startedAt : undefined),
        status: options && options.reason === 'expired'
            ? 'expired'
            : (hasActiveTrial ? 'trial' : 'free')
    });
    persistPlanRecord(planRecord);
    syncPlanRecordToUserStore(planRecord);
    syncPlanRecordToFirebase(planRecord);
    if (options && options.reason === 'expired') {
        persistTrialRecordScoped({
            status: 'expired',
            label: '3-day dashboard trial expired',
            planName: 'Individual',
            startedAt: trialRecord && trialRecord.startedAt ? trialRecord.startedAt : new Date().toISOString(),
            endsAt: trialRecord && trialRecord.endsAt ? trialRecord.endsAt : new Date().toISOString()
        });
        return planRecord;
    }
    if (hasActiveTrial) {
        persistTrialRecordScoped({
            status: 'trial',
            label: '3-day dashboard trial',
            planName: 'Individual',
            startedAt: trialRecord.startedAt || new Date().toISOString(),
            endsAt: trialRecord.endsAt
        });
        return planRecord;
    }
    persistTrialRecordScoped({
        status: 'free',
        label: 'Individual plan access',
        planName: 'Individual',
        startedAt: new Date().toISOString()
    });
    return planRecord;
}

function getCurrentOwnerKey() {
    const user = getCurrentSessionUser();
    return normalizeEmail(user && user.email);
}

function isAdminUser() {
    if (getCurrentOwnerKey() === 'mehrahinal113@gmail.com') {
        return true;
    }

    try {
        const adminUiSession = JSON.parse(localStorage.getItem('nexlance_admin_ui') || 'null');
        return Boolean(adminUiSession && normalizeEmail(adminUiSession.email) === 'mehrahinal113@gmail.com');
    } catch (error) {
        return false;
    }
}

function syncAdminUiVisibility() {
    const isAdmin = isAdminUser();
    document.querySelectorAll('a[href="admin.html"]').forEach(link => {
        const profile = link.closest('.profile');
        const navItem = link.closest('li');
        if (isAdmin) {
            if (profile) profile.style.display = '';
            if (navItem) navItem.style.display = '';
            link.style.display = '';
            return;
        }
        if (profile) {
            profile.style.display = 'none';
        } else if (navItem) {
            navItem.style.display = 'none';
        } else {
            link.style.display = 'none';
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncAdminUiVisibility);
} else {
    syncAdminUiVisibility();
}

function isPaidPlanActive() {
    return hasPaidDashboardAccess();
}

function isTrialStillActive() {
    return getTrialAccessState().isActive;
}

function isUpgradeRequiredForData() {
    return !hasDashboardAccess() && !isFreePlanPageAllowed();
}

function canAccessAccountData() {
    return true;
}

function shouldShowDemoData() {
    return false;
}

function getUpgradeRequiredMessage() {
    if (getTrialAccessState().record && !getTrialAccessState().isActive) {
        return 'Your 3-day dashboard trial has ended. Upgrade to a paid plan to keep using the dashboard.';
    }
    return 'Your 3-day dashboard trial only unlocks dashboard features. Templates still require payment.';
}

function canAccessEntity(entity) {
    if (hasDashboardAccess()) return true;
    return ['projects', 'tasks'].includes(entity);
}

function syncPlanUiVisibility() {
    const dashboardAccess = hasDashboardAccess();
    const previewAccess = hasExpiredRestrictedPreviewAccess();
    const unrestrictedLinks = ['projects.html', 'project-detail.html', 'developer-info.html', 'settings.html'];
    const allowedLinks = (dashboardAccess || previewAccess)
        ? ['dashboard.html', 'clients.html', 'team.html', 'projects.html', 'invoices.html', 'services.html', 'access-roles.html', 'developer-info.html', 'settings.html']
        : ['projects.html', 'developer-info.html', 'settings.html'];

    document.querySelectorAll('.sidebar a[href]').forEach(link => {
        const href = link.getAttribute('href');
        if (href === 'admin.html') return;
        link.parentElement.style.display = allowedLinks.includes(href) ? '' : 'none';
        link.classList.toggle('restricted-preview-link', previewAccess && !unrestrictedLinks.includes(href));
    });
}

function enforcePlanPageAccess() {
    const pageName = getCurrentPageName();
    if (pageName === 'admin.html') {
        return;
    }
    if (shouldShowRestrictedPreview(pageName)) return;
    if (hasDashboardAccess()) return;
    if (!isFreePlanPageAllowed(pageName) && pageName.endsWith('.html') && ['dashboard.html', 'clients.html', 'team.html', 'invoices.html', 'invoice-create.html', 'services.html', 'access-roles.html', 'reports.html', 'client-detail.html'].includes(pageName)) {
        window.location.href = 'projects.html';
    }
}

function ensureRestrictedPreviewStyles() {
    if (document.getElementById('restrictedPreviewStyles')) return;

    const style = document.createElement('style');
    style.id = 'restrictedPreviewStyles';
    style.textContent = `
        .restricted-preview-surface {
            position: relative !important;
            isolation: isolate;
            overflow: hidden;
        }

        .restricted-preview-overlay {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            background: rgba(248, 245, 255, 0.26);
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
            z-index: 999;
        }

        .restricted-preview-card {
            width: min(420px, 100%);
            padding: 28px 24px;
            border-radius: 24px;
            text-align: center;
            background: rgba(255, 255, 255, 0.82);
            border: 1px solid rgba(108, 92, 231, 0.16);
            box-shadow: 0 24px 48px rgba(45, 27, 105, 0.16);
        }

        .restricted-preview-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 7px 12px;
            border-radius: 999px;
            background: rgba(108, 92, 231, 0.12);
            color: #4b3fbf;
            font-size: 0.78rem;
            font-weight: 700;
            letter-spacing: 0.04em;
            text-transform: uppercase;
        }

        .restricted-preview-card h2 {
            margin: 14px 0 10px;
            color: #2d1b69;
            font-size: 1.6rem;
        }

        .restricted-preview-card p {
            margin: 0 0 18px;
            color: #625f7a;
            line-height: 1.6;
        }

        .restricted-preview-button {
            border: none;
            border-radius: 999px;
            padding: 14px 24px;
            font-weight: 700;
            font-size: 0.98rem;
            cursor: pointer;
            color: #fff;
            background: linear-gradient(135deg, #4b3fbf, #6c5ce7);
            box-shadow: 0 16px 28px rgba(108, 92, 231, 0.24);
            transition: transform 0.2s ease, box-shadow 0.2s ease;
        }

        .restricted-preview-button:hover {
            transform: translateY(-1px);
            box-shadow: 0 20px 32px rgba(108, 92, 231, 0.28);
        }

        .restricted-preview-link::after {
            content: ' Locked';
            font-size: 0.74rem;
            color: #8f7aea;
        }

        @media (max-width: 768px) {
            .restricted-preview-overlay {
                padding: 16px;
            }

            .restricted-preview-card {
                padding: 22px 18px;
                border-radius: 20px;
            }

            .restricted-preview-card h2 {
                font-size: 1.35rem;
            }
        }
    `;

    document.head.appendChild(style);
}

function getRestrictedPreviewTarget() {
    return document.querySelector('main.main, main, .main, .main-content') || document.body;
}

function removeRestrictedPreviewOverlay() {
    document.body.classList.remove('restricted-preview-active');
    document.querySelectorAll('.restricted-preview-overlay').forEach(overlay => overlay.remove());
    document.querySelectorAll('.restricted-preview-surface').forEach(surface => surface.classList.remove('restricted-preview-surface'));
}

function redirectToPricingFromPreview() {
    const pageName = getCurrentPageName();
    const target = `pricing.html?source=locked-preview&from=${encodeURIComponent(pageName)}`;
    window.location.href = target;
}

function applyRestrictedPreviewOverlay() {
    const previewActive = shouldShowRestrictedPreview();
    const existingOverlay = document.querySelector('.restricted-preview-overlay');

    if (!previewActive) {
        if (existingOverlay) {
            removeRestrictedPreviewOverlay();
            if (hasDashboardAccess()) {
                window.location.reload();
            }
        }
        return;
    }

    ensureRestrictedPreviewStyles();
    document.body.classList.add('restricted-preview-active');

    const target = getRestrictedPreviewTarget();
    if (!target) return;
    target.classList.add('restricted-preview-surface');

    if (existingOverlay) return;

    const overlay = document.createElement('div');
    overlay.className = 'restricted-preview-overlay';
    overlay.innerHTML = `
        <div class="restricted-preview-card" role="dialog" aria-modal="true" aria-labelledby="restrictedPreviewTitle">
            <span class="restricted-preview-badge">Preview Locked</span>
            <h2 id="restrictedPreviewTitle">This section is visible, but locked</h2>
            <p>Your free trial has ended. You can still use the Project section, and you can unlock the rest of the dashboard anytime.</p>
            <button type="button" class="restricted-preview-button" id="restrictedPreviewButton">See Insights</button>
        </div>
    `;
    target.appendChild(overlay);

    const previewButton = overlay.querySelector('#restrictedPreviewButton');
    if (previewButton) {
        previewButton.addEventListener('click', redirectToPricingFromPreview);
    }
}

function ensureStoredAccessConsistency() {
    if (isPrivilegedEmail(getCurrentOwnerKey())) {
        return buildBusinessPlanRecord();
    }

    const storedPlan = getStoredPlanRecord();
    const trialState = getTrialAccessState();

    if (!storedPlan) {
        if (trialState.isActive) {
            return activateIndividualPlanAccess({ trialRecord: trialState.record });
        }
        if (trialState.record && trialState.record.status === 'expired') {
            return activateIndividualPlanAccess({ reason: 'expired', trialRecord: trialState.record });
        }
        return activateIndividualPlanAccess();
    }

    if (!storedPlan.paid && trialState.isActive && storedPlan.status !== 'trial') {
        return activateIndividualPlanAccess({
            trialRecord: trialState.record,
            preserveStartedAt: storedPlan.startedAt || (trialState.record && trialState.record.startedAt) || null
        });
    }

    if (!storedPlan.paid && trialState.record && trialState.record.status === 'expired' && storedPlan.status !== 'expired') {
        return activateIndividualPlanAccess({
            reason: 'expired',
            trialRecord: trialState.record,
            preserveStartedAt: storedPlan.startedAt || trialState.record.startedAt || null
        });
    }

    return storedPlan;
}

function syncAccessUiState() {
    ensureStoredAccessConsistency();
    syncPlanUiVisibility();
    syncAdminUiVisibility();
    enforcePlanPageAccess();
    applyRestrictedPreviewOverlay();
}

function getEntityStorageKey(entity) {
    return `nexlance_${entity}_${getCurrentOwnerKey() || 'guest'}`;
}

function getLocalEntityData(entity) {
    try {
        return JSON.parse(localStorage.getItem(getEntityStorageKey(entity)) || '[]');
    } catch (error) {
        return [];
    }
}

function setLocalEntityData(entity, records) {
    localStorage.setItem(getEntityStorageKey(entity), JSON.stringify(records));
    window.dispatchEvent(new CustomEvent('nexlance-data-changed', { detail: { entity } }));
}

function cloneDemoRecords(records, prefix) {
    return records.map((record, index) => ({
        ...record,
        id: `${prefix}-${index + 1}`,
        is_demo: true
    }));
}

function withOwnerFields(data) {
    const ownerKey = getCurrentOwnerKey();
    return {
        ...data,
        owner_key: ownerKey,
        owner_email: ownerKey,
        updated_at: new Date().toISOString()
    };
}

function sanitizeFirestoreValue(value, seen = new WeakSet()) {
    if (value === null) return null;

    const valueType = typeof value;
    if (valueType === 'string' || valueType === 'boolean') return value;
    if (valueType === 'number') return Number.isFinite(value) ? value : null;
    if (valueType === 'undefined' || valueType === 'function' || valueType === 'symbol' || valueType === 'bigint') {
        return undefined;
    }

    if (value instanceof Date) {
        return Number.isFinite(value.getTime()) ? value.toISOString() : null;
    }

    if (Array.isArray(value)) {
        if (seen.has(value)) return [];
        seen.add(value);
        return value.map(item => {
            const sanitizedItem = sanitizeFirestoreValue(item, seen);
            return sanitizedItem === undefined ? null : sanitizedItem;
        });
    }

    if (valueType === 'object') {
        if (value && (value.nodeType || value === window)) {
            return undefined;
        }

        if (seen.has(value)) return undefined;
        seen.add(value);

        if (typeof value.toJSON === 'function') {
            return sanitizeFirestoreValue(value.toJSON(), seen);
        }

        const result = {};
        Object.keys(value).forEach(key => {
            const sanitizedValue = sanitizeFirestoreValue(value[key], seen);
            if (sanitizedValue !== undefined) {
                result[key] = sanitizedValue;
            }
        });
        return result;
    }

    return undefined;
}

function sanitizeFirestoreData(data) {
    const sanitized = sanitizeFirestoreValue(data);
    return sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized) ? sanitized : {};
}

function createAccessFilteredDataset(entity, demoRecords) {
    if (!canAccessAccountData()) {
        return [];
    }
    const realRecords = getLocalEntityData(entity);
    if (shouldShowDemoData()) {
        return [...realRecords, ...cloneDemoRecords(demoRecords, `demo-${entity}`)];
    }
    return realRecords;
}

function createRestrictedAccessError(entity) {
    const message = `Your current plan does not allow changes in ${entity}.`;
    showToast(message, 'error');
    return new Error(message);
}

function getLocalAdminRecords(key) {
    try {
        return JSON.parse(localStorage.getItem(key) || '[]');
    } catch (error) {
        return [];
    }
}

function setLocalAdminRecords(key, records) {
    localStorage.setItem(key, JSON.stringify(records));
}

async function trackPlatformActivity(eventType, options = {}) {
    const currentUser = getCurrentSessionUser();
    const record = sanitizeFirestoreData({
        event_type: String(eventType || '').trim().toLowerCase(),
        actor_email: normalizeEmail(options.actorEmail || (currentUser && currentUser.email) || ''),
        actor_name: options.actorName || (currentUser && currentUser.name) || '',
        target_type: options.targetType || '',
        target_id: options.targetId || '',
        message: options.message || '',
        page: options.page || getCurrentPageName(),
        metadata: options.metadata || {},
        created_at: options.createdAt || new Date().toISOString()
    });

    if (!record.event_type) return null;

    if (!isFirebaseConfigured || !db) {
        const records = getLocalAdminRecords('nexlance_activity_logs');
        const localRecord = { id: `activity_${Date.now()}`, ...record };
        records.unshift(localRecord);
        setLocalAdminRecords('nexlance_activity_logs', records.slice(0, 500));
        return localRecord;
    }

    try {
        const ref = await db.collection('activity_logs').add(record);
        return { id: ref.id, ...record };
    } catch (error) {
        console.warn('Activity log write failed:', error);
        const records = getLocalAdminRecords('nexlance_activity_logs');
        const localRecord = { id: `activity_${Date.now()}`, ...record };
        records.unshift(localRecord);
        setLocalAdminRecords('nexlance_activity_logs', records.slice(0, 500));
        return localRecord;
    }
}

async function recordPaymentRecord(options = {}) {
    const currentUser = getCurrentSessionUser();
    const record = sanitizeFirestoreData({
        payment_intent_id: options.paymentIntentId || '',
        user_email: normalizeEmail(options.userEmail || (currentUser && currentUser.email) || ''),
        amount: Number(options.amount || 0),
        currency: options.currency || 'EUR',
        payment_type: options.paymentType || 'payment',
        plan_code: options.planCode || '',
        template_id: options.templateId || '',
        template_name: options.templateName || '',
        project_id: options.projectId || '',
        status: options.status || 'succeeded',
        metadata: options.metadata || {},
        created_at: options.createdAt || new Date().toISOString()
    });

    if (!record.payment_intent_id && !record.payment_type) return null;

    if (!isFirebaseConfigured || !db) {
        const records = getLocalAdminRecords('nexlance_payments');
        const localRecord = { id: `payment_${Date.now()}`, ...record };
        records.unshift(localRecord);
        setLocalAdminRecords('nexlance_payments', records.slice(0, 500));
        return localRecord;
    }

    try {
        const ref = await db.collection('payments').add(record);
        return { id: ref.id, ...record };
    } catch (error) {
        console.warn('Payment log write failed:', error);
        const records = getLocalAdminRecords('nexlance_payments');
        const localRecord = { id: `payment_${Date.now()}`, ...record };
        records.unshift(localRecord);
        setLocalAdminRecords('nexlance_payments', records.slice(0, 500));
        return localRecord;
    }
}

async function fetchClients() {
    if (!canAccessEntity('clients')) return [];
    if (!isFirebaseConfigured) return createAccessFilteredDataset('clients', sampleClients);
    try {
        const ownerKey = getCurrentOwnerKey();
        if (!ownerKey) return [];
        const snap = await db.collection('clients').where('owner_key', '==', ownerKey).get();
        return _snap(snap).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    } catch (e) { console.error(e); return getLocalEntityData('clients'); }
}

async function addClient(d) {
    if (!canAccessEntity('clients')) throw createRestrictedAccessError('clients');
    const doc = { ...withOwnerFields(d), created_at: new Date().toISOString() };
    if (!isFirebaseConfigured) {
        const records = getLocalEntityData('clients');
        const r = { ...doc, id: 'c' + Date.now() };
        records.unshift(r);
        setLocalEntityData('clients', records);
        return r;
    }
    const ref = await db.collection('clients').add(doc);
    return { id: ref.id, ...doc };
}

async function updateClient(id, d) {
    if (!canAccessEntity('clients')) throw createRestrictedAccessError('clients');
    const doc = withOwnerFields(d);
    if (!isFirebaseConfigured) {
        const records = getLocalEntityData('clients');
        const i = records.findIndex(c => c.id === id);
        if (i > -1) {
            records[i] = { ...records[i], ...doc };
            setLocalEntityData('clients', records);
            return records[i];
        }
        return null;
    }
    await db.collection('clients').doc(id).update(doc);
    return { id, ...doc };
}

async function deleteClient(id) {
    if (!canAccessEntity('clients')) throw createRestrictedAccessError('clients');
    if (!isFirebaseConfigured) {
        const records = getLocalEntityData('clients').filter(c => c.id !== id);
        setLocalEntityData('clients', records);
        return;
    }
    await db.collection('clients').doc(id).delete();
}

async function fetchProjects(clientId = null) {
    if (!canAccessEntity('projects')) return [];
    
    // Fetch template-created projects from localStorage
    let templateProjects = [];
    try {
        templateProjects = JSON.parse(localStorage.getItem('nexlance_projects') || '[]');
    } catch (e) {
        templateProjects = [];
    }
    
    if (!isFirebaseConfigured) {
        const records = createAccessFilteredDataset('projects', sampleProjects);
        const combined = [...records, ...templateProjects];
        return clientId ? combined.filter(p => p.client_id === clientId) : combined;
    }
    try {
        const ownerKey = getCurrentOwnerKey();
        if (!ownerKey) {
            // If no owner key, just return template projects
            return clientId ? templateProjects.filter(p => p.client_id === clientId) : templateProjects;
        }
        let q = db.collection('projects').where('owner_key', '==', ownerKey);
        if (clientId) q = q.where('client_id', '==', clientId);
        const snap = await q.get();
        const firebaseProjects = _snap(snap).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        // Merge Firebase projects with template projects
        const combined = [...firebaseProjects, ...templateProjects.filter(tp => !firebaseProjects.find(fp => fp.id === tp.id))];
        return combined.sort((a, b) => new Date(b.created_at || b.completedAt || 0) - new Date(a.created_at || a.completedAt || 0));
    } catch (e) {
        console.error(e);
        const records = getLocalEntityData('projects');
        const combined = [...records, ...templateProjects.filter(tp => !records.find(r => r.id === tp.id))];
        return clientId ? combined.filter(p => p.client_id === clientId) : combined;
    }
}

async function addProject(d) {
    const doc = sanitizeFirestoreData({ ...withOwnerFields(d), created_at: new Date().toISOString() });
    if (!isFirebaseConfigured) {
        const records = getLocalEntityData('projects');
        const r = { ...doc, id: 'p' + Date.now() };
        records.unshift(r);
        setLocalEntityData('projects', records);
        return r;
    }
    const ref = await db.collection('projects').add(doc);
    return { id: ref.id, ...doc };
}

async function updateProject(id, d) {
    const doc = sanitizeFirestoreData(withOwnerFields(d));
    if (Object.prototype.hasOwnProperty.call(doc, 'template_state')) {
        console.debug('[Nexlance] Saving sanitized template_state', {
            projectId: id,
            templateState: doc.template_state
        });
    }
    if (!isFirebaseConfigured) {
        const records = getLocalEntityData('projects');
        const i = records.findIndex(p => p.id === id);
        if (i > -1) {
            records[i] = { ...records[i], ...doc };
            setLocalEntityData('projects', records);
            return records[i];
        }
        return null;
    }
    await db.collection('projects').doc(id).update(doc);
    return { id, ...doc };
}

async function deleteProject(id) {
    if (!isFirebaseConfigured) {
        const records = getLocalEntityData('projects').filter(p => p.id !== id);
        setLocalEntityData('projects', records);
        return;
    }
    await db.collection('projects').doc(id).delete();
}

async function fetchTasks(projectId) {
    if (!canAccessEntity('tasks')) return [];
    if (!isFirebaseConfigured) {
        return createAccessFilteredDataset('tasks', sampleTasks).filter(t => t.project_id === projectId);
    }
    try {
        const ownerKey = getCurrentOwnerKey();
        if (!ownerKey) return [];
        const snap = await db.collection('tasks')
            .where('owner_key', '==', ownerKey)
            .where('project_id', '==', projectId)
            .get();
        return _snap(snap).sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
    } catch (e) { console.error(e); return []; }
}

async function addTask(d) {
    const doc = { ...withOwnerFields(d), created_at: new Date().toISOString() };
    if (!isFirebaseConfigured) {
        const records = getLocalEntityData('tasks');
        const r = { ...doc, id: 't' + Date.now() };
        records.push(r);
        setLocalEntityData('tasks', records);
        return r;
    }
    const ref = await db.collection('tasks').add(doc);
    return { id: ref.id, ...doc };
}

async function updateTask(id, d) {
    const doc = withOwnerFields(d);
    if (!isFirebaseConfigured) {
        const records = getLocalEntityData('tasks');
        const i = records.findIndex(t => t.id === id);
        if (i > -1) {
            records[i] = { ...records[i], ...doc };
            setLocalEntityData('tasks', records);
            return records[i];
        }
        return null;
    }
    await db.collection('tasks').doc(id).update(doc);
    return { id, ...doc };
}

async function deleteTask(id) {
    if (!isFirebaseConfigured) {
        const records = getLocalEntityData('tasks').filter(t => t.id !== id);
        setLocalEntityData('tasks', records);
        return;
    }
    await db.collection('tasks').doc(id).delete();
}

async function fetchInvoices() {
    if (!canAccessEntity('invoices')) return [];
    if (!isFirebaseConfigured) return createAccessFilteredDataset('invoices', sampleInvoices);
    try {
        const ownerKey = getCurrentOwnerKey();
        if (!ownerKey) return [];
        const snap = await db.collection('invoices').where('owner_key', '==', ownerKey).get();
        return _snap(snap).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    } catch (e) { console.error(e); return getLocalEntityData('invoices'); }
}

async function addInvoice(d) {
    if (!canAccessEntity('invoices')) throw createRestrictedAccessError('invoices');
    const doc = { ...withOwnerFields(d), created_at: new Date().toISOString() };
    if (!isFirebaseConfigured) {
        const records = getLocalEntityData('invoices');
        const r = { ...doc, id: 'i' + Date.now() };
        records.unshift(r);
        setLocalEntityData('invoices', records);
        return r;
    }
    const ref = await db.collection('invoices').add(doc);
    return { id: ref.id, ...doc };
}

async function updateInvoiceStatus(id, status, paidDate = null) {
    if (!canAccessEntity('invoices')) throw createRestrictedAccessError('invoices');
    const upd = withOwnerFields({ status, ...(paidDate ? { paid_date: paidDate } : {}) });
    if (!isFirebaseConfigured) {
        const records = getLocalEntityData('invoices');
        const i = records.findIndex(inv => inv.id === id);
        if (i > -1) {
            records[i] = { ...records[i], ...upd };
            setLocalEntityData('invoices', records);
        }
        return;
    }
    await db.collection('invoices').doc(id).update(upd);
}

async function deleteInvoice(id) {
    if (!canAccessEntity('invoices')) throw createRestrictedAccessError('invoices');
    if (!isFirebaseConfigured) {
        const records = getLocalEntityData('invoices').filter(inv => inv.id !== id);
        setLocalEntityData('invoices', records);
        return;
    }
    await db.collection('invoices').doc(id).delete();
}

async function fetchServices() {
    if (!canAccessEntity('services')) return [];
    if (!isFirebaseConfigured) return createAccessFilteredDataset('services', sampleServices);
    try {
        const ownerKey = getCurrentOwnerKey();
        if (!ownerKey) return [];
        const snap = await db.collection('services').where('owner_key', '==', ownerKey).get();
        return _snap(snap);
    } catch (e) { console.error(e); return getLocalEntityData('services'); }
}

async function addService(d) {
    if (!canAccessEntity('services')) throw createRestrictedAccessError('services');
    const doc = { ...withOwnerFields(d), created_at: new Date().toISOString() };
    if (!isFirebaseConfigured) {
        const records = getLocalEntityData('services');
        const r = { ...doc, id: 's' + Date.now() };
        records.push(r);
        setLocalEntityData('services', records);
        return r;
    }
    const ref = await db.collection('services').add(doc);
    return { id: ref.id, ...doc };
}

async function updateService(id, d) {
    if (!canAccessEntity('services')) throw createRestrictedAccessError('services');
    const doc = withOwnerFields(d);
    if (!isFirebaseConfigured) {
        const records = getLocalEntityData('services');
        const i = records.findIndex(s => s.id === id);
        if (i > -1) {
            records[i] = { ...records[i], ...doc };
            setLocalEntityData('services', records);
            return records[i];
        }
        return null;
    }
    await db.collection('services').doc(id).update(doc);
    return { id, ...doc };
}

async function deleteService(id) {
    if (!canAccessEntity('services')) throw createRestrictedAccessError('services');
    if (!isFirebaseConfigured) {
        const records = getLocalEntityData('services').filter(s => s.id !== id);
        setLocalEntityData('services', records);
        return;
    }
    await db.collection('services').doc(id).delete();
}

async function fetchTeamMembers() {
    if (!canAccessEntity('team')) return [];
    if (!isFirebaseConfigured) return createAccessFilteredDataset('team_members', sampleTeamMembers);
    try {
        const ownerKey = getCurrentOwnerKey();
        if (!ownerKey) return [];
        const snap = await db.collection('team_members').where('owner_key', '==', ownerKey).get();
        return _snap(snap);
    } catch (e) { console.error(e); return getLocalEntityData('team_members'); }
}

async function addTeamMember(d) {
    if (!canAccessEntity('team')) throw createRestrictedAccessError('team');
    const doc = { ...withOwnerFields(d), created_at: new Date().toISOString() };
    if (!isFirebaseConfigured) {
        const records = getLocalEntityData('team_members');
        const r = { ...doc, id: 'm' + Date.now() };
        records.push(r);
        setLocalEntityData('team_members', records);
        return r;
    }
    const ref = await db.collection('team_members').add(doc);
    return { id: ref.id, ...doc };
}

async function updateTeamMember(id, d) {
    if (!canAccessEntity('team')) throw createRestrictedAccessError('team');
    const doc = withOwnerFields(d);
    if (!isFirebaseConfigured) {
        const records = getLocalEntityData('team_members');
        const i = records.findIndex(m => m.id === id);
        if (i > -1) {
            records[i] = { ...records[i], ...doc };
            setLocalEntityData('team_members', records);
            return records[i];
        }
        return null;
    }
    await db.collection('team_members').doc(id).update(doc);
    return { id, ...doc };
}

async function deleteTeamMember(id) {
    if (!canAccessEntity('team')) throw createRestrictedAccessError('team');
    if (!isFirebaseConfigured) {
        const records = getLocalEntityData('team_members').filter(m => m.id !== id);
        setLocalEntityData('team_members', records);
        return;
    }
    await db.collection('team_members').doc(id).delete();
}

async function logActivity(description, userName = 'Admin') {
    if (!isFirebaseConfigured) return;
    await db.collection('activity_log').add({
        description,
        user_name: userName,
        created_at: new Date().toISOString()
    });
}

const EURO_SYMBOL = '€';
const INR_TO_EUR_RATE = 1 / 90;

function formatCurrency(n) {
    return new Intl.NumberFormat('en-IE', {
        style: 'currency',
        currency: 'EUR',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(Number(n) || 0);
}

function convertInrToEur(value) {
    return Math.round((Number(value) || 0) * INR_TO_EUR_RATE);
}

function migrateLocalCurrencyToEuro() {
    const migrationKey = 'nexlance_currency_migrated_to_eur_v1';
    if (localStorage.getItem(migrationKey) === '1') return;

    const migrations = [
        {
            key: 'clients',
            fields: ['total_contract_value', 'paid_amount']
        },
        {
            key: 'invoices',
            fields: ['amount', 'total_amount']
        },
        {
            key: 'services',
            fields: ['pricing', 'revenue_generated']
        }
    ];

    migrations.forEach(({ key, fields }) => {
        const storageKey = getEntityStorageKey(key);
        try {
            const records = JSON.parse(localStorage.getItem(storageKey) || '[]');
            if (!Array.isArray(records) || !records.length) return;

            const migrated = records.map(record => {
                const updatedRecord = { ...record };
                fields.forEach(field => {
                    if (updatedRecord[field] !== undefined && updatedRecord[field] !== null) {
                        updatedRecord[field] = convertInrToEur(updatedRecord[field]);
                    }
                });
                return updatedRecord;
            });

            localStorage.setItem(storageKey, JSON.stringify(migrated));
        } catch (error) {
            console.error(`Currency migration failed for ${key}:`, error);
        }
    });

    localStorage.setItem(migrationKey, '1');
}
function formatDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
function getInitials(name) { return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2); }

function isValidDate(str) {
    if (!str || typeof str !== 'string') return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
    const d = new Date(str);
    if (isNaN(d.getTime())) return false;
    return d.toISOString().slice(0, 10) === str;
}

function isDateAfter(strA, strB) {
    if (!isValidDate(strA) || !isValidDate(strB)) return false;
    return new Date(strB) > new Date(strA);
}

function isDateSameOrAfter(strA, strB) {
    if (!isValidDate(strA) || !isValidDate(strB)) return false;
    return new Date(strB) >= new Date(strA);
}

function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

function markDateError(inputId, msg) {
    const el = document.getElementById(inputId);
    if (!el) return;
    el.style.borderColor = '#d63031';
    el.style.boxShadow = '0 0 0 3px rgba(214,48,49,0.12)';
    el.title = msg;
}

function clearDateError(inputId) {
    const el = document.getElementById(inputId);
    if (!el) return;
    el.style.borderColor = '';
    el.style.boxShadow = '';
    el.title = '';
}

function attachDateValidation(inputId, { required = false, minToday = false, label = 'Date' } = {}) {
    const el = document.getElementById(inputId);
    if (!el) return;
    el.addEventListener('change', function () {
        const v = this.value;
        if (!v && required) { markDateError(inputId, label + ' is required'); return; }
        if (v && !isValidDate(v)) { markDateError(inputId, label + ': invalid date'); return; }
        if (v && minToday && v < todayISO()) { markDateError(inputId, label + ' must be today or a future date'); return; }
        clearDateError(inputId);
    });
}

function showToast(msg, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) { container = document.createElement('div'); container.className = 'toast-container'; document.body.appendChild(container); }
    const t = document.createElement('div');
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    t.className = `toast toast-${type}`;
    t.innerHTML = `${icons[type] || 'ℹ️'} ${msg}`;
    container.appendChild(t);
    setTimeout(() => { t.style.animation = 'toastIn 0.3s ease reverse'; setTimeout(() => t.remove(), 300); }, 3200);
}

const sampleClients = [
    { id: '1', name: 'Rahul Sharma', email: 'rahul@techvision.in', phone: '+91 98765 43210', company: 'TechVision Pvt Ltd', domain_name: 'techvision.in', hosting_provider: 'Hostinger', project_type: 'Business Website', platform: 'WordPress', hosting_expiry: '2025-08-15', ssl_expiry: '2025-08-15', maintenance_plan: 'Monthly', total_contract_value: 500, paid_amount: 389, plan_type: 'Premium' },
    { id: '2', name: 'Priya Mehta', email: 'priya@shopkart.in', phone: '+91 87654 32109', company: 'ShopKart India', domain_name: 'shopkart.in', hosting_provider: 'AWS', project_type: 'Ecommerce Website', platform: 'Shopify', hosting_expiry: '2025-12-20', ssl_expiry: '2025-10-10', maintenance_plan: 'Annual', total_contract_value: 944, paid_amount: 944, plan_type: 'Premium' },
    { id: '3', name: 'Amit Kumar', email: 'amit@startuphub.com', phone: '+91 76543 21098', company: 'StartupHub', domain_name: 'startuphub.com', hosting_provider: 'GoDaddy', project_type: 'Landing Page', platform: 'Custom', hosting_expiry: '2026-01-30', ssl_expiry: '2026-01-30', maintenance_plan: 'None', total_contract_value: 167, paid_amount: 167, plan_type: 'Basic' },
    { id: '4', name: 'Sunita Patel', email: 'sunita@fashionhub.in', phone: '+91 65432 10987', company: 'FashionHub', domain_name: 'fashionhub.in', hosting_provider: 'Bluehost', project_type: 'Ecommerce Website', platform: 'WooCommerce', hosting_expiry: '2025-07-01', ssl_expiry: '2025-07-01', maintenance_plan: 'Monthly', total_contract_value: 722, paid_amount: 444, plan_type: 'Custom' },
    { id: '5', name: 'Vikram Singh', email: 'vikram@digitaledge.in', phone: '+91 54321 09876', company: 'Digital Edge', domain_name: 'digitaledge.in', hosting_provider: 'SiteGround', project_type: 'Business Website', platform: 'WordPress', hosting_expiry: '2025-09-15', ssl_expiry: '2025-09-15', maintenance_plan: 'Monthly', total_contract_value: 333, paid_amount: 167, plan_type: 'Basic' }
];

const sampleProjects = [
    { id: '1', name: 'TechVision Corporate Website', client_id: '1', client_name: 'TechVision Pvt Ltd', start_date: '2025-01-15', deadline: '2025-03-15', status: 'Development', assigned_team: 'Arjun, Priya', progress: 65 },
    { id: '2', name: 'ShopKart Ecommerce Platform', client_id: '2', client_name: 'ShopKart India', start_date: '2025-02-01', deadline: '2025-05-01', status: 'Testing', assigned_team: 'Dev Team', progress: 85 },
    { id: '3', name: 'StartupHub Landing Page', client_id: '3', client_name: 'StartupHub', start_date: '2025-03-01', deadline: '2025-03-30', status: 'Live', assigned_team: 'Rahul', progress: 100 },
    { id: '4', name: 'FashionHub Store Redesign', client_id: '4', client_name: 'FashionHub', start_date: '2025-03-15', deadline: '2025-06-15', status: 'Design', assigned_team: 'Design Team', progress: 30 },
    { id: '5', name: 'Digital Edge Business Site', client_id: '5', client_name: 'Digital Edge', start_date: '2025-04-01', deadline: '2025-06-30', status: 'Planning', assigned_team: 'Unassigned', progress: 10 }
];

const sampleTasks = [
    { id: '1', project_id: '1', title: 'Homepage wireframe', description: 'Create wireframes for homepage layout', status: 'completed', assignee: 'Arjun', priority: 'high', due_date: '2025-02-01' },
    { id: '2', project_id: '1', title: 'Header & navigation design', description: 'Design sticky header with dropdown', status: 'completed', assignee: 'Priya', priority: 'medium', due_date: '2025-02-05' },
    { id: '3', project_id: '1', title: 'Homepage development', description: 'Build homepage in WordPress', status: 'development', assignee: 'Arjun', priority: 'high', due_date: '2025-02-20' },
    { id: '4', project_id: '1', title: 'Contact form setup', description: 'Setup contact form with email notifications', status: 'todo', assignee: 'Arjun', priority: 'low', due_date: '2025-03-01' },
    { id: '5', project_id: '1', title: 'Client review - Round 1', description: 'Send mockups to client for feedback', status: 'review', assignee: 'Admin', priority: 'medium', due_date: '2025-02-25' },
    { id: '6', project_id: '1', title: 'SEO & analytics setup', description: 'Meta tags, sitemap, Google Analytics', status: 'todo', assignee: 'Priya', priority: 'medium', due_date: '2025-03-10' },
    { id: '7', project_id: '1', title: 'Mobile responsive testing', description: 'Test across devices', status: 'testing', assignee: 'Rohit', priority: 'high', due_date: '2025-03-05' }
];

const sampleInvoices = [
    { id: '1', invoice_number: 'INV-2025-001', client_id: '1', client_name: 'TechVision Pvt Ltd', project_name: 'TechVision Corporate Website', amount: 278, gst_percent: 18, total_amount: 328, due_date: '2025-02-28', status: 'paid', paid_date: '2025-02-20', notes: 'First milestone payment' },
    { id: '2', invoice_number: 'INV-2025-002', client_id: '2', client_name: 'ShopKart India', project_name: 'ShopKart Ecommerce Platform', amount: 500, gst_percent: 18, total_amount: 590, due_date: '2025-03-15', status: 'pending', notes: 'Second milestone' },
    { id: '3', invoice_number: 'INV-2025-003', client_id: '4', client_name: 'FashionHub', project_name: 'FashionHub Store Redesign', amount: 222, gst_percent: 18, total_amount: 262, due_date: '2025-02-01', status: 'overdue', notes: 'Design phase completion' },
    { id: '4', invoice_number: 'INV-2025-004', client_id: '1', client_name: 'TechVision Pvt Ltd', project_name: 'Monthly Maintenance - Feb', amount: 56, gst_percent: 18, total_amount: 66, due_date: '2025-04-01', status: 'recurring', notes: 'Monthly maintenance plan' },
    { id: '5', invoice_number: 'INV-2025-005', client_id: '5', client_name: 'Digital Edge', project_name: 'Digital Edge Business Site', amount: 167, gst_percent: 18, total_amount: 197, due_date: '2025-03-30', status: 'pending', notes: 'Initial payment' }
];

const sampleServices = [
    { id: '1', name: 'Business Website', icon: '🏢', pricing: 278, active_clients: 12, revenue_generated: 3333, avg_delivery_days: 30, description: 'Professional business websites with modern design' },
    { id: '2', name: 'Ecommerce Website', icon: '🛒', pricing: 611, active_clients: 8, revenue_generated: 4889, avg_delivery_days: 45, description: 'Full-featured online stores with payment gateway' },
    { id: '3', name: 'Landing Page', icon: '📄', pricing: 133, active_clients: 5, revenue_generated: 667, avg_delivery_days: 7, description: 'High-converting landing pages for campaigns' },
    { id: '4', name: 'Website Redesign', icon: '🎨', pricing: 200, active_clients: 4, revenue_generated: 800, avg_delivery_days: 21, description: 'Modernize existing websites with fresh design' },
    { id: '5', name: 'Maintenance Plan', icon: '🛠️', pricing: 56, active_clients: 15, revenue_generated: 833, avg_delivery_days: 0, description: 'Monthly website maintenance and updates' },
    { id: '6', name: 'SEO Add-on', icon: '📈', pricing: 89, active_clients: 10, revenue_generated: 889, avg_delivery_days: 0, description: 'Search engine optimization and ranking improvement' },
    { id: '7', name: 'Hosting Setup', icon: '☁️', pricing: 39, active_clients: 20, revenue_generated: 778, avg_delivery_days: 2, description: 'Server setup, DNS config, and SSL installation' }
];

const sampleTeamMembers = [
    { id: '1', name: 'Arjun Kapoor', email: 'vijaypratap@nexlancedigital.com', role: 'Developer', can_edit_tasks: true, can_see_revenue: false, can_create_invoices: false, can_upload_files: true },
    { id: '2', name: 'Priya Gupta', email: 'vijaypratap@nexlancedigital.com', role: 'Designer', can_edit_tasks: true, can_see_revenue: false, can_create_invoices: false, can_upload_files: true },
    { id: '3', name: 'Rohit Sharma', email: 'vijaypratap@nexlancedigital.com', role: 'Project Manager', can_edit_tasks: true, can_see_revenue: true, can_create_invoices: true, can_upload_files: true },
    { id: '4', name: 'Admin User', email: 'vijaypratap@nexlancedigital.com', role: 'Admin', can_edit_tasks: true, can_see_revenue: true, can_create_invoices: true, can_upload_files: true }
];

document.addEventListener("DOMContentLoaded", () => {
    migrateLocalCurrencyToEuro();
    syncAccessUiState();
    if (typeof emailjs !== 'undefined' && EMAILJS_CONFIG && EMAILJS_CONFIG.publicKey) {
        try { emailjs.init(EMAILJS_CONFIG.publicKey); } catch (e) { /* will use per-call key */ }
    }
});

window.addEventListener('pageshow', syncAccessUiState);
window.addEventListener('focus', syncAccessUiState);
window.addEventListener('storage', syncAccessUiState);
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncAccessUiState();
});
