const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const AccessControl = require('../rbac.js');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(PROJECT_ROOT, '.env');

function loadEnvFile(envPath = ENV_PATH) {
    if (!fs.existsSync(envPath)) return;

    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;

        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex === -1) return;

        const key = trimmed.slice(0, separatorIndex).trim();
        let value = trimmed.slice(separatorIndex + 1).trim();

        if (!key || process.env[key] !== undefined) return;

        if (
            (value.startsWith('"') && value.endsWith('"'))
            || (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        process.env[key] = value;
    });
}

loadEnvFile();

const { getPaymentConfig, createStripePaymentIntent } = require('./services/payments');
const checkoutCompleteHandler = require('./api/checkout-complete');
const checkoutStartHandler = require('./api/checkout-start');
const confirmBusinessUpgradeHandler = require('./api/confirm-business-upgrade');
const polarWebhookHandler = require('./api/polar-webhook');
const stripeWebhookHandler = require('./api/stripe-webhook');
const projectTemplateDownloadHandler = require('./api/project-template-download');
const templateAccessCompleteHandler = require('./api/template-access-complete');
const templateAccessStartHandler = require('./api/template-access-start');
const templateDownloadHandler = require('./api/template-download');
const {
    buildLogoutCookie,
    buildSessionCookie,
    createAdminSession,
    getAdminSessionFromRequest,
    verifyAdminCredentials
} = require('./services/admin-auth');
const { getAdminAnalytics } = require('./services/admin-analytics');
const { authenticateDashboardRequest } = require('./services/dashboard-auth');
const { canPerformCollectionAction, normalizeEmail } = require('./services/dashboard-rbac');
const {
    buildClientAccessFields,
    normalizeProjectAccess,
    syncClientAccessState
} = require('./services/client-access');
const { syncTeamMemberState } = require('./services/team-member-access');
const {
    requireAuth,
    requireOwnerOnly,
    requirePermission
} = require('./services/request-guards');
  const {
      acceptInvitation,
      assertInvitationUsable,
      createInvitation,
      resendInvitation,
      resolveInvitationByToken
} = require('./services/invitations');
const {
    createCollectionDocument,
    deleteCollectionDocument,
    getCollectionDocument,
    listCollectionDocuments,
    patchCollectionDocument,
    queryCollectionDocuments
} = require('./services/firebase-service');

const PORT = Number(process.env.PORT || 4242);
const MAX_PORT_ATTEMPTS = 10;
const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_MAX_LOGIN_ATTEMPTS = 5;
const adminLoginAttempts = new Map();

const PUBLIC_MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.avif': 'image/avif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp4': 'video/mp4'
};

const BLOCKED_STATIC_ROOTS = new Set([
    'api',
    'backend',
    'node_modules',
    '.git',
    '.claude',
    '.vscode'
]);

const BLOCKED_STATIC_FILES = new Set([
    '.env',
    '.env.example',
    'package.json',
    'package-lock.json',
    'server.js'
]);

function sendJson(res, statusCode, payload) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8'
    });
    res.end(JSON.stringify(payload));
}

function sendRedirect(res, location) {
    res.writeHead(302, { Location: location });
    res.end();
}

function isValidEmailAddress(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function parseNonNegativeNumber(value, fieldLabel) {
    if (value === '' || value === null || value === undefined) return 0;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`${fieldLabel} must be a valid non-negative number.`);
    }
    return parsed;
}

function normalizeProjectIdList(value) {
    const source = Array.isArray(value)
        ? value
        : (typeof value === 'string' && value.trim()
            ? value.split(',').map(entry => entry.trim())
            : []);
    return [...new Set(source.map(entry => String(entry || '').trim()).filter(Boolean))];
}

