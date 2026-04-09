const crypto = require('crypto');
const AccessControl = require('../../rbac.js');
const { logAuditEvent } = require('./audit-log');
const { sendEmailWithResend } = require('./email-service');
const { buildClientInviteEmail, buildTeamInviteEmail } = require('./invitation-emails');
const {
    buildClientAccessFields,
    buildInvitationAccessFields,
    buildProfileAccessFields,
    normalizeProjectAccess
} = require('./client-access');
const { buildTeamPermissionFields } = require('./team-member-access');
const {
    createCollectionDocument,
    getCollectionDocument,
    listCollectionDocuments,
    patchCollectionDocument,
    queryCollectionDocuments,
    sanitizeDocumentId,
    upsertCollectionDocument
} = require('./firebase-service');
const {
    buildPermissionFields,
    buildSessionUser,
    getNormalizedAssignedProjectIds,
    getWorkspaceMemberDocumentId
} = require('./workspace-access');
const { resolveAssignedProjectIdsForWorkspace } = require('./project-assignment-resolution');

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function getAuthoritativeAssignmentScope(profile = {}) {
    const workspaceId = String(profile.workspaceId || '').trim();
    const assignedProjectIds = AccessControl.sanitizeAssignedProjectIds(profile.assignedProjectIds);
    const allProjectsAccess = profile.allProjectsAccess === true
        || profile.all_projects_access === true
        || String(profile.projectAccessScope || profile.project_access_scope || '').trim().toLowerCase() === 'all';
    return {
        workspaceId,
        assignedProjectIds: allProjectsAccess ? [] : assignedProjectIds,
        allProjectsAccess,
        projectAccessScope: allProjectsAccess ? 'all' : 'selected'
    };
}

async function deactivateExistingProjectAssignments({
    workspaceId = '',
    userId = '',
    email = '',
    reason = 'assignment_resync'
} = {}) {
    const normalizedWorkspaceId = String(workspaceId || '').trim();
    const normalizedUserId = String(userId || '').trim();
    const normalizedEmail = AccessControl.normalizeEmail(email);
    if (!normalizedWorkspaceId || (!normalizedEmail && !normalizedUserId)) {
        return [];
    }

    const now = new Date().toISOString();
    const existingAssignments = await listCollectionDocuments('project_assignments', { pageSize: 500 }).catch(() => []);
    const matchingAssignments = (Array.isArray(existingAssignments) ? existingAssignments : []).filter(record => {
        const recordWorkspaceId = String(record.workspaceId || record.workspace_id || '').trim();
        const recordUserId = String(record.userId || record.user_id || '').trim();
        const recordEmail = AccessControl.normalizeEmail(record.email || record.user_email);
        const matchesIdentity = normalizedEmail
            ? recordEmail === normalizedEmail
            : (normalizedUserId && recordUserId === normalizedUserId);
        return recordWorkspaceId === normalizedWorkspaceId && matchesIdentity;
    });

    for (const assignment of matchingAssignments) {
        await patchCollectionDocument('project_assignments', assignment.id, {
            status: 'inactive',
            active: false,
            deactivatedReason: String(reason || '').trim() || 'assignment_resync',
            updatedAt: now,
            updated_at: now
        }).catch(() => undefined);
    }

    return matchingAssignments.map(assignment => String(assignment && assignment.id || '').trim()).filter(Boolean);
}

function createRawInviteToken() {
    return crypto.randomBytes(32).toString('base64url');
}

function hashInviteToken(token) {
    return crypto
        .createHash('sha256')
        .update(String(token || '').trim())
        .digest('hex');
}

function getInvitationDocumentId(inviteId) {
    return sanitizeDocumentId(inviteId || `invitation_${Date.now()}`);
}

function getAppBaseUrl(origin = '') {
    const normalizedOrigin = String(origin || '').trim().replace(/\/+$/, '');
    const environment = String(process.env.NODE_ENV || 'development').trim().toLowerCase();
    const configuredBaseUrl = String(process.env.APP_BASE_URL || '').trim().replace(/\/+$/, '');
    const localBaseUrl = String(process.env.LOCAL_APP_BASE_URL || '').trim().replace(/\/+$/, '');
    const isLocalOrigin = /^https?:\/\/(localhost|127(?:\.\d{1,3}){3})(:\d+)?$/i.test(normalizedOrigin);

    if (environment !== 'production') {
        if (localBaseUrl) return localBaseUrl;
        if (isLocalOrigin) return normalizedOrigin;
    }

    if (configuredBaseUrl) return configuredBaseUrl;
    if (normalizedOrigin) return normalizedOrigin;
    return 'http://localhost:4242';
}

function buildInvitationLink(rawToken, origin = '') {
    return `${getAppBaseUrl(origin)}/invite-accept.html?token=${encodeURIComponent(rawToken)}`;
}

function assertAllowedInviteRole(role, inviteType) {
    const normalizedRole = AccessControl.normalizeRole(role);
    if (inviteType === 'client' && normalizedRole !== AccessControl.ROLES.CLIENT) {
        throw new Error('Client invitations must use the client role.');
    }

    if (inviteType === 'team' && !AccessControl.isInternalTeamRole(normalizedRole)) {
        throw new Error('Team invitations must use one of these roles: admin, developer, or designer.');
    }

    return normalizedRole;
}

