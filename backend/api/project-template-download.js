const AccessControl = require('../../rbac.js');
const { getCollectionDocument } = require('../services/firebase-service');
const { requireAuth, requirePermission } = require('../services/request-guards');
const { buildProjectTemplateZipBundle } = require('../services/template-access');

function normalizeBody(body) {
    if (!body) return {};
    if (typeof body === 'string') {
        try {
            return JSON.parse(body);
        } catch (error) {
            throw new Error('Invalid JSON body.');
        }
    }
    return body;
}

function hasAllProjectsAccess(sessionUser = {}) {
    return sessionUser.allProjectsAccess === true
        || sessionUser.all_projects_access === true
        || String(sessionUser.projectAccessScope || sessionUser.project_access_scope || '').trim().toLowerCase() === 'all';
}

function canAccessProjectRecord(sessionUser = {}, projectId, project = {}) {
    const ownerEmail = AccessControl.normalizeEmail(sessionUser.workspaceOwnerEmail || sessionUser.ownerEmail || sessionUser.email);
    const recordOwner = AccessControl.normalizeEmail(project.owner_key || project.owner_email || '');
    const workspaceMatch = String(project.workspace_id || '').trim() === String(sessionUser.workspaceId || '').trim();
    if (!((recordOwner && recordOwner === ownerEmail) || workspaceMatch)) {
        return false;
    }

    if (AccessControl.isWorkspaceOwner(sessionUser) || hasAllProjectsAccess(sessionUser)) {
        return true;
    }

    const role = AccessControl.normalizeRole(sessionUser.role || sessionUser.workspaceRole);
    const assignedProjectIds = AccessControl.sanitizeAssignedProjectIds(sessionUser.assignedProjectIds);
    if (role !== AccessControl.ROLES.CLIENT && !assignedProjectIds.length) {
        return true;
    }

    return assignedProjectIds.includes(String(projectId || '').trim());
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
        requirePermission(session, AccessControl.PERMISSIONS.VIEW_PROJECTS);
        const body = normalizeBody(req.body);
        const projectId = String(body.projectId || '').trim();
        if (!projectId) {
            throw new Error('Project ID is required.');
        }

        const projectRecord = await getCollectionDocument('projects', projectId);
        if (!projectRecord || !projectRecord.data) {
            const error = new Error('Project could not be found.');
            error.statusCode = 404;
            throw error;
        }

        if (!canAccessProjectRecord(session.sessionUser, projectId, projectRecord.data)) {
            const error = new Error('You do not have access to this project.');
            error.statusCode = 403;
            throw error;
        }

        if (String(projectRecord.data.template_workflow_status || '').trim().toLowerCase() !== 'completed') {
            throw new Error('Complete the project before downloading the final output.');
        }

        if (projectRecord.data.template_download_paid !== true) {
            const error = new Error('Complete the template payment before downloading the final output.');
            error.statusCode = 403;
            throw error;
        }

        const renderedHtml = String(
            projectRecord.data.template_saved_html
            || body.renderedHtml
            || ''
        ).trim();
        if (!renderedHtml) {
            throw new Error('No saved template output is available for download yet.');
        }

        const bundle = buildProjectTemplateZipBundle({
            templateId: projectRecord.data.template_id,
            requestedBy: session.sessionUser.email,
            renderedHtml,
            projectId,
            projectName: projectRecord.data.name || projectRecord.data.template_name || projectRecord.data.template_id
        });

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${bundle.fileName}"`);
        res.status(200).end(bundle.buffer);
    } catch (error) {
        res.status(error.statusCode || 400).json({ error: error.message || 'Project template download could not be prepared.' });
    }
};