function normalizeClientInvitePayload(body = {}) {
    const metadata = body && typeof body.metadata === 'object' && body.metadata !== null ? body.metadata : {};
    const inviteeName = String(body.name || body.clientName || metadata.name || '').trim();
    const email = String(body.email || body.clientEmail || metadata.email || '').trim().toLowerCase();
    const rawAssignedProjectIds = normalizeProjectIdList(
        body.assignedProjectIds !== undefined
            ? body.assignedProjectIds
            : (metadata.assigned_project_ids !== undefined ? metadata.assigned_project_ids : metadata.assignedProjectIds)
    );
    const allProjectsAccess = body.allProjectsAccess === true
        || body.all_projects_access === true
        || metadata.allProjectsAccess === true
        || metadata.all_projects_access === true
        || String(body.projectAccessScope || body.project_access_scope || metadata.projectAccessScope || metadata.project_access_scope || '').trim().toLowerCase() === 'all';
    const access = normalizeProjectAccess({
        assignedProjectIds: rawAssignedProjectIds,
        allProjectsAccess
    });
    const totalContractValue = parseNonNegativeNumber(
        metadata.total_contract_value !== undefined ? metadata.total_contract_value : metadata.totalContractValue,
        'Total contract value'
    );
    const paidAmount = parseNonNegativeNumber(
        metadata.paid_amount !== undefined ? metadata.paid_amount : metadata.paidAmount,
        'Paid amount'
    );

    if (!inviteeName) {
        throw new Error('Client name is required.');
    }
    if (!email) {
        throw new Error('Client email is required.');
    }
    if (!isValidEmailAddress(email)) {
        throw new Error('Client email must be a valid email address.');
    }
    if (paidAmount > totalContractValue && totalContractValue > 0) {
        throw new Error('Paid amount cannot be greater than total contract value.');
    }

    return {
        inviteeName,
        email,
        assignedProjectIds: access.assignedProjectIds,
        allProjectsAccess: access.allProjectsAccess,
        metadata: {
            ...metadata,
            name: inviteeName,
            email,
            total_contract_value: totalContractValue,
            paid_amount: paidAmount,
            assigned_project_ids: access.assignedProjectIds,
            all_projects_access: access.allProjectsAccess,
            project_access_scope: access.projectAccessScope,
            ...buildClientAccessFields(access)
        }
    };
}

function augmentResponse(res) {
    if (typeof res.status === 'function' && typeof res.json === 'function') {
        return res;
    }

    res.status = function status(statusCode) {
        this.statusCode = statusCode;
        return this;
    };

    res.json = function json(payload) {
        sendJson(this, this.statusCode || 200, payload);
    };

    return res;
}

function isBlockedStaticRequest(reqPath) {
    const pathParts = String(reqPath || '')
        .split('/')
        .filter(Boolean);

    if (pathParts.some(part => part.startsWith('.'))) {
        return true;
    }

    if (pathParts.length && BLOCKED_STATIC_ROOTS.has(pathParts[0])) {
        return true;
    }

    const filename = pathParts[pathParts.length - 1] || 'index.html';
    if (BLOCKED_STATIC_FILES.has(filename)) {
        return true;
    }

    const ext = path.extname(filename).toLowerCase();
    return !PUBLIC_MIME_TYPES[ext];
}

function serveFile(reqPath, res) {
    const safePath = reqPath === '/' ? '/index.html' : reqPath;
    const normalizedRequestPath = path.posix.normalize(safePath);

    if (isBlockedStaticRequest(normalizedRequestPath)) {
        sendJson(res, 404, { error: 'File not found' });
        return;
    }

    const filePath = path.join(PROJECT_ROOT, normalizedRequestPath);
    const normalized = path.normalize(filePath);

    if (!normalized.startsWith(PROJECT_ROOT)) {
        sendJson(res, 403, { error: 'Forbidden' });
        return;
    }

    fs.readFile(normalized, (error, data) => {
        if (error) {
            if (error.code === 'ENOENT') {
                sendJson(res, 404, { error: 'File not found' });
                return;
            }
            sendJson(res, 500, { error: 'Could not read file' });
            return;
        }

        const ext = path.extname(normalized).toLowerCase();
        res.writeHead(200, { 'Content-Type': PUBLIC_MIME_TYPES[ext] || 'application/octet-stream' });
        res.end(data);
    });
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', chunk => {
            raw += chunk;
            if (raw.length > 1e6) {
                reject(new Error('Request body too large.'));
            }
        });
        req.on('end', () => {
            try {
                resolve(raw ? JSON.parse(raw) : {});
            } catch (error) {
                reject(new Error('Invalid JSON body.'));
            }
        });
        req.on('error', reject);
    });
}

function getRequestIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return String(forwarded).split(',')[0].trim();
    }
    return req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
}

function getRequestOrigin(req) {
    if (req.headers.origin) return req.headers.origin;

    const forwardedProtoHeader = Array.isArray(req.headers['x-forwarded-proto'])
        ? req.headers['x-forwarded-proto'][0]
        : req.headers['x-forwarded-proto'];
    const forwardedHostHeader = Array.isArray(req.headers['x-forwarded-host'])
        ? req.headers['x-forwarded-host'][0]
        : req.headers['x-forwarded-host'];
    const protocol = String(
        forwardedProtoHeader
        || (req.socket && req.socket.encrypted ? 'https' : 'http')
    ).split(',')[0].trim() || 'http';
    const host = String(forwardedHostHeader || req.headers.host || 'localhost:4242').split(',')[0].trim();

    return `${protocol}://${host}`;
}

