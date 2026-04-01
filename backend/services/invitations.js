const crypto = require('crypto');
const AccessControl = require('../../rbac.js');
const { logAuditEvent } = require('./audit-log');
const { sendEmailWithResend } = require('./email-service');
const { buildClientInviteEmail, buildTeamInviteEmail } = require('./invitation-emails');
const {
    createCollectionDocument,
    getCollectionDocument,
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

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

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

    if (inviteType === 'team' && normalizedRole === AccessControl.ROLES.CLIENT) {
        throw new Error('Team invitations must use an internal team role.');
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

function buildTargetRecordPayload({ inviteType, inviteeName, email, role, assignedProjectIds, sessionUser, invitationId, metadata = {} }) {
    const now = new Date().toISOString();
    const baseRecord = {
        ...(metadata && typeof metadata === 'object' ? metadata : {}),
        name: inviteeName,
        email: AccessControl.normalizeEmail(email),
        role: AccessControl.getRoleDisplayLabel(role),
        canonical_role: role,
        assigned_project_ids: assignedProjectIds,
        invitation_id: invitationId,
        invite_status: 'pending',
        owner_key: AccessControl.normalizeEmail(sessionUser.workspaceOwnerEmail || sessionUser.email),
        owner_email: AccessControl.normalizeEmail(sessionUser.workspaceOwnerEmail || sessionUser.email),
        workspace_id: sessionUser.workspaceId,
        updated_at: now
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
            created_at: now
        }
    };
}

async function createPendingTargetRecord(options) {
    const target = buildTargetRecordPayload(options);
    const created = await createCollectionDocument(target.collectionId, target.record);
    return {
        targetCollectionId: target.collectionId,
        targetRecord: created
    };
}

function buildInvitationRecord({ invitationId, inviteType, inviteeName, email, role, assignedProjectIds, sessionUser, rawToken, targetRecord, origin }) {
    const now = new Date().toISOString();
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
        assignedProjectIds,
        targetRecordCollection: targetRecord ? targetRecord.targetCollectionId : '',
        targetRecordId: targetRecord && targetRecord.targetRecord ? targetRecord.targetRecord.id : '',
        inviteLink: buildInvitationLink(rawToken, origin),
        createdAt: now,
        updatedAt: now
    };
}

