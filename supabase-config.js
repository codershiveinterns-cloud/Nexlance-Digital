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
const AUTH_NOTICE_KEY = 'nexlance_auth_notice';
const AUTH_REDIRECT_LOCK_KEY = 'nexlance_auth_redirecting';

function isAuthEntryPage(pageName = getCurrentPageName()) {
    const normalizedPage = String(pageName || '').trim().toLowerCase();
    return normalizedPage === 'login.html'
        || normalizedPage === 'admin-login.html'
        || normalizedPage === 'reset-password.html'
        || normalizedPage === 'auth-action.html';
}

function clearAuthRedirectLock() {
    try {
        sessionStorage.removeItem(AUTH_REDIRECT_LOCK_KEY);
    } catch (error) {
        // no-op
    }
}

function clearStaleLocalAuthState() {
    try {
        localStorage.removeItem('nexlance_auth');
        localStorage.removeItem('nexlance_user');
        localStorage.removeItem('nexlance_admin_ui');
        clearSessionRuntime('auth_state_cleared');
    } catch (error) {
        // no-op
    }
}

function getCurrentLocationForLoginRedirect() {
    const pathname = String(window.location.pathname || '');
    const search = String(window.location.search || '');
    const hash = String(window.location.hash || '');
    const target = `${pathname}${search}${hash}`.trim();
    return target || 'dashboard.html';
}

function redirectToLoginForAuthMismatch(message = 'Your login session expired. Please sign in again to continue.') {
    if (typeof window === 'undefined') return false;

    const pageName = getCurrentPageName();
    if (isAuthEntryPage(pageName)) {
        clearAuthRedirectLock();
        return false;
    }

    try {
        if (sessionStorage.getItem(AUTH_REDIRECT_LOCK_KEY) === '1') {
            return true;
        }
        sessionStorage.setItem(AUTH_REDIRECT_LOCK_KEY, '1');
        sessionStorage.setItem(AUTH_NOTICE_KEY, message);
    } catch (error) {
        // no-op
    }

    clearStaleLocalAuthState();

    const redirectTarget = getCurrentLocationForLoginRedirect();
    window.location.href = `login.html?redirect=${encodeURIComponent(redirectTarget)}`;
    return true;
}

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

const SESSION_STORAGE_KEY = 'nexlance_user';
const SESSION_META_KEY = '__sessionMeta';
const SESSION_UPDATE_SOURCE = {
    API_ME: 'api_me',
    BOOTSTRAP_CACHE: 'bootstrap_cache',
    STORAGE_EVENT: 'storage_event',
    AUTH_FLOW: 'auth_flow',
    UNKNOWN: 'unknown'
};
const SESSION_SCOPE_FIELDS = ['workspaceId', 'assignedProjectIds', 'allProjectsAccess', 'projectAccessScope'];
const SESSION_RUNTIME = {
    currentUser: null,
    scopeVersion: 0,
    isHydrated: false,
    hydrationCompleted: false,
    hydrationPromise: null,
    hydrationError: null,
    requestCounter: 0,
    latestRequestedRequestId: 0,
    lastAppliedRequestId: 0,
    inFlightRefreshPromise: null,
    activeRefreshAbortController: null,
    assignmentsValidatedByBackend: false
};
const TEAM_UPDATE_RUNTIME = {
    active: false,
    startedAt: 0,
    reason: ''
};

function normalizeSessionRole(user = {}) {
    return String(user.role || user.workspaceRole || user.dashboardRole || '').trim().toLowerCase();
}

function isTeamUpdateCacheBypassActive() {
    return TEAM_UPDATE_RUNTIME.active === true;
}

function readStoredSessionUser() {
    try {
        return JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || 'null');
    } catch (error) {
        return null;
    }
}

function getSessionMeta(user = {}) {
    return user && typeof user === 'object' && user[SESSION_META_KEY] && typeof user[SESSION_META_KEY] === 'object'
        ? user[SESSION_META_KEY]
        : {};
}

function getSessionVersion(user = {}) {
    const version = Number(getSessionMeta(user).version);
    return Number.isFinite(version) && version > 0 ? version : 0;
}

function getSessionUpdatedAtMs(user = {}) {
    const meta = getSessionMeta(user);
    const value = meta.updatedAt || user.updatedAt || user.updated_at || '';
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function getAssignmentStateVersion(user = {}) {
    const meta = getSessionMeta(user);
    const value = Number(meta.assignmentVersion || user.assignmentStateVersion || user.assignment_state_version || 0);
    return Number.isFinite(value) && value > 0 ? value : 0;
}

function getAssignmentStateUpdatedAtMs(user = {}) {
    const meta = getSessionMeta(user);
    const value = meta.assignmentUpdatedAt || user.assignmentStateUpdatedAt || user.assignment_state_updated_at || '';
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeScopeProjectIds(projectIds) {
    const source = Array.isArray(projectIds) ? projectIds : [];
    const fallback = source.map(projectId => String(projectId || '').trim()).filter(Boolean);
    const accessControl = getAccessControl();
    return accessControl ? accessControl.sanitizeAssignedProjectIds(source) : fallback;
}

function normalizeSessionScope(user = {}) {
    const allProjectsAccess = Boolean(
        user.allProjectsAccess === true
        || user.all_projects_access === true
        || String(user.projectAccessScope || user.project_access_scope || '').trim().toLowerCase() === 'all'
    );
    const assignedProjectIds = allProjectsAccess
        ? []
        : normalizeScopeProjectIds(
            user.assignedProjectIds !== undefined
                ? user.assignedProjectIds
                : user.assigned_project_ids
        );
    const workspaceId = String(user.workspaceId || user.workspace_id || '').trim();
    return {
        workspaceId,
        assignedProjectIds,
        allProjectsAccess,
        projectAccessScope: allProjectsAccess ? 'all' : 'selected'
    };
}

function buildSessionScopeHash(user = {}) {
    const scope = normalizeSessionScope(user);
    return JSON.stringify({
        workspaceId: scope.workspaceId,
        assignedProjectIds: scope.assignedProjectIds.slice().sort(),
        allProjectsAccess: scope.allProjectsAccess,
        projectAccessScope: scope.projectAccessScope
    });
}

function buildSessionFingerprint(user = {}) {
    const scope = normalizeSessionScope(user);
    return JSON.stringify({
        uid: String(user.uid || '').trim(),
        email: normalizeEmail(user.email),
        role: String(user.role || user.workspaceRole || '').trim().toLowerCase(),
        workspaceId: scope.workspaceId,
        assignedProjectIds: scope.assignedProjectIds.slice().sort(),
        allProjectsAccess: scope.allProjectsAccess,
        projectAccessScope: scope.projectAccessScope,
        membershipStatus: String(user.membershipStatus || '').trim().toLowerCase()
    });
}

function withSessionMeta(user = {}, meta = {}) {
    return {
        ...user,
        [SESSION_META_KEY]: {
            ...getSessionMeta(user),
            ...meta
        }
    };
}

function clearSessionRuntime(reason = 'clear') {
    SESSION_RUNTIME.currentUser = null;
    SESSION_RUNTIME.scopeVersion = 0;
    SESSION_RUNTIME.isHydrated = false;
    SESSION_RUNTIME.hydrationCompleted = false;
    SESSION_RUNTIME.hydrationPromise = null;
    SESSION_RUNTIME.hydrationError = null;
    SESSION_RUNTIME.latestRequestedRequestId = 0;
    SESSION_RUNTIME.lastAppliedRequestId = 0;
    SESSION_RUNTIME.inFlightRefreshPromise = null;
    if (SESSION_RUNTIME.activeRefreshAbortController) {
        try {
            SESSION_RUNTIME.activeRefreshAbortController.abort();
        } catch (error) {
            // no-op
        }
    }
    SESSION_RUNTIME.activeRefreshAbortController = null;
    stopRealtimeWorkspaceSync(`session_runtime_clear:${reason}`);
    console.info('[SessionState] Runtime cleared', { reason });
}

function applySessionUserUpdate({
    source = SESSION_UPDATE_SOURCE.UNKNOWN,
    nextUser = null,
    requestId = 0,
    persist = true,
    force = false
} = {}) {
    const candidate = nextUser && typeof nextUser === 'object' ? { ...nextUser } : null;
    if (!candidate) {
        console.warn('[SessionState] Rejected session update', { source, reason: 'missing_candidate' });
        return { accepted: false, reason: 'missing_candidate', changed: false, user: SESSION_RUNTIME.currentUser };
    }

    const currentUser = SESSION_RUNTIME.currentUser || null;
    const isAuthoritativeSource = source === SESSION_UPDATE_SOURCE.API_ME;
    const scopeSource = isAuthoritativeSource ? candidate : (currentUser || {});
    const trustedScope = normalizeSessionScope(scopeSource);
    const trustedRole = isAuthoritativeSource
        ? String(candidate.role || candidate.workspaceRole || candidate.dashboardRole || '').trim()
        : String(currentUser && (currentUser.role || currentUser.workspaceRole || currentUser.dashboardRole) || '').trim();
    const trustedPermissions = isAuthoritativeSource
        ? (candidate.permissions && typeof candidate.permissions === 'object' ? candidate.permissions : (currentUser && currentUser.permissions) || {})
        : ((currentUser && currentUser.permissions) || {});
    const trustedPermissionKeys = isAuthoritativeSource
        ? (Array.isArray(candidate.permissionKeys) ? candidate.permissionKeys : [])
        : (Array.isArray(currentUser && currentUser.permissionKeys) ? currentUser.permissionKeys : []);
    const trustedPermissionMode = isAuthoritativeSource
        ? String(candidate.permissionMode || candidate.permission_mode || '').trim().toLowerCase() || 'default'
        : String(currentUser && currentUser.permissionMode || 'default').trim().toLowerCase();
    const projectedCandidate = {
        ...(currentUser || {}),
        ...candidate,
        role: trustedRole,
        workspaceRole: trustedRole || String(currentUser && currentUser.workspaceRole || '').trim(),
        isWorkspaceOwner: isAuthoritativeSource
            ? Boolean(candidate.isWorkspaceOwner)
            : Boolean(currentUser && currentUser.isWorkspaceOwner),
        permissionKeys: trustedPermissionKeys,
        permissions: trustedPermissions,
        permissionMode: trustedPermissionMode,
        workspaceId: trustedScope.workspaceId,
        workspace_id: trustedScope.workspaceId,
        assignedProjectIds: trustedScope.assignedProjectIds,
        assigned_project_ids: trustedScope.assignedProjectIds,
        allProjectsAccess: trustedScope.allProjectsAccess,
        all_projects_access: trustedScope.allProjectsAccess,
        projectAccessScope: trustedScope.projectAccessScope,
        project_access_scope: trustedScope.projectAccessScope
    };
    const currentFingerprint = buildSessionFingerprint(currentUser || {});
    const nextFingerprint = buildSessionFingerprint(projectedCandidate);
    const previousScopeHash = buildSessionScopeHash(currentUser || {});
    const nextScopeHash = buildSessionScopeHash(projectedCandidate);
    const scopeChanged = previousScopeHash !== nextScopeHash;
    const previousRole = normalizeSessionRole(currentUser || {});
    const nextRole = normalizeSessionRole(projectedCandidate);
    const roleChanged = previousRole !== nextRole;
    const incomingVersion = getSessionVersion(candidate);
    const currentVersion = Math.max(SESSION_RUNTIME.scopeVersion, getSessionVersion(currentUser || {}));
    const incomingUpdatedAtMs = getSessionUpdatedAtMs(candidate);
    const currentUpdatedAtMs = getSessionUpdatedAtMs(currentUser || {});
    const incomingAssignmentVersionRaw = getAssignmentStateVersion(candidate);
    const currentAssignmentVersion = getAssignmentStateVersion(currentUser || {});
    const incomingAssignmentUpdatedAtMsRaw = getAssignmentStateUpdatedAtMs(candidate);
    const currentAssignmentUpdatedAtMs = getAssignmentStateUpdatedAtMs(currentUser || {});
    const effectiveIncomingAssignmentVersion = incomingAssignmentVersionRaw > 0
        ? incomingAssignmentVersionRaw
        : currentAssignmentVersion;
    const effectiveIncomingAssignmentUpdatedAtMs = incomingAssignmentUpdatedAtMsRaw > 0
        ? incomingAssignmentUpdatedAtMsRaw
        : (incomingUpdatedAtMs > 0 ? incomingUpdatedAtMs : currentAssignmentUpdatedAtMs);

    if (source === SESSION_UPDATE_SOURCE.API_ME && Number(requestId) > 0 && Number(requestId) < Number(SESSION_RUNTIME.lastAppliedRequestId || 0)) {
        console.info('[SessionState] Rejected session update', { source, reason: 'stale_request', requestId, latestRequestId: SESSION_RUNTIME.lastAppliedRequestId });
        return { accepted: false, reason: 'stale_request', changed: false, user: currentUser };
    }

    if (
        source === SESSION_UPDATE_SOURCE.API_ME
        && Number(requestId) > 0
        && Number(SESSION_RUNTIME.latestRequestedRequestId || 0) > 0
        && Number(requestId) < Number(SESSION_RUNTIME.latestRequestedRequestId || 0)
    ) {
        console.info('[SessionState] Rejected session update', {
            source,
            reason: 'superseded_by_newer_request',
            requestId,
            latestRequestedRequestId: SESSION_RUNTIME.latestRequestedRequestId
        });
        return { accepted: false, reason: 'stale_request', changed: false, user: currentUser };
    }

    if (
        source !== SESSION_UPDATE_SOURCE.API_ME
        && SESSION_RUNTIME.isHydrated
        && scopeChanged
        && !force
    ) {
        console.info('[SessionState] Rejected session update', {
            source,
            reason: 'non_api_scope_overwrite_blocked',
            scopeFields: SESSION_SCOPE_FIELDS
        });
        return { accepted: false, reason: 'non_api_scope_overwrite_blocked', changed: false, user: currentUser };
    }

    if (
        source === SESSION_UPDATE_SOURCE.STORAGE_EVENT
        && incomingVersion > 0
        && incomingVersion < currentVersion
    ) {
        console.info('[SessionState] Rejected session update', {
            source,
            reason: 'older_storage_version',
            incomingVersion,
            currentVersion
        });
        return { accepted: false, reason: 'older_storage_version', changed: false, user: currentUser };
    }

    if (source === SESSION_UPDATE_SOURCE.STORAGE_EVENT) {
        const isNewerVersion = incomingVersion > currentVersion;
        const isNewerTimestamp = incomingUpdatedAtMs > currentUpdatedAtMs;
        if (!isNewerVersion && !isNewerTimestamp && currentFingerprint !== nextFingerprint) {
            console.info('[SessionState] Rejected session update', {
                source,
                reason: 'storage_update_not_newer',
                incomingVersion,
                currentVersion,
                incomingUpdatedAtMs,
                currentUpdatedAtMs
            });
            return { accepted: false, reason: 'storage_update_not_newer', changed: false, user: currentUser };
        }
    }

    if (
        source === SESSION_UPDATE_SOURCE.STORAGE_EVENT
        && SESSION_RUNTIME.isHydrated
        && incomingVersion <= 0
    ) {
        console.info('[SessionState] Rejected session update', {
            source,
            reason: 'unversioned_storage_after_hydration'
        });
        return { accepted: false, reason: 'unversioned_storage_after_hydration', changed: false, user: currentUser };
    }

    if (
        incomingUpdatedAtMs > 0
        && currentUpdatedAtMs > 0
        && incomingUpdatedAtMs < currentUpdatedAtMs
        && !force
    ) {
        console.info('[SessionState] Rejected session update', {
            source,
            reason: 'older_timestamp',
            incomingUpdatedAtMs,
            currentUpdatedAtMs
        });
        return { accepted: false, reason: 'older_timestamp', changed: false, user: currentUser };
    }

    if (scopeChanged && !force) {
        const newerByVersion = effectiveIncomingAssignmentVersion > currentAssignmentVersion;
        const sameVersion = effectiveIncomingAssignmentVersion === currentAssignmentVersion;
        const newerByTimestamp = effectiveIncomingAssignmentUpdatedAtMs > currentAssignmentUpdatedAtMs;
        if (!newerByVersion && !(sameVersion && newerByTimestamp)) {
            console.info('[SessionState] Rejected session update', {
                source,
                reason: 'stale_assignment_state',
                incomingAssignmentVersion: effectiveIncomingAssignmentVersion,
                currentAssignmentVersion,
                incomingAssignmentUpdatedAtMs: effectiveIncomingAssignmentUpdatedAtMs,
                currentAssignmentUpdatedAtMs
            });
            return { accepted: false, reason: 'stale_assignment_state', changed: false, user: currentUser };
        }
    }

    if (!force && currentFingerprint === nextFingerprint) {
        const nextIdempotentVersion = Math.max(currentVersion, incomingVersion, 1);
        const nextIdempotentUpdatedAtMs = Math.max(currentUpdatedAtMs, incomingUpdatedAtMs, 0);
        const nextIdempotentAssignmentVersion = Math.max(currentAssignmentVersion, incomingAssignmentVersionRaw, 1);
        const nextIdempotentAssignmentUpdatedAtMs = Math.max(
            currentAssignmentUpdatedAtMs,
            incomingAssignmentUpdatedAtMsRaw,
            incomingUpdatedAtMs,
            0
        );
        const shouldAdvanceFreshnessMeta = nextIdempotentVersion > currentVersion
            || nextIdempotentUpdatedAtMs > currentUpdatedAtMs
            || nextIdempotentAssignmentVersion > currentAssignmentVersion
            || nextIdempotentAssignmentUpdatedAtMs > currentAssignmentUpdatedAtMs;
        if (shouldAdvanceFreshnessMeta && currentUser) {
            const nextIdempotentUpdatedAt = new Date(nextIdempotentUpdatedAtMs > 0 ? nextIdempotentUpdatedAtMs : Date.now()).toISOString();
            const nextIdempotentAssignmentUpdatedAt = new Date(
                nextIdempotentAssignmentUpdatedAtMs > 0 ? nextIdempotentAssignmentUpdatedAtMs : Date.now()
            ).toISOString();
            const refreshedMeta = {
                ...getSessionMeta(currentUser),
                version: nextIdempotentVersion,
                updatedAt: nextIdempotentUpdatedAt,
                assignmentVersion: nextIdempotentAssignmentVersion,
                assignmentUpdatedAt: nextIdempotentAssignmentUpdatedAt,
                assignmentStateHash: nextScopeHash,
                source,
                requestId: Number(requestId) || 0
            };
            const refreshedUser = withSessionMeta({
                ...currentUser,
                assignmentStateVersion: nextIdempotentAssignmentVersion,
                assignment_state_version: nextIdempotentAssignmentVersion,
                assignmentStateUpdatedAt: nextIdempotentAssignmentUpdatedAt,
                assignment_state_updated_at: nextIdempotentAssignmentUpdatedAt
            }, refreshedMeta);
            SESSION_RUNTIME.currentUser = refreshedUser;
            SESSION_RUNTIME.scopeVersion = Math.max(SESSION_RUNTIME.scopeVersion, nextIdempotentVersion);
            if (persist) {
                localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(refreshedUser));
            }
        }
        if (source === SESSION_UPDATE_SOURCE.API_ME) {
            SESSION_RUNTIME.isHydrated = true;
            SESSION_RUNTIME.hydrationCompleted = true;
            SESSION_RUNTIME.hydrationError = null;
            SESSION_RUNTIME.lastAppliedRequestId = Math.max(SESSION_RUNTIME.lastAppliedRequestId, Number(requestId) || 0);
        } else if (source === SESSION_UPDATE_SOURCE.AUTH_FLOW) {
            SESSION_RUNTIME.isHydrated = false;
            SESSION_RUNTIME.hydrationCompleted = false;
            SESSION_RUNTIME.hydrationError = null;
        }
        console.info('[SessionState] Idempotent session update ignored', { source, requestId });
        return { accepted: true, reason: 'idempotent_no_change', changed: false, user: SESSION_RUNTIME.currentUser || currentUser };
    }

    const nextVersion = source === SESSION_UPDATE_SOURCE.API_ME
        ? Math.max(currentVersion + 1, incomingVersion + 1, 1)
        : Math.max(incomingVersion, currentVersion + 1, 1);
    const nextSessionUpdatedAtMs = Math.max(currentUpdatedAtMs, incomingUpdatedAtMs, 0);
    const nextAssignmentVersion = scopeChanged
        ? Math.max(currentAssignmentVersion + 1, effectiveIncomingAssignmentVersion, 1)
        : Math.max(currentAssignmentVersion, 1);
    const nextAssignmentUpdatedAtMs = Math.max(currentAssignmentUpdatedAtMs, effectiveIncomingAssignmentUpdatedAtMs, 0);
    const normalizedSessionUpdatedAt = new Date(nextSessionUpdatedAtMs > 0 ? nextSessionUpdatedAtMs : Date.now()).toISOString();
    const normalizedAssignmentUpdatedAt = new Date(nextAssignmentUpdatedAtMs > 0 ? nextAssignmentUpdatedAtMs : Date.now()).toISOString();
    const nextMeta = {
        ...getSessionMeta(candidate),
        version: nextVersion,
        updatedAt: normalizedSessionUpdatedAt,
        assignmentVersion: nextAssignmentVersion,
        assignmentUpdatedAt: normalizedAssignmentUpdatedAt,
        assignmentStateHash: nextScopeHash,
        source,
        requestId: Number(requestId) || 0
    };
    const nextSessionUser = withSessionMeta({
        ...projectedCandidate,
        assignmentStateVersion: nextAssignmentVersion,
        assignment_state_version: nextAssignmentVersion,
        assignmentStateUpdatedAt: normalizedAssignmentUpdatedAt,
        assignment_state_updated_at: normalizedAssignmentUpdatedAt
    }, nextMeta);

    SESSION_RUNTIME.currentUser = nextSessionUser;
    SESSION_RUNTIME.scopeVersion = nextVersion;
    if (source === SESSION_UPDATE_SOURCE.API_ME) {
        SESSION_RUNTIME.isHydrated = true;
        SESSION_RUNTIME.hydrationCompleted = true;
        SESSION_RUNTIME.hydrationError = null;
        SESSION_RUNTIME.lastAppliedRequestId = Math.max(SESSION_RUNTIME.lastAppliedRequestId, Number(requestId) || 0);
    } else if (source === SESSION_UPDATE_SOURCE.AUTH_FLOW) {
        SESSION_RUNTIME.isHydrated = false;
        SESSION_RUNTIME.hydrationCompleted = false;
        SESSION_RUNTIME.hydrationError = null;
    }

    if (persist) {
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(nextSessionUser));
    }

    const contextChanged = scopeChanged || roleChanged;
    if (contextChanged && typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        window.dispatchEvent(new CustomEvent('nexlance-session-context-changed', {
            detail: {
                source,
                requestId: Number(requestId) || 0,
                roleChanged,
                scopeChanged,
                workspaceId: trustedScope.workspaceId
            }
        }));
        window.dispatchEvent(new CustomEvent('nexlance-data-changed', {
            detail: {
                entity: 'session_context',
                source
            }
        }));
    }

    console.info('[SessionState] Accepted session update', {
        source,
        requestId: Number(requestId) || 0,
        version: nextVersion,
        workspaceId: trustedScope.workspaceId,
        assignedProjectIds: trustedScope.assignedProjectIds
    });
    return { accepted: true, reason: 'applied', changed: true, user: nextSessionUser };
}

