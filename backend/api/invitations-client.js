const { requireAuth, requireOwnerOnly } = require('../services/request-guards');
const { createInvitation } = require('../services/invitations');
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

function normalizeDateInput(value) {
    const safeValue = String(value || '').trim();
    if (!safeValue) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(safeValue)) return safeValue;
    const dayMonthYearMatch = safeValue.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (dayMonthYearMatch) {
        return `${dayMonthYearMatch[3]}-${dayMonthYearMatch[2]}-${dayMonthYearMatch[1]}`;
    }
    return '';
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
    const hostingExpiry = normalizeDateInput(metadata.hosting_expiry || metadata.hostingExpiry || '');
    const sslExpiry = normalizeDateInput(metadata.ssl_expiry || metadata.sslExpiry || '');
    const assignedProjectIds = normalizeProjectIdList(
        body.assignedProjectIds !== undefined
            ? body.assignedProjectIds
            : (metadata.assigned_project_ids !== undefined ? metadata.assigned_project_ids : metadata.assignedProjectIds)
    );
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
    if ((metadata.hosting_expiry || metadata.hostingExpiry) && !hostingExpiry) {
        throw new Error('Hosting expiry must use YYYY-MM-DD format.');
    }
    if ((metadata.ssl_expiry || metadata.sslExpiry) && !sslExpiry) {
        throw new Error('SSL expiry must use YYYY-MM-DD format.');
    }
    if (paidAmount > totalContractValue && totalContractValue > 0) {
        throw new Error('Paid amount cannot be greater than total contract value.');
    }

    return {
        inviteeName,
        email,
        assignedProjectIds,
        metadata: {
            ...metadata,
            name: inviteeName,
            email,
            hosting_expiry: hostingExpiry || null,
            ssl_expiry: sslExpiry || null,
            total_contract_value: totalContractValue,
            paid_amount: paidAmount,
            assigned_project_ids: assignedProjectIds
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
