const AccessControl = require('../../rbac.js');
const { requireAuth } = require('../services/request-guards');
const { buildProjectTemplateZipBundle } = require('../services/template-access');
const { loadTemplateWorkspaceContext, requireTemplateWorkspaceCapability } = require('../services/template-workspace');

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
        const body = req.body && typeof req.body === 'object'
            ? req.body
            : (typeof req.body === 'string' && req.body
                ? JSON.parse(req.body)
                : {});
        const projectId = String(body.projectId || '').trim();
        const context = await loadTemplateWorkspaceContext(session, projectId);
        requireTemplateWorkspaceCapability(context, AccessControl.TEMPLATE_WORKSPACE_CAPABILITIES.DOWNLOAD_TEMPLATE_OUTPUT);

        if (String(context.project.template_workflow_status || '').trim().toLowerCase() !== 'completed') {
            throw new Error('Complete the project before downloading the final output.');
        }

        if (body.hasUnsavedChanges === true) {
            const error = new Error('Save changes before downloading the final output.');
            error.statusCode = 409;
            throw error;
        }

        if (context.project.template_download_paid !== true) {
            const error = new Error('Complete the template payment before downloading the final output.');
            error.statusCode = 403;
            throw error;
        }

        const renderedHtml = String(context.project.template_saved_html || '').trim();
        if (!renderedHtml) {
            throw new Error('No saved template output is available for download yet.');
        }

        const bundle = buildProjectTemplateZipBundle({
            templateId: context.project.template_id,
            requestedBy: session.sessionUser.email,
            renderedHtml,
            projectId,
            projectName: context.project.name || context.project.template_name || context.project.template_id
        });

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${bundle.fileName}"`);
        res.status(200).end(bundle.buffer);
    } catch (error) {
        res.status(error.statusCode || 400).json({ error: error.message || 'Project template download could not be prepared.' });
    }
};