function initializeSessionRuntimeFromCache() {
    const cachedUser = readStoredSessionUser();
    if (cachedUser && typeof cachedUser === 'object') {
        const bootstrapResult = applySessionUserUpdate({
            source: SESSION_UPDATE_SOURCE.BOOTSTRAP_CACHE,
            nextUser: cachedUser,
            persist: false,
            force: true
        });
        SESSION_RUNTIME.currentUser = bootstrapResult.user || null;
        SESSION_RUNTIME.scopeVersion = getSessionVersion(bootstrapResult.user || {});
    }
    SESSION_RUNTIME.assignmentsValidatedByBackend = false;
    const cachedAssignedProjectIds = SESSION_RUNTIME.currentUser
        ? normalizeScopeProjectIds(
            SESSION_RUNTIME.currentUser.assignedProjectIds !== undefined
                ? SESSION_RUNTIME.currentUser.assignedProjectIds
                : SESSION_RUNTIME.currentUser.assigned_project_ids
        )
        : [];
    console.warn('[SessionState] App boot cache snapshot - ASSIGNMENTS NOT VALIDATED BY BACKEND', {
        hasCachedUser: Boolean(cachedUser),
        workspaceId: String(SESSION_RUNTIME.currentUser && (SESSION_RUNTIME.currentUser.workspaceId || SESSION_RUNTIME.currentUser.workspace_id) || '').trim(),
        assignedProjectIds: cachedAssignedProjectIds,
        requiresBackendValidation: true,
        validationRequiredBeforeUse: true
    });
}

initializeSessionRuntimeFromCache();

// Clear legacy stale cache keys on boot — prevents deleted records from reappearing
try {
    const legacyKey = 'nexlance_projects';
    const legacyData = localStorage.getItem(legacyKey);
    if (legacyData) {
        console.info('[SessionState] Clearing legacy nexlance_projects cache on boot');
        localStorage.removeItem(legacyKey);
    }
} catch (e) { /* no-op */ }

function getCurrentSessionUser() {
    return SESSION_RUNTIME.currentUser;
}

async function beginTeamUpdateCacheBypass(teamMemberId = '') {
    TEAM_UPDATE_RUNTIME.active = true;
    TEAM_UPDATE_RUNTIME.startedAt = Date.now();
    TEAM_UPDATE_RUNTIME.reason = `team_member_update_${String(teamMemberId || '').trim() || 'unknown'}`;
    console.info('[SessionState] Team update cache bypass enabled', {
        teamMemberId: String(teamMemberId || '').trim(),
        reason: TEAM_UPDATE_RUNTIME.reason
    });

    if (!isFirebaseUserAuthenticated()) return;
    const refreshedUser = await refreshCurrentSessionUserFromApi({
        reason: `${TEAM_UPDATE_RUNTIME.reason}_prefetch`
    });
    if (!refreshedUser || typeof refreshedUser !== 'object') {
        const error = new Error('Unable to refresh backend session before team member update.');
        error.code = 'session_prefetch_failed';
        throw error;
    }
}

function endTeamUpdateCacheBypass(reason = 'team_update_complete') {
    if (!TEAM_UPDATE_RUNTIME.active) return;
    const durationMs = TEAM_UPDATE_RUNTIME.startedAt
        ? Math.max(0, Date.now() - TEAM_UPDATE_RUNTIME.startedAt)
        : 0;
    console.info('[SessionState] Team update cache bypass disabled', {
        reason,
        durationMs
    });
    TEAM_UPDATE_RUNTIME.active = false;
    TEAM_UPDATE_RUNTIME.startedAt = 0;
    TEAM_UPDATE_RUNTIME.reason = '';
}

function writeSessionFromAuthFlow(sessionUser = {}, options = {}) {
    return applySessionUserUpdate({
        source: SESSION_UPDATE_SOURCE.AUTH_FLOW,
        nextUser: sessionUser,
        persist: options.persist !== false,
        force: options.force === true
    });
}

function hardRefreshSessionFromServer(reason = 'manual_hard_refresh') {
    SESSION_RUNTIME.assignmentsValidatedByBackend = false;
    console.info('[SessionDebug] hardRefreshSessionFromServer - starting validation from backend', {
        reason,
        previousValidationStatus: SESSION_RUNTIME.assignmentsValidatedByBackend,
        currentAssignedProjectIds: SESSION_RUNTIME.currentUser ? (SESSION_RUNTIME.currentUser.assignedProjectIds || SESSION_RUNTIME.currentUser.assigned_project_ids || []) : [],
        timestamp: new Date().toISOString()
    });
    return refreshCurrentSessionUserFromApi({ reason });
}

