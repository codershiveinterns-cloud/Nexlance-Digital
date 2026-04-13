const AccessControl = require('../../rbac.js');
const { authenticateDashboardRequest } = require('../services/dashboard-auth');
const { canPerformCollectionAction, normalizeEmail } = require('../services/dashboard-rbac');
const { syncClientAccessState } = require('../services/client-access');
const { syncTeamMemberState } = require('../services/team-member-access');
const {
    createCollectionDocument,
    deleteCollectionDocument,
    getCollectionDocument,
    listCollectionDocuments,
    patchCollectionDocument,
    queryCollectionDocuments
} = require('../services/firebase-service');
const { handleOptions, normalizeBody, sendApiError, setApiCors } = require('./_utils');

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

async function listDashboardCollectionRecords(collectionId, sessionUser) {
    const ownerKey = getWorkspaceOwnerKey(sessionUser);
    const workspaceId = String(sessionUser.workspaceId || '').trim();
    if (!ownerKey && !workspaceId) return [];

    const queryResults = [];

    // Always query by owner_key (catches projects with empty workspace_id)
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
    const deduped = queryResults
        .map(record => ({
            id: record.id || (record.name ? record.name.split('/').pop() : ''),
            data: record.data || record
        }))
        .filter(record => {
            if (!record.id || seen.has(record.id)) return false;
            seen.add(record.id);
            return true;
        });

    // Auto-repair: patch projects with empty workspace_id if session has one
    if (collectionId === 'projects' && workspaceId) {
        for (const record of deduped) {
            const recordWsId = String(record.data && (record.data.workspace_id || record.data.workspaceId) || '').trim();
            if (!recordWsId && record.id) {
                console.info('[DashboardProjects] Auto-repairing project with empty workspace_id', {
                    projectId: record.id,
                    workspaceId
                });
                await patchCollectionDocument('projects', record.id, {
                    workspace_id: workspaceId,
                    updated_at: new Date().toISOString()
                }).catch(() => undefined);
                record.data = { ...record.data, workspace_id: workspaceId };
            }
        }
    }

    return deduped;
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