async function getProjectNames(projectIds = []) {
    const safeIds = AccessControl.sanitizeAssignedProjectIds(projectIds);
    if (!safeIds.length) return [];

    const names = [];
    for (const projectId of safeIds) {
        try {
            const project = await getCollectionDocument('projects', projectId);
            if (project && project.data && project.data.name) {
                names.push(project.data.name);
            }
        } catch (error) {
            // Ignore missing project names in emails.
        }
    }
    return names;
}

async function sendInvitationEmail({ inviteType, inviteeName, email, workspaceName, inviteLink, role, assignedProjectIds }) {
    const roleLabel = AccessControl.getRoleDisplayLabel(role);
    const projectNames = await getProjectNames(assignedProjectIds);
    const payload = inviteType === 'client'
        ? buildClientInviteEmail({ inviteeName, workspaceName, inviteLink, projectNames })
        : buildTeamInviteEmail({ inviteeName, workspaceName, inviteLink, roleLabel, projectNames });

    return sendEmailWithResend({
        to: email,
        subject: payload.subject,
        html: payload.html,
        text: payload.text
    });
}

function buildTargetRecordPayload({ inviteType, inviteeName, email, role, assignedProjectIds, allProjectsAccess, sessionUser, invitationId, metadata = {} }) {
    const now = new Date().toISOString();
    const accessFields = buildClientAccessFields({
        assignedProjectIds,
        allProjectsAccess
    });
    const baseRecord = {
        ...(metadata && typeof metadata === 'object' ? metadata : {}),
        name: inviteeName,
        email: AccessControl.normalizeEmail(email),
        role: AccessControl.getRoleDisplayLabel(role),
        canonical_role: role,
        invitation_id: invitationId,
        invite_status: 'pending',
        owner_key: AccessControl.normalizeEmail(sessionUser.workspaceOwnerEmail || sessionUser.email),
        owner_email: AccessControl.normalizeEmail(sessionUser.workspaceOwnerEmail || sessionUser.email),
        workspace_id: sessionUser.workspaceId,
        updated_at: now,
        ...accessFields
    };

    if (inviteType === 'client') {
        return {
            collectionId: 'clients',
            record: {
                ...baseRecord,
                created_at: now
            }
        };
    }

    return {
        collectionId: 'team_members',
        record: {
            ...baseRecord,
            ...buildTeamPermissionFields(role),
            created_at: now
        }
    };
}

async function createPendingTargetRecord(options) {
    const target = buildTargetRecordPayload(options);
    const reuseTargetRecordId = String(options && options.reuseTargetRecordId ? options.reuseTargetRecordId : '').trim();
    if (reuseTargetRecordId) {
        const existing = await getCollectionDocument(target.collectionId, reuseTargetRecordId).catch(() => null);
        if (existing && existing.data) {
            const inviteType = String(options && options.inviteType || '').trim().toLowerCase();
            const existingInvitedUserId = String(existing.data.invited_user_id || existing.data.invitedUserId || '').trim();
            const existingInviteAcceptedAt = String(existing.data.invite_accepted_at || existing.data.inviteAcceptedAt || '').trim();
            const existingInviteStatus = String(existing.data.invite_status || existing.data.status || '').trim().toLowerCase();
            const keepAcceptedState = inviteType === 'team'
                && (Boolean(existingInvitedUserId) || existingInviteStatus === 'accepted');
            const patched = await patchCollectionDocument(target.collectionId, reuseTargetRecordId, {
                ...target.record,
                created_at: existing.data.created_at || target.record.created_at || new Date().toISOString(),
                invite_status: keepAcceptedState ? 'accepted' : String(target.record.invite_status || 'pending').trim().toLowerCase(),
                invited_user_id: keepAcceptedState ? existingInvitedUserId : '',
                invite_accepted_at: keepAcceptedState ? existingInviteAcceptedAt : ''
            });
            return {
                targetCollectionId: target.collectionId,
                targetRecord: {
                    id: reuseTargetRecordId,
                    ...patched
                }
            };
        }
    }

    const created = await createCollectionDocument(target.collectionId, target.record);
    return {
        targetCollectionId: target.collectionId,
        targetRecord: created
    };
}

function getTimestampMs(value) {
    const timestampMs = new Date(value || '').getTime();
    return Number.isFinite(timestampMs) && timestampMs > 0 ? timestampMs : 0;
}

function getClientRecordSortTimestamp(record = {}) {
    return (
        getTimestampMs(record.updated_at)
        || getTimestampMs(record.invite_accepted_at)
        || getTimestampMs(record.created_at)
        || 0
    );
}

function isAcceptedClientRecord(record = {}) {
    const inviteStatus = String(record.invite_status || record.status || '').trim().toLowerCase();
    const invitedUserId = String(record.invited_user_id || record.invitedUserId || '').trim();
    return Boolean(invitedUserId) || inviteStatus === 'accepted';
}

function isAcceptedTeamMemberRecord(record = {}) {
    const inviteStatus = String(record.invite_status || record.status || '').trim().toLowerCase();
    const invitedUserId = String(record.invited_user_id || record.invitedUserId || '').trim();
    return Boolean(invitedUserId) || inviteStatus === 'accepted';
}