if (typeof window !== 'undefined') {
    window.NexlanceSessionState = {
        writeSessionFromAuthFlow,
        hardRefreshSessionFromServer,
        ensureSessionHydration,
        getCurrentSessionUser,
        forceProjectAssignmentSync: async () => {
            try {
                console.info('[ForceSync] Starting background project assignment sync');
                const token = await getDashboardBearerToken();
                const response = await fetch('/api/sync-project-assignments', {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });
                const data = await response.json();
                console.info('[ForceSync] Background sync complete', {
                    assignedProjectIds: data.assignedProjectIds
                });
                await hardRefreshSessionFromServer('invitation_accept_sync');
                return data;
            } catch (error) {
                console.warn('[ForceSync] Background sync failed:', error.message);
                await hardRefreshSessionFromServer('invitation_accept_fallback');
                return { assignedProjectIds: [] };
            }
        }
    };
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
    const permissionMode = String(user.permissionMode || user.permission_mode || '').trim().toLowerCase();
    const normalizedRole = normalizeDashboardRole(user.role || user.workspaceRole || user.dashboardRole || 'admin');
    const derivedPermissions = accessControl
        ? accessControl.getPermissionMatrix({
            ...user,
            role: normalizedRole,
            workspaceRole: normalizedRole
        })
        : getDefaultDashboardPermissions(normalizedRole, Boolean(user.isWorkspaceOwner));
    const mergePermissionGroup = (key) => {
        const derivedGroup = derivedPermissions && typeof derivedPermissions[key] === 'object' ? derivedPermissions[key] : {};
        const explicitGroup = user.permissions && typeof user.permissions[key] === 'object' ? user.permissions[key] : {};
        const actions = new Set([...Object.keys(derivedGroup), ...Object.keys(explicitGroup)]);
        return Array.from(actions).reduce((accumulator, action) => {
            accumulator[action] = Boolean(derivedGroup[action] || explicitGroup[action]);
            return accumulator;
        }, {});
    };
    const permissions = permissionMode === 'explicit'
        ? derivedPermissions
        : (user.permissions && typeof user.permissions === 'object'
        ? {
            ...derivedPermissions,
            projects: mergePermissionGroup('projects'),
            tasks: mergePermissionGroup('tasks'),
            clients: mergePermissionGroup('clients'),
            invoices: mergePermissionGroup('invoices'),
            services: mergePermissionGroup('services'),
            team: mergePermissionGroup('team')
        }
        : derivedPermissions);
    return {
        role: normalizedRole,
        permissionKeys: accessControl ? accessControl.getAuthenticatedPermissionKeys(user) : [],
        isWorkspaceOwner: Boolean(user.isWorkspaceOwner),
        permissionMode: permissionMode === 'explicit' ? 'explicit' : 'default',
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
        clients: action === 'read' ? 'view clients' : 'manage clients',
        invoices: action === 'read' ? 'view invoices' : 'manage invoices',
        projects: action === 'read' ? 'view projects' : 'manage projects',
        services: action === 'read' ? 'view services' : 'manage services',
        tasks: action === 'read' ? 'view tasks' : 'manage tasks',
        team: action === 'read' ? 'view team members' : 'manage team members'
    };
    const actionLabel = action === 'create'
        ? 'create'
        : (action === 'delete'
            ? 'delete'
            : (action === 'read' ? 'view' : 'update'));
    return new Error(`You do not have permission to ${actionLabel} ${labels[entity] || entity}. Sign in with an owner/admin account or update the user's role in Firestore.`);
}

function isFirebaseUserAuthenticated() {
    return Boolean(typeof firebase !== 'undefined' && firebase.auth && firebase.auth().currentUser);
}

async function waitForFirebaseAuthSession(timeoutMs = 1800) {
    if (!(typeof firebase !== 'undefined' && firebase.auth)) {
        return null;
    }

    const authInstance = firebase.auth();
    if (authInstance.currentUser) {
        return authInstance.currentUser;
    }

    return new Promise(resolve => {
        let settled = false;
        let unsubscribe = null;

        const finish = user => {
            if (settled) return;
            settled = true;
            if (typeof unsubscribe === 'function') {
                try {
                    unsubscribe();
                } catch (error) {
                    // no-op
                }
            }
            resolve(user || null);
        };

        const timer = window.setTimeout(() => finish(authInstance.currentUser || null), Math.max(Number(timeoutMs) || 0, 0));
        unsubscribe = authInstance.onAuthStateChanged(
            user => {
                window.clearTimeout(timer);
                finish(user || null);
            },
            () => {
                window.clearTimeout(timer);
                finish(null);
            }
        );
    });
}

function isDashboardApiUnavailableError(error) {
    return Boolean(error && (error.code === 'api/unavailable' || error.code === 'api/not-configured'));
}

async function getDashboardBearerToken() {
    await waitForFirebaseAuthSession();
    if (!isFirebaseUserAuthenticated()) {
        redirectToLoginForAuthMismatch('Your login session expired. Please sign in again to continue.');
        const error = new Error('Please sign in again to continue.');
        error.code = 'auth/not-authenticated';
        throw error;
    }
    clearAuthRedirectLock();
    return firebase.auth().currentUser.getIdToken();
}

