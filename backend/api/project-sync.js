const AccessControl = require('../../rbac.js');
const { createCollectionDocument } = require('../services/firebase-service');
const { requireAuth, requirePermission } = require('../services/request-guards');

const SERVER_MANAGED_FIELDS = new Set([
    'id',
    'backend_id',
    'backendId',
    'owner_key',
    'owner_email',
    'workspace_id',
    'created_at',
    'updated_at',
    'created_by_user_id',
    'created_by_email',
    'project_source',
    'projectSource',
    'source',
    'isPersisted',
    'is_persisted_project',
    'is_shared_workspace_available',
    'storage_fallback',
    'local_fallback'
]);

function sanitizeProjectPayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return {};
    }

    return Object.keys(payload).reduce((result, key) => {
        const normalizedKey = String(key || '').trim();
        if (!normalizedKey || SERVER_MANAGED_FIELDS.has(normalizedKey)) {
            return result;
        }
        result[normalizedKey] = payload[key];
        return result;
    }, {});
}

function toJsonBody(body) {
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
    if (typeof body !== 'string' || !body.trim()) return {};
    try {
        const parsed = JSON.parse(body);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (error) {
        return {};
    }
}

function buildProjectDocument(payload, sessionUser) {
    const now = new Date().toISOString();
    const ownerEmail = AccessControl.normalizeEmail(
        sessionUser.workspaceOwnerEmail
        || sessionUser.ownerEmail
        || sessionUser.email
    );
    const cleanPayload = sanitizeProjectPayload(payload);

    return {
        ...cleanPayload,
        owner_key: ownerEmail,
        owner_email: ownerEmail,
        workspace_id: String(sessionUser.workspaceId || '').trim(),
        created_by_user_id: String(sessionUser.uid || '').trim(),
        created_by_email: AccessControl.normalizeEmail(sessionUser.email),
        created_at: now,
        updated_at: now
    };
}

function toPersistedProjectRecord(record) {
    const backendId = String(record && record.id ? record.id : '').trim();
    return {
        ...(record || {}),
        id: backendId,
        backend_id: backendId,
        backendId,
        source: 'database',
        project_source: 'database',
        isPersisted: true,
        is_persisted_project: true,
        is_shared_workspace_available: true
    };
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');

    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        const session = await requireAuth(req);
        requirePermission(session, AccessControl.PERMISSIONS.MANAGE_PROJECTS);

        const body = toJsonBody(req.body);
        const localId = String(body.localId || '').trim();
        const projectPayload = body.project && typeof body.project === 'object' && !Array.isArray(body.project)
            ? body.project
            : body;

        const document = buildProjectDocument(projectPayload, session.sessionUser);
        if (!String(document.name || '').trim()) {
            const error = new Error('Project name is required.');
            error.statusCode = 400;
            throw error;
        }

        const created = await createCollectionDocument('projects', document);
        const record = toPersistedProjectRecord(created);
        res.status(200).json({
            ok: true,
            localId,
            record
        });
    } catch (error) {
        res.status(error.statusCode || 400).json({
            error: error.message || 'Project could not be synced to backend.'
        });
    }
};
