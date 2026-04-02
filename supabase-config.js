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
const PLAN_ACCESS_CONFIG = {
    individual: {
        pages: ['projects.html', 'project-detail.html', 'developer-info.html', 'settings.html'],
        entities: ['projects', 'tasks'],
        dashboardAccess: false,
        allTemplatesAccess: false,
        templateLimit: 0
    },
    plus: {
        pages: ['dashboard.html', 'projects.html', 'project-detail.html', 'settings.html', 'developer-info.html', 'access-roles.html', 'services.html'],
        entities: ['projects', 'tasks', 'services'],
        dashboardAccess: true,
        allTemplatesAccess: false,
        templateLimit: 0
    },
    pro: {
        pages: ['dashboard.html', 'projects.html', 'project-detail.html', 'settings.html', 'developer-info.html', 'access-roles.html', 'services.html', 'invoices.html', 'invoice-create.html', 'team.html'],
        entities: ['projects', 'tasks', 'services', 'invoices', 'team'],
        dashboardAccess: true,
        allTemplatesAccess: false,
        templateLimit: 4
    },
    business: {
        pages: ['dashboard.html', 'projects.html', 'project-detail.html', 'settings.html', 'developer-info.html', 'access-roles.html', 'services.html', 'invoices.html', 'invoice-create.html', 'team.html', 'clients.html', 'client-detail.html', 'reports.html'],
        entities: ['projects', 'tasks', 'services', 'invoices', 'team', 'clients', 'reports'],
        dashboardAccess: true,
        allTemplatesAccess: true,
        templateLimit: 8
    }
};
const TRIAL_ACCESS_CONFIG = {
    pages: [...PLAN_ACCESS_CONFIG.business.pages],
    entities: [...PLAN_ACCESS_CONFIG.business.entities],
    dashboardAccess: true,
    allTemplatesAccess: false,
    templateLimit: 0
};
const DEFAULT_PLAN_CURRENCY = (function () {
    const sharedCurrency = window.NEXLANCE_BILLING_CATALOG
        && typeof window.NEXLANCE_BILLING_CATALOG.DEFAULT_CURRENCY === 'string'
        ? window.NEXLANCE_BILLING_CATALOG.DEFAULT_CURRENCY
        : 'gbp';
    const normalized = String(sharedCurrency || '').trim().toUpperCase();
    return normalized || 'GBP';
})();
const RESTRICTED_PAGE_NAMES = ['dashboard.html', 'clients.html', 'team.html', 'invoices.html', 'invoice-create.html', 'services.html', 'access-roles.html', 'reports.html', 'client-detail.html'];
const AUTHENTICATED_APP_PAGE_NAMES = [
    'dashboard.html',
    'clients.html',
    'client-detail.html',
    'team.html',
    'projects.html',
    'project-detail.html',
    'invoices.html',
    'invoice-create.html',
    'services.html',
    'access-roles.html',
    'owner-control.html',
    'settings.html',
    'developer-info.html',
    'reports.html',
    'unauthorized.html'
];

function getAccessControl() {
    return window.NexlanceAccessControl || null;
}

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
    return ['plus', 'pro', 'business'].includes(String(planCode || '').trim().toLowerCase());
}

function getPlanAccessConfig(planCode) {
    const normalizedCode = String(planCode || 'individual').trim().toLowerCase();
    const config = PLAN_ACCESS_CONFIG[normalizedCode] || PLAN_ACCESS_CONFIG.individual;
    return {
        pages: [...config.pages],
        entities: [...config.entities],
        dashboardAccess: Boolean(config.dashboardAccess),
        allTemplatesAccess: Boolean(config.allTemplatesAccess),
        templateLimit: Number(config.templateLimit || 0)
    };
}

function getRoleBasedAccessConfig() {
    const accessControl = getAccessControl();
    const currentUser = getCurrentSessionUser();
    if (!accessControl || !currentUser || !currentUser.workspaceId) {
        return null;
    }

    const permissionMatrix = accessControl.getPermissionMatrix(currentUser);
    const allowedPages = accessControl.getAllowedPages(currentUser);
    const entities = [];

    if (permissionMatrix.projects && permissionMatrix.projects.read) entities.push('projects');
    if (permissionMatrix.tasks && permissionMatrix.tasks.read) entities.push('tasks');
    if (permissionMatrix.clients && permissionMatrix.clients.read) entities.push('clients');
    if (permissionMatrix.invoices && permissionMatrix.invoices.read) entities.push('invoices');
    if (permissionMatrix.services && permissionMatrix.services.read) entities.push('services');
    if (permissionMatrix.team && permissionMatrix.team.read) entities.push('team');
    if (permissionMatrix.invoices && permissionMatrix.invoices.read && !entities.includes('reports')) {
        entities.push('reports');
    }

    return {
        pages: [...new Set(allowedPages)],
        entities: [...new Set(entities)],
        dashboardAccess: accessControl.canViewDashboard(currentUser),
        allTemplatesAccess: false,
        templateLimit: 0
    };
}

function getCurrentAccessConfig() {
    const roleBasedConfig = getRoleBasedAccessConfig();
    if (roleBasedConfig) {
        return roleBasedConfig;
    }

    if (isTrialStillActive()) {
        return {
            pages: [...TRIAL_ACCESS_CONFIG.pages],
            entities: [...TRIAL_ACCESS_CONFIG.entities],
            dashboardAccess: true,
            allTemplatesAccess: false,
            templateLimit: 0
        };
    }

    const currentPlan = getCurrentPlanRecord();
    return getPlanAccessConfig(currentPlan && currentPlan.code);
}

function canAccessPage(pageName = getCurrentPageName()) {
    const accessControl = getAccessControl();
    const currentUser = getCurrentSessionUser();
    if (accessControl && currentUser && currentUser.workspaceId) {
        return accessControl.canAccessPage(currentUser, pageName);
    }
    return getCurrentAccessConfig().pages.includes(pageName);
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
        currency: DEFAULT_PLAN_CURRENCY,
        startedAt: options.startedAt || new Date().toISOString(),
        status: options.status || 'free'
    };
}

function buildPaidPlanRecord(planCode, options = {}) {
    const normalizedCode = String(planCode || 'business').trim().toLowerCase();
    const planNames = { plus: 'Plus', pro: 'Pro', business: 'Business' };
    const defaultPrices = { plus: 199, pro: 299, business: 399 };
    const accessConfig = getPlanAccessConfig(normalizedCode);
    const startedAt = options.startedAt || new Date().toISOString();
    const dashboardAccess = options.dashboardAccess !== undefined
        ? Boolean(options.dashboardAccess)
        : accessConfig.dashboardAccess;
    const allTemplatesAccess = options.allTemplatesAccess !== undefined
        ? Boolean(options.allTemplatesAccess)
        : accessConfig.allTemplatesAccess;
    const templateLimit = options.templateLimit !== undefined
        ? Number(options.templateLimit || 0)
        : accessConfig.templateLimit;
    return {
        code: normalizedCode,
        name: planNames[normalizedCode] || 'Business',
        paid: true,
        price: Number(options.price || defaultPrices[normalizedCode] || defaultPrices.business),
        currency: options.currency || DEFAULT_PLAN_CURRENCY,
        startedAt,
        endsAt: options.endsAt || null,
        status: 'active',
        billingCycle: options.billingCycle || 'monthly',
        paymentIntentId: options.paymentIntentId || '',
        dashboardAccess,
        allTemplatesAccess,
        templateLimit
    };
}

