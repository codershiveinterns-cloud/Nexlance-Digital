const AccessControl = require('../../rbac.js');
const { authenticateDashboardRequest } = require('../services/dashboard-auth');
const { requireInitializedUser } = require('../services/request-guards');
const { canPerformCollectionAction, normalizeEmail } = require('../services/dashboard-rbac');
const { syncClientAccessState } = require('../services/client-access');
const { syncTeamMemberState } = require('../services/team-member-access');
const { invalidateSessionCache } = require('../services/workspace-access');
const {
    createCollectionDocument,
    deleteCollectionDocument,
    getCollectionDocument,
    patchCollectionDocument,
    queryCollectionDocuments,
    sanitizeDocumentId,
    upsertCollectionDocument
} = require('../services/firebase-service');
const { handleOptions, normalizeBody, sendApiError, setApiCors } = require('./_utils');

// ─── 30-second TTL cache for dashboard list queries ───
// Invalidated on any create/patch/delete to same (workspace, collection) pair.
const DASHBOARD_LIST_CACHE_TTL_MS = 30 * 1000;
const DASHBOARD_LIST_CACHE_MAX = 200;
const _dashboardListCache = new Map();

function _dashboardListCacheKey(collectionId, sessionUser) {
    const ws = String(sessionUser && sessionUser.workspaceId || '').trim();
    const owner = normalizeEmail(sessionUser && (sessionUser.workspaceOwnerEmail || sessionUser.ownerEmail || sessionUser.email));
    return `${collectionId}::${ws}::${owner}`;
}

function _getDashboardListCache(key) {
    const entry = _dashboardListCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > DASHBOARD_LIST_CACHE_TTL_MS) {
        _dashboardListCache.delete(key);
        return null;
    }
    return entry.records;
}

function _setDashboardListCache(key, records) {
    if (_dashboardListCache.size >= DASHBOARD_LIST_CACHE_MAX) {
        const firstKey = _dashboardListCache.keys().next().value;
        _dashboardListCache.delete(firstKey);
    }
    _dashboardListCache.set(key, { records, timestamp: Date.now() });
}

function _invalidateDashboardListCache(collectionId, sessionUser) {
    const ws = String(sessionUser && sessionUser.workspaceId || '').trim();
    const prefix = `${collectionId}::${ws}::`;
    for (const key of _dashboardListCache.keys()) {
        if (key.startsWith(prefix)) _dashboardListCache.delete(key);
    }
}

// Cross-module invalidation: bust every cached list for a given workspaceId,
// regardless of collection.  Called from invitation acceptance so the first
// post-accept dashboard load doesn't serve a pre-accept empty result.
function invalidateDashboardListCacheByWorkspace(workspaceId) {
    const ws = String(workspaceId || '').trim();
    if (!ws) return;
    const suffix = `::${ws}::`;
    for (const key of _dashboardListCache.keys()) {
        if (key.includes(suffix)) _dashboardListCache.delete(key);
    }
}

const DASHBOARD_COLLECTIONS = new Set([
    'clients',
    'invoices',
    'projects',
    'services',
    'tasks',
    'team_members'
]);

const PROJECT_TEMPLATE_WORKSPACE_MUTATION_FIELDS = new Set([
    'template_state',
    'template_last_saved_at',
    'template_saved_html',
    'template_workflow_status',
    'template_completed_at',
    'template_download_paid',
    'template_download_paid_at',
    'template_download_payment_intent_id',
    'template_download_amount_gbp'
]);

// ─── Team member role/permission validation ──────────────────────
// Runs on POST/PATCH for 'team_members'. Rejects unknown roles and
// malformed permission fields before any Firestore write.
const ALLOWED_TEAM_ROLES = new Set([
    AccessControl.ROLES.ADMIN,
    AccessControl.ROLES.DEVELOPER,
    AccessControl.ROLES.DESIGNER,
    AccessControl.ROLES.TEAM_MEMBER,
    AccessControl.ROLES.CLIENT
]);