function getTeamRecordSortTimestamp(record = {}) {
    return (
        getTimestampMs(record.updated_at)
        || getTimestampMs(record.invite_accepted_at)
        || getTimestampMs(record.created_at)
        || 0
    );
}

async function findWorkspaceClientRecordsByEmail({ workspaceId = '', email = '' } = {}) {
    const normalizedWorkspaceId = String(workspaceId || '').trim();
    const normalizedEmail = AccessControl.normalizeEmail(email);
    if (!normalizedWorkspaceId || !normalizedEmail) {
        return [];
    }

    let workspaceClients = await queryCollectionDocuments('clients', {
        fieldPath: 'workspace_id',
        op: 'EQUAL',
        value: normalizedWorkspaceId,
        limit: 500
    }).catch(() => []);

    if (!Array.isArray(workspaceClients) || !workspaceClients.length) {
        workspaceClients = (await listCollectionDocuments('clients', { pageSize: 500 }).catch(() => []))
            .filter(record => String(record.workspace_id || '').trim() === normalizedWorkspaceId)
            .map(record => ({ id: record.id, data: record }));
    }

    return (Array.isArray(workspaceClients) ? workspaceClients : [])
        .map(record => ({
            id: record.id || (record.name ? record.name.split('/').pop() : ''),
            data: record.data || record
        }))
        .filter(entry => AccessControl.normalizeEmail(entry && entry.data && entry.data.email) === normalizedEmail)
        .sort((left, right) => {
            const leftAccepted = isAcceptedClientRecord(left.data) ? 1 : 0;
            const rightAccepted = isAcceptedClientRecord(right.data) ? 1 : 0;
            if (leftAccepted !== rightAccepted) {
                return rightAccepted - leftAccepted;
            }
            return getClientRecordSortTimestamp(right.data) - getClientRecordSortTimestamp(left.data);
        });
}

async function findWorkspaceTeamMemberRecordsByEmail({ workspaceId = '', email = '' } = {}) {
    const normalizedWorkspaceId = String(workspaceId || '').trim();
    const normalizedEmail = AccessControl.normalizeEmail(email);
    if (!normalizedWorkspaceId || !normalizedEmail) {
        return [];
    }

    let workspaceMembers = await queryCollectionDocuments('team_members', {
        fieldPath: 'workspace_id',
        op: 'EQUAL',
        value: normalizedWorkspaceId,
        limit: 500
    }).catch(() => []);

    if (!Array.isArray(workspaceMembers) || !workspaceMembers.length) {
        workspaceMembers = (await listCollectionDocuments('team_members', { pageSize: 500 }).catch(() => []))
            .filter(record => String(record.workspace_id || '').trim() === normalizedWorkspaceId)
            .map(record => ({ id: record.id, data: record }));
    }

    return (Array.isArray(workspaceMembers) ? workspaceMembers : [])
        .map(record => ({
            id: record.id || (record.name ? record.name.split('/').pop() : ''),
            data: record.data || record
        }))
        .filter(entry => AccessControl.normalizeEmail(entry && entry.data && entry.data.email) === normalizedEmail)
        .sort((left, right) => {
            const leftAccepted = isAcceptedTeamMemberRecord(left.data) ? 1 : 0;
            const rightAccepted = isAcceptedTeamMemberRecord(right.data) ? 1 : 0;
            if (leftAccepted !== rightAccepted) {
                return rightAccepted - leftAccepted;
            }
            return getTeamRecordSortTimestamp(right.data) - getTeamRecordSortTimestamp(left.data);
        });
}

async function dedupeWorkspaceTeamMembersByEmail({ workspaceId = '', email = '', keepRecordId = '' } = {}) {
    const normalizedWorkspaceId = String(workspaceId || '').trim();
    const normalizedEmail = AccessControl.normalizeEmail(email);
    const normalizedKeepRecordId = String(keepRecordId || '').trim();
    if (!normalizedWorkspaceId || !normalizedEmail || !normalizedKeepRecordId) {
        return;
    }

    const records = await findWorkspaceTeamMemberRecordsByEmail({
        workspaceId: normalizedWorkspaceId,
        email: normalizedEmail
    }).catch(() => []);

    const now = new Date().toISOString();
    const duplicates = (Array.isArray(records) ? records : [])
        .filter(entry => String(entry && entry.id || '').trim() && String(entry.id || '').trim() !== normalizedKeepRecordId);

    if (!duplicates.length) return;

    console.warn('[WorkspaceAssignment] Deduplicating team member records by email', {
        workspaceId: normalizedWorkspaceId,
        email: normalizedEmail,
        keepRecordId: normalizedKeepRecordId,
        duplicateRecordIds: duplicates.map(entry => String(entry && entry.id || '').trim()).filter(Boolean)
    });

    for (const duplicate of duplicates) {
        await patchCollectionDocument('team_members', duplicate.id, {
            invite_status: 'superseded',
            status: 'inactive',
            updated_at: now
        }).catch(() => undefined);
    }
}