function buildBusinessPlanRecord(options = {}) {
    return buildPaidPlanRecord('business', options);
}

function normalizePlanRecord(planRecord) {
    if (!planRecord || !planRecord.code) {
        return planRecord;
    }

    const normalizedCode = String(planRecord.code || '').trim().toLowerCase();
    const accessConfig = getPlanAccessConfig(normalizedCode);
    const isPaid = Boolean(planRecord.paid);

    return {
        ...planRecord,
        code: normalizedCode || 'individual',
        dashboardAccess: isPaid ? accessConfig.dashboardAccess : false,
        allTemplatesAccess: isPaid ? accessConfig.allTemplatesAccess : false,
        templateLimit: isPaid ? accessConfig.templateLimit : 0
    };
}

function getScopedStorageKey(baseKey, ownerKey = getCurrentOwnerKey()) {
    return ownerKey ? `${baseKey}_${ownerKey}` : baseKey;
}

function getStoredPlanRecord() {
    try {
        const scopedKey = getScopedStorageKey('nexlance_plan');
        return normalizePlanRecord(JSON.parse(localStorage.getItem(scopedKey) || localStorage.getItem('nexlance_plan') || 'null'));
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
    return PLAN_ACCESS_CONFIG.individual.pages.includes(pageName);
}

function isRestrictedPreviewPage(pageName = getCurrentPageName()) {
    return RESTRICTED_PAGE_NAMES.includes(pageName);
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
                templateLimit: Number(planRecord.templateLimit || 0),
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
        templateLimit: Number(planRecord.templateLimit || 0),
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
    return normalizeEmail(user && (user.workspaceOwnerEmail || user.ownerEmail || user.email));
}

function isAdminUser() {
    const accessControl = getAccessControl();
    const user = getCurrentSessionUser();
    return Boolean(accessControl && user && accessControl.canAccessAdminPanel(user));
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
    return getCurrentAccessConfig().entities.includes(String(entity || '').trim().toLowerCase());
}

function normalizeDashboardRole(role) {
    const accessControl = getAccessControl();
    if (accessControl) {
        return accessControl.normalizeRole(role || 'admin');
    }
    return String(role || 'admin').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function getDefaultDashboardPermissions(role = 'admin', isWorkspaceOwner = false) {
    const accessControl = getAccessControl();
    if (accessControl) {
        return accessControl.getPermissionMatrix({
            role,
            isWorkspaceOwner
        });
    }
    return {
        clients: { create: true, update: true, delete: true, read: true },
        invoices: { create: true, update: true, delete: true, read: true },
        projects: { create: true, update: true, delete: true, read: true },
        services: { create: true, update: true, delete: true, read: true },
        tasks: { create: true, update: true, delete: true, read: true },
        team: { create: isWorkspaceOwner, update: isWorkspaceOwner, delete: isWorkspaceOwner, read: isWorkspaceOwner }
    };
}

function getCurrentDashboardUserContext() {
    const user = getCurrentSessionUser() || {};
    const accessControl = getAccessControl();
    const normalizedRole = normalizeDashboardRole(user.role || user.workspaceRole || user.dashboardRole || 'admin');
    const permissions = user.permissions && typeof user.permissions === 'object'
        ? user.permissions
        : getDefaultDashboardPermissions(normalizedRole, Boolean(user.isWorkspaceOwner));
    return {
        role: normalizedRole,
        permissionKeys: accessControl ? accessControl.getAuthenticatedPermissionKeys(user) : [],
        isWorkspaceOwner: Boolean(user.isWorkspaceOwner),
        permissions
    };
}

function hasDashboardPermission(entity, action) {
    const context = getCurrentDashboardUserContext();
    return Boolean(
        context.permissions
        && context.permissions[entity]
        && context.permissions[entity][action]
    );
}

function createDashboardPermissionError(entity, action) {
    const labels = {
        clients: 'manage clients',
        invoices: 'manage invoices',
        projects: 'manage projects',
        services: 'manage services',
        tasks: 'manage tasks',
        team: 'manage team members'
    };
    const actionLabel = action === 'create'
        ? 'create'
        : (action === 'delete' ? 'delete' : 'update');
    return new Error(`You do not have permission to ${actionLabel} ${labels[entity] || entity}. Sign in with an owner/admin account or update the user's role in Firestore.`);
}

function isFirebaseUserAuthenticated() {
    return Boolean(typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser);
}

function isDashboardApiUnavailableError(error) {
    return Boolean(error && (error.code === 'api/unavailable' || error.code === 'api/not-configured'));
}

async function getDashboardBearerToken() {
    if (!isFirebaseUserAuthenticated()) {
        const error = new Error('Please sign in again to continue.');
        error.code = 'auth/not-authenticated';
        throw error;
    }
    return firebase.auth().currentUser.getIdToken();
}

async function refreshCurrentSessionUserFromApi() {
    if (!isFirebaseUserAuthenticated()) return null;

    try {
        const token = await getDashboardBearerToken();
        const response = await fetch('/api/me', {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${token}`
            },
            credentials: 'same-origin'
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload || !payload.user) {
            return null;
        }

        const currentUser = getCurrentSessionUser() || {};
        const nextUser = {
            ...currentUser,
            ...payload.user
        };
        localStorage.setItem('nexlance_user', JSON.stringify(nextUser));
        return nextUser;
    } catch (error) {
        return null;
    }
}

function normalizeDashboardApiError(error, entity, action) {
    const rawMessage = String(error && error.message ? error.message : '').toLowerCase();
    const status = Number(error && error.status);
    if (status === 401 || rawMessage.includes('bearer token')) {
        return new Error('Your login session expired. Please sign in again and retry.');
    }
    if (status === 403 || rawMessage.includes('insufficient permissions') || rawMessage.includes('permission')) {
        return createDashboardPermissionError(entity, action);
    }
    return error;
}

async function dashboardApiRequest(method, collectionId, docId = '', payload = null) {
    if (!isFirebaseUserAuthenticated()) {
        const error = new Error('Dashboard API requires a signed-in Firebase user.');
        error.code = 'api/not-configured';
        throw error;
    }

    const token = await getDashboardBearerToken();
    const path = docId
        ? `/api/dashboard/${encodeURIComponent(collectionId)}/${encodeURIComponent(docId)}`
        : `/api/dashboard/${encodeURIComponent(collectionId)}`;

    let response;
    try {
        response = await fetch(path, {
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            credentials: 'same-origin',
            body: payload !== null ? JSON.stringify(payload) : undefined
        });
    } catch (error) {
        const wrapped = new Error('Dashboard API is unavailable.');
        wrapped.code = 'api/unavailable';
        throw wrapped;
    }

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const rawText = await response.text().catch(() => '');
    let data = null;
    if (contentType.includes('application/json') && rawText) {
        try {
            data = JSON.parse(rawText);
        } catch (error) {
            data = null;
        }
    } else if (rawText) {
        data = { message: rawText };
    }

    if (!response.ok) {
        if (!contentType.includes('application/json') && (response.status === 404 || response.status === 405)) {
            const unavailable = new Error('Dashboard API is unavailable.');
            unavailable.code = 'api/unavailable';
            throw unavailable;
        }
        const wrapped = new Error((data && (data.error || data.message)) || (rawText ? rawText.trim() : '') || 'Dashboard request failed.');
        wrapped.status = response.status;
        wrapped.response = {
            status: response.status,
            data,
            text: rawText,
            url: path,
            method,
            payload
        };
        throw wrapped;
    }

    if (data && Object.prototype.hasOwnProperty.call(data, 'record')) return data.record;
    if (data && Object.prototype.hasOwnProperty.call(data, 'records')) return data.records;
    return data;
}

async function authorizedApiRequest(path, method = 'GET', payload = null) {
    if (!isFirebaseUserAuthenticated()) {
        const error = new Error('You need to sign in to continue.');
        error.code = 'auth/not-authenticated';
        throw error;
    }

    const token = await getDashboardBearerToken();
    const response = await fetch(path, {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        credentials: 'same-origin',
        body: payload !== null ? JSON.stringify(payload) : undefined
    });

    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const rawText = await response.text().catch(() => '');
    let data = {};
    if (contentType.includes('application/json') && rawText) {
        try {
            data = JSON.parse(rawText);
        } catch (error) {
            data = {};
        }
    } else if (rawText) {
        data = { message: rawText };
    }

    if (!response.ok) {
        const errorMessage = data.error || data.message || (rawText ? rawText.trim() : '') || 'Request failed.';
        const error = new Error(errorMessage);
        error.status = response.status;
        error.response = {
            status: response.status,
            data,
            text: rawText,
            url: path,
            method,
            payload
        };
        throw error;
    }
    return data;
}

async function inviteClient(payload) {
    const response = await authorizedApiRequest('/api/invitations/client', 'POST', payload);
    if (response && response.record) {
        upsertLocalEntityRecord('clients', response.record);
    } else {
        window.dispatchEvent(new CustomEvent('nexlance-data-changed', { detail: { entity: 'clients' } }));
    }
    return response;
}

async function inviteTeamMember(payload) {
    return authorizedApiRequest('/api/invitations/team', 'POST', payload);
}

async function resendWorkspaceInvitation(invitationId) {
    return authorizedApiRequest(`/api/invitations/${encodeURIComponent(invitationId)}/resend`, 'POST', {});
}

async function fetchCurrentUserProfile() {
    return authorizedApiRequest('/api/me', 'GET');
}

async function fetchCurrentUserPermissions() {
    return authorizedApiRequest('/api/me/permissions', 'GET');
}

async function fetchWorkspaceInvitations() {
    return authorizedApiRequest('/api/invitations', 'GET');
}

async function resolveWorkspaceInvitation(token) {
    const response = await fetch(`/api/invitations/resolve?token=${encodeURIComponent(token)}`, {
        method: 'GET',
        credentials: 'same-origin'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        const error = new Error(data.error || 'Invitation could not be loaded.');
        error.status = response.status;
        throw error;
    }
    return data;
}

async function acceptWorkspaceInvitation(token) {
    return authorizedApiRequest('/api/invitations/accept', 'POST', { token });
}

function syncPlanUiVisibility() {
    const previewAccess = hasExpiredRestrictedPreviewAccess();
    const unrestrictedLinks = [...PLAN_ACCESS_CONFIG.individual.pages];
    const allowedLinks = previewAccess
        ? [...new Set([...TRIAL_ACCESS_CONFIG.pages, ...PLAN_ACCESS_CONFIG.individual.pages])]
        : getCurrentAccessConfig().pages;

    document.querySelectorAll('.sidebar a[href]').forEach(link => {
        const href = link.getAttribute('href');
        if (href === 'admin.html') return;
        link.parentElement.style.display = allowedLinks.includes(href) ? '' : 'none';
        link.classList.toggle('restricted-preview-link', previewAccess && !unrestrictedLinks.includes(href));
    });
}

function isAuthenticatedAppPage(pageName = getCurrentPageName()) {
    return AUTHENTICATED_APP_PAGE_NAMES.includes(pageName);
}

function redirectToUnauthorized(pageName = getCurrentPageName()) {
    const target = `unauthorized.html?from=${encodeURIComponent(pageName)}`;
    if (window.location.pathname.endsWith('/unauthorized.html') || pageName === 'unauthorized.html') return;
    window.location.href = target;
}

function enforcePlanPageAccess() {
    const pageName = getCurrentPageName();
    if (pageName === 'admin.html') {
        return;
    }
    if (isAuthenticatedAppPage(pageName) && !getCurrentSessionUser()) {
        window.location.href = `login.html?redirect=${encodeURIComponent(pageName)}`;
        return;
    }
    if (shouldShowRestrictedPreview(pageName)) return;
    if (canAccessPage(pageName)) return;
    if (pageName.endsWith('.html') && RESTRICTED_PAGE_NAMES.includes(pageName)) {
        redirectToUnauthorized(pageName);
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
    refreshCurrentSessionUserFromApi().then(nextUser => {
        if (!nextUser) return;
        syncPlanUiVisibility();
        syncAdminUiVisibility();
        enforcePlanPageAccess();
    });
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

function upsertLocalEntityRecord(entity, record) {
    if (!record || typeof record !== 'object' || !record.id) return record || null;
    const recordId = String(record.id);
    const records = getLocalEntityData(entity);
    const nextRecords = [record, ...records.filter(existing => String(existing && existing.id) !== recordId)];
    setLocalEntityData(entity, nextRecords);
    return record;
}

function mergeEntityCollections() {
    const seen = new Set();
    const merged = [];
    Array.from(arguments).forEach(collection => {
        (Array.isArray(collection) ? collection : []).forEach(record => {
            const key = String(record && record.id ? record.id : '');
            if (key && seen.has(key)) return;
            if (key) seen.add(key);
            merged.push(record);
        });
    });
    return merged;
}

function shouldUseLocalEntityFallback(error) {
    const code = String(error && error.code ? error.code : '').toLowerCase();
    const message = String(error && error.message ? error.message : '').toLowerCase();
    const status = Number(error && error.status);
    return (
        code === 'permission-denied'
        || code === 'firestore/permission-denied'
        || code === 'api/unavailable'
        || code === 'api/not-configured'
        || status === 401
        || status === 403
        || message.includes('missing or insufficient permissions')
        || message.includes('permission denied')
        || message.includes('insufficient permissions')
        || message.includes('dashboard api is unavailable')
    );
}

function getLegacyTemplateProjects() {
    try {
        const records = JSON.parse(localStorage.getItem('nexlance_projects') || '[]');
        return Array.isArray(records) ? records : [];
    } catch (error) {
        return [];
    }
}

function setLegacyTemplateProjects(records) {
    localStorage.setItem('nexlance_projects', JSON.stringify(Array.isArray(records) ? records : []));
    window.dispatchEvent(new CustomEvent('nexlance-data-changed', { detail: { entity: 'projects' } }));
}

function mergeProjectCollections() {
    const merged = [];
    const seen = new Set();

    Array.from(arguments).forEach(collection => {
        const records = Array.isArray(collection) ? collection : [];
        records.forEach(record => {
            if (!record || typeof record !== 'object') return;
            const key = String(record.id || '').trim()
                || `${String(record.template_id || '').trim()}::${String(record.name || '').trim()}`;
            if (!key || seen.has(key)) return;
            seen.add(key);
            merged.push(record);
        });
    });

    return merged;
}

function sortProjectsByRecent(records) {
    return records.slice().sort((a, b) => new Date(b.created_at || b.completedAt || b.template_last_saved_at || 0) - new Date(a.created_at || a.completedAt || a.template_last_saved_at || 0));
}

function updateProjectInCollection(records, id, updates) {
    const nextRecords = Array.isArray(records) ? records.slice() : [];
    const index = nextRecords.findIndex(record => record && record.id === id);
    if (index > -1) {
        nextRecords[index] = { ...nextRecords[index], ...updates };
        return {
            records: nextRecords,
            record: nextRecords[index]
        };
    }
    return {
        records: nextRecords,
        record: null
    };
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
    const realRecords = filterRecordsForCurrentUserScope(entity, getLocalEntityData(entity));
    if (shouldShowDemoData()) {
        return [
            ...realRecords,
            ...filterRecordsForCurrentUserScope(entity, cloneDemoRecords(demoRecords, `demo-${entity}`))
        ];
    }
    return realRecords;
}

function currentUserHasAllProjectsAccess() {
    const currentUser = getCurrentSessionUser();
    return Boolean(
        currentUser
        && (
            currentUser.allProjectsAccess === true
            || currentUser.all_projects_access === true
            || String(currentUser.projectAccessScope || currentUser.project_access_scope || '').trim().toLowerCase() === 'all'
        )
    );
}

function getProjectScopedIdsForRecord(entity, record = {}) {
    if (!record || typeof record !== 'object') return [];
    if (entity === 'projects') {
        return [String(record.id || '').trim()].filter(Boolean);
    }
    if (entity === 'tasks') {
        return [String(record.project_id || '').trim()].filter(Boolean);
    }
    if (entity === 'clients') {
        const accessControl = getAccessControl();
        const ids = [
            ...(Array.isArray(record.assigned_project_ids) ? record.assigned_project_ids : []),
            ...(Array.isArray(record.assignedProjectIds) ? record.assignedProjectIds : []),
            record.project_id,
            record.primary_project_id
        ];
        return accessControl ? accessControl.sanitizeAssignedProjectIds(ids) : ids.map(id => String(id || '').trim()).filter(Boolean);
    }
    return [];
}

function filterRecordsForCurrentUserScope(entity, records) {
    const accessControl = getAccessControl();
    const currentUser = getCurrentSessionUser();
    const safeRecords = Array.isArray(records) ? records : [];
    if (!accessControl || !currentUser || !currentUser.workspaceId) {
        return safeRecords;
    }

    if (accessControl.isWorkspaceOwner(currentUser) || currentUserHasAllProjectsAccess()) {
        return safeRecords;
    }

    const assignedProjectIds = new Set(accessControl.sanitizeAssignedProjectIds(currentUser.assignedProjectIds));
    const role = accessControl.normalizeRole(currentUser.role || currentUser.workspaceRole || currentUser.dashboardRole);
    const shouldRestrictProjects = role === accessControl.ROLES.CLIENT || assignedProjectIds.size > 0;
    if (!shouldRestrictProjects) {
        return safeRecords;
    }

    return safeRecords.filter(record => {
        const projectIds = getProjectScopedIdsForRecord(entity, record);
        if (!projectIds.length) {
            return false;
        }
        return projectIds.some(projectId => assignedProjectIds.has(String(projectId || '').trim()));
    });
}

function shouldSkipOwnerScopedFallbackForCurrentUser() {
    const accessControl = getAccessControl();
    const currentUser = getCurrentSessionUser();
    if (!accessControl || !currentUser || !currentUser.workspaceId) {
        return false;
    }
    return !accessControl.isWorkspaceOwner(currentUser) && !currentUserHasAllProjectsAccess();
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
        currency: options.currency || DEFAULT_PLAN_CURRENCY,
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
        if (isFirebaseUserAuthenticated()) {
            try {
                const records = await dashboardApiRequest('GET', 'clients');
                return Array.isArray(records) ? records : [];
            } catch (error) {
                if (!isDashboardApiUnavailableError(error)) throw normalizeDashboardApiError(error, 'clients', 'update');
            }
        }
        const ownerKey = getCurrentOwnerKey();
        if (!ownerKey) return [];
        const snap = await db.collection('clients').where('owner_key', '==', ownerKey).get();
        return filterRecordsForCurrentUserScope('clients', mergeEntityCollections(
            _snap(snap).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)),
            getLocalEntityData('clients')
        )).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    } catch (e) { console.error(e); return filterRecordsForCurrentUserScope('clients', getLocalEntityData('clients')); }
}

async function fetchClientById(id) {
    if (!canAccessEntity('clients')) return null;
    const clientId = String(id || '').trim();
    if (!clientId) return null;

    if (!isFirebaseConfigured) {
        return createAccessFilteredDataset('clients', sampleClients).find(client => String(client.id) === clientId) || null;
    }

    try {
        if (isFirebaseUserAuthenticated()) {
            try {
                const record = await dashboardApiRequest('GET', 'clients', clientId);
                if (record && typeof record === 'object') {
                    upsertLocalEntityRecord('clients', record);
                    return record;
                }
            } catch (error) {
                if (!isDashboardApiUnavailableError(error)) throw normalizeDashboardApiError(error, 'clients', 'update');
            }
        }

        const ownerKey = getCurrentOwnerKey();
        if (!ownerKey) {
            return filterRecordsForCurrentUserScope('clients', getLocalEntityData('clients'))
                .find(client => String(client.id) === clientId) || null;
        }

        const snapshot = await db.collection('clients').doc(clientId).get();
        if (snapshot.exists) {
            const record = { id: snapshot.id, ...snapshot.data() };
            const isOwnedRecord = String(record.owner_key || '').trim().toLowerCase() === String(ownerKey || '').trim().toLowerCase();
            const filteredRecords = filterRecordsForCurrentUserScope('clients', isOwnedRecord ? [record] : []);
            if (filteredRecords.length) {
                upsertLocalEntityRecord('clients', filteredRecords[0]);
                return filteredRecords[0];
            }
        }
    } catch (error) {
        console.error(error);
    }

    return filterRecordsForCurrentUserScope('clients', getLocalEntityData('clients'))
        .find(client => String(client.id) === clientId) || null;
}

async function addClient(d) {
    if (!canAccessEntity('clients')) throw createRestrictedAccessError('clients');
    const doc = { ...withOwnerFields(d), created_at: new Date().toISOString() };
    if (isFirebaseConfigured) {
        if (!hasDashboardPermission('clients', 'create')) throw createDashboardPermissionError('clients', 'create');
        if (isFirebaseUserAuthenticated()) {
            try {
                return await dashboardApiRequest('POST', 'clients', '', doc);
            } catch (error) {
                if (!isDashboardApiUnavailableError(error)) throw normalizeDashboardApiError(error, 'clients', 'create');
            }
        }
    }
    if (!isFirebaseConfigured) {
        const records = getLocalEntityData('clients');
        const r = { ...doc, id: 'c' + Date.now() };
        records.unshift(r);
        setLocalEntityData('clients', records);
        return r;
    }
    try {
        const ref = await db.collection('clients').add(doc);
        return { id: ref.id, ...doc };
    } catch (error) {
        if (shouldUseLocalEntityFallback(error)) {
            const records = getLocalEntityData('clients');
            const r = { ...doc, id: 'c' + Date.now(), storage_fallback: true };
            records.unshift(r);
            setLocalEntityData('clients', records);
            return r;
        }
        throw error;
    }
}

async function updateClient(id, d) {
    if (!canAccessEntity('clients')) throw createRestrictedAccessError('clients');
    const doc = withOwnerFields(d);
    const existingLocalRecord = getLocalEntityData('clients').find(client => String(client && client.id) === String(id)) || null;
    if (isFirebaseConfigured) {
        if (!hasDashboardPermission('clients', 'update')) throw createDashboardPermissionError('clients', 'update');
        if (isFirebaseUserAuthenticated()) {
            try {
                const record = await dashboardApiRequest('PATCH', 'clients', id, doc);
                if (record) upsertLocalEntityRecord('clients', record);
                return record;
            } catch (error) {
                if (!isDashboardApiUnavailableError(error)) throw normalizeDashboardApiError(error, 'clients', 'update');
            }
        }
    }
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
    return upsertLocalEntityRecord('clients', { ...(existingLocalRecord || {}), id, ...doc });
}

async function deleteClient(id) {
    if (!canAccessEntity('clients')) throw createRestrictedAccessError('clients');
    if (isFirebaseConfigured) {
        if (!hasDashboardPermission('clients', 'delete')) throw createDashboardPermissionError('clients', 'delete');
        if (isFirebaseUserAuthenticated()) {
            try {
                await dashboardApiRequest('DELETE', 'clients', id);
                const remainingRecords = getLocalEntityData('clients').filter(client => String(client && client.id) !== String(id));
                setLocalEntityData('clients', remainingRecords);
                return;
            } catch (error) {
                if (!isDashboardApiUnavailableError(error)) throw normalizeDashboardApiError(error, 'clients', 'delete');
            }
        }
    }
    if (!isFirebaseConfigured) {
        const records = getLocalEntityData('clients').filter(c => c.id !== id);
        setLocalEntityData('clients', records);
        return;
    }
    try {
        await db.collection('clients').doc(id).delete();
    } catch (error) {
        if (!shouldUseLocalEntityFallback(error)) throw error;
    }
    const records = getLocalEntityData('clients').filter(c => c.id !== id);
    setLocalEntityData('clients', records);
}

async function fetchProjects(clientId = null) {
    if (!canAccessEntity('projects')) return [];

    const scopedProjects = filterRecordsForCurrentUserScope('projects', getLocalEntityData('projects'));
    const templateProjects = filterRecordsForCurrentUserScope('projects', getLegacyTemplateProjects());

    if (!isFirebaseConfigured) {
        const records = createAccessFilteredDataset('projects', sampleProjects);
        const combined = sortProjectsByRecent(mergeProjectCollections(records, scopedProjects, templateProjects));
        return clientId ? combined.filter(p => p.client_id === clientId) : combined;
    }
    try {
        if (isFirebaseUserAuthenticated()) {
            try {
                const records = await dashboardApiRequest('GET', 'projects');
                const combinedApiRecords = sortProjectsByRecent(mergeProjectCollections(
                    Array.isArray(records) ? records : [],
                    scopedProjects,
                    templateProjects
                ));
                return clientId ? combinedApiRecords.filter(p => p.client_id === clientId) : combinedApiRecords;
            } catch (error) {
                if (!isDashboardApiUnavailableError(error)) throw normalizeDashboardApiError(error, 'projects', 'update');
            }
        }
        if (shouldSkipOwnerScopedFallbackForCurrentUser()) {
            const combinedScoped = sortProjectsByRecent(mergeProjectCollections(scopedProjects, templateProjects));
            return clientId ? combinedScoped.filter(p => p.client_id === clientId) : combinedScoped;
        }
        const ownerKey = getCurrentOwnerKey();
        if (!ownerKey) {
            const combinedWithoutOwner = sortProjectsByRecent(mergeProjectCollections(scopedProjects, templateProjects));
            return clientId ? combinedWithoutOwner.filter(p => p.client_id === clientId) : combinedWithoutOwner;
        }
        let q = db.collection('projects').where('owner_key', '==', ownerKey);
        if (clientId) q = q.where('client_id', '==', clientId);
        const snap = await q.get();
        const firebaseProjects = _snap(snap).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        const combined = sortProjectsByRecent(filterRecordsForCurrentUserScope('projects', mergeProjectCollections(firebaseProjects, scopedProjects, templateProjects)));
        return clientId ? combined.filter(p => p.client_id === clientId) : combined;
    } catch (e) {
        console.error(e);
        const combined = sortProjectsByRecent(mergeProjectCollections(scopedProjects, templateProjects));
        return clientId ? combined.filter(p => p.client_id === clientId) : combined;
    }
}

async function addProject(d) {
    if (!canAccessEntity('projects')) throw createRestrictedAccessError('projects');
    const doc = sanitizeFirestoreData({ ...withOwnerFields(d), created_at: new Date().toISOString() });
    if (isFirebaseConfigured) {
        if (!hasDashboardPermission('projects', 'create')) throw createDashboardPermissionError('projects', 'create');
        if (isFirebaseUserAuthenticated()) {
            try {
                return await dashboardApiRequest('POST', 'projects', '', doc);
            } catch (error) {
                if (!isDashboardApiUnavailableError(error)) throw normalizeDashboardApiError(error, 'projects', 'create');
            }
        }
    }
    if (!isFirebaseConfigured) {
        const records = getLocalEntityData('projects');
        const r = { ...doc, id: 'p' + Date.now() };
        records.unshift(r);
        setLocalEntityData('projects', records);
        return r;
    }
    try {
        const ref = await db.collection('projects').add(doc);
        return { id: ref.id, ...doc };
    } catch (error) {
        if (shouldUseLocalEntityFallback(error)) {
            const records = getLocalEntityData('projects');
            const r = { ...doc, id: 'p' + Date.now(), storage_fallback: true };
            records.unshift(r);
            setLocalEntityData('projects', records);
            return r;
        }
        throw error;
    }
}

async function updateProject(id, d) {
    if (!canAccessEntity('projects')) throw createRestrictedAccessError('projects');
    const doc = sanitizeFirestoreData(withOwnerFields(d));
    if (Object.prototype.hasOwnProperty.call(doc, 'template_state')) {
        console.debug('[Nexlance] Saving sanitized template_state', {
            projectId: id,
            templateState: doc.template_state
        });
    }
    if (isFirebaseConfigured) {
        if (!hasDashboardPermission('projects', 'update')) throw createDashboardPermissionError('projects', 'update');
        if (isFirebaseUserAuthenticated()) {
            try {
                return await dashboardApiRequest('PATCH', 'projects', id, doc);
            } catch (error) {
                if (!isDashboardApiUnavailableError(error)) throw normalizeDashboardApiError(error, 'projects', 'update');
            }
        }
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
    try {
        await db.collection('projects').doc(id).update(doc);
        return { id, ...doc };
    } catch (error) {
        const message = String(error && error.message ? error.message : '');
        const code = String(error && error.code ? error.code : '');
        const isMissingDocumentError = message.toLowerCase().includes('no document to update')
            || code === 'not-found'
            || code === 5;

        if (!isMissingDocumentError) {
            throw error;
        }

        const scopedProjects = getLocalEntityData('projects');
        const scopedResult = updateProjectInCollection(scopedProjects, id, doc);
        if (scopedResult.record) {
            setLocalEntityData('projects', scopedResult.records);
            return scopedResult.record;
        }

        const legacyProjects = getLegacyTemplateProjects();
        const legacyResult = updateProjectInCollection(legacyProjects, id, doc);
        if (legacyResult.record) {
            setLegacyTemplateProjects(legacyResult.records);
            return legacyResult.record;
        }

        throw error;
    }
}

async function deleteProject(id) {
    if (!canAccessEntity('projects')) throw createRestrictedAccessError('projects');
    if (isFirebaseConfigured) {
        if (!hasDashboardPermission('projects', 'delete')) throw createDashboardPermissionError('projects', 'delete');
        if (isFirebaseUserAuthenticated()) {
            try {
                await dashboardApiRequest('DELETE', 'projects', id);
                const records = getLocalEntityData('projects').filter(p => p.id !== id);
                setLocalEntityData('projects', records);
                const legacyRecords = getLegacyTemplateProjects().filter(p => p.id !== id);
                setLegacyTemplateProjects(legacyRecords);
                return;
            } catch (error) {
                if (!isDashboardApiUnavailableError(error)) throw normalizeDashboardApiError(error, 'projects', 'delete');
            }
        }
    }
    if (!isFirebaseConfigured) {
        const records = getLocalEntityData('projects').filter(p => p.id !== id);
        setLocalEntityData('projects', records);
        const legacyRecords = getLegacyTemplateProjects().filter(p => p.id !== id);
        setLegacyTemplateProjects(legacyRecords);
        return;
    }
    try {
        await db.collection('projects').doc(id).delete();
    } catch (error) {
        const message = String(error && error.message ? error.message : '');
        const code = String(error && error.code ? error.code : '');
        const isMissingDocumentError = message.toLowerCase().includes('no document to update')
            || message.toLowerCase().includes('no document to delete')
            || code === 'not-found'
            || code === 5;
        if (shouldUseLocalEntityFallback(error)) {
            const records = getLocalEntityData('projects').filter(p => p.id !== id);
            setLocalEntityData('projects', records);
            const legacyRecords = getLegacyTemplateProjects().filter(p => p.id !== id);
            setLegacyTemplateProjects(legacyRecords);
            return;
        }
        if (!isMissingDocumentError) {
            throw error;
        }
    }

    const records = getLocalEntityData('projects').filter(p => p.id !== id);
    setLocalEntityData('projects', records);
    const legacyRecords = getLegacyTemplateProjects().filter(p => p.id !== id);
    setLegacyTemplateProjects(legacyRecords);
}

async function fetchTasks(projectId) {
    if (!canAccessEntity('tasks')) return [];
    if (!isFirebaseConfigured) {
        return createAccessFilteredDataset('tasks', sampleTasks).filter(t => t.project_id === projectId);
    }
    try {
        if (isFirebaseUserAuthenticated()) {
            try {
                const records = await dashboardApiRequest('GET', 'tasks');
                return (Array.isArray(records) ? records : []).filter(t => t.project_id === projectId);
            } catch (error) {
                if (!isDashboardApiUnavailableError(error)) throw normalizeDashboardApiError(error, 'tasks', 'update');
            }
        }
        if (shouldSkipOwnerScopedFallbackForCurrentUser()) {
            return filterRecordsForCurrentUserScope('tasks', getLocalEntityData('tasks')).filter(t => t.project_id === projectId);
        }
        const ownerKey = getCurrentOwnerKey();
        if (!ownerKey) return [];
        const snap = await db.collection('tasks')
            .where('owner_key', '==', ownerKey)
            .where('project_id', '==', projectId)
            .get();
        return filterRecordsForCurrentUserScope('tasks', mergeEntityCollections(
            _snap(snap).sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0)),
            getLocalEntityData('tasks').filter(t => t.project_id === projectId)
        )).sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
    } catch (e) { console.error(e); return []; }
}

async function addTask(d) {
    if (!canAccessEntity('tasks')) throw createRestrictedAccessError('tasks');
    const doc = { ...withOwnerFields(d), created_at: new Date().toISOString() };
    if (isFirebaseConfigured) {
        if (!hasDashboardPermission('tasks', 'create')) throw createDashboardPermissionError('tasks', 'create');
        if (isFirebaseUserAuthenticated()) {
            try {
                return await dashboardApiRequest('POST', 'tasks', '', doc);
            } catch (error) {
                if (!isDashboardApiUnavailableError(error)) throw normalizeDashboardApiError(error, 'tasks', 'create');
            }
        }
    }
    if (!isFirebaseConfigured) {
        const records = getLocalEntityData('tasks');
        const r = { ...doc, id: 't' + Date.now() };
        records.push(r);
        setLocalEntityData('tasks', records);
        return r;
    }
    try {
        const ref = await db.collection('tasks').add(doc);
        return { id: ref.id, ...doc };
    } catch (error) {
        if (shouldUseLocalEntityFallback(error)) {
            const records = getLocalEntityData('tasks');
            const r = { ...doc, id: 't' + Date.now(), storage_fallback: true };
            records.push(r);
            setLocalEntityData('tasks', records);
            return r;
        }
        throw error;
    }
}

async function updateTask(id, d) {
    if (!canAccessEntity('tasks')) throw createRestrictedAccessError('tasks');
    const doc = withOwnerFields(d);
    if (isFirebaseConfigured) {
        if (!hasDashboardPermission('tasks', 'update')) throw createDashboardPermissionError('tasks', 'update');
        if (isFirebaseUserAuthenticated()) {
            try {
                return await dashboardApiRequest('PATCH', 'tasks', id, doc);
            } catch (error) {
                if (!isDashboardApiUnavailableError(error)) throw normalizeDashboardApiError(error, 'tasks', 'update');
            }
        }
    }
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
    if (!canAccessEntity('tasks')) throw createRestrictedAccessError('tasks');
    if (isFirebaseConfigured) {
        if (!hasDashboardPermission('tasks', 'delete')) throw createDashboardPermissionError('tasks', 'delete');
        if (isFirebaseUserAuthenticated()) {
            try {
                await dashboardApiRequest('DELETE', 'tasks', id);
                return;
            } catch (error) {
                if (!isDashboardApiUnavailableError(error)) throw normalizeDashboardApiError(error, 'tasks', 'delete');
            }
        }
    }
    if (!isFirebaseConfigured) {
        const records = getLocalEntityData('tasks').filter(t => t.id !== id);
        setLocalEntityData('tasks', records);
        return;
    }
    try {
        await db.collection('tasks').doc(id).delete();
    } catch (error) {
        if (!shouldUseLocalEntityFallback(error)) throw error;
    }
    const records = getLocalEntityData('tasks').filter(t => t.id !== id);
    setLocalEntityData('tasks', records);
}

async function fetchInvoices() {
    if (!canAccessEntity('invoices')) return [];
    if (!isFirebaseConfigured) return createAccessFilteredDataset('invoices', sampleInvoices);
    try {
        if (isFirebaseUserAuthenticated()) {
            try {
                const records = await dashboardApiRequest('GET', 'invoices');
                return Array.isArray(records) ? records : [];
            } catch (error) {
                if (!isDashboardApiUnavailableError(error)) throw normalizeDashboardApiError(error, 'invoices', 'update');
            }
        }
        const ownerKey = getCurrentOwnerKey();
        if (!ownerKey) return [];
        const snap = await db.collection('invoices').where('owner_key', '==', ownerKey).get();
        return mergeEntityCollections(
            _snap(snap).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)),
            getLocalEntityData('invoices')
        ).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    } catch (e) { console.error(e); return getLocalEntityData('invoices'); }
}

async function addInvoice(d) {
    if (!canAccessEntity('invoices')) throw createRestrictedAccessError('invoices');
    const doc = { ...withOwnerFields(d), created_at: new Date().toISOString() };
    if (isFirebaseConfigured) {
        if (!hasDashboardPermission('invoices', 'create')) throw createDashboardPermissionError('invoices', 'create');
        if (isFirebaseUserAuthenticated()) {
            try {
                return await dashboardApiRequest('POST', 'invoices', '', doc);
            } catch (error) {
                if (!isDashboardApiUnavailableError(error)) throw normalizeDashboardApiError(error, 'invoices', 'create');
            }
        }
    }
    if (!isFirebaseConfigured) {
        const records = getLocalEntityData('invoices');
        const r = { ...doc, id: 'i' + Date.now() };
        records.unshift(r);
        setLocalEntityData('invoices', records);
        return r;
    }
    try {
        const ref = await db.collection('invoices').add(doc);
        return { id: ref.id, ...doc };
    } catch (error) {
        if (shouldUseLocalEntityFallback(error)) {
            const records = getLocalEntityData('invoices');
            const r = { ...doc, id: 'i' + Date.now(), storage_fallback: true };
            records.unshift(r);
            setLocalEntityData('invoices', records);
            return r;
        }
        throw error;
    }
}

async function updateInvoiceStatus(id, status, paidDate = null) {
    if (!canAccessEntity('invoices')) throw createRestrictedAccessError('invoices');
    const upd = withOwnerFields({ status, ...(paidDate ? { paid_date: paidDate } : {}) });
    if (isFirebaseConfigured) {
        if (!hasDashboardPermission('invoices', 'update')) throw createDashboardPermissionError('invoices', 'update');
        if (isFirebaseUserAuthenticated()) {
            try {
                await dashboardApiRequest('PATCH', 'invoices', id, upd);
                return;
            } catch (error) {
                if (!isDashboardApiUnavailableError(error)) throw normalizeDashboardApiError(error, 'invoices', 'update');
            }
        }
    }
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
    if (isFirebaseConfigured) {
        if (!hasDashboardPermission('invoices', 'delete')) throw createDashboardPermissionError('invoices', 'delete');
        if (isFirebaseUserAuthenticated()) {
            try {
                await dashboardApiRequest('DELETE', 'invoices', id);
                return;
            } catch (error) {
                if (!isDashboardApiUnavailableError(error)) throw normalizeDashboardApiError(error, 'invoices', 'delete');
            }
        }
    }
    if (!isFirebaseConfigured) {
        const records = getLocalEntityData('invoices').filter(inv => inv.id !== id);
        setLocalEntityData('invoices', records);
        return;
    }
    try {
        await db.collection('invoices').doc(id).delete();
    } catch (error) {
        if (!shouldUseLocalEntityFallback(error)) throw error;
    }
    const records = getLocalEntityData('invoices').filter(inv => inv.id !== id);
    setLocalEntityData('invoices', records);
}

async function fetchServices() {
    if (!canAccessEntity('services')) return [];
    if (!isFirebaseConfigured) return createAccessFilteredDataset('services', sampleServices);
    try {
        if (isFirebaseUserAuthenticated()) {
            try {
                const records = await dashboardApiRequest('GET', 'services');
                return Array.isArray(records) ? records : [];
            } catch (error) {
                if (!isDashboardApiUnavailableError(error)) throw normalizeDashboardApiError(error, 'services', 'update');
            }
        }
        const ownerKey = getCurrentOwnerKey();
        if (!ownerKey) return [];
        const snap = await db.collection('services').where('owner_key', '==', ownerKey).get();
        return mergeEntityCollections(_snap(snap), getLocalEntityData('services'));
    } catch (e) { console.error(e); return getLocalEntityData('services'); }
}

async function addService(d) {
    if (!canAccessEntity('services')) throw createRestrictedAccessError('services');
    const doc = { ...withOwnerFields(d), created_at: new Date().toISOString() };
    if (isFirebaseConfigured) {
        if (!hasDashboardPermission('services', 'create')) throw createDashboardPermissionError('services', 'create');
        if (isFirebaseUserAuthenticated()) {
            try {
                return await dashboardApiRequest('POST', 'services', '', doc);
            } catch (error) {
                if (!isDashboardApiUnavailableError(error)) throw normalizeDashboardApiError(error, 'services', 'create');
            }
        }
    }
    if (!isFirebaseConfigured) {
        const records = getLocalEntityData('services');
        const r = { ...doc, id: 's' + Date.now() };
        records.push(r);
        setLocalEntityData('services', records);
        return r;
    }
    try {
        const ref = await db.collection('services').add(doc);
        return { id: ref.id, ...doc };
    } catch (error) {
        if (shouldUseLocalEntityFallback(error)) {
            const records = getLocalEntityData('services');
            const r = { ...doc, id: 's' + Date.now(), storage_fallback: true };
            records.push(r);
            setLocalEntityData('services', records);
            return r;
        }
        throw error;
    }
}

async function updateService(id, d) {
    if (!canAccessEntity('services')) throw createRestrictedAccessError('services');
    const doc = withOwnerFields(d);
    if (isFirebaseConfigured) {
        if (!hasDashboardPermission('services', 'update')) throw createDashboardPermissionError('services', 'update');
        if (isFirebaseUserAuthenticated()) {
            try {
                return await dashboardApiRequest('PATCH', 'services', id, doc);
            } catch (error) {
                if (!isDashboardApiUnavailableError(error)) throw normalizeDashboardApiError(error, 'services', 'update');
            }
        }
    }
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
    if (isFirebaseConfigured) {
        if (!hasDashboardPermission('services', 'delete')) throw createDashboardPermissionError('services', 'delete');
        if (isFirebaseUserAuthenticated()) {
            try {
                await dashboardApiRequest('DELETE', 'services', id);
                return;
            } catch (error) {
                if (!isDashboardApiUnavailableError(error)) throw normalizeDashboardApiError(error, 'services', 'delete');
            }
        }
    }
    if (!isFirebaseConfigured) {
        const records = getLocalEntityData('services').filter(s => s.id !== id);
        setLocalEntityData('services', records);
        return;
    }
    try {
        await db.collection('services').doc(id).delete();
    } catch (error) {
        if (!shouldUseLocalEntityFallback(error)) throw error;
    }
    const records = getLocalEntityData('services').filter(s => s.id !== id);
    setLocalEntityData('services', records);
}

async function fetchTeamMembers() {
    if (!canAccessEntity('team')) return [];
    if (!isFirebaseConfigured) return createAccessFilteredDataset('team_members', sampleTeamMembers);
    try {
        if (isFirebaseUserAuthenticated()) {
            try {
                const records = await dashboardApiRequest('GET', 'team_members');
                return Array.isArray(records) ? records : [];
            } catch (error) {
                if (!isDashboardApiUnavailableError(error)) throw normalizeDashboardApiError(error, 'team', 'update');
            }
        }
        const ownerKey = getCurrentOwnerKey();
        if (!ownerKey) return [];
        const snap = await db.collection('team_members').where('owner_key', '==', ownerKey).get();
        return mergeEntityCollections(_snap(snap), getLocalEntityData('team_members'));
    } catch (e) { console.error(e); return getLocalEntityData('team_members'); }
}

async function addTeamMember(d) {
    if (!canAccessEntity('team')) throw createRestrictedAccessError('team');
    const doc = { ...withOwnerFields(d), created_at: new Date().toISOString() };
    if (isFirebaseConfigured) {
        if (!hasDashboardPermission('team', 'create')) throw createDashboardPermissionError('team', 'create');
        if (isFirebaseUserAuthenticated()) {
            try {
                return await dashboardApiRequest('POST', 'team_members', '', doc);
            } catch (error) {
                if (!isDashboardApiUnavailableError(error)) throw normalizeDashboardApiError(error, 'team', 'create');
            }
        }
    }
    if (!isFirebaseConfigured) {
        const records = getLocalEntityData('team_members');
        const r = { ...doc, id: 'm' + Date.now() };
        records.push(r);
        setLocalEntityData('team_members', records);
        return r;
    }
    try {
        const ref = await db.collection('team_members').add(doc);
        return { id: ref.id, ...doc };
    } catch (error) {
        if (shouldUseLocalEntityFallback(error)) {
            const records = getLocalEntityData('team_members');
            const r = { ...doc, id: 'm' + Date.now(), storage_fallback: true };
            records.push(r);
            setLocalEntityData('team_members', records);
            return r;
        }
        throw error;
    }
}

async function updateTeamMember(id, d) {
    if (!canAccessEntity('team')) throw createRestrictedAccessError('team');
    const doc = withOwnerFields(d);
    if (isFirebaseConfigured) {
        if (!hasDashboardPermission('team', 'update')) throw createDashboardPermissionError('team', 'update');
        if (isFirebaseUserAuthenticated()) {
            try {
                return await dashboardApiRequest('PATCH', 'team_members', id, doc);
            } catch (error) {
                if (!isDashboardApiUnavailableError(error)) throw normalizeDashboardApiError(error, 'team', 'update');
            }
        }
    }
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
    if (isFirebaseConfigured) {
        if (!hasDashboardPermission('team', 'delete')) throw createDashboardPermissionError('team', 'delete');
        if (isFirebaseUserAuthenticated()) {
            try {
                await dashboardApiRequest('DELETE', 'team_members', id);
                return;
            } catch (error) {
                if (!isDashboardApiUnavailableError(error)) throw normalizeDashboardApiError(error, 'team', 'delete');
            }
        }
    }
    if (!isFirebaseConfigured) {
        const records = getLocalEntityData('team_members').filter(m => m.id !== id);
        setLocalEntityData('team_members', records);
        return;
    }
    try {
        await db.collection('team_members').doc(id).delete();
    } catch (error) {
        if (!shouldUseLocalEntityFallback(error)) throw error;
    }
    const records = getLocalEntityData('team_members').filter(m => m.id !== id);
    setLocalEntityData('team_members', records);
}

async function logActivity(description, userName = 'Admin') {
    if (!isFirebaseConfigured) return;
    await db.collection('activity_log').add({
        description,
        user_name: userName,
        created_at: new Date().toISOString()
    });
}

const GBP_SYMBOL = '£';
const INR_TO_GBP_RATE = 1 / 123.5;

function formatCurrency(n) {
    return new Intl.NumberFormat('en-IE', {
        style: 'currency',
        currency: DEFAULT_PLAN_CURRENCY,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(Number(n) || 0);
}

function convertInrToGbp(value) {
    return Math.round((Number(value) || 0) * INR_TO_GBP_RATE);
}

function migrateLocalCurrencyToGbp() {
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
                        updatedRecord[field] = convertInrToGbp(updatedRecord[field]);
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
    { id: '1', name: 'Rahul Sharma', email: 'rahul@techvision.in', company: 'TechVision Pvt Ltd', domain_name: 'techvision.in', hosting_provider: 'Hostinger', project_type: 'Business Website', platform: 'WordPress', hosting_expiry: '2025-08-15', ssl_expiry: '2025-08-15', maintenance_plan: 'Monthly', total_contract_value: 500, paid_amount: 389, plan_type: 'Premium' },
    { id: '2', name: 'Priya Mehta', email: 'priya@shopkart.in', company: 'ShopKart India', domain_name: 'shopkart.in', hosting_provider: 'AWS', project_type: 'Ecommerce Website', platform: 'Shopify', hosting_expiry: '2025-12-20', ssl_expiry: '2025-10-10', maintenance_plan: 'Annual', total_contract_value: 944, paid_amount: 944, plan_type: 'Premium' },
    { id: '3', name: 'Amit Kumar', email: 'amit@startuphub.com', company: 'StartupHub', domain_name: 'startuphub.com', hosting_provider: 'GoDaddy', project_type: 'Landing Page', platform: 'Custom', hosting_expiry: '2026-01-30', ssl_expiry: '2026-01-30', maintenance_plan: 'None', total_contract_value: 167, paid_amount: 167, plan_type: 'Basic' },
    { id: '4', name: 'Sunita Patel', email: 'sunita@fashionhub.in', company: 'FashionHub', domain_name: 'fashionhub.in', hosting_provider: 'Bluehost', project_type: 'Ecommerce Website', platform: 'WooCommerce', hosting_expiry: '2025-07-01', ssl_expiry: '2025-07-01', maintenance_plan: 'Monthly', total_contract_value: 722, paid_amount: 444, plan_type: 'Custom' },
    { id: '5', name: 'Vikram Singh', email: 'vikram@digitaledge.in', company: 'Digital Edge', domain_name: 'digitaledge.in', hosting_provider: 'SiteGround', project_type: 'Business Website', platform: 'WordPress', hosting_expiry: '2025-09-15', ssl_expiry: '2025-09-15', maintenance_plan: 'Monthly', total_contract_value: 333, paid_amount: 167, plan_type: 'Basic' }
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
    migrateLocalCurrencyToGbp();
    syncAccessUiState();
});

window.addEventListener('pageshow', syncAccessUiState);
window.addEventListener('focus', syncAccessUiState);
window.addEventListener('storage', syncAccessUiState);
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncAccessUiState();
});
