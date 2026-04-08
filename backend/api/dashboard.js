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
const { isTemplateWorkspaceProjectPatch } = require('../services/template-workspace');
const { handleOptions, normalizeBody, sendApiError, setApiCors } = require('./_utils');

const DASHBOARD_COLLECTIONS = new Set([
    'clients',
    'invoices',
    'projects',
    'services',
    'tasks',
    'team_members'
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

function ensureOwnedDocument(record, sessionUser) {
    const ownerEmail = getWorkspaceOwnerKey(sessionUser);
    const recordOwner = normalizeEmail(record && record.owner_key ? record.owner_key : record && record.owner_email ? record.owner_email : '');
    const recordWorkspaceId = String(record && record.workspace_id ? record.workspace_id : '').trim();
    return Boolean(
        (recordOwner && recordOwner === normalizeEmail(ownerEmail))
        || (recordWorkspaceId && recordWorkspaceId === String(sessionUser.workspaceId || '').trim())
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
    if (ownerKey && (!workspaceId || collectionId !== 'projects')) {
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
        const requireWorkspaceMatch = collectionId === 'projects' && Boolean(workspaceId);
        return all
            .filter(record => (
                (!requireWorkspaceMatch && ownerKey && normalizeEmail(record.owner_key || record.owner_email) === ownerKey)
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
    const isAdmin = role === AccessControl.ROLES.ADMIN;
    const hasExplicitProjectScope = !isOwner && assignedProjectIds.size > 0;
    const allProjectsAccess = hasAllProjectsAccess(sessionUser);
    const shouldRestrictProjects = role === AccessControl.ROLES.CLIENT || hasExplicitProjectScope;

    if (!shouldRestrictProjects || isOwner || isAdmin || allProjectsAccess) {
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
    return isTemplateWorkspaceProjectPatch(payload);
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
                if (!ensureOwnedDocument(existing.data, sessionUser)) {
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
            res.status(200).json({ ok: true, record: responseRecord });
            return;
        }

        if (req.method === 'PATCH') {
            if (!route.documentId) {
                res.status(400).json({ error: 'Document ID is required.' });
                return;
            }
            const body = normalizeBody(req.body);
            const action = isTemplateWorkspacePatchPayload(route.collectionId, body) ? 'read' : 'update';
            if (!canPerformCollectionAction({
                collectionId: route.collectionId,
                action,
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
            if (!ensureOwnedDocument(existing.data, sessionUser)) {
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
                res.status(404).json({ error: 'Document not found.' });
                return;
            }
            if (!ensureOwnedDocument(existing.data, sessionUser)) {
                res.status(403).json({ error: 'You do not have access to delete this record.' });
                return;
            }

            await deleteCollectionDocument(route.collectionId, route.documentId);
            res.status(200).json({ ok: true });
            return;
        }

        res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        sendApiError(res, error, 'Dashboard request failed.', 500);
    }
};