async function markWorkspaceClientInvitationsSuperseded({ workspaceId = '', email = '', exceptInvitationId = '' } = {}) {
    const normalizedWorkspaceId = String(workspaceId || '').trim();
    const normalizedEmail = AccessControl.normalizeEmail(email);
    const excludedInvitationId = String(exceptInvitationId || '').trim();
    if (!normalizedWorkspaceId || !normalizedEmail) {
        return;
    }

    let invitations = await queryCollectionDocuments('invitations', {
        fieldPath: 'email',
        op: 'EQUAL',
        value: normalizedEmail,
        limit: 200
    }).catch(() => []);

    if (!Array.isArray(invitations) || !invitations.length) {
        invitations = (await listCollectionDocuments('invitations', { pageSize: 500 }).catch(() => []))
            .filter(record => AccessControl.normalizeEmail(record.email) === normalizedEmail)
            .map(record => ({ id: record.id, data: record }));
    }

    const supersedableStatuses = new Set(['pending', 'delivery_failed']);
    const now = new Date().toISOString();
    const candidates = (Array.isArray(invitations) ? invitations : [])
        .map(record => ({
            id: record.id || (record.name ? record.name.split('/').pop() : ''),
            data: record.data || record
        }))
        .filter(entry => {
            const invite = entry.data || {};
            if (!entry.id || entry.id === excludedInvitationId) return false;
            if (String(invite.workspaceId || '').trim() !== normalizedWorkspaceId) return false;
            if (invite.usedAt) return false;
            return supersedableStatuses.has(String(invite.status || '').trim().toLowerCase());
        });

    for (const candidate of candidates) {
        const candidateInvite = candidate.data || {};
        await patchCollectionDocument('invitations', candidate.id, {
            status: 'superseded',
            supersededAt: now,
            supersededBy: excludedInvitationId || '',
            updatedAt: now
        }).catch(() => undefined);

        if (candidateInvite.targetRecordCollection && candidateInvite.targetRecordId) {
            await patchCollectionDocument(candidateInvite.targetRecordCollection, candidateInvite.targetRecordId, {
                invite_status: 'superseded',
                updated_at: now
            }).catch(() => undefined);
        }
    }
}

function buildInvitationRecord({
    invitationId,
    inviteType,
    inviteeName,
    email,
    role,
    assignedProjectIds,
    allProjectsAccess,
    sessionUser,
    rawToken,
    targetRecord,
    origin,
    metadata = {}
}) {
    const now = new Date().toISOString();
    const invitationAccessFields = buildInvitationAccessFields({
        assignedProjectIds,
        allProjectsAccess
    });
    return {
        invitationId,
        inviteType,
        email: AccessControl.normalizeEmail(email),
        inviteeName: String(inviteeName || '').trim(),
        role,
        workspaceId: String(sessionUser.workspaceId || '').trim(),
        workspaceOwnerEmail: AccessControl.normalizeEmail(sessionUser.workspaceOwnerEmail || sessionUser.email),
        workspaceOwnerUserId: String(sessionUser.workspaceOwnerUserId || sessionUser.uid || '').trim(),
        invitedBy: String(sessionUser.uid || '').trim(),
        invitedByEmail: AccessControl.normalizeEmail(sessionUser.email),
        tokenHash: hashInviteToken(rawToken),
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS).toISOString(),
        usedAt: '',
        status: 'pending',
        targetRecordCollection: targetRecord ? targetRecord.targetCollectionId : '',
        targetRecordId: targetRecord && targetRecord.targetRecord ? targetRecord.targetRecord.id : '',
        inviteLink: buildInvitationLink(rawToken, origin),
        createdAt: now,
        updatedAt: now,
        permissionKeys: Array.isArray(metadata.permissionKeys)
            ? metadata.permissionKeys.map(permission => String(permission || '').trim()).filter(Boolean)
            : (Array.isArray(metadata.permission_keys)
                ? metadata.permission_keys.map(permission => String(permission || '').trim()).filter(Boolean)
                : []),
        permissionMode: String(metadata.permissionMode || metadata.permission_mode || '').trim().toLowerCase() === 'explicit' ? 'explicit' : 'default',
        ...invitationAccessFields
    };
}