function validateTeamMemberPayload(payload, { isCreate }) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        const err = new Error('Team member payload must be an object.');
        err.statusCode = 400;
        throw err;
    }

    const hasRole = Object.prototype.hasOwnProperty.call(payload, 'role')
        || Object.prototype.hasOwnProperty.call(payload, 'canonical_role');
    if (hasRole) {
        const rawRole = payload.canonical_role || payload.role;
        const normalized = AccessControl.normalizeRole(rawRole);
        if (!normalized || !ALLOWED_TEAM_ROLES.has(normalized)) {
            const err = new Error(`Team member "role" must resolve to one of: ${Array.from(ALLOWED_TEAM_ROLES).join(', ')}.`);
            err.statusCode = 400;
            throw err;
        }
    } else if (isCreate) {
        const err = new Error('Team member "role" is required on create.');
        err.statusCode = 400;
        throw err;
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'email')) {
        const email = String(payload.email || '').trim();
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            const err = new Error('Team member "email" must be a valid email address.');
            err.statusCode = 400;
            throw err;
        }
    }

    if (Object.prototype.hasOwnProperty.call(payload, 'assigned_project_ids')) {
        if (!Array.isArray(payload.assigned_project_ids)) {
            const err = new Error('Team member "assigned_project_ids" must be an array.');
            err.statusCode = 400;
            throw err;
        }
    }

    const booleanPermissionFields = [
        'can_edit_tasks', 'can_see_revenue', 'can_create_invoices',
        'can_upload_files', 'all_projects_access'
    ];
    for (const field of booleanPermissionFields) {
        if (!Object.prototype.hasOwnProperty.call(payload, field)) continue;
        if (typeof payload[field] !== 'boolean') {
            const err = new Error(`Team member "${field}" must be a boolean.`);
            err.statusCode = 400;
            throw err;
        }
    }
}

// ─── Invoice financial-integrity validation ──────────────────────
// Runs on POST/PATCH for the 'invoices' collection. Rejects negative
// numbers, non-finite values, and status values outside the allowed set.
// Partial payloads are allowed on PATCH — fields absent from the body
// are not validated.
const ALLOWED_INVOICE_STATUSES = new Set([
    'draft', 'pending', 'paid', 'overdue', 'recurring', 'cancelled', 'refunded'
]);
const INVOICE_NUMERIC_FIELDS = ['amount', 'total_amount', 'gst_percent', 'paid_amount'];

function validateInvoicePayload(payload, { isCreate }) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        const err = new Error('Invoice payload must be an object.');
        err.statusCode = 400;
        throw err;
    }
    for (const field of INVOICE_NUMERIC_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(payload, field)) continue;
        const raw = payload[field];
        if (raw === '' || raw === null) continue;
        const num = Number(raw);
        if (!Number.isFinite(num) || num < 0) {
            const err = new Error(`Invoice "${field}" must be a non-negative number.`);
            err.statusCode = 400;
            throw err;
        }
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'status')) {
        const status = String(payload.status || '').trim().toLowerCase();
        if (status && !ALLOWED_INVOICE_STATUSES.has(status)) {
            const err = new Error(`Invoice "status" must be one of: ${Array.from(ALLOWED_INVOICE_STATUSES).join(', ')}.`);
            err.statusCode = 400;
            throw err;
        }
    }
    // Cross-field invariant: paid_amount cannot exceed total_amount when both present.
    if (
        Object.prototype.hasOwnProperty.call(payload, 'paid_amount')
        && Object.prototype.hasOwnProperty.call(payload, 'total_amount')
    ) {
        const paid = Number(payload.paid_amount);
        const total = Number(payload.total_amount);
        if (Number.isFinite(paid) && Number.isFinite(total) && total > 0 && paid > total) {
            const err = new Error('Invoice "paid_amount" cannot exceed "total_amount".');
            err.statusCode = 400;
            throw err;
        }
    }
    // Create-only: at least one monetary field required to prevent empty invoices.
    if (isCreate) {
        const hasAnyAmount = INVOICE_NUMERIC_FIELDS.some(f =>
            Object.prototype.hasOwnProperty.call(payload, f)
            && payload[f] !== '' && payload[f] !== null
            && Number.isFinite(Number(payload[f]))
        );
        if (!hasAnyAmount) {
            const err = new Error('Invoice must include at least one monetary amount (amount / total_amount).');
            err.statusCode = 400;
            throw err;
        }
    }
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

