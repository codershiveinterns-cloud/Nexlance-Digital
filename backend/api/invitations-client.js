const { requireAuth, requireOwnerOnly } = require('../services/request-guards');
const { createInvitation } = require('../services/invitations');
const { buildClientAccessFields, normalizeProjectAccess } = require('../services/client-access');
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
        sendApiError(res, error, 'Client invitation could not be sent.');
    }
};