function getLoginAttemptState(ip) {
    const now = Date.now();
    const existing = adminLoginAttempts.get(ip);
    if (!existing || existing.windowStartedAt + ADMIN_LOGIN_WINDOW_MS < now) {
        const nextState = { count: 0, windowStartedAt: now, blockedUntil: 0 };
        adminLoginAttempts.set(ip, nextState);
        return nextState;
    }
    return existing;
}

function recordFailedAdminLogin(ip) {
    const state = getLoginAttemptState(ip);
    state.count += 1;
    if (state.count >= ADMIN_MAX_LOGIN_ATTEMPTS) {
        state.blockedUntil = Date.now() + ADMIN_LOGIN_WINDOW_MS;
    }
    adminLoginAttempts.set(ip, state);
}

function clearAdminLoginAttempts(ip) {
    adminLoginAttempts.delete(ip);
}

function applyCorsHeaders(req, res) {
    const origin = req && req.headers ? req.headers.origin : '';
    if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else {
        res.setHeader('Access-Control-Allow-Origin', '*');
    }
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
}

const DASHBOARD_COLLECTIONS = new Set([
    'clients',
    'invoices',
    'projects',
    'services',
    'tasks',
    'team_members'
]);

const TEMPLATE_WORKSPACE_PATCH_FIELDS = new Set([
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

function parseDashboardRoute(pathname) {
    const match = String(pathname || '').match(/^\/api\/dashboard\/([^/]+)(?:\/([^/]+))?$/);
    if (!match) return null;
    return {
        collectionId: decodeURIComponent(match[1]),
        documentId: match[2] ? decodeURIComponent(match[2]) : ''
    };
}

function sanitizeDashboardPayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return {};
    }

    const next = { ...payload };
    delete next.id;
    delete next.owner_key;
    delete next.owner_email;
    delete next.workspace_id;
    delete next.created_at;
    delete next.updated_at;
    return next;
}

function getWorkspaceOwnerKey(sessionUser = {}) {
    return normalizeEmail(sessionUser.workspaceOwnerEmail || sessionUser.ownerEmail || sessionUser.email);
}

function buildDashboardDocument(payload, sessionUser, isCreate = false) {
    const ownerEmail = getWorkspaceOwnerKey(sessionUser);
    const now = new Date().toISOString();
    return {
        ...sanitizeDashboardPayload(payload),
        owner_key: ownerEmail,
        owner_email: ownerEmail,
        workspace_id: String(sessionUser.workspaceId || '').trim(),
        created_by_user_id: String(sessionUser.uid || '').trim(),
        created_by_email: normalizeEmail(sessionUser.email),
        updated_at: now,
        ...(isCreate ? { created_at: now } : {})
    };
}

function ensureOwnedDocument(record, sessionUser) {
    const ownerEmail = getWorkspaceOwnerKey(sessionUser);
    const recordOwner = normalizeEmail(record && record.owner_key ? record.owner_key : record && record.owner_email ? record.owner_email : '');
    const recordWorkspaceId = String(record && record.workspace_id ? record.workspace_id : '').trim();
    return Boolean(
        (recordOwner && recordOwner === normalizeEmail(ownerEmail))
        || (recordWorkspaceId && recordWorkspaceId === String(sessionUser.workspaceId || '').trim())
    );
}

async function listDashboardCollectionRecords(collectionId, sessionUser) {
    const ownerKey = getWorkspaceOwnerKey(sessionUser);
    const workspaceId = String(sessionUser.workspaceId || '').trim();
    if (!ownerKey && !workspaceId) return [];

    const queryResults = [];
    if (ownerKey) {
        const ownerMatched = await queryCollectionDocuments(collectionId, {
            fieldPath: 'owner_key',
            op: 'EQUAL',
            value: ownerKey,
            limit: 500
        }).catch(() => []);
        queryResults.push(...(Array.isArray(ownerMatched) ? ownerMatched : []));
    }

    if (workspaceId) {
        const workspaceMatched = await queryCollectionDocuments(collectionId, {
            fieldPath: 'workspace_id',
            op: 'EQUAL',
            value: workspaceId,
            limit: 500
        }).catch(() => []);
        queryResults.push(...(Array.isArray(workspaceMatched) ? workspaceMatched : []));
    }

    if (!queryResults.length) {
        const all = await listCollectionDocuments(collectionId, { pageSize: 500 }).catch(() => []);
        return all
            .filter(record => (
                (ownerKey && normalizeEmail(record.owner_key || record.owner_email) === ownerKey)
                || (workspaceId && String(record.workspace_id || '').trim() === workspaceId)
            ))
            .map(record => ({
                id: record.id,
                data: record
            }));
    }

    const seen = new Set();
    return queryResults
        .map(record => ({
            id: record.id || (record.name ? record.name.split('/').pop() : ''),
            data: record.data || record
        }))
        .filter(record => {
            if (!record.id || seen.has(record.id)) return false;
            seen.add(record.id);
            return true;
        });
}