async function createInvitation({
    session,
    inviteType,
    inviteeName,
    email,
    role,
    assignedProjectIds = [],
    allProjectsAccess = false,
    origin = '',
    metadata = {},
    suppressEmailDeliveryError = false
}) {
    const sessionUser = session.sessionUser;
    const normalizedRole = assertAllowedInviteRole(role, inviteType);
    const safeEmail = AccessControl.normalizeEmail(email);
    if (!safeEmail) {
        throw new Error('Invite email is required.');
    }

    const normalizedAccess = normalizeProjectAccess({ assignedProjectIds, allProjectsAccess });
    let safeAssignedProjectIds = normalizedAccess.assignedProjectIds;
    let safeAllProjectsAccess = inviteType === 'team'
        ? false
        : (inviteType === 'client'
            ? false
            : normalizedAccess.allProjectsAccess);
    if (inviteType === 'client' || inviteType === 'team') {
        const resolvedScope = await resolveAssignedProjectIdsForWorkspace({
            assignedProjectIds: safeAssignedProjectIds,
            workspaceId: String(sessionUser.workspaceId || '').trim(),
            workspaceOwnerEmail: AccessControl.normalizeEmail(sessionUser.workspaceOwnerEmail || sessionUser.ownerEmail || sessionUser.email)
        }).catch(() => ({
            assignedProjectIds: safeAssignedProjectIds,
            unresolvedProjectIds: safeAssignedProjectIds
        }));
        const unresolvedProjectIds = Array.isArray(resolvedScope.unresolvedProjectIds)
            ? resolvedScope.unresolvedProjectIds
            : [];
        if (unresolvedProjectIds.length) {
            const assignmentError = new Error('Assigned projects must belong to the selected workspace.');
            assignmentError.statusCode = 400;
            throw assignmentError;
        }
        const normalizedResolvedScope = normalizeProjectAccess({
            assignedProjectIds: resolvedScope.assignedProjectIds,
            allProjectsAccess: false
        });
        safeAssignedProjectIds = normalizedResolvedScope.assignedProjectIds;
        safeAllProjectsAccess = normalizedResolvedScope.allProjectsAccess;
    }

    let reusablePendingClientRecord = null;
    let reusableTeamMemberRecord = null;
    if (inviteType === 'client') {
        const existingClientRecords = await findWorkspaceClientRecordsByEmail({
            workspaceId: String(sessionUser.workspaceId || '').trim(),
            email: safeEmail
        }).catch(() => []);

        reusablePendingClientRecord = (Array.isArray(existingClientRecords) ? existingClientRecords : [])
            .find(entry => !isAcceptedClientRecord(entry && entry.data ? entry.data : {})) || null;
    }
    if (inviteType === 'team') {
        const existingTeamRecords = await findWorkspaceTeamMemberRecordsByEmail({
            workspaceId: String(sessionUser.workspaceId || '').trim(),
            email: safeEmail
        }).catch(() => []);
        reusableTeamMemberRecord = (Array.isArray(existingTeamRecords) ? existingTeamRecords : [])[0] || null;
    }

    const rawToken = createRawInviteToken();
    const invitationId = getInvitationDocumentId();
    const targetRecord = await createPendingTargetRecord({
        inviteType,
        inviteeName,
        email: safeEmail,
        role: normalizedRole,
        assignedProjectIds: safeAssignedProjectIds,
        allProjectsAccess: safeAllProjectsAccess,
        sessionUser,
        invitationId,
        metadata,
        reuseTargetRecordId: reusablePendingClientRecord
            ? reusablePendingClientRecord.id
            : (reusableTeamMemberRecord ? reusableTeamMemberRecord.id : '')
    });
    const expectedWorkspaceId = String(sessionUser.workspaceId || '').trim();
    const targetRecordWorkspaceId = String(
        targetRecord && targetRecord.targetRecord && targetRecord.targetRecord.workspace_id
            ? targetRecord.targetRecord.workspace_id
            : ''
    ).trim();
    if (!expectedWorkspaceId || (targetRecordWorkspaceId && targetRecordWorkspaceId !== expectedWorkspaceId)) {
        const mismatchError = new Error('Workspace assignment mismatch while storing target record.');
        mismatchError.statusCode = 500;
        throw mismatchError;
    }
    const invitationRecord = buildInvitationRecord({
        invitationId,
        inviteType,
        inviteeName,
        email: safeEmail,
        role: normalizedRole,
        assignedProjectIds: safeAssignedProjectIds,
        allProjectsAccess: safeAllProjectsAccess,
        sessionUser,
        rawToken,
        targetRecord,
        origin,
        metadata
    });

    const storedInvitationRecord = await upsertCollectionDocument('invitations', invitationId, invitationRecord);
    const storedWorkspaceId = String(storedInvitationRecord.workspaceId || '').trim();
    if (!expectedWorkspaceId || storedWorkspaceId !== expectedWorkspaceId) {
        const mismatchError = new Error('Workspace assignment mismatch while storing invitation.');
        mismatchError.statusCode = 500;
        throw mismatchError;
    }
    console.info('[WorkspaceMappingTrace] Invitation stored', {
        invitationId,
        workspaceId: storedWorkspaceId,
        email: safeEmail,
        assignedProjectIds: safeAssignedProjectIds
    });
    if (inviteType === 'client') {
        await markWorkspaceClientInvitationsSuperseded({
            workspaceId: String(sessionUser.workspaceId || '').trim(),
            email: safeEmail,
            exceptInvitationId: invitationId
        }).catch(() => undefined);
    }
    if (inviteType === 'team' && targetRecord && targetRecord.targetRecord && targetRecord.targetRecord.id) {
        await dedupeWorkspaceTeamMembersByEmail({
            workspaceId: String(sessionUser.workspaceId || '').trim(),
            email: safeEmail,
            keepRecordId: String(targetRecord.targetRecord.id || '').trim()
        }).catch(() => undefined);
    }

    console.info('[WorkspaceAssignment] Invitation created', {
        invitationId,
        workspaceId: String(sessionUser.workspaceId || '').trim(),
        email: safeEmail,
        targetRecordId: targetRecord && targetRecord.targetRecord ? targetRecord.targetRecord.id : '',
        assignedProjectIds: safeAssignedProjectIds
    });

    let finalInvitationRecord = invitationRecord;
    let finalTargetRecord = targetRecord.targetRecord;
    let emailDeliveryError = null;
    try {
        await sendInvitationEmail({
            inviteType,
            inviteeName,
            email: safeEmail,
            workspaceName: sessionUser.businessName || sessionUser.workspaceId,
            inviteLink: invitationRecord.inviteLink,
            role: normalizedRole,
            assignedProjectIds: safeAssignedProjectIds
        });
    } catch (error) {
        const failedAt = new Date().toISOString();
        finalInvitationRecord = await patchCollectionDocument('invitations', invitationId, {
            status: 'delivery_failed',
            updatedAt: failedAt
        }).catch(() => ({
            ...invitationRecord,
            status: 'delivery_failed',
            updatedAt: failedAt
        }));

        if (targetRecord && targetRecord.targetCollectionId && targetRecord.targetRecord && targetRecord.targetRecord.id) {
            finalTargetRecord = await patchCollectionDocument(targetRecord.targetCollectionId, targetRecord.targetRecord.id, {
                invite_status: 'delivery_failed',
                updated_at: failedAt
            }).catch(() => ({
                ...(targetRecord.targetRecord || {}),
                invite_status: 'delivery_failed',
                updated_at: failedAt
            }));
        }

        emailDeliveryError = {
            message: error.message || 'Invitation email could not be sent.',
            statusCode: error.statusCode || error.status || 500,
            response: error.response || null
        };

        await logAuditEvent('invite_delivery_failed', {
            workspaceId: sessionUser.workspaceId,
            actorUserId: sessionUser.uid,
            actorEmail: sessionUser.email,
            targetEmail: safeEmail,
            targetId: invitationId,
            message: `${inviteType} invitation created for ${safeEmail}, but email delivery failed.`,
            metadata: {
                inviteType,
                role: normalizedRole,
                assignedProjectIds: safeAssignedProjectIds,
                emailError: emailDeliveryError.message
            }
        }).catch(() => undefined);

        if (!suppressEmailDeliveryError) {
            throw error;
        }
    }

    if (!emailDeliveryError) {
        await logAuditEvent('invite_sent', {
            workspaceId: sessionUser.workspaceId,
            actorUserId: sessionUser.uid,
            actorEmail: sessionUser.email,
            targetEmail: safeEmail,
            targetId: invitationId,
            message: `${inviteType} invitation sent to ${safeEmail}.`,
            metadata: {
                inviteType,
                role: normalizedRole,
                assignedProjectIds: safeAssignedProjectIds
            }
        });
    }

    return {
        invitation: finalInvitationRecord,
        targetRecord: finalTargetRecord,
        emailDeliveryError
    };
}