function ensureOwnedDocument(record, sessionUser, collectionId = '') {
    const ownerEmail = getWorkspaceOwnerKey(sessionUser);
    const recordOwner = normalizeEmail(record && record.owner_key ? record.owner_key : record && record.owner_email ? record.owner_email : '');
    const recordWorkspaceId = String(record && record.workspace_id ? record.workspace_id : '').trim();
    const sessionWorkspaceId = String(sessionUser.workspaceId || '').trim();

    // For projects: match by workspace_id OR by owner_key (handles projects with empty workspace_id)
    if (String(collectionId || '').trim() === 'projects') {
        return Boolean(
            (recordWorkspaceId && sessionWorkspaceId && recordWorkspaceId === sessionWorkspaceId)
            || (recordOwner && ownerEmail && recordOwner === normalizeEmail(ownerEmail))
        );
    }
    return Boolean(
        (recordOwner && recordOwner === normalizeEmail(ownerEmail))
        || (recordWorkspaceId && sessionWorkspaceId && recordWorkspaceId === sessionWorkspaceId)
    );
}

function getRecordWorkspaceId(record = {}) {
    return String(record && (record.workspace_id || record.workspaceId) || '').trim();
}

function isProjectWorkspaceConsistent(record = {}, sessionUser = {}) {
    const expectedWorkspaceId = String(sessionUser.workspaceId || '').trim();
    if (!expectedWorkspaceId) return true;
    const actualWorkspaceId = getRecordWorkspaceId(record);
    if (actualWorkspaceId && actualWorkspaceId === expectedWorkspaceId) {
        return true;
    }
    console.error('[WorkspaceConsistency] Dashboard project record workspace mismatch', {
        projectId: String(record.id || '').trim(),
        expectedWorkspaceId,
        actualWorkspaceId
    });
    return false;
}

async function rehydrateAssignedProjectIdsFromAssignments(sessionUser) {
    const workspaceId = String(sessionUser.workspaceId || '').trim();
    const userId = String(sessionUser.uid || '').trim();
    const email = normalizeEmail(sessionUser.email);
    if (!workspaceId || (!userId && !email)) return [];

    // 1) project_assignments (primary source written at invite-accept time)
    const ids = new Set();
    const assignmentRecords = await queryCollectionDocuments('project_assignments', {
        fieldPath: userId ? 'userId' : 'email',
        op: 'EQUAL',
        value: userId || email,
        limit: 500
    }).catch(() => []);
    for (const entry of (Array.isArray(assignmentRecords) ? assignmentRecords : [])) {
        const data = entry.data || entry;
        const recordWs = String(data.workspaceId || data.workspace_id || '').trim();
        if (recordWs !== workspaceId) continue;
        const status = String(data.status || '').trim().toLowerCase();
        if (status && status !== 'active') continue;
        const projectId = String(data.projectId || data.project_id || '').trim();
        if (projectId) ids.add(projectId);
    }
    if (ids.size) return Array.from(ids);

    // 2) Fallback — source-of-truth collections the owner edits from the UI
    if (!email) return [];
    const role = AccessControl.normalizeRole(sessionUser.role || sessionUser.workspaceRole);
    const fallbackCollection = role === AccessControl.ROLES.CLIENT ? 'clients' : 'team_members';
    const fallbackDocId = sanitizeDocumentId(`${workspaceId}_${email}`);
    const fallbackDoc = await getCollectionDocument(fallbackCollection, fallbackDocId).catch(() => null);
    const fallbackData = fallbackDoc && fallbackDoc.data ? fallbackDoc.data : null;

    const fallbackIds = fallbackData
        ? AccessControl.sanitizeAssignedProjectIds(
            fallbackData.assigned_project_ids
            || fallbackData.assignedProjectIds
            || (fallbackData.project_id ? [fallbackData.project_id] : [])
        )
        : [];

    if (!fallbackIds.length) return [];

    console.info('[DashboardProjects] assignment filter', {
        workspaceId,
        source: `rehydrated_from_${fallbackCollection}`,
        count: fallbackIds.length
    });

    // Opportunistic backfill: repair users/{uid} and project_assignments so
    // subsequent requests are fast and consistent.
    const now = new Date().toISOString();
    if (userId) {
        await patchCollectionDocument('users', userId, {
            assignedProjectIds: fallbackIds,
            allProjectsAccess: fallbackData.all_projects_access === true || fallbackData.allProjectsAccess === true,
            updatedAt: now
        }).catch(() => undefined);
    }
    for (const projectId of fallbackIds) {
        const assignmentId = sanitizeDocumentId(`${workspaceId}_${projectId}_${email}`);
        await upsertCollectionDocument('project_assignments', assignmentId, {
            workspaceId,
            workspace_id: workspaceId,
            projectId,
            project_id: projectId,
            userId: userId || '',
            user_id: userId || '',
            email,
            user_email: email,
            role,
            status: 'active',
            active: true,
            createdAt: now,
            created_at: now,
            updatedAt: now,
            updated_at: now
        }).catch(() => undefined);
    }

    return fallbackIds;
}

