const AccessControl = require('../../rbac.js');
const { requireAuth, requireOwnerOnly } = require('../services/request-guards');
const { createInvitation } = require('../services/invitations');
const { buildClientAccessFields, normalizeProjectAccess } = require('../services/client-access');
const { resolveAssignedProjectIdsForWorkspace } = require('../services/project-assignment-resolution');
const {
    handleOptions,
    normalizeBody,
    sendApiError,
    setApiCors,
    getRequestOrigin
} = require('./_utils');

function isValidEmailAddress(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function normalizeProjectIdList(value) {
    const source = Array.isArray(value)
        ? value
        : (typeof value === 'string' && value.trim()
            ? value.split(',').map(entry => entry.trim())
            : []);
    return [...new Set(source.map(entry => String(entry || '').trim()).filter(Boolean))];
}

async function normalizeTeamInvitePayload(body = {}, sessionUser = {}) {
    const metadata = body && typeof body.metadata === 'object' && body.metadata !== null ? body.metadata : {};
    const inviteeName = String(body.name || body.memberName || metadata.name || '').trim();
    const email = String(body.email || body.memberEmail || metadata.email || '').trim().toLowerCase();
    const role = AccessControl.normalizeRole(String(body.role || metadata.role || '').trim());
    const rawAssignedProjectIds = normalizeProjectIdList(
        body.assignedProjectIds !== undefined
            ? body.assignedProjectIds
            : (metadata.assigned_project_ids !== undefined ? metadata.assigned_project_ids : metadata.assignedProjectIds)
    );
    const access = normalizeProjectAccess({
        assignedProjectIds: rawAssignedProjectIds,
        allProjectsAccess: false
    });
    const resolvedScope = await resolveAssignedProjectIdsForWorkspace({
        assignedProjectIds: access.assignedProjectIds,
        workspaceId: String(sessionUser.workspaceId || '').trim(),
        workspaceOwnerEmail: String(sessionUser.workspaceOwnerEmail || sessionUser.ownerEmail || sessionUser.email || '').trim()
    }).catch(() => ({
        assignedProjectIds: access.assignedProjectIds,
        unresolvedProjectIds: access.assignedProjectIds
    }));
    const unresolvedProjectIds = Array.isArray(resolvedScope.unresolvedProjectIds)
        ? resolvedScope.unresolvedProjectIds
        : [];
    if (unresolvedProjectIds.length) {
        const error = new Error('One or more assigned projects do not belong to this workspace.');
        error.statusCode = 400;
        throw error;
    }
    const resolvedAccess = normalizeProjectAccess({
        assignedProjectIds: resolvedScope.assignedProjectIds,
        allProjectsAccess: false
    });

    if (!inviteeName) {
        throw new Error('Team member name is required.');
    }
    if (!email) {
        throw new Error('Team member email is required.');
    }
    if (!isValidEmailAddress(email)) {
        throw new Error('Team member email must be a valid email address.');
    }
    if (![AccessControl.ROLES.DEVELOPER, AccessControl.ROLES.DESIGNER].includes(role)) {
        const error = new Error('Team invitations only support developer or designer roles.');
        error.statusCode = 400;
        throw error;
    }

    return {
        inviteeName,
        email,
        role,
        assignedProjectIds: resolvedAccess.assignedProjectIds,
        metadata: {
            ...metadata,
            name: inviteeName,
            email,
            role,
            assigned_project_ids: resolvedAccess.assignedProjectIds,
            all_projects_access: false,
            project_access_scope: resolvedAccess.projectAccessScope,
            ...buildClientAccessFields({
                assignedProjectIds: resolvedAccess.assignedProjectIds,
                allProjectsAccess: false
            })
        }
    };
}

module.exports = async function handler(req, res) {
    if (handleOptions(req, res, 'POST,OPTIONS')) return;
    setApiCors(res, 'POST,OPTIONS');

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method not allowed' });
        return;
    }

    try {
        const session = await requireAuth(req);
        requireOwnerOnly(session);
        const body = normalizeBody(req.body);
        const normalizedPayload = await normalizeTeamInvitePayload(body, session.sessionUser);
        const result = await createInvitation({
            session,
            inviteType: 'team',
            inviteeName: normalizedPayload.inviteeName,
            email: normalizedPayload.email,
            role: normalizedPayload.role,
            assignedProjectIds: normalizedPayload.assignedProjectIds,
            origin: getRequestOrigin(req),
            metadata: normalizedPayload.metadata,
            suppressEmailDeliveryError: true
        });

        res.status(200).json({
            ok: true,
            invitation: result.invitation,
            record: result.targetRecord,
            emailDeliveryError: result.emailDeliveryError || null
        });
    } catch (error) {
        sendApiError(res, error, 'Team invitation could not be sent.');
    }
};
