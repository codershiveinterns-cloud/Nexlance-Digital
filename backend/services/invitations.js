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
    commitBatchedWrites,
    createCollectionDocument,
    getCollectionDocument,
    getFirestoreDocRef,
    patchCollectionDocument,
    queryCollectionDocuments,
    queryCollectionDocumentsMulti,
    runFirestoreTransaction,
    sanitizeDocumentId,
    upsertCollectionDocument
} = require('./firebase-service');
const {
    buildPermissionFields,
    buildSessionUser,
    getNormalizedAssignedProjectIds,
    getWorkspaceMemberDocumentId,
    invalidateSessionCache
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
    // Indexed composite query — no full scan
    const assignmentQueries = [];
    if (normalizedEmail) {
        assignmentQueries.push(queryCollectionDocumentsMulti('project_assignments', [
            { fieldPath: 'workspace_id', op: 'EQUAL', value: normalizedWorkspaceId },
            { fieldPath: 'email', op: 'EQUAL', value: normalizedEmail }
        ], 500).catch(() => []));
        assignmentQueries.push(queryCollectionDocumentsMulti('project_assignments', [
            { fieldPath: 'workspace_id', op: 'EQUAL', value: normalizedWorkspaceId },
            { fieldPath: 'user_email', op: 'EQUAL', value: normalizedEmail }
        ], 500).catch(() => []));
    } else if (normalizedUserId) {
        assignmentQueries.push(queryCollectionDocumentsMulti('project_assignments', [
            { fieldPath: 'workspace_id', op: 'EQUAL', value: normalizedWorkspaceId },
            { fieldPath: 'user_id', op: 'EQUAL', value: normalizedUserId }
        ], 500).catch(() => []));
        assignmentQueries.push(queryCollectionDocumentsMulti('project_assignments', [
            { fieldPath: 'workspace_id', op: 'EQUAL', value: normalizedWorkspaceId },
            { fieldPath: 'userId', op: 'EQUAL', value: normalizedUserId }
        ], 500).catch(() => []));
    }
    const assignmentResults = await Promise.all(assignmentQueries);
    const seenAssignmentIds = new Set();
    const matchingAssignments = [];
    for (const batch of assignmentResults) {
        for (const record of (Array.isArray(batch) ? batch : [])) {
            if (!record || !record.id || seenAssignmentIds.has(record.id)) continue;
            seenAssignmentIds.add(record.id);
            matchingAssignments.push(record);
        }
    }

    // Batch deactivate — chunked single op
    if (matchingAssignments.length) {
        const ops = matchingAssignments.map(assignment => ({
            collectionId: 'project_assignments',
            docId: assignment.id,
            data: {
                status: 'inactive',
                active: false,
                deactivatedReason: String(reason || '').trim() || 'assignment_resync',
                updatedAt: now,
                updated_at: now
            }
        }));
        await commitBatchedWrites(ops).catch(() => undefined);
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

async function sendInvitationEmail({ inviteType, inviteeName, email, workspaceName, inviteLink, role, assignedProjectIds, ownerEmail, allProjectsAccess }) {
    const roleLabel = AccessControl.getRoleDisplayLabel(role);
    const projectNames = await getProjectNames(assignedProjectIds);
    const payload = inviteType === 'client'
        ? buildClientInviteEmail({ inviteeName, workspaceName, inviteLink, projectNames, ownerEmail, allProjectsAccess, roleLabel })
        : buildTeamInviteEmail({ inviteeName, workspaceName, inviteLink, roleLabel, projectNames, ownerEmail, allProjectsAccess });

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

    // Indexed composite query: workspace_id + email — no full-scan fallback
    const workspaceClients = await queryCollectionDocumentsMulti('clients', [
        { fieldPath: 'workspace_id', op: 'EQUAL', value: normalizedWorkspaceId },
        { fieldPath: 'email', op: 'EQUAL', value: normalizedEmail }
    ], 500).catch(() => []);

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

    // Indexed composite query: workspace_id + email — no full-scan fallback
    const workspaceMembers = await queryCollectionDocumentsMulti('team_members', [
        { fieldPath: 'workspace_id', op: 'EQUAL', value: normalizedWorkspaceId },
        { fieldPath: 'email', op: 'EQUAL', value: normalizedEmail }
    ], 500).catch(() => []);

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

    // Indexed composite query: workspaceId + email — no full-scan fallback
    const invitations = await queryCollectionDocumentsMulti('invitations', [
        { fieldPath: 'workspaceId', op: 'EQUAL', value: normalizedWorkspaceId },
        { fieldPath: 'email', op: 'EQUAL', value: normalizedEmail }
    ], 200).catch(() => []);

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
            assignedProjectIds: safeAssignedProjectIds,
            ownerEmail: sessionUser.workspaceOwnerEmail || sessionUser.email,
            allProjectsAccess: safeAllProjectsAccess === true
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
            assignedProjectIds: nextRecord.assignedProjectIds,
            ownerEmail: nextRecord.workspaceOwnerEmail || sessionUser.workspaceOwnerEmail || sessionUser.email,
            allProjectsAccess: nextRecord.allProjectsAccess === true
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

async function findPendingInvitationForEmail(email) {
    const normalizedEmail = AccessControl.normalizeEmail(email);
    if (!normalizedEmail) return null;
    const matches = await queryCollectionDocumentsMulti('invitations', [
        { fieldPath: 'email', op: 'EQUAL', value: normalizedEmail },
        { fieldPath: 'status', op: 'EQUAL', value: 'pending' }
    ], 10).catch(() => []);
    const candidates = Array.isArray(matches) ? matches : [];
    const usable = candidates.find(entry => {
        const data = entry && entry.data ? entry.data : {};
        if (!data) return false;
        if (data.expiresAt && new Date(data.expiresAt).getTime() <= Date.now()) return false;
        return true;
    });
    return usable ? { id: usable.id, data: usable.data } : null;
}

async function acceptInvitation({ session, token, invitation: preResolvedInvitation }) {
    console.info('[InviteAccept] start', { userId: session && session.authUser && session.authUser.uid });

    const invitation = preResolvedInvitation || await resolveInvitationByToken(token);
    const record = assertInvitationUsable(invitation);
    const sessionUser = session.sessionUser;
    const safeSessionEmail = AccessControl.normalizeEmail(sessionUser.email);
    const invitationWorkspaceId = String(record.workspaceId || '').trim();
    const role = AccessControl.normalizeRole(record.role);

    if (!invitationWorkspaceId) {
        const error = new Error('Invitation is missing workspace assignment.');
        error.statusCode = 400;
        throw error;
    }
    if (!role) {
        const error = new Error('Invitation is missing a role.');
        error.statusCode = 400;
        throw error;
    }
    if (!session.authUser) {
        const error = new Error('Please sign in before accepting this invitation.');
        error.statusCode = 403;
        throw error;
    }
    // Email verification is intentionally NOT enforced here.
    // The invitation token itself (cryptographic, single-use, sent to the
    // email) proves ownership of the address.  This allows invited users to
    // create an account and join the workspace in a single step without
    // waiting for a verification email round-trip.
    if (safeSessionEmail !== AccessControl.normalizeEmail(record.email)) {
        throw new Error('This invitation was sent to a different email address.');
    }
    const sessionIsWorkspaceOwner = AccessControl.isWorkspaceOwner(sessionUser)
        || String(sessionUser.role || '').trim().toLowerCase() === 'owner'
        || String(sessionUser.workspaceRole || '').trim().toLowerCase() === 'owner';
    if (
        sessionUser.workspaceId
        && record.workspaceId
        && sessionUser.workspaceId !== record.workspaceId
    ) {
        if (sessionIsWorkspaceOwner) {
            throw new Error('This account is already attached to another workspace.');
        }
        console.info('[InviteAccept] Reassigning non-owner user to invitation workspace', {
            userId: String(session.authUser && session.authUser.uid || '').trim(),
            email: safeSessionEmail,
            previousWorkspaceId: sessionUser.workspaceId,
            nextWorkspaceId: invitationWorkspaceId
        });
    }

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

    const nowIso = new Date().toISOString();
    const nextUserProfile = {
        workspaceId: invitationWorkspaceId,
        workspaceOwnerEmail: record.workspaceOwnerEmail || '',
        workspaceOwnerUserId: record.workspaceOwnerUserId || '',
        ownerEmail: record.workspaceOwnerEmail || '',
        ownerUserId: record.workspaceOwnerUserId || '',
        isWorkspaceOwner: false,
        role,
        workspaceRole: role,
        permissionKeys: profileFields.permissionKeys,
        permissions: profileFields.permissions,
        permissionMode: profileFields.permissionMode,
        assignedProjectIds: accessFields.assignedProjectIds || [],
        allProjectsAccess: accessFields.allProjectsAccess === true,
        projectAccessScope: accessFields.projectAccessScope,
        membershipStatus: 'active',
        inviteType: record.inviteType,
        inviteAcceptedAt: nowIso,
        updatedAt: nowIso
    };

    const assignmentIds = AccessControl.sanitizeAssignedProjectIds(accessFields.assignedProjectIds);
    const userId = String(session.authUser.uid || '').trim();
    const assignmentIdentityToken = safeSessionEmail || userId;

    const invitationRef = getFirestoreDocRef('invitations', invitation.id);
    const userRef = getFirestoreDocRef('users', userId);
    const plannedProjectIds = (!nextUserProfile.allProjectsAccess ? assignmentIds : [])
        .map(projectId => String(projectId || '').trim())
        .filter(Boolean);
    // Resolve each project's workspaceId from its own document (source of truth)
    // so the assignment is stamped with the project's workspace, not the
    // invitation's.  Any project whose workspace differs from the invitation
    // workspace is dropped — such records would be invisible to the scope
    // resolver anyway and would pollute the assignments collection.
    const projectDocs = await Promise.all(plannedProjectIds.map(id =>
        getCollectionDocument('projects', id).catch(() => null)
    ));
    const assignmentPlans = [];
    plannedProjectIds.forEach((projectId, idx) => {
        const projectRecord = projectDocs[idx];
        const projectWorkspaceId = String(
            projectRecord && projectRecord.data && (projectRecord.data.workspace_id || projectRecord.data.workspaceId) || ''
        ).trim();
        if (!projectWorkspaceId || projectWorkspaceId !== invitationWorkspaceId) {
            console.warn('[InviteAccept] Dropping project assignment with workspace mismatch', {
                projectId,
                invitationWorkspaceId,
                projectWorkspaceId
            });
            return;
        }
        assignmentPlans.push({
            projectId,
            projectWorkspaceId,
            ref: getFirestoreDocRef(
                'project_assignments',
                sanitizeDocumentId(`${projectWorkspaceId}_${projectId}_${assignmentIdentityToken}`)
            )
        });
    });

    await runFirestoreTransaction(async tx => {
        const invitationSnap = await tx.get(invitationRef);
        if (!invitationSnap.exists) {
            const error = new Error('Invitation is invalid or has expired.');
            error.statusCode = 404;
            throw error;
        }
        const currentInvitation = invitationSnap.data() || {};
        const status = String(currentInvitation.status || 'pending').trim().toLowerCase();
        if (status !== 'pending') {
            const error = new Error('This invitation has already been used.');
            error.statusCode = 409;
            throw error;
        }
        if (currentInvitation.expiresAt && new Date(currentInvitation.expiresAt).getTime() <= Date.now()) {
            const error = new Error('This invitation has expired.');
            error.statusCode = 410;
            throw error;
        }
        // Required read before writes (user doc may not yet exist — merge-set handles both cases)
        await tx.get(userRef);

        tx.set(userRef, nextUserProfile, { merge: true });

        for (const { projectId, projectWorkspaceId, ref } of assignmentPlans) {
            tx.set(ref, {
                workspaceId: projectWorkspaceId,
                workspace_id: projectWorkspaceId,
                projectId,
                project_id: projectId,
                userId,
                user_id: userId,
                email: safeSessionEmail,
                user_email: safeSessionEmail,
                role: AccessControl.normalizeRole(role),
                inviteType: String(record.inviteType || '').trim().toLowerCase(),
                status: 'active',
                active: true,
                createdAt: nowIso,
                created_at: nowIso,
                updatedAt: nowIso,
                updated_at: nowIso
            }, { merge: true });
        }

        tx.update(invitationRef, {
            status: 'accepted',
            acceptedAt: nowIso,
            usedAt: nowIso,
            acceptedByUserId: userId,
            acceptedByEmail: safeSessionEmail,
            updatedAt: nowIso
        });
    });

    console.info('[InviteAccept] user updated', { userId, workspaceId: invitationWorkspaceId, role });
    console.info('[InviteAccept] assignments created', {
        userId,
        workspaceId: invitationWorkspaceId,
        assignedProjectIds: assignmentPlans.map(p => p.projectId)
    });

    // Invalidate cached session — role, workspace, and permissions just changed
    invalidateSessionCache(userId);
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

    // Multi-workspace membership (new model) — additive; keeps users/{uid} intact
    try {
        const { upsertMembership } = require('./memberships');
        await upsertMembership({
            userId: session.authUser.uid,
            email: safeSessionEmail,
            workspaceId: authoritativeScope.workspaceId,
            workspaceName: record.workspaceName || '',
            workspaceOwnerEmail: record.workspaceOwnerEmail,
            workspaceOwnerUserId: record.workspaceOwnerUserId,
            role,
            assignedProjectIds: authoritativeScope.assignedProjectIds,
            allProjectsAccess: authoritativeScope.allProjectsAccess,
            isWorkspaceOwner: false
        });
    } catch (membershipError) {
        console.warn('[InviteAccept] workspace_memberships upsert failed', {
            userId: session.authUser.uid,
            workspaceId: authoritativeScope.workspaceId,
            error: membershipError && membershipError.message
        });
    }

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

    // NOTE: deactivateExistingProjectAssignments was previously called here but has
    // been removed.  The Firestore transaction above already creates the authoritative
    // set of assignments with merge:true — calling a blanket deactivation immediately
    // afterward would destroy those freshly-created records, leaving the user with an
    // empty dashboard on first login.  Stale pre-invite assignments (if any) are
    // naturally superseded by the merge-set and cleaned up by the idempotent
    // syncProjectAssignments() / resolveScopedAssignedProjectsForLogin() on subsequent
    // syncs.

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

    // Bust the dashboard list cache for both the invitation's workspace (so the
    // admin sees the new member and the invitee sees their assigned projects on
    // first load) and the invitee's previous stale workspace (defensive cleanup).
    try {
        const { invalidateDashboardListCacheByWorkspace } = require('../api/dashboard');
        if (typeof invalidateDashboardListCacheByWorkspace === 'function') {
            invalidateDashboardListCacheByWorkspace(invitationWorkspaceId);
            const previousWorkspaceId = String(sessionUser.workspaceId || '').trim();
            if (previousWorkspaceId && previousWorkspaceId !== invitationWorkspaceId) {
                invalidateDashboardListCacheByWorkspace(previousWorkspaceId);
            }
        }
    } catch (cacheError) {
        console.warn('[InviteAccept] dashboard cache bust failed', {
            workspaceId: invitationWorkspaceId,
            error: cacheError && cacheError.message
        });
    }

    const mergedProfile = {
        ...session.userProfile,
        ...nextUserProfile,
        email: safeSessionEmail,
        name: sessionUser.name || safeSessionEmail
    };

    console.info('[InviteAccept] success', {
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
    findPendingInvitationForEmail,
    hashInviteToken,
    resendInvitation,
    resolveInvitationByToken
};