async function createInvitation({ session, inviteType, inviteeName, email, role, assignedProjectIds = [], origin = '', metadata = {} }) {
    const sessionUser = session.sessionUser;
    const normalizedRole = assertAllowedInviteRole(role, inviteType);
    const safeEmail = AccessControl.normalizeEmail(email);
    if (!safeEmail) {
        throw new Error('Invite email is required.');
    }

    const safeAssignedProjectIds = getNormalizedAssignedProjectIds({ assignedProjectIds });
    const rawToken = createRawInviteToken();
    const invitationId = getInvitationDocumentId();
    const targetRecord = await createPendingTargetRecord({
        inviteType,
        inviteeName,
        email: safeEmail,
        role: normalizedRole,
        assignedProjectIds: safeAssignedProjectIds,
        sessionUser,
        invitationId,
        metadata
    });
    const invitationRecord = buildInvitationRecord({
        invitationId,
        inviteType,
        inviteeName,
        email: safeEmail,
        role: normalizedRole,
        assignedProjectIds: safeAssignedProjectIds,
        sessionUser,
        rawToken,
        targetRecord,
        origin
    });

    await upsertCollectionDocument('invitations', invitationId, invitationRecord);
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
        await patchCollectionDocument('invitations', invitationId, {
            status: 'delivery_failed',
            updatedAt: new Date().toISOString()
        }).catch(() => undefined);

        if (targetRecord && targetRecord.targetCollectionId && targetRecord.targetRecord && targetRecord.targetRecord.id) {
            await patchCollectionDocument(targetRecord.targetCollectionId, targetRecord.targetRecord.id, {
                invite_status: 'delivery_failed',
                updated_at: new Date().toISOString()
            }).catch(() => undefined);
        }

        throw error;
    }

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

    return {
        invitation: invitationRecord,
        targetRecord: targetRecord.targetRecord
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
    if (record.status === 'accepted' || record.usedAt) {
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

    if (safeSessionEmail !== AccessControl.normalizeEmail(record.email)) {
        throw new Error('This invitation was sent to a different email address.');
    }

    if (
        sessionUser.workspaceId
        && record.workspaceId
        && sessionUser.workspaceId !== record.workspaceId
        && !sessionUser.isWorkspaceOwner
    ) {
        throw new Error('This account is already attached to another workspace.');
    }

    const role = AccessControl.normalizeRole(record.role);
    const profileFields = buildPermissionFields({
        ...session.userProfile,
        role,
        workspaceRole: role,
        workspaceId: record.workspaceId,
        workspaceOwnerEmail: record.workspaceOwnerEmail,
        workspaceOwnerUserId: record.workspaceOwnerUserId,
        isWorkspaceOwner: false,
        assignedProjectIds: record.assignedProjectIds,
        membershipStatus: 'active',
        inviteType: record.inviteType,
        inviteAcceptedAt: new Date().toISOString(),
        joinedAt: session.userProfile.joinedAt || new Date().toISOString()
    }, session.authUser);

    const nextUserProfile = {
        workspaceId: record.workspaceId,
        workspaceOwnerEmail: record.workspaceOwnerEmail,
        workspaceOwnerUserId: record.workspaceOwnerUserId,
        ownerEmail: record.workspaceOwnerEmail,
        ownerUserId: record.workspaceOwnerUserId,
        isWorkspaceOwner: false,
        role,
        workspaceRole: role,
        permissionKeys: profileFields.permissionKeys,
        permissions: profileFields.permissions,
        assignedProjectIds: record.assignedProjectIds || [],
        membershipStatus: 'active',
        inviteType: record.inviteType,
        inviteAcceptedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    await patchCollectionDocument('users', session.authUser.uid, nextUserProfile);

    const memberDocId = getWorkspaceMemberDocumentId(record.workspaceId, session.authUser.uid, safeSessionEmail);
    await upsertCollectionDocument('workspace_members', memberDocId, {
        workspaceId: record.workspaceId,
        userId: session.authUser.uid,
        email: safeSessionEmail,
        name: sessionUser.name || safeSessionEmail,
        role,
        workspaceRole: role,
        isWorkspaceOwner: false,
        assignedProjectIds: record.assignedProjectIds || [],
        status: 'active',
        inviteType: record.inviteType,
        joinedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });

    const assignmentIds = AccessControl.sanitizeAssignedProjectIds(record.assignedProjectIds);
    for (const projectId of assignmentIds) {
        const assignmentId = sanitizeDocumentId(`${record.workspaceId}_${projectId}_${session.authUser.uid}`);
        await upsertCollectionDocument('project_assignments', assignmentId, {
            workspaceId: record.workspaceId,
            projectId,
            userId: session.authUser.uid,
            email: safeSessionEmail,
            role,
            inviteType: record.inviteType,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            active: true
        });
    }

    if (record.targetRecordCollection && record.targetRecordId) {
        await patchCollectionDocument(record.targetRecordCollection, record.targetRecordId, {
            invite_status: 'accepted',
            canonical_role: role,
            role: AccessControl.getRoleDisplayLabel(role),
            assigned_project_ids: assignmentIds,
            invited_user_id: session.authUser.uid,
            invite_accepted_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });
    }

    if (record.inviteType === 'client') {
        const clientProfileId = sanitizeDocumentId(`${record.workspaceId}_${safeSessionEmail}`);
        await upsertCollectionDocument('client_profiles', clientProfileId, {
            workspaceId: record.workspaceId,
            userId: session.authUser.uid,
            email: safeSessionEmail,
            assignedProjectIds: assignmentIds,
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
        workspaceId: record.workspaceId,
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