function hasAllProjectsAccess(sessionUser = {}) {
    return sessionUser.allProjectsAccess === true
        || sessionUser.all_projects_access === true
        || String(sessionUser.projectAccessScope || sessionUser.project_access_scope || '').trim().toLowerCase() === 'all';
}

function getScopedProjectIdsFromRecord(recordData = {}, collectionId = '') {
    if (!recordData || typeof recordData !== 'object') return [];
    if (collectionId === 'projects') {
        return [String(recordData.id || '').trim()].filter(Boolean);
    }
    if (collectionId === 'tasks') {
        return [String(recordData.project_id || '').trim()].filter(Boolean);
    }
    return AccessControl.sanitizeAssignedProjectIds([
        ...(Array.isArray(recordData.assigned_project_ids) ? recordData.assigned_project_ids : []),
        ...(Array.isArray(recordData.assignedProjectIds) ? recordData.assignedProjectIds : []),
        recordData.project_id,
        recordData.primary_project_id
    ]);
}

function filterDashboardRecordsForSession(collectionId, records, sessionUser) {
    const assignedProjectIds = new Set(AccessControl.sanitizeAssignedProjectIds(sessionUser.assignedProjectIds));
    const isOwner = AccessControl.isWorkspaceOwner(sessionUser);
    const role = AccessControl.normalizeRole(sessionUser.role || sessionUser.workspaceRole);
    const hasExplicitProjectScope = !isOwner && assignedProjectIds.size > 0;
    const allProjectsAccess = hasAllProjectsAccess(sessionUser);
    const shouldRestrictProjects = role === AccessControl.ROLES.CLIENT || hasExplicitProjectScope;

    if (!shouldRestrictProjects || isOwner || allProjectsAccess) {
        return records;
    }

    return (Array.isArray(records) ? records : []).filter(record => {
        const projectIds = getScopedProjectIdsFromRecord(record && record.data ? record.data : record, collectionId);
        if (!projectIds.length) {
            return false;
        }
        return projectIds.some(projectId => assignedProjectIds.has(String(projectId || '').trim()));
    });
}

function filterDashboardRecordForSession(collectionId, record, sessionUser) {
    return filterDashboardRecordsForSession(collectionId, [record], sessionUser)[0] || null;
}

function isTemplateWorkspacePatchPayload(collectionId, payload) {
    if (collectionId !== 'projects' || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return false;
    }

    const sanitizedPayload = sanitizeDashboardPayload(payload);
    const keys = Object.keys(sanitizedPayload);
    if (!keys.length) {
        return false;
    }

    return keys.every(key => TEMPLATE_WORKSPACE_PATCH_FIELDS.has(String(key || '').trim()));
}