async function listDashboardCollectionRecords(collectionId, sessionUser) {
    const workspaceId = String(sessionUser.workspaceId || '').trim();
    if (!workspaceId) {
        const error = new Error('No workspace is attached to this session.');
        error.statusCode = 403;
        error.code = 'WORKSPACE_UNRESOLVED';
        throw error;
    }

    const role = AccessControl.normalizeRole(sessionUser.role || sessionUser.workspaceRole);
    const isScopedRole = role === AccessControl.ROLES.CLIENT
        || role === AccessControl.ROLES.DEVELOPER
        || role === AccessControl.ROLES.DESIGNER;
    const allProjectsAccess = hasAllProjectsAccess(sessionUser);

    if (collectionId === 'projects' && isScopedRole && !allProjectsAccess) {
        let assignedIds = AccessControl.sanitizeAssignedProjectIds(sessionUser.assignedProjectIds);
        if (!assignedIds.length) {
            const rehydrated = await rehydrateAssignedProjectIdsFromAssignments(sessionUser);
            if (rehydrated.length) {
                console.info('[DashboardProjects] assignment filter', {
                    workspaceId,
                    source: 'rehydrated_from_project_assignments',
                    count: rehydrated.length
                });
                sessionUser.assignedProjectIds = rehydrated;
                assignedIds = rehydrated;
            } else {
                console.warn('[DashboardProjects] empty assignments', {
                    workspaceId,
                    role,
                    userId: sessionUser.uid,
                    email: normalizeEmail(sessionUser.email)
                });
                return [];
            }
        }
        // Scoped-role fast path: fetch projects by ID directly.  The
        // project_assignments list is the authoritative scope (written only
        // via validated flows: acceptInvitation + syncProjectAssignments),
        // so cross-checking against workspace_id is both redundant and
        // fragile — stale workspace stamping on legacy accounts causes the
        // workspace query below to drop valid projects.
        const projectDocs = await Promise.all(
            assignedIds.map(projectId => getCollectionDocument('projects', projectId).catch(() => null))
        );
        const scopedProjects = projectDocs
            .filter(doc => doc && doc.data)
            .map(doc => ({ id: doc.id, data: doc.data }));
        const foundIds = new Set(scopedProjects.map(p => p.id));
        console.info('[DashboardProjects] scoped-by-id fetch', {
            role,
            userId: sessionUser.uid,
            email: normalizeEmail(sessionUser.email),
            assignedCount: assignedIds.length,
            foundCount: scopedProjects.length,
            missingIds: assignedIds.filter(pid => !foundIds.has(pid))
        });
        return scopedProjects;
    }

    const cacheKey = _dashboardListCacheKey(collectionId, sessionUser);
    const cached = _getDashboardListCache(cacheKey);
    if (cached) return cached;

    console.info('[DashboardProjects] workspace query', {
        collectionId,
        workspaceId,
        role,
        isScopedRole,
        allProjectsAccess
    });

    const queryResults = await queryCollectionDocuments(collectionId, {
        fieldPath: 'workspace_id',
        op: 'EQUAL',
        value: workspaceId,
        limit: 500
    }).catch(() => []);

    const seen = new Set();
    const deduped = (Array.isArray(queryResults) ? queryResults : [])
        .map(record => ({
            id: record.id || (record.name ? record.name.split('/').pop() : ''),
            data: record.data || record
        }))
        .filter(record => {
            if (!record.id || seen.has(record.id)) return false;
            seen.add(record.id);
            return true;
        });

    // Strict workspace membership check — drop any record whose workspace_id doesn't match.
    const workspaceMatched = deduped.filter(record => {
        const recordWs = String(record.data && (record.data.workspace_id || record.data.workspaceId) || '').trim();
        if (recordWs === workspaceId) return true;
        console.warn('[DashboardProjects] dropping record with mismatched workspace_id', {
            collectionId,
            recordId: record.id,
            recordWorkspaceId: recordWs,
            expectedWorkspaceId: workspaceId
        });
        return false;
    });

    console.info('[DashboardProjects] final count', {
        collectionId,
        workspaceId,
        fetched: deduped.length,
        retained: workspaceMatched.length
    });

    _setDashboardListCache(cacheKey, workspaceMatched);
    return workspaceMatched;
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

function validateProjectAssignmentForWorkspace(projectRecords, assignedProjectIds, workspaceId) {
    const normalizedWorkspaceId = String(workspaceId || '').trim();
    const validProjectIds = new Set();
    const invalidProjectIds = [];
    const projectIdToWorkspace = new Map();

    (Array.isArray(projectRecords) ? projectRecords : []).forEach(record => {
        const entry = record && record.data
            ? { id: record.id, data: record.data }
            : { id: record && record.id, data: record || {} };
        const projectId = String(entry.id || '').trim();
        const projectWorkspaceId = String(entry.data.workspace_id || entry.data.workspaceId || '').trim();
        if (projectId) {
            projectIdToWorkspace.set(projectId, projectWorkspaceId);
        }
    });

    (Array.isArray(assignedProjectIds) ? assignedProjectIds : []).forEach(projectId => {
        const normalizedId = String(projectId || '').trim();
        if (!normalizedId) return;

        const projectWorkspaceId = projectIdToWorkspace.get(normalizedId);
        if (!projectWorkspaceId) {
            invalidProjectIds.push(normalizedId);
            return;
        }

        if (normalizedWorkspaceId && projectWorkspaceId !== normalizedWorkspaceId) {
            invalidProjectIds.push(normalizedId);
            console.error('[WorkspaceConsistency] Project assignment workspace mismatch', {
                projectId: normalizedId,
                expectedWorkspaceId: normalizedWorkspaceId,
                actualWorkspaceId: projectWorkspaceId
            });
            return;
        }

        validProjectIds.add(normalizedId);
    });

    if (invalidProjectIds.length) {
        console.warn('[WorkspaceConsistency] Invalid project assignments filtered out', {
            workspaceId: normalizedWorkspaceId,
            invalidProjectIds,
            validProjectIds: Array.from(validProjectIds)
        });
    }

    return {
        validProjectIds: Array.from(validProjectIds),
        invalidProjectIds
    };
}

function filterDashboardRecordsForSession(collectionId, records, sessionUser) {
    const workspaceId = String(sessionUser.workspaceId || '').trim();
    const rawAssignedProjectIds = AccessControl.sanitizeAssignedProjectIds(sessionUser.assignedProjectIds);
    const isOwner = AccessControl.isWorkspaceOwner(sessionUser);
    const role = AccessControl.normalizeRole(sessionUser.role || sessionUser.workspaceRole);
    const isAdmin = role === AccessControl.ROLES.ADMIN;
    const allProjectsAccess = hasAllProjectsAccess(sessionUser);
    const roleRequiresProjectAssignments = role === AccessControl.ROLES.CLIENT
        || role === AccessControl.ROLES.DEVELOPER
        || role === AccessControl.ROLES.DESIGNER;
    const shouldRestrictProjects = roleRequiresProjectAssignments || (rawAssignedProjectIds.length > 0 && !isOwner);

    console.info('[DashboardProjects] Debug - assignedProjectIds', {
        rawAssignedProjectIds,
        workspaceId,
        role,
        isOwner,
        isAdmin,
        allProjectsAccess,
        shouldRestrictProjects
    });

    console.info('[DashboardProjects] Debug - fetched projects count', {
        count: (Array.isArray(records) ? records : []).length
    });

    const { validProjectIds, invalidProjectIds } = validateProjectAssignmentForWorkspace(
        records,
        rawAssignedProjectIds,
        workspaceId
    );

    console.info('[DashboardProjects] Debug - filtered result', {
        validProjectIds,
        invalidProjectIds,
        originalCount: rawAssignedProjectIds.length
    });

    const assignedProjectIds = new Set(validProjectIds);

    if (isOwner || isAdmin || allProjectsAccess) {
        return records;
    }

    // Scoped roles with no valid assignments see nothing — not everything
    if (roleRequiresProjectAssignments && assignedProjectIds.size === 0) {
        console.info('[DashboardProjects] Scoped role with no valid assignments — returning empty', {
            role,
            workspaceId
        });
        return [];
    }

    if (!shouldRestrictProjects) {
        return records;
    }

    return (Array.isArray(records) ? records : []).filter(record => {
        // Records from listDashboardCollectionRecords have shape { id, data }.
        // getScopedProjectIdsFromRecord reads recordData.id for the projects
        // collection, so we must surface the outer doc id into the payload
        // or every scoped-user query returns zero — the bug that was hiding
        // behind the previous workspace_id filter returning empty upstream.
        const recordData = record && record.data ? record.data : (record || {});
        const outerId = String((record && record.id) || recordData.id || '').trim();
        const projectIds = getScopedProjectIdsFromRecord(
            outerId ? { ...recordData, id: outerId } : recordData,
            collectionId
        );
        if (!projectIds.length) {
            return false;
        }
        return projectIds.some(projectId => assignedProjectIds.has(String(projectId || '').trim()));
    });
}

function filterDashboardRecordForSession(collectionId, record, sessionUser) {
    return filterDashboardRecordsForSession(collectionId, [record], sessionUser)[0] || null;
}

function assertNoTemplateWorkspaceMutationViaDashboardPatch(collectionId, payload) {
    if (collectionId !== 'projects' || !payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return;
    }
    const cleanPayload = sanitizeDashboardPayload(payload);
    const attemptedField = Object.keys(cleanPayload)
        .map(key => String(key || '').trim())
        .find(key => PROJECT_TEMPLATE_WORKSPACE_MUTATION_FIELDS.has(key));
    if (!attemptedField) {
        return;
    }
    const error = new Error(
        `Field "${attemptedField}" cannot be updated through /api/dashboard/projects. `
        + 'Use the dedicated template workspace endpoints for save/complete/unlock actions.'
    );
    error.statusCode = 403;
    throw error;
}

function getRouteFromRequest(req) {
    const querySlug = req && req.query && req.query.slug !== undefined
        ? req.query.slug
        : [];
    const slugParts = (Array.isArray(querySlug) ? querySlug : [querySlug])
        .map(entry => decodeURIComponent(String(entry || '').trim()))
        .filter(Boolean);

    if (!slugParts.length) {
        const pathname = (() => {
            try {
                const sourceUrl = String(req.url || '');
                return new URL(sourceUrl, 'https://nexlance.local').pathname;
            } catch (error) {
                return String(req.url || '').split('?')[0].trim();
            }
        })();
        const prefix = '/api/dashboard/';
        if (!pathname.startsWith(prefix)) {
            return { collectionId: '', documentId: '' };
        }
        const fromPath = pathname
            .slice(prefix.length)
            .split('/')
            .map(part => decodeURIComponent(String(part || '').trim()))
            .filter(Boolean);
        return {
            collectionId: String(fromPath[0] || '').trim(),
            documentId: String(fromPath[1] || '').trim()
        };
    }

    return {
        collectionId: String(slugParts[0] || '').trim(),
        documentId: String(slugParts[1] || '').trim()
    };
}

module.exports = async function handler(req, res) {
    if (handleOptions(req, res, 'GET,POST,PATCH,DELETE,OPTIONS')) return;
    setApiCors(res, 'GET,POST,PATCH,DELETE,OPTIONS');

    try {
        const route = getRouteFromRequest(req);
        if (!route.collectionId) {
            res.status(404).json({ error: 'Dashboard resource not found.' });
            return;
        }
        if (!DASHBOARD_COLLECTIONS.has(route.collectionId)) {
            res.status(404).json({ error: 'Dashboard resource not found.' });
            return;
        }

        const session = await authenticateDashboardRequest(req);
        requireInitializedUser(session);
        const { authUser, userProfile, sessionUser } = session;

        if (req.method === 'GET') {
            if (!canPerformCollectionAction({
                collectionId: route.collectionId,
                action: 'read',
                authUser,
                userProfile
            })) {
                res.status(403).json({ error: 'Missing or insufficient permissions.' });
                return;
            }

            if (route.documentId) {
                const existing = await getCollectionDocument(route.collectionId, route.documentId);
                if (!existing) {
                    res.status(404).json({ error: 'Document not found.' });
                    return;
                }
                if (route.collectionId === 'projects' && !isProjectWorkspaceConsistent(existing.data, sessionUser)) {
                    res.status(403).json({ error: 'You do not have access to this record.' });
                    return;
                }
                if (!ensureOwnedDocument(existing.data, sessionUser, route.collectionId)) {
                    res.status(403).json({ error: 'You do not have access to this record.' });
                    return;
                }

                const filteredRecord = filterDashboardRecordForSession(route.collectionId, {
                    id: existing.id || route.documentId,
                    data: existing.data
                }, sessionUser);

                if (!filteredRecord) {
                    res.status(403).json({ error: 'You do not have access to this record.' });
                    return;
                }

                res.status(200).json({ ok: true, record: { id: filteredRecord.id, ...filteredRecord.data } });
                return;
            }

            const records = await listDashboardCollectionRecords(route.collectionId, sessionUser);
            const workspaceConsistentRecords = route.collectionId === 'projects'
                ? records.filter(record => isProjectWorkspaceConsistent(record && record.data ? record.data : record, sessionUser))
                : records;
            const filteredRecords = filterDashboardRecordsForSession(route.collectionId, workspaceConsistentRecords, sessionUser)
                .map(record => ({ id: record.id, ...record.data }));
            res.status(200).json({ ok: true, records: filteredRecords });
            return;
        }

        if (req.method === 'POST') {
            if (!canPerformCollectionAction({
                collectionId: route.collectionId,
                action: 'create',
                authUser,
                userProfile
            })) {
                res.status(403).json({ error: 'Missing or insufficient permissions.' });
                return;
            }

            const body = normalizeBody(req.body);

            // Collection-specific validation.
            if (route.collectionId === 'invoices') {
                validateInvoicePayload(body, { isCreate: true });
            }
            if (route.collectionId === 'team_members') {
                validateTeamMemberPayload(body, { isCreate: true });
            }

            const builtDoc = buildDashboardDocument(body, sessionUser, true);

            // Hard validation: projects MUST have a workspace_id
            if (route.collectionId === 'projects' && !String(builtDoc.workspace_id || '').trim()) {
                console.error('[DashboardAPI] BLOCKED project creation: workspace_id is empty', {
                    userId: String(sessionUser.uid || '').trim(),
                    email: normalizeEmail(sessionUser.email),
                    role: sessionUser.role
                });
                res.status(400).json({
                    error: 'Cannot create project: your workspace could not be resolved. Please log out and log back in.'
                });
                return;
            }

            const record = await createCollectionDocument(
                route.collectionId,
                builtDoc,
                route.documentId || ''
            );
            _invalidateDashboardListCache(route.collectionId, sessionUser);
            let responseRecord = record;
            if (route.collectionId === 'clients') {
                const syncedClientRecord = await syncClientAccessState({ id: record.id, data: record }).catch(() => null);
                if (syncedClientRecord && syncedClientRecord.data) {
                    responseRecord = { id: syncedClientRecord.id, ...syncedClientRecord.data };
                }
                invalidateSessionCache(record.invited_user_id || record.userId || '');
            }
            if (route.collectionId === 'team_members') {
                const syncedTeamRecord = await syncTeamMemberState({ id: record.id, data: record }).catch(() => null);
                if (syncedTeamRecord && syncedTeamRecord.data) {
                    responseRecord = { id: syncedTeamRecord.id, ...syncedTeamRecord.data };
                }
                invalidateSessionCache(record.invited_user_id || record.userId || '');
            }
            res.status(200).json({ ok: true, record: responseRecord });
            return;
        }

        if (req.method === 'PATCH') {
            if (!route.documentId) {
                res.status(400).json({ error: 'Document ID is required.' });
                return;
            }
            const body = normalizeBody(req.body);
            assertNoTemplateWorkspaceMutationViaDashboardPatch(route.collectionId, body);

            // Collection-specific validation.
            if (route.collectionId === 'invoices') {
                validateInvoicePayload(body, { isCreate: false });
            }
            if (route.collectionId === 'team_members') {
                validateTeamMemberPayload(body, { isCreate: false });
            }
            if (!canPerformCollectionAction({
                collectionId: route.collectionId,
                action: 'update',
                authUser,
                userProfile
            })) {
                res.status(403).json({ error: 'Missing or insufficient permissions.' });
                return;
            }

            const existing = await getCollectionDocument(route.collectionId, route.documentId);
            if (!existing) {
                res.status(404).json({ error: 'Document not found.' });
                return;
            }
            if (!ensureOwnedDocument(existing.data, sessionUser, route.collectionId)) {
                res.status(403).json({ error: 'You do not have access to modify this record.' });
                return;
            }

            const record = await patchCollectionDocument(
                route.collectionId,
                route.documentId,
                buildDashboardDocument(body, sessionUser, false)
            );
            _invalidateDashboardListCache(route.collectionId, sessionUser);
            let responseRecord = record;
            if (route.collectionId === 'clients') {
                const syncedClientRecord = await syncClientAccessState({ id: route.documentId, data: record }).catch(() => null);
                if (syncedClientRecord && syncedClientRecord.data) {
                    responseRecord = { id: syncedClientRecord.id, ...syncedClientRecord.data };
                }
                invalidateSessionCache(record.invited_user_id || record.userId || '');
            }
            if (route.collectionId === 'team_members') {
                const syncedTeamRecord = await syncTeamMemberState({ id: route.documentId, data: record }).catch(() => null);
                if (syncedTeamRecord && syncedTeamRecord.data) {
                    responseRecord = { id: syncedTeamRecord.id, ...syncedTeamRecord.data };
                }
                invalidateSessionCache(record.invited_user_id || record.userId || '');
            }
            res.status(200).json({ ok: true, record: responseRecord });
            return;
        }

        if (req.method === 'DELETE') {
            if (!route.documentId) {
                res.status(400).json({ error: 'Document ID is required.' });
                return;
            }
            if (!canPerformCollectionAction({
                collectionId: route.collectionId,
                action: 'delete',
                authUser,
                userProfile
            })) {
                res.status(403).json({ error: 'Missing or insufficient permissions.' });
                return;
            }

            const existing = await getCollectionDocument(route.collectionId, route.documentId);
            if (!existing) {
                // Document already gone — treat as success (idempotent delete)
                res.status(200).json({ ok: true });
                return;
            }
            if (!ensureOwnedDocument(existing.data, sessionUser, route.collectionId)) {
                res.status(403).json({ error: 'You do not have access to delete this record.' });
                return;
            }

            await deleteCollectionDocument(route.collectionId, route.documentId);
            _invalidateDashboardListCache(route.collectionId, sessionUser);
            res.status(200).json({ ok: true });
            return;
        }

        res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        const statusCode = error.statusCode || error.status || 0;
        const message = String(error.message || '').toLowerCase();
        if (statusCode === 401 || statusCode === 403) {
            sendApiError(res, error, 'Authentication or permission error.', statusCode);
        } else if (message.includes('quota exceeded') || message.includes('resource_exhausted')) {
            console.error('[DashboardAPI] Firestore quota exceeded', { method: req.method, url: req.url });
            res.status(429).json({ error: 'Service temporarily unavailable. Please try again later.' });
        } else {
            sendApiError(res, error, 'Dashboard request failed.', 500);
        }
    }
};

module.exports.invalidateDashboardListCacheByWorkspace = invalidateDashboardListCacheByWorkspace;