async function resendInvitation({ invitationId, session, origin = '' }) {
    const invitation = await getCollectionDocument('invitations', invitationId);
    if (!invitation || !invitation.data) {
        throw new Error('Invitation not found.');
    }

    const sessionUser = session.sessionUser;
    if (String(invitation.data.workspaceId || '') !== String(sessionUser.workspaceId || '')) {
        throw new Error('You do not have access to resend this invitation.');
    }
    if (invitation.data.status === 'accepted' || invitation.data.usedAt) {
        throw new Error('Accepted invitations cannot be resent.');
    }

    const rawToken = createRawInviteToken();
    const nextRecord = {
        ...invitation.data,
        tokenHash: hashInviteToken(rawToken),
        expiresAt: new Date(Date.now() + INVITATION_TTL_MS).toISOString(),
        usedAt: '',
        status: 'pending',
        inviteLink: buildInvitationLink(rawToken, origin),
        updatedAt: new Date().toISOString()
    };

    await patchCollectionDocument('invitations', invitationId, nextRecord);
    try {
        await sendInvitationEmail({
            inviteType: nextRecord.inviteType,
            inviteeName: nextRecord.inviteeName,
            email: nextRecord.email,
            workspaceName: sessionUser.businessName || sessionUser.workspaceId,
            inviteLink: nextRecord.inviteLink,
            role: nextRecord.role,
            assignedProjectIds: nextRecord.assignedProjectIds
        });
    } catch (error) {
        await patchCollectionDocument('invitations', invitationId, {
            status: 'delivery_failed',
            updatedAt: new Date().toISOString()
        }).catch(() => undefined);
        throw error;
    }

    await logAuditEvent('invite_resent', {
        workspaceId: sessionUser.workspaceId,
        actorUserId: sessionUser.uid,
        actorEmail: sessionUser.email,
        targetEmail: nextRecord.email,
        targetId: invitationId,
        message: `Invitation resent to ${nextRecord.email}.`,
        metadata: {
            inviteType: nextRecord.inviteType,
            role: nextRecord.role
        }
    });

    return nextRecord;
}

async function resolveInvitationByToken(rawToken) {
    const tokenHash = hashInviteToken(rawToken);
    const invitationCollection = await queryCollectionDocuments('invitations', {
        fieldPath: 'tokenHash',
        op: 'EQUAL',
        value: tokenHash,
        limit: 1
    });

    const invitation = Array.isArray(invitationCollection) ? invitationCollection[0] : null;
    if (!invitation || !invitation.data) {
        throw new Error('Invitation is invalid or has expired.');
    }

    return {
        id: invitation.id,
        data: invitation.data
    };
}