async function handleDashboardApi(req, res, url) {
    const route = parseDashboardRoute(url.pathname);
    if (!route) {
        sendJson(res, 404, { error: 'Dashboard resource not found.' });
        return;
    }

    const session = await authenticateDashboardRequest(req);
    const { authUser, userProfile, sessionUser } = session;

    if (req.method === 'GET' && route.collectionId === 'session') {
        sendJson(res, 200, {
            ok: true,
            authUser,
            userProfile,
            sessionUser
        });
        return;
    }

    if (!DASHBOARD_COLLECTIONS.has(route.collectionId)) {
        sendJson(res, 404, { error: 'Dashboard resource not found.' });
        return;
    }

    if (req.method === 'GET') {
        if (!canPerformCollectionAction({
            collectionId: route.collectionId,
            action: 'read',
            authUser,
            userProfile
        })) {
            sendJson(res, 403, { error: 'Missing or insufficient permissions.' });
            return;
        }

        if (route.documentId) {
            const existing = await getCollectionDocument(route.collectionId, route.documentId);
            if (!existing) {
                sendJson(res, 404, { error: 'Document not found.' });
                return;
            }
            if (!ensureOwnedDocument(existing.data, sessionUser)) {
                sendJson(res, 403, { error: 'You do not have access to this record.' });
                return;
            }

            const filteredRecord = filterDashboardRecordForSession(route.collectionId, {
                id: existing.id || route.documentId,
                data: existing.data
            }, sessionUser);

            if (!filteredRecord) {
                sendJson(res, 403, { error: 'You do not have access to this record.' });
                return;
            }

            sendJson(res, 200, { ok: true, record: { id: filteredRecord.id, ...filteredRecord.data } });
            return;
        }

        const records = await listDashboardCollectionRecords(route.collectionId, sessionUser);
        const filteredRecords = filterDashboardRecordsForSession(route.collectionId, records, sessionUser)
            .map(record => ({ id: record.id, ...record.data }));
        sendJson(res, 200, { ok: true, records: filteredRecords });
        return;
    }

    if (req.method === 'POST') {
        if (!canPerformCollectionAction({
            collectionId: route.collectionId,
            action: 'create',
            authUser,
            userProfile
        })) {
            sendJson(res, 403, { error: 'Missing or insufficient permissions.' });
            return;
        }

        const body = await readBody(req);
        const record = await createCollectionDocument(
            route.collectionId,
            buildDashboardDocument(body, sessionUser, true),
            route.documentId || ''
        );
        let responseRecord = record;
        if (route.collectionId === 'clients') {
            const syncedClientRecord = await syncClientAccessState({ id: record.id, data: record }).catch(() => null);
            if (syncedClientRecord && syncedClientRecord.data) {
                responseRecord = { id: syncedClientRecord.id, ...syncedClientRecord.data };
            }
        }
        if (route.collectionId === 'team_members') {
            const syncedTeamRecord = await syncTeamMemberState({ id: record.id, data: record }).catch(() => null);
            if (syncedTeamRecord && syncedTeamRecord.data) {
                responseRecord = { id: syncedTeamRecord.id, ...syncedTeamRecord.data };
            }
        }
        sendJson(res, 200, { ok: true, record: responseRecord });
        return;
    }

    if (req.method === 'PATCH') {
        if (!route.documentId) {
            sendJson(res, 400, { error: 'Document ID is required.' });
            return;
        }
        const body = await readBody(req);
        const action = isTemplateWorkspacePatchPayload(route.collectionId, body) ? 'read' : 'update';
        if (!canPerformCollectionAction({
            collectionId: route.collectionId,
            action,
            authUser,
            userProfile
        })) {
            sendJson(res, 403, { error: 'Missing or insufficient permissions.' });
            return;
        }

        const existing = await getCollectionDocument(route.collectionId, route.documentId);
        if (!existing) {
            sendJson(res, 404, { error: 'Document not found.' });
            return;
        }
        if (!ensureOwnedDocument(existing.data, sessionUser)) {
            sendJson(res, 403, { error: 'You do not have access to modify this record.' });
            return;
        }

        const record = await patchCollectionDocument(
            route.collectionId,
            route.documentId,
            buildDashboardDocument(body, sessionUser, false)
        );
        let responseRecord = record;
        if (route.collectionId === 'clients') {
            const syncedClientRecord = await syncClientAccessState({ id: route.documentId, data: record }).catch(() => null);
            if (syncedClientRecord && syncedClientRecord.data) {
                responseRecord = { id: syncedClientRecord.id, ...syncedClientRecord.data };
            }
        }
        if (route.collectionId === 'team_members') {
            const syncedTeamRecord = await syncTeamMemberState({ id: route.documentId, data: record }).catch(() => null);
            if (syncedTeamRecord && syncedTeamRecord.data) {
                responseRecord = { id: syncedTeamRecord.id, ...syncedTeamRecord.data };
            }
        }
        sendJson(res, 200, { ok: true, record: responseRecord });
        return;
    }

    if (req.method === 'DELETE') {
        if (!route.documentId) {
            sendJson(res, 400, { error: 'Document ID is required.' });
            return;
        }
        if (!canPerformCollectionAction({
            collectionId: route.collectionId,
            action: 'delete',
            authUser,
            userProfile
        })) {
            sendJson(res, 403, { error: 'Missing or insufficient permissions.' });
            return;
        }

        const existing = await getCollectionDocument(route.collectionId, route.documentId);
        if (!existing) {
            sendJson(res, 404, { error: 'Document not found.' });
            return;
        }
        if (!ensureOwnedDocument(existing.data, sessionUser)) {
            sendJson(res, 403, { error: 'You do not have access to delete this record.' });
            return;
        }

        await deleteCollectionDocument(route.collectionId, route.documentId);
        sendJson(res, 200, { ok: true });
        return;
    }

    sendJson(res, 405, { error: 'Method not allowed' });
}

