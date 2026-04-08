const AccessControl = require('../../rbac.js');
const { listCollectionDocuments, queryCollectionDocuments } = require('./firebase-service');

const AMBIGUOUS_PROJECT_TOKEN = '__ambiguous_project_token__';

function normalizeLookupToken(value) {
    return String(value || '').trim().toLowerCase();
}

function addLookupToken(index, token, projectId) {
    const normalizedToken = normalizeLookupToken(token);
    const normalizedProjectId = String(projectId || '').trim();
    if (!normalizedToken || !normalizedProjectId) return;
    if (!index.has(normalizedToken)) {
        index.set(normalizedToken, normalizedProjectId);
        return;
    }

    const existingProjectId = String(index.get(normalizedToken) || '').trim();
    if (existingProjectId && existingProjectId !== normalizedProjectId && existingProjectId !== AMBIGUOUS_PROJECT_TOKEN) {
        // Do not silently map duplicated tokens to the first project.
        index.set(normalizedToken, AMBIGUOUS_PROJECT_TOKEN);
    }
}

function buildWorkspaceProjectIndex(projectRecords = []) {
    const byToken = new Map();
    const byId = new Map();

    (Array.isArray(projectRecords) ? projectRecords : []).forEach(projectRecord => {
        const entry = projectRecord && projectRecord.data
            ? { id: projectRecord.id, data: projectRecord.data }
            : { id: projectRecord && projectRecord.id, data: projectRecord || {} };
        const projectId = String(entry.id || entry.data.id || '').trim();
        if (!projectId) return;

        if (!byId.has(projectId)) {
            byId.set(projectId, entry);
        }

        addLookupToken(byToken, projectId, projectId);
        addLookupToken(byToken, entry.data.id, projectId);
        addLookupToken(byToken, entry.data.backend_id, projectId);
        addLookupToken(byToken, entry.data.backendId, projectId);
        addLookupToken(byToken, entry.data.template_id, projectId);
        addLookupToken(byToken, entry.data.templateId, projectId);
        addLookupToken(byToken, entry.data.name, projectId);
    });

    return {
        byToken,
        byId
    };
}

async function listWorkspaceProjects({ workspaceId = '', workspaceOwnerEmail = '' } = {}) {
    const normalizedWorkspaceId = String(workspaceId || '').trim();
    const normalizedOwnerEmail = AccessControl.normalizeEmail(workspaceOwnerEmail);
    const records = [];
    const seenIds = new Set();

    const pushRecords = sourceRecords => {
        (Array.isArray(sourceRecords) ? sourceRecords : []).forEach(record => {
            const entry = record && record.data
                ? { id: record.id, data: record.data }
                : { id: record && record.id, data: record || {} };
            const projectId = String(entry.id || entry.data.id || '').trim();
            if (!projectId || seenIds.has(projectId)) return;

            const projectWorkspaceId = String(entry.data.workspace_id || '').trim();
            const projectOwnerEmail = AccessControl.normalizeEmail(entry.data.owner_key || entry.data.owner_email);
            const workspaceMatch = normalizedWorkspaceId && projectWorkspaceId === normalizedWorkspaceId;
            const ownerMatch = normalizedOwnerEmail && projectOwnerEmail === normalizedOwnerEmail;

            if (!workspaceMatch && !ownerMatch) return;
            seenIds.add(projectId);
            records.push({
                id: projectId,
                data: entry.data
            });
        });
    };

    if (normalizedWorkspaceId) {
        const workspaceMatches = await queryCollectionDocuments('projects', {
            fieldPath: 'workspace_id',
            op: 'EQUAL',
            value: normalizedWorkspaceId,
            limit: 500
        }).catch(() => []);
        pushRecords(workspaceMatches);
    }

    if (normalizedOwnerEmail) {
        const ownerMatches = await queryCollectionDocuments('projects', {
            fieldPath: 'owner_key',
            op: 'EQUAL',
            value: normalizedOwnerEmail,
            limit: 500
        }).catch(() => []);
        pushRecords(ownerMatches);
    }

    if (records.length) {
        return records;
    }

    const fallbackRecords = await listCollectionDocuments('projects', { pageSize: 500 }).catch(() => []);
    pushRecords(fallbackRecords);
    return records;
}

async function resolveAssignedProjectIdsForWorkspace({
    assignedProjectIds = [],
    workspaceId = '',
    workspaceOwnerEmail = ''
} = {}) {
    const normalizedAssignedIds = AccessControl.sanitizeAssignedProjectIds(assignedProjectIds);
    if (!normalizedAssignedIds.length) {
        return {
            assignedProjectIds: [],
            unresolvedProjectIds: []
        };
    }

    const workspaceProjects = await listWorkspaceProjects({ workspaceId, workspaceOwnerEmail });
    const projectIndex = buildWorkspaceProjectIndex(workspaceProjects);
    const resolved = [];
    const unresolved = [];

    normalizedAssignedIds.forEach(rawProjectId => {
        const directProjectId = String(rawProjectId || '').trim();
        if (!directProjectId) return;
        if (projectIndex.byId.has(directProjectId)) {
            resolved.push(directProjectId);
            return;
        }

        const normalizedToken = normalizeLookupToken(directProjectId);
        const mappedProjectId = projectIndex.byToken.get(normalizedToken);
        if (mappedProjectId && mappedProjectId !== AMBIGUOUS_PROJECT_TOKEN) {
            resolved.push(mappedProjectId);
            return;
        }

        if (mappedProjectId === AMBIGUOUS_PROJECT_TOKEN) {
            console.warn('[WorkspaceAssignment] Ambiguous project token mapping', {
                workspaceId: String(workspaceId || '').trim(),
                token: normalizedToken
            });
        }
        unresolved.push(directProjectId);
    });

    return {
        assignedProjectIds: AccessControl.sanitizeAssignedProjectIds(resolved),
        unresolvedProjectIds: AccessControl.sanitizeAssignedProjectIds(unresolved)
    };
}

module.exports = {
    buildWorkspaceProjectIndex,
    listWorkspaceProjects,
    resolveAssignedProjectIdsForWorkspace
};