async function refreshCurrentSessionUserFromApi(options = {}) {
    const reason = String(options.reason || 'manual_refresh').trim();
    if (!isFirebaseUserAuthenticated()) return null;
    const requestId = ++SESSION_RUNTIME.requestCounter;
    SESSION_RUNTIME.latestRequestedRequestId = requestId;
    if (SESSION_RUNTIME.activeRefreshAbortController) {
        try {
            SESSION_RUNTIME.activeRefreshAbortController.abort();
        } catch (error) {
            // no-op
        }
    }
    const refreshAbortController = new AbortController();
    SESSION_RUNTIME.activeRefreshAbortController = refreshAbortController;
    const startedAt = Date.now();
    const refreshPromise = (async () => {
        try {
            const token = await getDashboardBearerToken();
            console.info('[AuthContext] /api/me request start', {
                requestId,
                reason,
                hasBearerToken: Boolean(token),
                hasCachedSession: localStorage.getItem('nexlance_auth') === '1',
                latestRequestedRequestId: SESSION_RUNTIME.latestRequestedRequestId
            });
            const response = await fetch('/api/me', {
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${token}`
                },
                credentials: 'same-origin',
                signal: refreshAbortController.signal
            });
            if (requestId < Number(SESSION_RUNTIME.latestRequestedRequestId || 0)) {
                console.info('[AuthContext] /api/me response ignored because a newer refresh is in-flight', {
                    requestId,
                    latestRequestedRequestId: SESSION_RUNTIME.latestRequestedRequestId
                });
                return getCurrentSessionUser();
            }
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload || !payload.user) {
                SESSION_RUNTIME.hydrationCompleted = true;
                SESSION_RUNTIME.hydrationError = `status_${Number(response.status) || 0}`;
                console.warn('[AuthContext] /api/me request failed', {
                    requestId,
                    reason,
                    status: Number(response.status) || 0
                });
                return null;
            }

            const nextScope = normalizeSessionScope(payload.user);
            const currentUser = getCurrentSessionUser() || {};
            const currentFrontendAssignedProjectIds = currentUser
                ? normalizeScopeProjectIds(
                    currentUser.assignedProjectIds !== undefined
                        ? currentUser.assignedProjectIds
                        : currentUser.assigned_project_ids
                )
                : [];
            const backendAssignedProjectIds = nextScope.assignedProjectIds;
            const frontendSorted = currentFrontendAssignedProjectIds.slice().sort();
            const backendSorted = backendAssignedProjectIds.slice().sort();
            const isMismatch = JSON.stringify(frontendSorted) !== JSON.stringify(backendSorted);
            if (isMismatch) {
                console.error('[ProjectAssignmentMismatch] FORCED_RESYNC_TRIGGERED', {
                    requestId,
                    reason: 'backend_frontend_assignedProjectIds_mismatch',
                    workspaceId: nextScope.workspaceId,
                    email: currentUser.email,
                    frontendAssignedProjectIds: frontendSorted,
                    backendAssignedProjectIds: backendSorted,
                    frontendCount: frontendSorted.length,
                    backendCount: backendSorted.length,
                    timestamp: new Date().toISOString()
                });
            } else {
                console.info('[ProjectAssignmentMatch] Backend and frontend assignedProjectIds match', {
                    requestId,
                    workspaceId: nextScope.workspaceId,
                    assignedProjectIds: backendSorted,
                    count: backendSorted.length,
                    timestamp: new Date().toISOString()
                });
            }
            console.info('[AuthContext] /api/me response scope', {
                requestId,
                workspaceId: nextScope.workspaceId,
                assignedProjectIds: nextScope.assignedProjectIds,
                allProjectsAccess: nextScope.allProjectsAccess,
                projectAccessScope: nextScope.projectAccessScope,
                mismatchDetected: isMismatch
            });
            const nextUser = {
                ...currentUser,
                ...payload.user,
                workspaceId: nextScope.workspaceId,
                workspace_id: nextScope.workspaceId,
                assignedProjectIds: nextScope.assignedProjectIds,
                assigned_project_ids: nextScope.assignedProjectIds,
                allProjectsAccess: nextScope.allProjectsAccess,
                all_projects_access: nextScope.allProjectsAccess,
                projectAccessScope: nextScope.projectAccessScope,
                project_access_scope: nextScope.projectAccessScope
            };
            const updateResult = applySessionUserUpdate({
                source: SESSION_UPDATE_SOURCE.API_ME,
                nextUser,
                requestId,
                persist: true
            });
            SESSION_RUNTIME.hydrationCompleted = true;
            SESSION_RUNTIME.hydrationError = null;
            SESSION_RUNTIME.assignmentsValidatedByBackend = true;
            console.info('[AuthContext] /api/me request end', {
                requestId,
                accepted: updateResult.accepted,
                changed: updateResult.changed,
                reason: updateResult.reason,
                durationMs: Date.now() - startedAt,
                mismatchDetected: isMismatch,
                forcedResync: isMismatch,
                assignmentsValidatedByBackend: true
            });
            return updateResult.user || getCurrentSessionUser();
        } catch (error) {
            if (error && (error.name === 'AbortError' || error.code === 20)) {
                console.info('[AuthContext] /api/me request aborted in favor of a newer request', {
                    requestId,
                    reason
                });
                return getCurrentSessionUser();
            }
            SESSION_RUNTIME.hydrationCompleted = true;
            SESSION_RUNTIME.hydrationError = String(error && error.message || 'unknown_error');
            console.warn('[AuthContext] Failed to refresh /api/me session', {
                requestId,
                reason,
                error: SESSION_RUNTIME.hydrationError
            });
            return null;
        } finally {
            if (SESSION_RUNTIME.activeRefreshAbortController === refreshAbortController) {
                SESSION_RUNTIME.activeRefreshAbortController = null;
            }
            if (SESSION_RUNTIME.inFlightRefreshPromise === refreshPromise) {
                SESSION_RUNTIME.inFlightRefreshPromise = null;
            }
        }
    })();

    SESSION_RUNTIME.inFlightRefreshPromise = refreshPromise;
    return refreshPromise;
}

async function ensureSessionHydration(reason = 'initial_hydration', options = {}) {
    const forceRetry = options.forceRetry === true;
    if (!isFirebaseUserAuthenticated()) {
        SESSION_RUNTIME.hydrationCompleted = true;
        return getCurrentSessionUser();
    }
    if (forceRetry) {
        return refreshCurrentSessionUserFromApi({ reason: `${reason}_force_retry` });
    }
    if (SESSION_RUNTIME.isHydrated && !forceRetry) {
        return getCurrentSessionUser();
    }
    if (SESSION_RUNTIME.hydrationPromise) {
        return SESSION_RUNTIME.hydrationPromise;
    }
    if (SESSION_RUNTIME.hydrationCompleted && !forceRetry) {
        return getCurrentSessionUser();
    }
    SESSION_RUNTIME.hydrationCompleted = false;
    SESSION_RUNTIME.hydrationError = null;
    SESSION_RUNTIME.hydrationPromise = refreshCurrentSessionUserFromApi({ reason }).finally(() => {
        SESSION_RUNTIME.hydrationPromise = null;
    });
    return SESSION_RUNTIME.hydrationPromise;
}

function normalizeDashboardApiError(error, entity, action) {
    const rawMessage = String(error && error.message ? error.message : '').toLowerCase();
    const status = Number(error && error.status);
    if (status === 401 || rawMessage.includes('bearer token')) {
        redirectToLoginForAuthMismatch('Your login session expired. Please sign in again to continue.');
        return new Error('Your login session expired. Please sign in again and retry.');
    }
    if (status === 403 || rawMessage.includes('insufficient permissions') || rawMessage.includes('permission')) {
        return createDashboardPermissionError(entity, action);
    }
    return error;
}

async function dashboardApiRequest(method, collectionId, docId = '', payload = null) {
    await waitForFirebaseAuthSession();
    if (!isFirebaseUserAuthenticated()) {
        const hasLocalSession = localStorage.getItem('nexlance_auth') === '1';
        redirectToLoginForAuthMismatch(
            hasLocalSession
                ? 'Your login session expired. Please sign in again to continue.'
                : 'You need to sign in to continue.'
        );
        const error = new Error('Dashboard API requires a signed-in Firebase user.');
        error.code = 'api/not-configured';
        throw error;
    }

    const token = await getDashboardBearerToken();
    const path = docId
        ? `/api/dashboard/${encodeURIComponent(collectionId)}/${encodeURIComponent(docId)}`
        : `/api/dashboard/${encodeURIComponent(collectionId)}`;
    console.info('[AuthContext] Dashboard API request prepared', {
        method,
        collectionId: String(collectionId || '').trim(),
        hasBearerToken: Boolean(token),
        path
    });

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
        if (response.status === 401) {
            const hasLocalSession = localStorage.getItem('nexlance_auth') === '1';
            redirectToLoginForAuthMismatch(
                hasLocalSession
                    ? 'Your login session expired. Please sign in again to continue.'
                    : 'You need to sign in to continue.'
            );
        }
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
    await waitForFirebaseAuthSession();
    if (!isFirebaseUserAuthenticated()) {
        const hasLocalSession = localStorage.getItem('nexlance_auth') === '1';
        redirectToLoginForAuthMismatch(
            hasLocalSession
                ? 'Your login session expired. Please sign in again to continue.'
                : 'You need to sign in to continue.'
        );
        const error = new Error(
            hasLocalSession
                ? 'Your login session expired. Please sign in again to continue.'
                : 'You need to sign in to continue.'
        );
        error.code = 'auth/not-authenticated';
        throw error;
    }

    const token = await getDashboardBearerToken();
    console.info('[AuthContext] Authorized API request prepared', {
        method,
        path: String(path || '').trim(),
        hasBearerToken: Boolean(token)
    });
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
        if (response.status === 401) {
            const hasLocalSession = localStorage.getItem('nexlance_auth') === '1';
            redirectToLoginForAuthMismatch(
                hasLocalSession
                    ? 'Your login session expired. Please sign in again to continue.'
                    : 'You need to sign in to continue.'
            );
        }
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
    const response = await authorizedApiRequest('/api/invitations/team', 'POST', payload);
    if (response && response.record) {
        upsertLocalEntityRecord('team_members', response.record);
    } else {
        window.dispatchEvent(new CustomEvent('nexlance-data-changed', { detail: { entity: 'team_members' } }));
    }
    return response;
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

function parseRoleGuardTokens(value) {
    return String(value || '')
        .split(',')
        .map(token => String(token || '').trim().toLowerCase())
        .filter(Boolean);
}

function ensureRoleAwareUiStyles() {
    if (document.getElementById('roleAwareUiStyles')) return;

    const style = document.createElement('style');
    style.id = 'roleAwareUiStyles';
    style.textContent = `
        .role-disabled-link,
        .is-role-disabled {
            opacity: 0.55;
            cursor: not-allowed !important;
            pointer-events: none !important;
            filter: grayscale(0.12);
        }
    `;
    document.head.appendChild(style);
}

function setRoleGuardVisibility(element, allowed, denyMode, denyMessage) {
    if (!(element instanceof Element)) return;

    const mode = String(denyMode || 'hide').trim().toLowerCase() === 'disable'
        ? 'disable'
        : 'hide';
    const message = String(denyMessage || 'This action is not available for your role.').trim();

    if (!allowed) {
        if (mode === 'disable') {
            ensureRoleAwareUiStyles();
            if ('disabled' in element) {
                element.disabled = true;
            }
            element.setAttribute('aria-disabled', 'true');
            element.classList.add(element.tagName.toLowerCase() === 'a' ? 'role-disabled-link' : 'is-role-disabled');
            if (message) {
                element.setAttribute('title', message);
            }
            if (element.tagName.toLowerCase() === 'a') {
                element.tabIndex = -1;
                if (element.dataset.roleGuardBound !== '1') {
                    element.dataset.roleGuardBound = '1';
                    element.addEventListener('click', event => {
                        event.preventDefault();
                        event.stopPropagation();
                    });
                }
            }
            return;
        }

        element.style.display = 'none';
        element.setAttribute('aria-hidden', 'true');
        return;
    }

    element.style.display = '';
    element.removeAttribute('aria-hidden');
    if ('disabled' in element) {
        element.disabled = false;
    }
    element.removeAttribute('aria-disabled');
    element.classList.remove('role-disabled-link', 'is-role-disabled');
    if (element.tagName.toLowerCase() === 'a' && element.tabIndex === -1) {
        element.removeAttribute('tabindex');
    }
    if (message && element.getAttribute('title') === message) {
        element.removeAttribute('title');
    }
}

function applyRoleAwareElementGuards() {
    const accessControl = getAccessControl();
    const currentUser = getCurrentSessionUser();
    if (!accessControl || !currentUser || !currentUser.workspaceId) return;

    const role = accessControl.normalizeRole(currentUser.role || currentUser.workspaceRole || currentUser.dashboardRole || 'admin');

    document.querySelectorAll('[data-requires-page], [data-requires-permission], [data-requires-entity], [data-hide-for-roles]').forEach(element => {
        const requiredPage = String(element.getAttribute('data-requires-page') || '').trim();
        const requiredPermission = String(element.getAttribute('data-requires-permission') || '').trim();
        const requiredEntity = String(element.getAttribute('data-requires-entity') || '').trim().toLowerCase();
        const requiredEntityAction = String(element.getAttribute('data-requires-action') || 'read').trim().toLowerCase();
        const hiddenRoles = parseRoleGuardTokens(element.getAttribute('data-hide-for-roles'));
        const denyMode = String(element.getAttribute('data-deny-mode') || 'hide').trim().toLowerCase();
        const denyMessage = String(element.getAttribute('data-deny-message') || '').trim();

        let allowed = true;

        if (requiredPage) {
            allowed = allowed && accessControl.canAccessPage(currentUser, requiredPage);
        }

        if (requiredPermission) {
            allowed = allowed && accessControl.hasPermission(currentUser, requiredPermission);
        }

        if (requiredEntity) {
            allowed = allowed && hasDashboardPermission(requiredEntity, requiredEntityAction);
        }

        if (hiddenRoles.length) {
            allowed = allowed && !hiddenRoles.includes(role);
        }

        setRoleGuardVisibility(element, allowed, denyMode, denyMessage);
    });
}

function syncPlanUiVisibility() {
    const previewAccess = hasExpiredRestrictedPreviewAccess();
    const unrestrictedLinks = [...PLAN_ACCESS_CONFIG.individual.pages];
    const allowedLinks = previewAccess
        ? [...new Set([...TRIAL_ACCESS_CONFIG.pages, ...PLAN_ACCESS_CONFIG.individual.pages])]
        : getCurrentAccessConfig().pages;
    const accessControl = getAccessControl();
    const currentUser = getCurrentSessionUser();

    document.querySelectorAll('.sidebar a[href]').forEach(link => {
        const href = link.getAttribute('href');
        if (href === 'admin.html') return;

        const roleAllowsPage = accessControl && currentUser && currentUser.workspaceId
            ? accessControl.canAccessPage(currentUser, href)
            : true;
        const allowed = allowedLinks.includes(href) && roleAllowsPage;

        if (link.parentElement) {
            link.parentElement.style.display = allowed ? '' : 'none';
        }
        link.classList.toggle('restricted-preview-link', allowed && previewAccess && !unrestrictedLinks.includes(href));
    });

    applyRoleAwareElementGuards();
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
    if (isFirebaseUserAuthenticated() && isSessionHydrationPendingForScopedData()) {
        return;
    }
    if (isAuthenticatedAppPage(pageName) && !getCurrentSessionUser()) {
        window.location.href = `login.html?redirect=${encodeURIComponent(pageName)}`;
        return;
    }
    if (shouldShowRestrictedPreview(pageName)) return;
    if (canAccessPage(pageName)) return;
    if (pageName.endsWith('.html') && isAuthenticatedAppPage(pageName)) {
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

function isSessionHydrationPendingForScopedData() {
    return isFirebaseUserAuthenticated() && !SESSION_RUNTIME.isHydrated;
}

function syncSessionHydrationOverlay() {
    return;
}

function syncAccessUiState() {
    if (isFirebaseUserAuthenticated()) {
        clearAuthRedirectLock();
    }
    ensureStoredAccessConsistency();
    syncPlanUiVisibility();
    syncAdminUiVisibility();
    enforcePlanPageAccess();
    applyRestrictedPreviewOverlay();
    ensureSessionHydration('sync_access_ui_state_background', { forceRetry: false }).then(nextUser => {
        if (!nextUser) return;
        const nextScopeHash = buildSessionScopeHash(nextUser);
        syncPlanUiVisibility();
        syncAdminUiVisibility();
        enforcePlanPageAccess();
    }).catch(() => {});
    return;
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

function removeLocalEntityRecord(entity, recordId) {
    const normalizedRecordId = String(recordId || '').trim();
    if (!normalizedRecordId) return;
    const records = getLocalEntityData(entity);
    const nextRecords = records.filter(record => String(record && record.id) !== normalizedRecordId);
    if (nextRecords.length !== records.length) {
        setLocalEntityData(entity, nextRecords);
    }
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

const API_MANAGED_DASHBOARD_COLLECTIONS = new Set([
    'clients',
    'projects',
    'tasks',
    'invoices',
    'services',
    'team_members',
    'activity_log',
    'activity_logs',
    'payments'
]);

function shouldBypassDirectFirestoreForCollection(collectionId) {
    return API_MANAGED_DASHBOARD_COLLECTIONS.has(String(collectionId || '').trim().toLowerCase());
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

const REALTIME_COLLECTION_CONFIG = Object.freeze([
    Object.freeze({ entity: 'projects', collection: 'projects' }),
    Object.freeze({ entity: 'tasks', collection: 'tasks' }),
    Object.freeze({ entity: 'clients', collection: 'clients' }),
    Object.freeze({ entity: 'services', collection: 'services' }),
    Object.freeze({ entity: 'team_members', collection: 'team_members' })
]);

const REALTIME_SYNC_RUNTIME = {
    scopeKey: '',
    listeners: {},
    startedAt: 0
};

let OPTIMISTIC_MUTATION_COUNTER = 0;

function createOptimisticMutationId(entity = 'entity', recordId = '') {
    OPTIMISTIC_MUTATION_COUNTER += 1;
    const safeEntity = String(entity || 'entity').trim().toLowerCase();
    const safeRecordId = String(recordId || '').trim();
    return `${safeEntity}_${safeRecordId || 'new'}_${Date.now()}_${OPTIMISTIC_MUTATION_COUNTER}`;
}

function stripOptimisticMetadata(record = {}) {
    if (!record || typeof record !== 'object') return record;
    const next = { ...record };
    delete next._optimistic;
    delete next._optimistic_mutation_id;
    delete next._optimistic_updated_at;
    return next;
}

function getRecordVersionTimestamp(record = {}) {
    const candidates = [
        record._optimistic_updated_at,
        record.updated_at,
        record.updatedAt,
        record.template_last_saved_at,
        record.template_completed_at,
        record.created_at,
        record.createdAt
    ];

    let best = 0;
    candidates.forEach(value => {
        if (!value) return;
        const parsed = new Date(value).getTime();
        if (Number.isFinite(parsed) && parsed > best) {
            best = parsed;
        }
    });
    return best;
}

function shouldAcceptIncomingRealtimeRecord(existingRecord, incomingRecord) {
    if (!existingRecord) return true;
    if (!incomingRecord) return false;

    const existingTs = getRecordVersionTimestamp(existingRecord);
    const incomingTs = getRecordVersionTimestamp(incomingRecord);

    if (incomingTs > existingTs) return true;
    if (incomingTs < existingTs) return false;

    if (existingRecord._optimistic === true && incomingRecord._optimistic !== true) {
        return true;
    }

    return true;
}

function sortEntityRecordsForStorage(entity, records) {
    const safeRecords = Array.isArray(records) ? records.slice() : [];
    const normalizedEntity = String(entity || '').trim().toLowerCase();

    if (normalizedEntity === 'projects') {
        return sortProjectsByRecent(safeRecords);
    }

    if (normalizedEntity === 'tasks') {
        return safeRecords.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
    }

    return safeRecords.sort((a, b) => new Date(b.updated_at || b.created_at || 0) - new Date(a.updated_at || a.created_at || 0));
}

function getChangedFieldKeys(previousRecord = {}, nextRecord = {}) {
    const keys = new Set([
        ...Object.keys(previousRecord || {}),
        ...Object.keys(nextRecord || {})
    ]);

    return Array.from(keys).filter(key => {
        const left = previousRecord ? previousRecord[key] : undefined;
        const right = nextRecord ? nextRecord[key] : undefined;
        try {
            return JSON.stringify(left) !== JSON.stringify(right);
        } catch (error) {
            return left !== right;
        }
    });
}

function classifyRealtimeSyncEvent(entity, changeType, previousRecord = {}, nextRecord = {}) {
    const normalizedEntity = String(entity || '').trim().toLowerCase();
    if (normalizedEntity === 'tasks') {
        return 'task_update';
    }
    if (normalizedEntity !== 'projects') {
        return `${normalizedEntity || 'record'}_update`;
    }

    const changedFields = getChangedFieldKeys(previousRecord, nextRecord);
    if (changedFields.some(field => /^template_/i.test(field))) {
        return 'template_change';
    }
    if (changedFields.some(field => /upload|file|asset|attachment/i.test(field))) {
        return 'file_upload';
    }
    if (changedFields.some(field => /status|progress/i.test(field))) {
        return 'status_update';
    }
    if (changeType === 'removed') {
        return 'project_delete';
    }
    return 'project_update';
}

function emitRealtimeSyncEvent({ entity, changeType, record, previousRecord }) {
    const eventType = classifyRealtimeSyncEvent(entity, changeType, previousRecord || {}, record || {});
    const detail = {
        source: 'realtime',
        entity,
        eventType,
        changeType,
        recordId: String(record && record.id || previousRecord && previousRecord.id || '').trim(),
        changedFields: getChangedFieldKeys(previousRecord || {}, record || {}),
        at: new Date().toISOString()
    };
    window.dispatchEvent(new CustomEvent('nexlance-realtime-sync', { detail }));
}

function stopRealtimeWorkspaceSync(reason = 'stop') {
    Object.keys(REALTIME_SYNC_RUNTIME.listeners || {}).forEach(key => {
        const unsubscribe = REALTIME_SYNC_RUNTIME.listeners[key];
        if (typeof unsubscribe === 'function') {
            try {
                unsubscribe();
            } catch (error) {
                // no-op
            }
        }
    });
    REALTIME_SYNC_RUNTIME.listeners = {};
    REALTIME_SYNC_RUNTIME.scopeKey = '';
    REALTIME_SYNC_RUNTIME.startedAt = 0;
    console.info('[RealtimeSync] Stopped workspace listeners', { reason });
}

function buildRealtimeScopeKey(currentUser = {}) {
    const workspaceId = String(currentUser.workspaceId || currentUser.workspace_id || '').trim();
    const uid = String(currentUser.uid || '').trim();
    const email = normalizeEmail(currentUser.email || '');
    return `${workspaceId}::${uid || email}`;
}

function applyRealtimeSnapshotToEntity(entity, snapshot) {
    const safeEntity = String(entity || '').trim();
    if (!safeEntity) return;

    const existingRecords = getLocalEntityData(safeEntity);
    const byId = new Map();
    existingRecords.forEach(record => {
        if (!record || !record.id) return;
        byId.set(String(record.id), record);
    });

    let changed = false;
    const changes = snapshot && typeof snapshot.docChanges === 'function'
        ? snapshot.docChanges()
        : [];

    changes.forEach(change => {
        const doc = change && change.doc ? change.doc : null;
        if (!doc) return;
        const recordId = String(doc.id || '').trim();
        if (!recordId) return;

        const previousRecord = byId.get(recordId) || null;
        if (change.type === 'removed') {
            if (byId.delete(recordId)) {
                changed = true;
                emitRealtimeSyncEvent({
                    entity: safeEntity,
                    changeType: 'removed',
                    previousRecord,
                    record: { id: recordId }
                });
            }
            return;
        }

        let incomingRecord = {
            id: recordId,
            ...(doc.data ? doc.data() : {})
        };

        if (safeEntity === 'projects') {
            incomingRecord = decorateProjectRecord(incomingRecord, 'database');
        }
        incomingRecord = stripOptimisticMetadata(incomingRecord);

        const scopedRecord = filterRecordsForCurrentUserScope(safeEntity, [incomingRecord])[0] || null;
        if (!scopedRecord) {
            if (byId.delete(recordId)) {
                changed = true;
                emitRealtimeSyncEvent({
                    entity: safeEntity,
                    changeType: 'removed',
                    previousRecord,
                    record: { id: recordId }
                });
            }
            return;
        }

        if (!shouldAcceptIncomingRealtimeRecord(previousRecord, scopedRecord)) {
            return;
        }

        byId.set(recordId, scopedRecord);
        changed = true;
        emitRealtimeSyncEvent({
            entity: safeEntity,
            changeType: change.type || 'modified',
            previousRecord,
            record: scopedRecord
        });
    });

    if (!changed) return;

    const nextRecords = sortEntityRecordsForStorage(safeEntity, Array.from(byId.values()));
    setLocalEntityData(safeEntity, nextRecords);
}

function startRealtimeWorkspaceSync(reason = 'sync_access_ui_state') {
    if (!isFirebaseConfigured || !db || !isFirebaseUserAuthenticated()) {
        stopRealtimeWorkspaceSync('firebase_unavailable');
        return;
    }

    const currentUser = getCurrentSessionUser();
    const workspaceId = String(currentUser && (currentUser.workspaceId || currentUser.workspace_id) || '').trim();
    if (!workspaceId) {
        stopRealtimeWorkspaceSync('missing_workspace');
        return;
    }

    const nextScopeKey = buildRealtimeScopeKey(currentUser || {});
    if (
        nextScopeKey
        && REALTIME_SYNC_RUNTIME.scopeKey === nextScopeKey
        && Object.keys(REALTIME_SYNC_RUNTIME.listeners || {}).length
    ) {
        return;
    }

    stopRealtimeWorkspaceSync('scope_change');

    REALTIME_COLLECTION_CONFIG.forEach(config => {
        const logicalEntity = String(config.entity || '').trim().toLowerCase();
        if (logicalEntity !== 'projects' && logicalEntity !== 'tasks' && !canAccessEntity(logicalEntity === 'team_members' ? 'team' : logicalEntity)) {
            return;
        }

        const query = db.collection(config.collection).where('workspace_id', '==', workspaceId);
        const unsubscribe = query.onSnapshot(snapshot => {
            applyRealtimeSnapshotToEntity(config.entity, snapshot);
        }, error => {
            console.warn('[RealtimeSync] Listener failed', {
                entity: config.entity,
                workspaceId,
                reason: String(error && error.message || 'unknown')
            });
        });

        REALTIME_SYNC_RUNTIME.listeners[config.entity] = unsubscribe;
    });

    REALTIME_SYNC_RUNTIME.scopeKey = nextScopeKey;
    REALTIME_SYNC_RUNTIME.startedAt = Date.now();
    console.info('[RealtimeSync] Started workspace listeners', {
        reason,
        workspaceId,
        listeners: Object.keys(REALTIME_SYNC_RUNTIME.listeners)
    });
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

function normalizeProjectSource(record = {}, fallbackSource = 'database') {
    const explicitSource = String(record.project_source || record.projectSource || '').trim().toLowerCase();
    if (explicitSource) return explicitSource;
    const semanticSource = String(record.source || '').trim().toLowerCase();
    if (semanticSource) return semanticSource;
    if (record.storage_fallback === true || record.local_fallback === true) {
        return 'local_fallback';
    }
    return fallbackSource;
}

function resolveProjectBackendId(record = {}, fallbackSource = 'database') {
    const explicitBackendId = String(record.backend_id || record.backendId || '').trim();
    if (explicitBackendId) return explicitBackendId;
    const projectSource = normalizeProjectSource(record, fallbackSource);
    if (projectSource === 'database') {
        return String(record.id || '').trim();
    }
    return '';
}

function isPersistedProjectRecord(record = {}, fallbackSource = 'database') {
    const projectSource = normalizeProjectSource(record, fallbackSource);
    const backendId = resolveProjectBackendId(record, fallbackSource);
    return projectSource === 'database' && Boolean(backendId);
}

function decorateProjectRecord(record, fallbackSource = 'database') {
    if (!record || typeof record !== 'object') return record;
    const projectSource = normalizeProjectSource(record, fallbackSource);
    const backendId = resolveProjectBackendId(record, fallbackSource);
    const isPersisted = isPersistedProjectRecord(record, fallbackSource);
    return {
        ...record,
        backend_id: backendId,
        backendId,
        source: projectSource,
        isPersisted: isPersisted,
        project_source: projectSource,
        is_persisted_project: isPersisted,
        is_shared_workspace_available: isPersisted
    };
}

function decorateProjectRecords(records, fallbackSource = 'database') {
    return (Array.isArray(records) ? records : []).map(record => decorateProjectRecord(record, fallbackSource));
}

function getRecordWorkspaceId(record = {}) {
    return String(record && (record.workspace_id || record.workspaceId) || '').trim();
}

function enforceWorkspaceConsistencyForProjects(records, sourceLabel = 'unknown') {
    const currentUser = getCurrentSessionUser();
    const expectedWorkspaceId = String(currentUser && currentUser.workspaceId || '').trim();
    const safeRecords = Array.isArray(records) ? records : [];
    if (!expectedWorkspaceId) return safeRecords;

    const mismatchedProjects = [];
    const consistentProjects = safeRecords.filter(record => {
        if (!record || typeof record !== 'object') return false;
        if (record.is_persisted_project === false) return true;
        const actualWorkspaceId = getRecordWorkspaceId(record);
        if (actualWorkspaceId && actualWorkspaceId === expectedWorkspaceId) {
            return true;
        }
        mismatchedProjects.push({
            projectId: String(record.id || '').trim(),
            expectedWorkspaceId,
            actualWorkspaceId
        });
        return false;
    });

    if (mismatchedProjects.length) {
        console.error('[WorkspaceConsistency] Removed projects with mismatched workspace during dashboard fetch', {
            source: String(sourceLabel || '').trim(),
            mismatchCount: mismatchedProjects.length,
            mismatchedProjects
        });
    }
    return consistentProjects;
}

function filterVisibleProjectSourcesForCurrentUser(records) {
    const currentUser = getCurrentSessionUser();
    const accessControl = getAccessControl();
    const safeRecords = Array.isArray(records) ? records : [];
    if (!currentUser || !accessControl || !currentUser.workspaceId) {
        return safeRecords;
    }

    if (accessControl.isWorkspaceOwner(currentUser)) {
        return safeRecords;
    }

    return safeRecords.filter(record => record && record.is_persisted_project !== false);
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

function createEntityRecordsSnapshot(entity) {
    const records = getLocalEntityData(entity);
    return Array.isArray(records) ? records.map(record => ({ ...(record || {}) })) : [];
}

function restoreEntityRecordsSnapshot(entity, snapshot) {
    setLocalEntityData(entity, Array.isArray(snapshot) ? snapshot : []);
}

function createOptimisticRecord(record = {}, mutationId = '') {
    const now = new Date().toISOString();
    return {
        ...(record || {}),
        _optimistic: true,
        _optimistic_mutation_id: String(mutationId || '').trim(),
        _optimistic_updated_at: now,
        updated_at: String(record && record.updated_at || '').trim() || now
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
    const scopedEntities = new Set(['projects', 'tasks', 'clients', 'invoices', 'services', 'team', 'team_members']);
    if (isSessionHydrationPendingForScopedData() && scopedEntities.has(String(entity || '').trim().toLowerCase())) {
        console.info('[SessionState] Dataset render deferred until /api/me hydration completes', { entity });
        return [];
    }
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

function getAssignedProjectIdsForCurrentUser() {
    const accessControl = getAccessControl();
    const currentUser = getCurrentSessionUser();
    const isValidated = SESSION_RUNTIME.assignmentsValidatedByBackend === true;
    if (!isValidated && currentUser) {
        const cachedIds = currentUser.assignedProjectIds !== undefined
            ? currentUser.assignedProjectIds
            : currentUser.assigned_project_ids;
        console.warn('[ProjectAssignmentSecurity] FRONTEND USING UNVALIDATED ASSIGNMENTS - BACKEND VALIDATION REQUIRED', {
            email: currentUser.email,
            workspaceId: currentUser.workspaceId,
            role: currentUser.role,
            rawUnvalidatedProjectIds: Array.isArray(cachedIds) ? cachedIds : [],
            securityWarning: 'Frontend assignments used without backend validation - possible stale or tampered state',
            requiringBackendValidation: true,
            timestamp: new Date().toISOString()
        });
    }
    const sourceIds = currentUser
        ? (
            currentUser.assignedProjectIds !== undefined
                ? currentUser.assignedProjectIds
                : currentUser.assigned_project_ids
        )
        : [];
    const fallback = (Array.isArray(sourceIds) ? sourceIds : []).map(projectId => String(projectId || '').trim()).filter(Boolean);
    const sanitized = accessControl ? accessControl.sanitizeAssignedProjectIds(sourceIds) : fallback;
    console.info('[ProjectAssignmentDebug] getAssignedProjectIdsForCurrentUser', {
        email: currentUser ? currentUser.email : null,
        workspaceId: currentUser ? currentUser.workspaceId : null,
        role: currentUser ? currentUser.role : null,
        validatedByBackend: isValidated,
        rawSourceIds: sourceIds,
        sanitizedProjectIds: sanitized,
        timestamp: new Date().toISOString()
    });
    return sanitized;
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
    const normalizedEntity = String(entity || '').trim().toLowerCase();
    const hydrationScopedEntities = new Set(['projects', 'tasks', 'clients', 'invoices', 'services', 'team', 'team_members']);
    if (
        isTeamUpdateCacheBypassActive()
        && hydrationScopedEntities.has(normalizedEntity)
        && (
            !SESSION_RUNTIME.isHydrated
            || Number(SESSION_RUNTIME.lastAppliedRequestId || 0) < Number(SESSION_RUNTIME.latestRequestedRequestId || 0)
        )
    ) {
        console.info('[SessionState] Scope filtering blocked during team-update cache bypass until fresh backend session is applied', {
            entity: normalizedEntity,
            isHydrated: SESSION_RUNTIME.isHydrated,
            lastAppliedRequestId: SESSION_RUNTIME.lastAppliedRequestId,
            latestRequestedRequestId: SESSION_RUNTIME.latestRequestedRequestId
        });
        return [];
    }
    if (isSessionHydrationPendingForScopedData() && hydrationScopedEntities.has(normalizedEntity)) {
        console.info('[SessionState] Scope filtering deferred during hydration', {
            entity: normalizedEntity,
            pendingHydration: true
        });
        return [];
    }
    if (!accessControl || !currentUser || !currentUser.workspaceId) {
        return safeRecords;
    }

    const expectedWorkspaceId = String(currentUser.workspaceId || '').trim();
    const assignedProjectIds = new Set(getAssignedProjectIdsForCurrentUser());

    console.info('[WorkspaceFilterDebug] ========== FILTER START ==========', {
        email: currentUser.email,
        workspaceId: expectedWorkspaceId,
        role: currentUser.role,
        canonical_role: currentUser.canonical_role,
        assignedProjectIds: Array.from(assignedProjectIds),
        isOwner: accessControl.isWorkspaceOwner(currentUser),
        hasAllAccess: currentUserHasAllProjectsAccess(),
        timestamp: new Date().toISOString()
    });

    const workspaceScopedRecords = entity === 'projects'
        ? safeRecords.filter(record => {
            if (!record || typeof record !== 'object') return false;
            if (record.is_persisted_project === false) return true;
            const recordWorkspaceId = getRecordWorkspaceId(record);
            if (recordWorkspaceId && recordWorkspaceId === expectedWorkspaceId) {
                return true;
            }
            return false;
        })
        : safeRecords;
    const debugProjectFilter = (filteredRecords, reason) => {
        if (entity !== 'projects') return;
        console.info('[WorkspaceFilterDebug] filterRecordsForCurrentUserScope', {
            reason,
            workspaceId: expectedWorkspaceId,
            rawProjectIds: workspaceScopedRecords.map(record => String(record && record.id || '').trim()).filter(Boolean),
            assignedProjectIds: Array.from(assignedProjectIds),
            filteredProjectIds: (Array.isArray(filteredRecords) ? filteredRecords : [])
                .map(record => String(record && record.id || '').trim())
                .filter(Boolean)
        });
    };

    if (accessControl.isWorkspaceOwner(currentUser) || currentUserHasAllProjectsAccess()) {
        debugProjectFilter(workspaceScopedRecords, 'owner_or_all_projects_access');
        return workspaceScopedRecords;
    }

    const role = accessControl.normalizeRole(currentUser.role || currentUser.workspaceRole || currentUser.dashboardRole);
    const isAdmin = role === accessControl.ROLES.ADMIN;
    const roleRequiresProjectAssignments = role === accessControl.ROLES.CLIENT
        || role === accessControl.ROLES.DEVELOPER
        || role === accessControl.ROLES.DESIGNER;
    const shouldRestrictProjects = roleRequiresProjectAssignments || assignedProjectIds.size > 0;
    if (isAdmin) {
        debugProjectFilter(workspaceScopedRecords, 'admin_role');
        return workspaceScopedRecords;
    }
    if (!shouldRestrictProjects) {
        debugProjectFilter(workspaceScopedRecords, 'no_project_restriction');
        return workspaceScopedRecords;
    }

    const filteredRecords = workspaceScopedRecords.filter(record => {
        const projectIds = getProjectScopedIdsForRecord(entity, record);
        if (!projectIds.length) {
            return false;
        }
        const normalizedProjectId = String(projectIds[0] || '').trim();
        const matchedId = Array.from(assignedProjectIds).find(pid => String(pid || '').trim() === normalizedProjectId);
        return Boolean(matchedId);
    });
    debugProjectFilter(filteredRecords, 'project_scope_filter');
    return filteredRecords;
}

function shouldSkipOwnerScopedFallbackForCurrentUser() {
    const accessControl = getAccessControl();
    const currentUser = getCurrentSessionUser();
    if (!accessControl || !currentUser || !currentUser.workspaceId) {
        return false;
    }
    const isOwner = accessControl.isWorkspaceOwner(currentUser);
    const hasAllAccess = currentUserHasAllProjectsAccess();
    console.info('[ScopeBypassDebug] shouldSkipOwnerScopedFallbackForCurrentUser', {
        email: currentUser.email,
        workspaceId: currentUser.workspaceId,
        isWorkspaceOwner: isOwner,
        hasAllProjectsAccess: hasAllAccess,
        role: currentUser.role,
        skipResult: !isOwner && !hasAllAccess
    });
    return !isOwner && !hasAllAccess;
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

    if (!isFirebaseConfigured || !db || shouldBypassDirectFirestoreForCollection('activity_logs')) {
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
        if (!shouldUseLocalEntityFallback(error)) {
            console.warn('Activity log write failed:', error);
        }
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

    if (!isFirebaseConfigured || !db || shouldBypassDirectFirestoreForCollection('payments')) {
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
        if (!shouldUseLocalEntityFallback(error)) {
            console.warn('Payment log write failed:', error);
        }
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
            const records = await dashboardApiRequest('GET', 'clients');
            const apiRecords = Array.isArray(records) ? records : [];
            // API is source of truth — sync localStorage, no merging with stale data
            setLocalEntityData('clients', apiRecords);
            return apiRecords;
        }
        return [];
    } catch (e) {
        if (!shouldUseLocalEntityFallback(e)) console.error(e);
        return [];
    }
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
                const status = Number(error && (error.status || (error.response && error.response.status)));
                if (status === 404) {
                    removeLocalEntityRecord('clients', clientId);
                    return null;
                }
                if (!isDashboardApiUnavailableError(error)) throw normalizeDashboardApiError(error, 'clients', 'update');
            }
        }

        const ownerKey = getCurrentOwnerKey();
        if (!ownerKey || shouldBypassDirectFirestoreForCollection('clients')) {
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
        if (!shouldUseLocalEntityFallback(error)) console.error(error);
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
    if (shouldBypassDirectFirestoreForCollection('clients')) {
        const records = getLocalEntityData('clients');
        const r = { ...doc, id: 'c' + Date.now(), storage_fallback: true };
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
    if (shouldBypassDirectFirestoreForCollection('clients')) {
        const records = getLocalEntityData('clients');
        const i = records.findIndex(c => c.id === id);
        if (i > -1) {
            records[i] = { ...records[i], ...doc };
            setLocalEntityData('clients', records);
            return records[i];
        }
        return upsertLocalEntityRecord('clients', { ...(existingLocalRecord || {}), id, ...doc, storage_fallback: true });
    }
    await db.collection('clients').doc(id).update(doc);
    return upsertLocalEntityRecord('clients', { ...(existingLocalRecord || {}), id, ...doc });
}

async function deleteClient(id) {
    if (!canAccessEntity('clients')) throw createRestrictedAccessError('clients');
    const clientId = String(id || '').trim();
    if (!clientId) return;

    if (isFirebaseConfigured) {
        if (!hasDashboardPermission('clients', 'delete')) throw createDashboardPermissionError('clients', 'delete');
        if (isFirebaseUserAuthenticated()) {
            try {
                await dashboardApiRequest('DELETE', 'clients', clientId);
                removeLocalEntityRecord('clients', clientId);
                return;
            } catch (error) {
                const status = Number(error && (error.status || (error.response && error.response.status)));
                if (status === 404) {
                    // Idempotent delete: if record is already gone on backend, keep local state aligned.
                    removeLocalEntityRecord('clients', clientId);
                    return;
                }
                if (!isDashboardApiUnavailableError(error)) throw normalizeDashboardApiError(error, 'clients', 'delete');
            }
        }
    }
    if (!isFirebaseConfigured) {
        const records = getLocalEntityData('clients').filter(c => c.id !== clientId);
        setLocalEntityData('clients', records);
        return;
    }
    if (shouldBypassDirectFirestoreForCollection('clients')) {
        const records = getLocalEntityData('clients').filter(c => c.id !== clientId);
        setLocalEntityData('clients', records);
        return;
    }
    try {
        await db.collection('clients').doc(clientId).delete();
    } catch (error) {
        if (!shouldUseLocalEntityFallback(error)) throw error;
    }
    const records = getLocalEntityData('clients').filter(c => c.id !== clientId);
    setLocalEntityData('clients', records);
}

async function fetchProjects(clientId = null) {
    if (!canAccessEntity('projects')) return [];
    const hydrationPending = isSessionHydrationPendingForScopedData();
    if (hydrationPending) {
        console.info('[SessionState] fetchProjects - hydration pending, awaiting before fetch', {
            hydrated: SESSION_RUNTIME.isHydrated,
            hydrationCompleted: SESSION_RUNTIME.hydrationCompleted,
            timestamp: new Date().toISOString()
        });
        await ensureSessionHydration('fetch_projects_await', { forceRetry: false }).catch(() => {});
    }

    // If workspaceId is still empty after initial hydration check, wait for Firebase auth and force hydration
    let currentUser = getCurrentSessionUser();
    let workspaceId = String(currentUser && currentUser.workspaceId || '').trim();
    if (!workspaceId) {
        console.info('[SessionState] fetchProjects - workspaceId empty, waiting for Firebase auth + forced hydration');
        await waitForFirebaseAuthSession(3000).catch(() => null);
        if (isFirebaseUserAuthenticated()) {
            await ensureSessionHydration('fetch_projects_workspace_resolve', { forceRetry: true }).catch(() => {});
            currentUser = getCurrentSessionUser();
            workspaceId = String(currentUser && currentUser.workspaceId || '').trim();
        }
    }
    const assignedProjectIdsForUser = getAssignedProjectIdsForCurrentUser();
    const applyClientFilter = records => (clientId ? records.filter(project => project.client_id === clientId) : records);
    const logProjectFetchDiagnostics = (source, rawRecords, filteredRecords) => {
        console.info('[WorkspaceFilterDebug] Dashboard project fetch', {
            source: String(source || '').trim(),
            workspaceId,
            rawProjectIds: (Array.isArray(rawRecords) ? rawRecords : [])
                .map(record => String(record && record.id || '').trim())
                .filter(Boolean),
            assignedProjectIds: assignedProjectIdsForUser,
            filteredProjectIds: (Array.isArray(filteredRecords) ? filteredRecords : [])
                .map(record => String(record && record.id || '').trim())
                .filter(Boolean)
        });
    };
    const logMissingAssignedProjects = records => {
        if (!workspaceId || !assignedProjectIdsForUser.length || currentUserHasAllProjectsAccess()) return;
        const persistedProjectIds = new Set((Array.isArray(records) ? records : [])
            .filter(record => record && record.is_persisted_project !== false)
            .map(record => String(record.id || '').trim())
            .filter(Boolean));
        const missingAssignedProjectIds = assignedProjectIdsForUser.filter(projectId => !persistedProjectIds.has(String(projectId || '').trim()));
        if (missingAssignedProjectIds.length) {
            console.error('[WorkspaceConsistency] Assigned projects missing from fetched workspace project list', {
                workspaceId,
                assignedProjectIds: assignedProjectIdsForUser,
                missingAssignedProjectIds
            });
        }
    };

    if (isTeamUpdateCacheBypassActive() && isFirebaseConfigured && isFirebaseUserAuthenticated()) {
        const records = enforceWorkspaceConsistencyForProjects(
            decorateProjectRecords(await dashboardApiRequest('GET', 'projects'), 'database'),
            'team_update_backend_only'
        );
        const visibleRecords = filterVisibleProjectSourcesForCurrentUser(sortProjectsByRecent(Array.isArray(records) ? records : []));
        const filtered = applyClientFilter(visibleRecords);
        logProjectFetchDiagnostics('team_update_backend_only', records, filtered);
        logMissingAssignedProjects(filtered);
        return filtered;
    }

    if (!isFirebaseConfigured) {
        const records = enforceWorkspaceConsistencyForProjects(
            decorateProjectRecords(createAccessFilteredDataset('projects', sampleProjects), 'local_fallback'),
            'local_dataset'
        );
        const filtered = applyClientFilter(filterVisibleProjectSourcesForCurrentUser(sortProjectsByRecent(records)));
        logProjectFetchDiagnostics('local_dataset', records, filtered);
        return filtered;
    }

    // API is the single source of truth — no merging with stale localStorage
    if (!workspaceId) {
        console.error('[FetchProjects] BLOCKED: workspaceId is empty — cannot load projects without workspace context', {
            email: currentUser ? currentUser.email : null,
            role: currentUser ? currentUser.role : null
        });
        return [];
    }

    try {
        if (isFirebaseUserAuthenticated()) {
            const records = enforceWorkspaceConsistencyForProjects(
                decorateProjectRecords(await dashboardApiRequest('GET', 'projects'), 'database'),
                'dashboard_api'
            );
            const apiRecords = Array.isArray(records) ? records : [];
            // Sync localStorage with API response — API is source of truth
            setLocalEntityData('projects', sortProjectsByRecent(apiRecords));
            setLegacyTemplateProjects(apiRecords.filter(r => r && r.template_id));

            const visibleRecords = filterVisibleProjectSourcesForCurrentUser(sortProjectsByRecent(apiRecords));
            const filtered = applyClientFilter(visibleRecords);
            logProjectFetchDiagnostics('dashboard_api', records, filtered);
            logMissingAssignedProjects(filtered);
            return filtered;
        }
        // Not authenticated — return empty, do not use stale cache
        console.warn('[FetchProjects] Not authenticated — returning empty');
        return [];
    } catch (e) {
        console.error('[FetchProjects] API error — returning empty, not using stale cache', { error: e.message });
        return [];
    }
}

async function addProject(d) {
    if (!canAccessEntity('projects')) throw createRestrictedAccessError('projects');

    // Ensure workspace context exists before creating a project
    let projectUser = getCurrentSessionUser();
    if (!projectUser || !String(projectUser.workspaceId || '').trim()) {
        console.info('[addProject] workspaceId is empty — waiting for Firebase auth + forcing session refresh');
        await waitForFirebaseAuthSession(3000).catch(() => null);
        await ensureSessionHydration('add_project_workspace_check', { forceRetry: true }).catch(() => {});
        projectUser = getCurrentSessionUser();
        if (!projectUser || !String(projectUser.workspaceId || '').trim()) {
            throw new Error('Cannot create project: your workspace could not be resolved. Please log out and log back in.');
        }
    }

    const doc = sanitizeFirestoreData({ ...withOwnerFields(d), created_at: new Date().toISOString() });
    const optimisticMutationId = createOptimisticMutationId('projects', '');
    let optimisticSnapshot = null;
    let optimisticDraftId = '';

    const createLocalDraftProject = () => {
        const records = getLocalEntityData('projects');
        const draftRecord = decorateProjectRecord({
            ...doc,
            id: 'p' + Date.now(),
            storage_fallback: true
        }, 'local_fallback');
        records.unshift(draftRecord);
        setLocalEntityData('projects', records);
        return draftRecord;
    };

    if (isFirebaseConfigured) {
        if (!hasDashboardPermission('projects', 'create')) throw createDashboardPermissionError('projects', 'create');
        if (isFirebaseUserAuthenticated()) {
            optimisticSnapshot = createEntityRecordsSnapshot('projects');
            optimisticDraftId = `tmp_project_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const optimisticDraft = decorateProjectRecord(createOptimisticRecord({
                ...doc,
                id: optimisticDraftId,
                storage_fallback: true
            }, optimisticMutationId), 'local_fallback');
            setLocalEntityData('projects', [optimisticDraft, ...optimisticSnapshot]);
            try {
                const createdRecord = await dashboardApiRequest('POST', 'projects', '', doc);
                const decoratedRecord = decorateProjectRecord(createdRecord, 'database');
                if (decoratedRecord) {
                    const withoutOptimistic = getLocalEntityData('projects')
                        .filter(record => String(record && record.id || '').trim() !== optimisticDraftId);
                    setLocalEntityData('projects', sortProjectsByRecent(mergeProjectCollections([decoratedRecord], withoutOptimistic)));
                }
                return decoratedRecord;
            } catch (error) {
                if (!isDashboardApiUnavailableError(error)) {
                    if (optimisticSnapshot) {
                        restoreEntityRecordsSnapshot('projects', optimisticSnapshot);
                    }
                    throw normalizeDashboardApiError(error, 'projects', 'create');
                }
                if (optimisticSnapshot) {
                    restoreEntityRecordsSnapshot('projects', optimisticSnapshot);
                }
            }
        }
    }
    if (!isFirebaseConfigured) {
        return createLocalDraftProject();
    }
    if (shouldBypassDirectFirestoreForCollection('projects')) {
        return createLocalDraftProject();
    }
    try {
        const ref = await db.collection('projects').add(doc);
        const persistedProject = decorateProjectRecord({ id: ref.id, ...doc }, 'database');
        if (persistedProject) upsertLocalEntityRecord('projects', persistedProject);
        return persistedProject;
    } catch (error) {
        if (shouldUseLocalEntityFallback(error)) {
            return createLocalDraftProject();
        }
        throw error;
    }
}

function isTemplateWorkspaceProjectUpdate(payload) {
    const templateWorkspaceMetadataFields = new Set([
        'owner_key',
        'owner_email',
        'updated_at'
    ]);
    const templateWorkspacePatchFields = new Set([
        'template_state',
        'template_last_saved_at',
        'template_saved_html',
        'template_workflow_status',
        'template_completed_at',
        'template_download_paid',
        'template_download_paid_at',
        'template_download_payment_intent_id',
        'template_download_amount_gbp',
        'status',
        'progress'
    ]);

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;

    const keys = Object.keys(payload).filter(key => !templateWorkspaceMetadataFields.has(String(key || '').trim()));
    if (!keys.length) return false;

    return keys.every(key => templateWorkspacePatchFields.has(String(key || '').trim()));
}

async function updateProject(id, d, options = {}) {
    if (!canAccessEntity('projects')) throw createRestrictedAccessError('projects');
    const sanitizedPayload = sanitizeFirestoreData(d);
    const doc = sanitizeFirestoreData(withOwnerFields(d));
    const optimisticMutationId = createOptimisticMutationId('projects', id);
    const optimisticProjectsSnapshot = createEntityRecordsSnapshot('projects');
    const optimisticLegacySnapshot = getLegacyTemplateProjects().map(record => ({ ...(record || {}) }));
    let optimisticApplied = false;
    const rollbackOptimisticState = () => {
        if (!optimisticApplied) return;
        restoreEntityRecordsSnapshot('projects', optimisticProjectsSnapshot);
        setLegacyTemplateProjects(optimisticLegacySnapshot);
    };
    const applyProjectPatchToLocalScopes = (patch = {}, markStorageFallback = false) => {
        const safePatch = sanitizeFirestoreData(patch);
        const scopedProjects = getLocalEntityData('projects');
        const scopedResult = updateProjectInCollection(scopedProjects, id, {
            ...safePatch,
            ...(markStorageFallback ? { storage_fallback: true, local_fallback: true } : {})
        });
        if (scopedResult.record) {
            const normalizedRecord = decorateProjectRecord(
                stripOptimisticMetadata(scopedResult.record),
                normalizeProjectSource(scopedResult.record, markStorageFallback ? 'local_fallback' : 'database')
            );
            const normalizedScopedRecords = scopedResult.records.map(project => (
                String(project && project.id || '') === String(id)
                    ? normalizedRecord
                    : project
            ));
            setLocalEntityData('projects', sortProjectsByRecent(normalizedScopedRecords));
            return normalizedRecord;
        }

        const legacyProjects = getLegacyTemplateProjects();
        const legacyResult = updateProjectInCollection(legacyProjects, id, {
            ...safePatch,
            ...(markStorageFallback ? { storage_fallback: true, local_fallback: true } : {})
        });
        if (legacyResult.record) {
            const normalizedRecord = stripOptimisticMetadata({
                ...legacyResult.record,
                ...(markStorageFallback ? { storage_fallback: true, local_fallback: true } : {})
            });
            const normalizedLegacyRecords = legacyResult.records.map(project => (
                String(project && project.id || '') === String(id)
                    ? normalizedRecord
                    : project
            ));
            setLegacyTemplateProjects(normalizedLegacyRecords);
            return normalizedRecord;
        }

        return null;
    };
    // Template Workspace now uses dedicated backend endpoints. This compatibility
    // branch remains so legacy callers do not get reclassified by injected metadata.
    const isTemplateWorkspaceUpdate = options && options.templateWorkspace === true && isTemplateWorkspaceProjectUpdate(sanitizedPayload);
    const dashboardPayload = isTemplateWorkspaceUpdate ? sanitizedPayload : doc;
    if (Object.prototype.hasOwnProperty.call(doc, 'template_state')) {
        console.debug('[Nexlance] Saving sanitized template_state', {
            projectId: id,
            templateState: doc.template_state
        });
    }

    const optimisticLocalRecords = optimisticProjectsSnapshot.slice();
    const optimisticLocalIndex = optimisticLocalRecords.findIndex(project => String(project && project.id) === String(id));
    if (optimisticLocalIndex > -1) {
        optimisticLocalRecords[optimisticLocalIndex] = createOptimisticRecord(
            decorateProjectRecord({
                ...optimisticLocalRecords[optimisticLocalIndex],
                ...dashboardPayload
            }, normalizeProjectSource(optimisticLocalRecords[optimisticLocalIndex], 'database')),
            optimisticMutationId
        );
        setLocalEntityData('projects', optimisticLocalRecords);
        optimisticApplied = true;
    }

    const optimisticLegacyRecords = optimisticLegacySnapshot.slice();
    const optimisticLegacyIndex = optimisticLegacyRecords.findIndex(project => String(project && project.id) === String(id));
    if (optimisticLegacyIndex > -1) {
        optimisticLegacyRecords[optimisticLegacyIndex] = createOptimisticRecord({
            ...optimisticLegacyRecords[optimisticLegacyIndex],
            ...dashboardPayload
        }, optimisticMutationId);
        setLegacyTemplateProjects(optimisticLegacyRecords);
        optimisticApplied = true;
    }

    if (isFirebaseConfigured) {
        if (!hasDashboardPermission('projects', isTemplateWorkspaceUpdate ? 'read' : 'update')) {
            rollbackOptimisticState();
            throw createDashboardPermissionError('projects', isTemplateWorkspaceUpdate ? 'read' : 'update');
        }
        if (isFirebaseUserAuthenticated()) {
            try {
                const record = await dashboardApiRequest('PATCH', 'projects', id, dashboardPayload);
                const persistedRecord = record && typeof record === 'object'
                    ? decorateProjectRecord(stripOptimisticMetadata(record), 'database')
                    : decorateProjectRecord(stripOptimisticMetadata({ id, ...dashboardPayload }), 'database');
                if (persistedRecord) {
                    upsertLocalEntityRecord('projects', persistedRecord);
                }
                return persistedRecord;
            } catch (error) {
                if (!isDashboardApiUnavailableError(error)) {
                    rollbackOptimisticState();
                    throw normalizeDashboardApiError(error, 'projects', isTemplateWorkspaceUpdate ? 'read' : 'update');
                }
            }
        }
    }
    if (!isFirebaseConfigured) {
        return applyProjectPatchToLocalScopes(doc, false);
    }
    if (shouldBypassDirectFirestoreForCollection('projects')) {
        return applyProjectPatchToLocalScopes(doc, true);
    }
    try {
        await db.collection('projects').doc(id).update(doc);
        const updatedRecord = applyProjectPatchToLocalScopes(doc, false);
        if (updatedRecord) {
            return updatedRecord;
        }
        return decorateProjectRecord(stripOptimisticMetadata({ id, ...doc }), 'database');
    } catch (error) {
        const message = String(error && error.message ? error.message : '');
        const code = String(error && error.code ? error.code : '');
        const isMissingDocumentError = message.toLowerCase().includes('no document to update')
            || code === 'not-found'
            || code === 5;

        if (!isMissingDocumentError && !shouldUseLocalEntityFallback(error)) {
            rollbackOptimisticState();
            throw error;
        }

        const fallbackRecord = applyProjectPatchToLocalScopes(doc, true);
        if (fallbackRecord) return fallbackRecord;
        rollbackOptimisticState();
        throw error;
    }
}

async function deleteProject(id) {
    if (!canAccessEntity('projects')) throw createRestrictedAccessError('projects');
    const projectId = String(id || '').trim();
    if (!projectId) return;

    const optimisticProjectsSnapshot = createEntityRecordsSnapshot('projects');
    const optimisticLegacySnapshot = getLegacyTemplateProjects().map(record => ({ ...(record || {}) }));
    const optimisticScopedRecords = optimisticProjectsSnapshot.filter(project => String(project && project.id || '') !== projectId);
    const optimisticLegacyRecords = optimisticLegacySnapshot.filter(project => String(project && project.id || '') !== projectId);
    const optimisticApplied = optimisticScopedRecords.length !== optimisticProjectsSnapshot.length
        || optimisticLegacyRecords.length !== optimisticLegacySnapshot.length;

    const rollbackOptimisticState = () => {
        if (!optimisticApplied) return;
        restoreEntityRecordsSnapshot('projects', optimisticProjectsSnapshot);
        setLegacyTemplateProjects(optimisticLegacySnapshot);
    };

    if (optimisticApplied) {
        setLocalEntityData('projects', optimisticScopedRecords);
        setLegacyTemplateProjects(optimisticLegacyRecords);
    }

    if (isFirebaseConfigured) {
        if (!hasDashboardPermission('projects', 'delete')) {
            rollbackOptimisticState();
            throw createDashboardPermissionError('projects', 'delete');
        }
        if (isFirebaseUserAuthenticated()) {
            try {
                await dashboardApiRequest('DELETE', 'projects', projectId);
                return;
            } catch (error) {
                if (!isDashboardApiUnavailableError(error)) {
                    rollbackOptimisticState();
                    throw normalizeDashboardApiError(error, 'projects', 'delete');
                }
            }
        }
    }
    if (!isFirebaseConfigured) {
        if (!optimisticApplied) {
            const records = getLocalEntityData('projects').filter(project => String(project && project.id || '') !== projectId);
            setLocalEntityData('projects', records);
            const legacyRecords = getLegacyTemplateProjects().filter(project => String(project && project.id || '') !== projectId);
            setLegacyTemplateProjects(legacyRecords);
        }
        return;
    }
    if (shouldBypassDirectFirestoreForCollection('projects')) {
        if (!optimisticApplied) {
            const records = getLocalEntityData('projects').filter(project => String(project && project.id || '') !== projectId);
            setLocalEntityData('projects', records);
            const legacyRecords = getLegacyTemplateProjects().filter(project => String(project && project.id || '') !== projectId);
            setLegacyTemplateProjects(legacyRecords);
        }
        return;
    }
    try {
        await db.collection('projects').doc(projectId).delete();
    } catch (error) {
        const message = String(error && error.message ? error.message : '');
        const code = String(error && error.code ? error.code : '');
        const isMissingDocumentError = message.toLowerCase().includes('no document to update')
            || message.toLowerCase().includes('no document to delete')
            || code === 'not-found'
            || code === 5;
        if (shouldUseLocalEntityFallback(error) || isMissingDocumentError) {
            return;
        }
        rollbackOptimisticState();
        throw error;
    }
}

function buildProjectSyncPayload(project) {
    const clone = { ...(project || {}) };
    [
        'id',
        'backend_id',
        'backendId',
        'project_source',
        'projectSource',
        'source',
        'isPersisted',
        'is_persisted_project',
        'is_shared_workspace_available',
        'storage_fallback',
        'local_fallback'
    ].forEach(key => {
        delete clone[key];
    });
    return sanitizeFirestoreData(clone);
}

async function syncProjectToBackend(projectId) {
    if (!canAccessEntity('projects')) throw createRestrictedAccessError('projects');

    const localId = String(projectId || '').trim();
    if (!localId) throw new Error('Project ID is required for sync.');

    const scopedProjects = getLocalEntityData('projects');
    const legacyProjects = getLegacyTemplateProjects();
    const currentProject = scopedProjects.find(project => String(project && project.id) === localId)
        || legacyProjects.find(project => String(project && project.id) === localId);

    if (!currentProject) {
        throw new Error('Project not found in local drafts.');
    }

    const decoratedLocalProject = decorateProjectRecord(currentProject, normalizeProjectSource(currentProject, 'local_fallback'));
    if (decoratedLocalProject.is_persisted_project === true && decoratedLocalProject.backend_id) {
        return decoratedLocalProject;
    }

    if (!isFirebaseConfigured) {
        throw new Error('Backend sync is unavailable because Firebase is not configured.');
    }
    if (!hasDashboardPermission('projects', 'create')) {
        throw createDashboardPermissionError('projects', 'create');
    }
    if (!isFirebaseUserAuthenticated()) {
        throw new Error('Please sign in again before syncing this project.');
    }

    const payload = sanitizeFirestoreData({
        ...withOwnerFields(buildProjectSyncPayload(decoratedLocalProject)),
        created_at: decoratedLocalProject.created_at || new Date().toISOString()
    });

    let createdRecord = null;
    try {
        const syncResponse = await authorizedApiRequest('/api/project-sync', 'POST', {
            localId,
            project: payload
        });
        createdRecord = syncResponse && syncResponse.record ? syncResponse.record : null;
    } catch (error) {
        const status = Number(error && error.status);
        const routeUnavailable = status === 404 || status === 405;
        console.error('[ProjectSync] /api/project-sync failed', {
            localId,
            status,
            message: error && error.message ? error.message : '',
            response: error && error.response ? error.response : null
        });

        if (!routeUnavailable) {
            throw error;
        }
    }

    if (!createdRecord) {
        try {
            createdRecord = await dashboardApiRequest('POST', 'projects', '', payload);
        } catch (error) {
            if (!isDashboardApiUnavailableError(error)) {
                throw normalizeDashboardApiError(error, 'projects', 'create');
            }
        }
    }

    if (!createdRecord) {
        console.error('[ProjectSync] Backend create routes unavailable', {
            localId,
            attemptedRoutes: ['/api/project-sync', '/api/dashboard/projects']
        });
        throw new Error('Project sync service is unavailable right now. Please try again in a moment.');
    }

    const createdRecordId = String(createdRecord && createdRecord.id ? createdRecord.id : '').trim();
    if (!createdRecordId) {
        console.error('[ProjectSync] Backend response missing ID', {
            localId,
            createdRecord
        });
        throw new Error('Project sync completed without a valid backend ID.');
    }

    const normalizedCreatedRecord = {
        ...createdRecord,
        id: createdRecordId,
        backend_id: String(createdRecord.backend_id || createdRecord.backendId || createdRecordId).trim() || createdRecordId,
        backendId: String(createdRecord.backendId || createdRecord.backend_id || createdRecordId).trim() || createdRecordId
    };

    const persistedProject = decorateProjectRecord(normalizedCreatedRecord, 'database');
    const backendId = String(persistedProject && persistedProject.id ? persistedProject.id : '').trim();
    if (!backendId) {
        throw new Error('Backend sync completed without a valid project ID.');
    }

    const nextScopedProjects = scopedProjects.filter(project => {
        const recordId = String(project && project.id ? project.id : '').trim();
        return recordId && recordId !== localId && recordId !== backendId;
    });
    nextScopedProjects.unshift(persistedProject);
    setLocalEntityData('projects', nextScopedProjects);

    const nextLegacyProjects = legacyProjects.filter(project => {
        const recordId = String(project && project.id ? project.id : '').trim();
        return recordId && recordId !== localId && recordId !== backendId;
    });
    setLegacyTemplateProjects(nextLegacyProjects);

    const localTasks = getLocalEntityData('tasks');
    let migratedTaskCount = 0;
    const nextTasks = localTasks.map(task => {
        if (!task || String(task.project_id || '').trim() !== localId) return task;
        migratedTaskCount += 1;
        return {
            ...task,
            project_id: backendId
        };
    });
    if (migratedTaskCount > 0) {
        setLocalEntityData('tasks', nextTasks);
    }

    window.dispatchEvent(new CustomEvent('nexlance-data-changed', {
        detail: {
            entity: 'projects',
            action: 'synced',
            fromId: localId,
            toId: backendId
        }
    }));

    return persistedProject;
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
                if (!isDashboardApiUnavailableError(error)) throw normalizeDashboardApiError(error, 'tasks', 'read');
            }
        }
        if (shouldBypassDirectFirestoreForCollection('tasks') || shouldSkipOwnerScopedFallbackForCurrentUser()) {
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
    } catch (e) {
        if (!shouldUseLocalEntityFallback(e)) console.error(e);
        return filterRecordsForCurrentUserScope('tasks', getLocalEntityData('tasks')).filter(t => t.project_id === projectId);
    }
}

async function addTask(d) {
    if (!canAccessEntity('tasks')) throw createRestrictedAccessError('tasks');
    const doc = sanitizeFirestoreData({ ...withOwnerFields(d), created_at: new Date().toISOString() });
    const optimisticMutationId = createOptimisticMutationId('tasks', '');
    let optimisticSnapshot = null;
    let optimisticDraftId = '';
    const createLocalDraftTask = (markStorageFallback = false) => {
        const records = getLocalEntityData('tasks');
        const draftRecord = stripOptimisticMetadata({
            ...doc,
            id: `t${Date.now()}`,
            ...(markStorageFallback ? { storage_fallback: true } : {})
        });
        setLocalEntityData('tasks', sortEntityRecordsForStorage('tasks', [...records, draftRecord]));
        return draftRecord;
    };

    if (isFirebaseConfigured) {
        if (!hasDashboardPermission('tasks', 'create')) throw createDashboardPermissionError('tasks', 'create');
        if (isFirebaseUserAuthenticated()) {
            optimisticSnapshot = createEntityRecordsSnapshot('tasks');
            optimisticDraftId = `tmp_task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const optimisticDraft = createOptimisticRecord({
                ...doc,
                id: optimisticDraftId
            }, optimisticMutationId);
            setLocalEntityData('tasks', sortEntityRecordsForStorage('tasks', [...optimisticSnapshot, optimisticDraft]));
            try {
                const createdRecord = await dashboardApiRequest('POST', 'tasks', '', doc);
                const persistedTask = stripOptimisticMetadata(
                    createdRecord && typeof createdRecord === 'object'
                        ? createdRecord
                        : { ...doc, id: `t${Date.now()}` }
                );
                const withoutOptimistic = getLocalEntityData('tasks')
                    .filter(task => String(task && task.id || '') !== optimisticDraftId);
                setLocalEntityData('tasks', sortEntityRecordsForStorage('tasks', mergeEntityCollections([persistedTask], withoutOptimistic)));
                return persistedTask;
            } catch (error) {
                if (!isDashboardApiUnavailableError(error)) {
                    if (optimisticSnapshot) {
                        restoreEntityRecordsSnapshot('tasks', optimisticSnapshot);
                    }
                    throw normalizeDashboardApiError(error, 'tasks', 'create');
                }
                if (optimisticSnapshot) {
                    restoreEntityRecordsSnapshot('tasks', optimisticSnapshot);
                }
            }
        }
    }
    if (!isFirebaseConfigured) {
        return createLocalDraftTask(false);
    }
    if (shouldBypassDirectFirestoreForCollection('tasks')) {
        return createLocalDraftTask(true);
    }
    try {
        const ref = await db.collection('tasks').add(doc);
        const persistedTask = stripOptimisticMetadata({ id: ref.id, ...doc });
        setLocalEntityData('tasks', sortEntityRecordsForStorage('tasks', mergeEntityCollections([persistedTask], getLocalEntityData('tasks'))));
        return persistedTask;
    } catch (error) {
        if (shouldUseLocalEntityFallback(error)) {
            return createLocalDraftTask(true);
        }
        throw error;
    }
}

async function updateTask(id, d) {
    if (!canAccessEntity('tasks')) throw createRestrictedAccessError('tasks');
    const taskId = String(id || '').trim();
    if (!taskId) return null;
    const doc = sanitizeFirestoreData(withOwnerFields(d));
    const optimisticMutationId = createOptimisticMutationId('tasks', taskId);
    const optimisticTasksSnapshot = createEntityRecordsSnapshot('tasks');
    const optimisticTasks = optimisticTasksSnapshot.slice();
    const optimisticIndex = optimisticTasks.findIndex(task => String(task && task.id || '') === taskId);
    const optimisticApplied = optimisticIndex > -1;
    const rollbackOptimisticState = () => {
        if (!optimisticApplied) return;
        restoreEntityRecordsSnapshot('tasks', optimisticTasksSnapshot);
    };
    const applyTaskPatchToLocalRecords = (patch = {}, markStorageFallback = false) => {
        const safePatch = sanitizeFirestoreData(patch);
        const records = getLocalEntityData('tasks');
        const i = records.findIndex(task => String(task && task.id || '') === taskId);
        if (i < 0) return null;
        records[i] = stripOptimisticMetadata({
            ...records[i],
            ...safePatch,
            ...(markStorageFallback ? { storage_fallback: true } : {})
        });
        setLocalEntityData('tasks', sortEntityRecordsForStorage('tasks', records));
        return records[i];
    };

    if (optimisticApplied) {
        optimisticTasks[optimisticIndex] = createOptimisticRecord({
            ...optimisticTasks[optimisticIndex],
            ...doc
        }, optimisticMutationId);
        setLocalEntityData('tasks', sortEntityRecordsForStorage('tasks', optimisticTasks));
    }

    if (isFirebaseConfigured) {
        if (!hasDashboardPermission('tasks', 'update')) {
            rollbackOptimisticState();
            throw createDashboardPermissionError('tasks', 'update');
        }
        if (isFirebaseUserAuthenticated()) {
            try {
                const record = await dashboardApiRequest('PATCH', 'tasks', taskId, doc);
                const persistedTask = stripOptimisticMetadata(
                    record && typeof record === 'object'
                        ? record
                        : { id: taskId, ...doc }
                );
                const remainingRecords = getLocalEntityData('tasks').filter(task => String(task && task.id || '') !== taskId);
                setLocalEntityData('tasks', sortEntityRecordsForStorage('tasks', [persistedTask, ...remainingRecords]));
                return persistedTask;
            } catch (error) {
                if (!isDashboardApiUnavailableError(error)) {
                    rollbackOptimisticState();
                    throw normalizeDashboardApiError(error, 'tasks', 'update');
                }
            }
        }
    }
    if (!isFirebaseConfigured) {
        return applyTaskPatchToLocalRecords(doc, false);
    }
    if (shouldBypassDirectFirestoreForCollection('tasks')) {
        return applyTaskPatchToLocalRecords(doc, true);
    }
    try {
        await db.collection('tasks').doc(taskId).update(doc);
        const updatedTask = applyTaskPatchToLocalRecords(doc, false);
        if (updatedTask) return updatedTask;
        return stripOptimisticMetadata({ id: taskId, ...doc });
    } catch (error) {
        const message = String(error && error.message ? error.message : '');
        const code = String(error && error.code ? error.code : '');
        const isMissingDocumentError = message.toLowerCase().includes('no document to update')
            || code === 'not-found'
            || code === 5;
        if (shouldUseLocalEntityFallback(error) || isMissingDocumentError) {
            return applyTaskPatchToLocalRecords(doc, true);
        }
        rollbackOptimisticState();
        throw error;
    }
}

async function deleteTask(id) {
    if (!canAccessEntity('tasks')) throw createRestrictedAccessError('tasks');
    const taskId = String(id || '').trim();
    if (!taskId) return;
    const optimisticTasksSnapshot = createEntityRecordsSnapshot('tasks');
    const optimisticTasks = optimisticTasksSnapshot.filter(task => String(task && task.id || '') !== taskId);
    const optimisticApplied = optimisticTasks.length !== optimisticTasksSnapshot.length;
    const rollbackOptimisticState = () => {
        if (!optimisticApplied) return;
        restoreEntityRecordsSnapshot('tasks', optimisticTasksSnapshot);
    };

    if (optimisticApplied) {
        setLocalEntityData('tasks', sortEntityRecordsForStorage('tasks', optimisticTasks));
    }

    if (isFirebaseConfigured) {
        if (!hasDashboardPermission('tasks', 'delete')) {
            rollbackOptimisticState();
            throw createDashboardPermissionError('tasks', 'delete');
        }
        if (isFirebaseUserAuthenticated()) {
            try {
                await dashboardApiRequest('DELETE', 'tasks', taskId);
                return;
            } catch (error) {
                if (!isDashboardApiUnavailableError(error)) {
                    rollbackOptimisticState();
                    throw normalizeDashboardApiError(error, 'tasks', 'delete');
                }
            }
        }
    }
    if (!isFirebaseConfigured) {
        if (!optimisticApplied) {
            const records = getLocalEntityData('tasks').filter(task => String(task && task.id || '') !== taskId);
            setLocalEntityData('tasks', records);
        }
        return;
    }
    if (shouldBypassDirectFirestoreForCollection('tasks')) {
        if (!optimisticApplied) {
            const records = getLocalEntityData('tasks').filter(task => String(task && task.id || '') !== taskId);
            setLocalEntityData('tasks', records);
        }
        return;
    }
    try {
        await db.collection('tasks').doc(taskId).delete();
    } catch (error) {
        const message = String(error && error.message ? error.message : '');
        const code = String(error && error.code ? error.code : '');
        const isMissingDocumentError = message.toLowerCase().includes('no document to update')
            || message.toLowerCase().includes('no document to delete')
            || code === 'not-found'
            || code === 5;
        if (!shouldUseLocalEntityFallback(error) && !isMissingDocumentError) {
            rollbackOptimisticState();
            throw error;
        }
    }
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
        if (shouldBypassDirectFirestoreForCollection('invoices')) {
            return getLocalEntityData('invoices')
                .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
        }
        const ownerKey = getCurrentOwnerKey();
        if (!ownerKey) return [];
        const snap = await db.collection('invoices').where('owner_key', '==', ownerKey).get();
        return mergeEntityCollections(
            _snap(snap).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)),
            getLocalEntityData('invoices')
        ).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    } catch (e) {
        if (!shouldUseLocalEntityFallback(e)) console.error(e);
        return getLocalEntityData('invoices');
    }
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
    if (shouldBypassDirectFirestoreForCollection('invoices')) {
        const records = getLocalEntityData('invoices');
        const r = { ...doc, id: 'i' + Date.now(), storage_fallback: true };
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
    if (shouldBypassDirectFirestoreForCollection('invoices')) {
        const records = getLocalEntityData('invoices');
        const i = records.findIndex(inv => inv.id === id);
        if (i > -1) {
            records[i] = { ...records[i], ...upd, storage_fallback: true };
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
    if (shouldBypassDirectFirestoreForCollection('invoices')) {
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
        if (shouldBypassDirectFirestoreForCollection('services')) {
            return getLocalEntityData('services');
        }
        const ownerKey = getCurrentOwnerKey();
        if (!ownerKey) return [];
        const snap = await db.collection('services').where('owner_key', '==', ownerKey).get();
        return mergeEntityCollections(_snap(snap), getLocalEntityData('services'));
    } catch (e) {
        if (!shouldUseLocalEntityFallback(e)) console.error(e);
        return getLocalEntityData('services');
    }
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
    if (shouldBypassDirectFirestoreForCollection('services')) {
        const records = getLocalEntityData('services');
        const r = { ...doc, id: 's' + Date.now(), storage_fallback: true };
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
    if (shouldBypassDirectFirestoreForCollection('services')) {
        const records = getLocalEntityData('services');
        const i = records.findIndex(s => s.id === id);
        if (i > -1) {
            records[i] = { ...records[i], ...doc, storage_fallback: true };
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
    if (shouldBypassDirectFirestoreForCollection('services')) {
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
            const records = await dashboardApiRequest('GET', 'team_members');
            const apiRecords = Array.isArray(records) ? records : [];
            // API is source of truth — sync localStorage, no merging with stale data
            setLocalEntityData('team_members', apiRecords);
            return apiRecords;
        }
        return [];
    } catch (e) {
        if (!shouldUseLocalEntityFallback(e)) console.error(e);
        return [];
    }
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
    if (shouldBypassDirectFirestoreForCollection('team_members')) {
        const records = getLocalEntityData('team_members');
        const r = { ...doc, id: 'm' + Date.now(), storage_fallback: true };
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

async function forceFullSessionRefreshAfterTeamMemberUpdate(teamMemberId = '') {
    if (!isFirebaseUserAuthenticated()) return null;
    const refreshedUser = await refreshCurrentSessionUserFromApi({
        reason: `team_member_update_${String(teamMemberId || '').trim() || 'unknown'}`
    });
    if (!refreshedUser || typeof refreshedUser !== 'object') {
        const error = new Error('Team member updated, but session refresh failed to return updated access context.');
        error.code = 'session_refresh_failed';
        throw error;
    }
    const accessControl = getAccessControl();
    const assignedProjectIds = accessControl
        ? accessControl.sanitizeAssignedProjectIds(
        refreshedUser.assignedProjectIds !== undefined
            ? refreshedUser.assignedProjectIds
            : refreshedUser.assigned_project_ids
        )
        : (Array.isArray(refreshedUser.assignedProjectIds) ? refreshedUser.assignedProjectIds : []);
    console.info('[SessionState] Forced backend session refresh after team member update', {
        teamMemberId: String(teamMemberId || '').trim(),
        workspaceId: String(refreshedUser.workspaceId || refreshedUser.workspace_id || '').trim(),
        assignedProjectIds
    });
    return refreshedUser;
}

async function updateTeamMember(id, d) {
    if (!canAccessEntity('team')) throw createRestrictedAccessError('team');
    await beginTeamUpdateCacheBypass(id);
    try {
        const doc = withOwnerFields(d);
        const existingLocalRecord = getLocalEntityData('team_members').find(member => String(member && member.id) === String(id)) || null;
        if (isFirebaseConfigured) {
            if (!hasDashboardPermission('team', 'update')) throw createDashboardPermissionError('team', 'update');
            if (isFirebaseUserAuthenticated()) {
                const record = await dashboardApiRequest('PATCH', 'team_members', id, doc);
                if (record) upsertLocalEntityRecord('team_members', record);
                await forceFullSessionRefreshAfterTeamMemberUpdate(id);
                return record;
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
        if (shouldBypassDirectFirestoreForCollection('team_members')) {
            const records = getLocalEntityData('team_members');
            const i = records.findIndex(m => m.id === id);
            if (i > -1) {
                records[i] = { ...records[i], ...doc, storage_fallback: true };
                setLocalEntityData('team_members', records);
                return records[i];
            }
            return upsertLocalEntityRecord('team_members', { ...(existingLocalRecord || {}), id, ...doc, storage_fallback: true });
        }
        await db.collection('team_members').doc(id).update(doc);
        return upsertLocalEntityRecord('team_members', { ...(existingLocalRecord || {}), id, ...doc });
    } finally {
        endTeamUpdateCacheBypass(`team_member_update_${String(id || '').trim()}_complete`);
    }
}

async function deleteTeamMember(id) {
    if (!canAccessEntity('team')) throw createRestrictedAccessError('team');
    if (isFirebaseConfigured) {
        if (!hasDashboardPermission('team', 'delete')) throw createDashboardPermissionError('team', 'delete');
        if (isFirebaseUserAuthenticated()) {
            try {
                await dashboardApiRequest('DELETE', 'team_members', id);
                const remainingRecords = getLocalEntityData('team_members').filter(member => String(member && member.id) !== String(id));
                setLocalEntityData('team_members', remainingRecords);
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
    if (shouldBypassDirectFirestoreForCollection('team_members')) {
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
    if (!isFirebaseConfigured || shouldBypassDirectFirestoreForCollection('activity_log')) return;
    try {
        await db.collection('activity_log').add({
            description,
            user_name: userName,
            created_at: new Date().toISOString()
        });
    } catch (error) {
        if (!shouldUseLocalEntityFallback(error)) {
            throw error;
        }
    }
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

let accessUiSyncDebounceTimer = null;

function scheduleAccessUiStateSync(reason = 'event', delayMs = 350) {
    const normalizedDelayMs = Math.max(300, Number(delayMs) || 350);
    if (accessUiSyncDebounceTimer) {
        window.clearTimeout(accessUiSyncDebounceTimer);
    }
    accessUiSyncDebounceTimer = window.setTimeout(() => {
        accessUiSyncDebounceTimer = null;
        if (SESSION_RUNTIME.inFlightRefreshPromise) {
            console.info('[SessionState] UI sync skipped because /api/me request is already in-flight', { reason });
            Promise.resolve(SESSION_RUNTIME.inFlightRefreshPromise).finally(() => {
                scheduleAccessUiStateSync(`${reason}_post_refresh`, 120);
            });
            return;
        }
        console.info('[SessionState] Running debounced UI sync', { reason });
        syncAccessUiState();
    }, normalizedDelayMs);
}

function handleSessionStorageEvent(event) {
    const key = String(event && event.key || '').trim();
    const isClearAllEvent = !key;
    const isSessionEvent = key === SESSION_STORAGE_KEY;
    const isAuthStateEvent = key === 'nexlance_auth';
    if (!isClearAllEvent && !isSessionEvent && !isAuthStateEvent) {
        return;
    }
    if (!isSessionEvent) {
        scheduleAccessUiStateSync('storage_event_non_session', 400);
        return;
    }

    if (!event.newValue) {
        clearSessionRuntime('storage_event_session_removed');
        scheduleAccessUiStateSync('storage_event_session_removed', 400);
        return;
    }

    let incomingSession = null;
    try {
        incomingSession = JSON.parse(event.newValue);
    } catch (error) {
        console.warn('[SessionState] Ignored storage session update due to invalid JSON payload', { key });
        scheduleAccessUiStateSync('storage_event_invalid_payload', 400);
        return;
    }

    console.info('[SessionState] Storage session update received; payload overwrite is disabled. Triggering server re-hydration.', {
        source: SESSION_UPDATE_SOURCE.STORAGE_EVENT
    });
    if (isFirebaseUserAuthenticated()) {
        ensureSessionHydration('storage_event_session_update', { forceRetry: true }).catch(() => undefined);
    }
    scheduleAccessUiStateSync('storage_event_session_update', 400);
}

window.addEventListener('pageshow', () => scheduleAccessUiStateSync('pageshow', 350));
window.addEventListener('focus', () => scheduleAccessUiStateSync('focus', 350));
window.addEventListener('storage', handleSessionStorageEvent);
window.addEventListener('nexlance-session-context-changed', () => scheduleAccessUiStateSync('session_context_changed', 150));
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) scheduleAccessUiStateSync('visibilitychange', 350);
});