const server = http.createServer(async (req, res) => {
    if (!req.url) {
        sendJson(res, 400, { error: 'Invalid request' });
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const adminSession = getAdminSessionFromRequest(req);
    applyCorsHeaders(req, res);

    if (req.method === 'GET' && url.pathname === '/admin.html' && !adminSession) {
        sendRedirect(res, '/admin-login.html?redirect=admin.html');
        return;
    }

    if (req.method === 'GET' && url.pathname === '/admin-login.html' && adminSession) {
        sendRedirect(res, '/admin.html');
        return;
    }

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/me') {
        try {
            const session = await requireAuth(req);
            sendJson(res, 200, {
                ok: true,
                user: session.sessionUser
            });
        } catch (error) {
            sendJson(res, error.statusCode || 401, { error: error.message || 'Authentication is required.' });
        }
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/me/permissions') {
        try {
            const session = await requireAuth(req);
            sendJson(res, 200, {
                ok: true,
                role: session.sessionUser.role,
                isWorkspaceOwner: session.sessionUser.isWorkspaceOwner,
                permissionKeys: session.sessionUser.permissionKeys,
                permissions: session.sessionUser.permissions,
                allowedPages: AccessControl.getAllowedPages(session.sessionUser)
            });
        } catch (error) {
            sendJson(res, error.statusCode || 401, { error: error.message || 'Authentication is required.' });
        }
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/invitations/resolve') {
        try {
            const token = String(url.searchParams.get('token') || '').trim();
            if (!token) {
                sendJson(res, 400, { error: 'Invitation token is required.' });
                return;
            }

              const invitation = await resolveInvitationByToken(token);
              const record = assertInvitationUsable(invitation);
              sendJson(res, 200, {
                  ok: true,
                  invitation: {
                    id: invitation.id,
                    inviteType: record.inviteType,
                    inviteeName: record.inviteeName,
                    email: record.email,
                    role: record.role,
                    workspaceId: record.workspaceId,
                    expiresAt: record.expiresAt,
                    status: record.status,
                    assignedProjectIds: record.assignedProjectIds || [],
                    allProjectsAccess: record.allProjectsAccess === true,
                    projectAccessScope: record.projectAccessScope || (record.allProjectsAccess ? 'all' : 'selected')
                }
            });
        } catch (error) {
            sendJson(res, 400, { error: error.message || 'Invitation is invalid or has expired.' });
        }
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/invitations') {
        try {
            const session = await requireAuth(req);
            requireOwnerOnly(session);
            const invites = await queryCollectionDocuments('invitations', {
                fieldPath: 'workspaceId',
                op: 'EQUAL',
                value: String(session.sessionUser.workspaceId || '').trim(),
                limit: 500
            }).catch(() => []);

            sendJson(res, 200, {
                ok: true,
                records: (Array.isArray(invites) ? invites : []).map(record => ({
                    id: record.id,
                    ...(record.data || {})
                }))
            });
        } catch (error) {
            sendJson(res, error.statusCode || 400, { error: error.message || 'Invitations could not be loaded.' });
        }
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/invitations/accept') {
        try {
            const session = await requireAuth(req);
            const body = await readBody(req);
            const token = String(body.token || '').trim();
            if (!token) {
                sendJson(res, 400, { error: 'Invitation token is required.' });
                return;
            }

            const result = await acceptInvitation({
                session,
                token
            });
            sendJson(res, 200, {
                ok: true,
                ...result
            });
        } catch (error) {
            sendJson(res, error.statusCode || 400, { error: error.message || 'Invitation could not be accepted.' });
        }
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/invitations/client') {
        try {
            const session = await requireAuth(req);
            requireOwnerOnly(session);
            const body = await readBody(req);
            const normalizedPayload = normalizeClientInvitePayload(body);
            const result = await createInvitation({
                session,
                inviteType: 'client',
                inviteeName: normalizedPayload.inviteeName,
                email: normalizedPayload.email,
                role: 'client',
                assignedProjectIds: normalizedPayload.assignedProjectIds,
                allProjectsAccess: normalizedPayload.allProjectsAccess,
                origin: getRequestOrigin(req),
                metadata: normalizedPayload.metadata
            });
            sendJson(res, 200, {
                ok: true,
                invitation: result.invitation,
                record: result.targetRecord
            });
        } catch (error) {
            sendJson(res, error.statusCode || 400, { error: error.message || 'Client invitation could not be sent.' });
        }
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/invitations/team') {
        try {
            const session = await requireAuth(req);
            requireOwnerOnly(session);
            const body = await readBody(req);
            const result = await createInvitation({
                session,
                inviteType: 'team',
                inviteeName: String(body.name || body.memberName || '').trim(),
                email: String(body.email || body.memberEmail || '').trim(),
                role: String(body.role || '').trim(),
                assignedProjectIds: body.assignedProjectIds || [],
                origin: getRequestOrigin(req),
                metadata: body.metadata || {}
            });
            sendJson(res, 200, {
                ok: true,
                invitation: result.invitation,
                record: result.targetRecord
            });
        } catch (error) {
            sendJson(res, error.statusCode || 400, { error: error.message || 'Team invitation could not be sent.' });
        }
        return;
    }

    if (req.method === 'POST' && /^\/api\/invitations\/[^/]+\/resend$/.test(url.pathname)) {
        try {
            const session = await requireAuth(req);
            requireOwnerOnly(session);
            const invitationId = decodeURIComponent(url.pathname.split('/')[3] || '');
            const invitation = await resendInvitation({
                invitationId,
                session,
                origin: getRequestOrigin(req)
            });
            sendJson(res, 200, {
                ok: true,
                invitation
            });
        } catch (error) {
            sendJson(res, error.statusCode || 400, { error: error.message || 'Invitation could not be resent.' });
        }
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/projects') {
        try {
            const session = await requireAuth(req);
            requirePermission(session, AccessControl.PERMISSIONS.VIEW_PROJECTS);
            const records = await listDashboardCollectionRecords('projects', session.sessionUser);
            const filteredRecords = filterDashboardRecordsForSession('projects', records, session.sessionUser)
                .map(record => ({ id: record.id, ...record.data }));
            sendJson(res, 200, {
                ok: true,
                records: filteredRecords
            });
        } catch (error) {
            sendJson(res, error.statusCode || 400, { error: error.message || 'Projects could not be loaded.' });
        }
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/team/members') {
        try {
            const session = await requireAuth(req);
            requirePermission(session, AccessControl.PERMISSIONS.MANAGE_TEAM_MEMBERS);
            const records = await listDashboardCollectionRecords('team_members', session.sessionUser);
            sendJson(res, 200, {
                ok: true,
                records: records.map(record => ({ id: record.id, ...record.data }))
            });
        } catch (error) {
            sendJson(res, error.statusCode || 400, { error: error.message || 'Team members could not be loaded.' });
        }
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/payments/summary') {
        try {
            const session = await requireAuth(req);
            requireOwnerOnly(session);
            const ownerEmail = getWorkspaceOwnerKey(session.sessionUser);
            const payments = await queryCollectionDocuments('payments', {
                fieldPath: 'userEmail',
                op: 'EQUAL',
                value: ownerEmail,
                limit: 500
            }).catch(() => []);
            sendJson(res, 200, {
                ok: true,
                records: (Array.isArray(payments) ? payments : []).map(record => ({
                    id: record.id,
                    ...(record.data || {})
                }))
            });
        } catch (error) {
            sendJson(res, error.statusCode || 400, { error: error.message || 'Payments could not be loaded.' });
        }
        return;
    }

    if (url.pathname.startsWith('/api/admin/') && url.pathname !== '/api/admin/login' && !adminSession) {
        sendJson(res, 401, { error: 'Admin authentication is required.' });
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/login') {
        try {
            const ip = getRequestIp(req);
            const attemptState = getLoginAttemptState(ip);
            if (attemptState.blockedUntil && attemptState.blockedUntil > Date.now()) {
                sendJson(res, 429, { error: 'Too many admin login attempts. Please try again later.' });
                return;
            }

            const body = await readBody(req);
            const email = String(body.email || '').trim().toLowerCase();
            const password = String(body.password || '');
            const isValid = verifyAdminCredentials(email, password);

            if (!isValid) {
                recordFailedAdminLogin(ip);
                sendJson(res, 401, { error: 'Invalid admin credentials.' });
                return;
            }

            clearAdminLoginAttempts(ip);
            const token = createAdminSession(email);
            res.setHeader('Set-Cookie', buildSessionCookie(token));
            sendJson(res, 200, {
                ok: true,
                email
            });
        } catch (error) {
            sendJson(res, 400, { error: error.message || 'Admin login failed.' });
        }
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/session') {
        sendJson(res, 200, {
            authenticated: Boolean(adminSession),
            email: adminSession ? adminSession.email : '',
            expiresAt: adminSession ? adminSession.exp : 0
        });
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
        res.setHeader('Set-Cookie', buildLogoutCookie());
        sendJson(res, 200, { ok: true });
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/analytics') {
        try {
            const payload = await getAdminAnalytics({
                search: url.searchParams.get('search') || ''
            });
            sendJson(res, 200, payload);
        } catch (error) {
            sendJson(res, 500, { error: error.message || 'Admin analytics could not be loaded.' });
        }
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/create-payment-intent') {
        try {
            const body = await readBody(req);
            const payload = await createStripePaymentIntent(body);
            sendJson(res, 200, payload);
        } catch (error) {
            sendJson(res, 400, { error: error.message || 'Payment intent could not be created.' });
        }
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/checkout-start') {
        try {
            req.body = await readBody(req);
            await checkoutStartHandler(req, augmentResponse(res));
        } catch (error) {
            sendJson(res, 400, { error: error.message || 'Checkout could not be started.' });
        }
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/checkout-complete') {
        try {
            req.body = await readBody(req);
            await checkoutCompleteHandler(req, augmentResponse(res));
        } catch (error) {
            sendJson(res, 400, { error: error.message || 'Checkout could not be verified.' });
        }
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/confirm-business-upgrade') {
        try {
            req.body = await readBody(req);
            await confirmBusinessUpgradeHandler(req, augmentResponse(res));
        } catch (error) {
            sendJson(res, 400, { error: error.message || 'Business upgrade could not be confirmed.' });
        }
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/stripe-webhook') {
        await stripeWebhookHandler(req, augmentResponse(res));
        return;
    }

    if (
        url.pathname === '/api/polar-webhook'
        || url.pathname === '/api/webhooks/polar'
    ) {
        await polarWebhookHandler(req, augmentResponse(res));
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/payment-config') {
        sendJson(res, 200, getPaymentConfig());
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/template-access-start') {
        try {
            req.body = await readBody(req);
            await templateAccessStartHandler(req, augmentResponse(res));
        } catch (error) {
            sendJson(res, 400, { error: error.message || 'Template checkout could not be started.' });
        }
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/template-access-complete') {
        try {
            req.body = await readBody(req);
            await templateAccessCompleteHandler(req, augmentResponse(res));
        } catch (error) {
            sendJson(res, 400, { error: error.message || 'Template checkout could not be verified.' });
        }
        return;
    }

    if (req.method === 'GET' && url.pathname === '/api/template-download') {
        await templateDownloadHandler(req, augmentResponse(res));
        return;
    }

    if (req.method === 'POST' && url.pathname === '/api/project-template-download') {
        try {
            req.body = await readBody(req);
            await projectTemplateDownloadHandler(req, augmentResponse(res));
        } catch (error) {
            sendJson(res, error.statusCode || 400, {
                error: error.message || 'Project template download could not be prepared.'
            });
        }
        return;
    }

    if (url.pathname.startsWith('/api/dashboard/')) {
        try {
            await handleDashboardApi(req, res, url);
        } catch (error) {
            sendJson(res, error.statusCode || 500, {
                error: error.message || 'Dashboard request failed.'
            });
        }
        return;
    }

    if (req.method === 'GET') {
        serveFile(url.pathname, res);
        return;
    }

    sendJson(res, 405, { error: 'Method not allowed' });
});

function startServer(preferredPort, attemptsLeft = MAX_PORT_ATTEMPTS) {
    server.listen(preferredPort, () => {
        console.log(`Nexlance server running at http://localhost:${preferredPort}`);
        if (preferredPort !== PORT) {
            console.log(`Preferred port ${PORT} was busy, so the server started on ${preferredPort} instead.`);
        }
    });

    server.once('error', error => {
        if (error.code === 'EADDRINUSE' && attemptsLeft > 0) {
            const nextPort = preferredPort + 1;
            console.warn(`Port ${preferredPort} is already in use. Trying port ${nextPort}...`);
            server.close(() => {
                startServer(nextPort, attemptsLeft - 1);
            });
            return;
        }

        if (error.code === 'EADDRINUSE') {
            console.error(`Could not start the server because ports ${PORT}-${preferredPort} are all in use.`);
            console.error('Stop the existing process or set a free port with the PORT environment variable.');
            process.exit(1);
        }

        console.error('Server failed to start:', error.message || error);
        process.exit(1);
    });
}

startServer(PORT);