function assertInvitationUsable(invitation) {
    if (!invitation || !invitation.data) {
        throw new Error('Invitation is invalid or has expired.');
    }

    const record = invitation.data;
    const disallowedStatuses = new Set(['accepted', 'cancelled', 'revoked', 'expired', 'superseded']);
    if (disallowedStatuses.has(String(record.status || '').trim().toLowerCase()) || record.usedAt) {
        throw new Error('This invitation has already been used.');
    }

    if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) {
        throw new Error('This invitation has expired.');
    }

    return record;
}

async function acceptInvitation({ session, token }) {
    const invitation = await resolveInvitationByToken(token);
    const record = assertInvitationUsable(invitation);
    const sessionUser = session.sessionUser;
    const safeSessionEmail = AccessControl.normalizeEmail(sessionUser.email);
    const invitationWorkspaceId = String(record.workspaceId || '').trim();
    if (!invitationWorkspaceId) {
        const error = new Error('Invitation is missing workspace assignment.');
        error.statusCode = 400;
        throw error;
    }

    if (!session.authUser || !session.authUser.emailVerified) {
        const error = new Error('Please verify your email address before accepting this invitation.');
        error.statusCode = 403;
        throw error;
    }

    if (safeSessionEmail !== AccessControl.normalizeEmail(record.email)) {
        throw new Error('This invitation was sent to a different email address.');
    }

    if (
        sessionUser.workspaceId
        && record.workspaceId
        && sessionUser.workspaceId !== record.workspaceId
    ) {
        throw new Error('This account is already attached to another workspace.');
    }

    const role = AccessControl.normalizeRole(record.role);
    let accessFields = buildProfileAccessFields(record);
    if (role === AccessControl.ROLES.CLIENT || String(record.inviteType || '').trim().toLowerCase() === 'team') {
        const resolvedScope = await resolveAssignedProjectIdsForWorkspace({
            assignedProjectIds: accessFields.assignedProjectIds,
            workspaceId: invitationWorkspaceId,
            workspaceOwnerEmail: AccessControl.normalizeEmail(record.workspaceOwnerEmail || record.ownerEmail)
        }).catch(() => ({
            assignedProjectIds: accessFields.assignedProjectIds,
            unresolvedProjectIds: accessFields.assignedProjectIds
        }));
        const unresolvedProjectIds = Array.isArray(resolvedScope.unresolvedProjectIds)
            ? resolvedScope.unresolvedProjectIds
            : [];
        if (unresolvedProjectIds.length) {
            const assignmentError = new Error('Invitation contains projects outside the workspace scope.');
            assignmentError.statusCode = 400;
            throw assignmentError;
        }
        accessFields = buildProfileAccessFields({
            ...accessFields,
            assignedProjectIds: resolvedScope.assignedProjectIds,
            allProjectsAccess: false
        });
    }
    const profileFields = buildPermissionFields({
        ...session.userProfile,
        role,
        workspaceRole: role,
        permissionKeys: Array.isArray(record.permissionKeys) ? record.permissionKeys : [],
        permissionMode: record.permissionMode || 'default',
        workspaceId: invitationWorkspaceId,
        workspaceOwnerEmail: record.workspaceOwnerEmail,
        workspaceOwnerUserId: record.workspaceOwnerUserId,
        isWorkspaceOwner: false,
        assignedProjectIds: accessFields.assignedProjectIds,
        allProjectsAccess: accessFields.allProjectsAccess,
        projectAccessScope: accessFields.projectAccessScope,
        membershipStatus: 'active',
        inviteType: record.inviteType,
        inviteAcceptedAt: new Date().toISOString(),
        joinedAt: session.userProfile.joinedAt || new Date().toISOString()
    }, session.authUser);

    const nextUserProfile = {
        workspaceId: invitationWorkspaceId,
        workspaceOwnerEmail: record.workspaceOwnerEmail,
        workspaceOwnerUserId: record.workspaceOwnerUserId,
        ownerEmail: record.workspaceOwnerEmail,
        ownerUserId: record.workspaceOwnerUserId,
        isWorkspaceOwner: false,
        role,
        workspaceRole: role,
        permissionKeys: profileFields.permissionKeys,
        permissions: profileFields.permissions,
        permissionMode: profileFields.permissionMode,
        assignedProjectIds: accessFields.assignedProjectIds,
        allProjectsAccess: accessFields.allProjectsAccess,
        projectAccessScope: accessFields.projectAccessScope,
        membershipStatus: 'active',
        inviteType: record.inviteType,
        inviteAcceptedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    await patchCollectionDocument('users', session.authUser.uid, nextUserProfile);
    const authoritativeScope = getAuthoritativeAssignmentScope(nextUserProfile);
    if (!authoritativeScope.workspaceId) {
        const scopeError = new Error('Authoritative workspace scope is missing after invitation acceptance.');
        scopeError.statusCode = 500;
        throw scopeError;
    }
    console.info('[WorkspaceSourceOfTruth] Using users document scope for assignment sync', {
        userId: String(session.authUser.uid || '').trim(),
        workspaceId: authoritativeScope.workspaceId,
        assignedProjectIds: authoritativeScope.assignedProjectIds
    });

    const memberDocId = getWorkspaceMemberDocumentId(authoritativeScope.workspaceId, session.authUser.uid, safeSessionEmail);
    await upsertCollectionDocument('workspace_members', memberDocId, {
        workspaceId: authoritativeScope.workspaceId,
        userId: session.authUser.uid,
        email: safeSessionEmail,
        name: sessionUser.name || safeSessionEmail,
        role,
        workspaceRole: role,
        isWorkspaceOwner: false,
        permissionKeys: profileFields.permissionKeys,
        permissions: profileFields.permissions,
        permissionMode: profileFields.permissionMode,
        assignedProjectIds: authoritativeScope.assignedProjectIds,
        allProjectsAccess: authoritativeScope.allProjectsAccess,
        projectAccessScope: authoritativeScope.projectAccessScope,
        status: 'active',
        inviteType: record.inviteType,
        joinedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });

    const assignmentIds = AccessControl.sanitizeAssignedProjectIds(authoritativeScope.assignedProjectIds);
    const assignmentSyncTimestamp = new Date().toISOString();
    await deactivateExistingProjectAssignments({
        workspaceId: authoritativeScope.workspaceId,
        userId: String(session.authUser.uid || '').trim(),
        email: safeSessionEmail,
        reason: 'invitation_accept_resync'
    }).catch(() => undefined);

    if (!authoritativeScope.allProjectsAccess) {
        for (const projectId of assignmentIds) {
            const assignmentIdentityToken = safeSessionEmail || String(session.authUser.uid || '').trim();
            const assignmentId = sanitizeDocumentId(`${authoritativeScope.workspaceId}_${projectId}_${assignmentIdentityToken}`);
            await upsertCollectionDocument('project_assignments', assignmentId, {
                workspaceId: authoritativeScope.workspaceId,
                workspace_id: authoritativeScope.workspaceId,
                projectId,
                project_id: projectId,
                userId: session.authUser.uid,
                user_id: session.authUser.uid,
                email: safeSessionEmail,
                user_email: safeSessionEmail,
                role,
                inviteType: record.inviteType,
                status: 'active',
                createdAt: assignmentSyncTimestamp,
                created_at: assignmentSyncTimestamp,
                updatedAt: assignmentSyncTimestamp,
                updated_at: assignmentSyncTimestamp,
                active: true
            });
        }
    }

    if (record.targetRecordCollection && record.targetRecordId) {
        await patchCollectionDocument(record.targetRecordCollection, record.targetRecordId, {
            invite_status: 'accepted',
            canonical_role: role,
            role: AccessControl.getRoleDisplayLabel(role),
            assigned_project_ids: assignmentIds,
            all_projects_access: authoritativeScope.allProjectsAccess,
            project_access_scope: authoritativeScope.projectAccessScope,
            project_id: authoritativeScope.allProjectsAccess ? '' : (assignmentIds[0] || ''),
            primary_project_id: authoritativeScope.allProjectsAccess ? '' : (assignmentIds[0] || ''),
            invited_user_id: session.authUser.uid,
            invite_accepted_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });
    }

    if (record.inviteType === 'client') {
        const clientProfileId = sanitizeDocumentId(`${authoritativeScope.workspaceId}_${safeSessionEmail}`);
        await upsertCollectionDocument('client_profiles', clientProfileId, {
            workspaceId: authoritativeScope.workspaceId,
            userId: session.authUser.uid,
            email: safeSessionEmail,
            assignedProjectIds: assignmentIds,
            allProjectsAccess: authoritativeScope.allProjectsAccess,
            projectAccessScope: authoritativeScope.projectAccessScope,
            status: 'active',
            updatedAt: new Date().toISOString()
        });
    }

    await patchCollectionDocument('invitations', invitation.id, {
        status: 'accepted',
        usedAt: new Date().toISOString(),
        acceptedByUserId: session.authUser.uid,
        acceptedByEmail: safeSessionEmail,
        updatedAt: new Date().toISOString()
    });

    await logAuditEvent('invite_accepted', {
        workspaceId: invitationWorkspaceId,
        actorUserId: session.authUser.uid,
        actorEmail: safeSessionEmail,
        targetEmail: safeSessionEmail,
        targetId: invitation.id,
        message: `Invitation accepted by ${safeSessionEmail}.`,
        metadata: {
            inviteType: record.inviteType,
            role
        }
    });

    const mergedProfile = {
        ...session.userProfile,
        ...nextUserProfile,
        email: safeSessionEmail,
        name: sessionUser.name || safeSessionEmail
    };

    console.info('[WorkspaceAssignment] Invitation accepted', {
        invitationId: invitation.id,
        inviteType: record.inviteType,
        workspaceId: invitationWorkspaceId,
        email: safeSessionEmail,
        assignedProjectIds: assignmentIds
    });

    return {
        invitationId: invitation.id,
        role,
        sessionUser: buildSessionUser(mergedProfile, session.authUser)
    };
}

module.exports = {
    INVITATION_TTL_MS,
    acceptInvitation,
    assertInvitationUsable,
    createInvitation,
    createRawInviteToken,
    hashInviteToken,
    resendInvitation,
    resolveInvitationByToken
};
