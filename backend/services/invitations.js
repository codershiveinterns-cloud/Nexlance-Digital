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
    const created = await createCollectionDocument(target.collectionId, target.record);
    return {
        targetCollectionId: target.collectionId,
        targetRecord: created
    };
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
    const safeAssignedProjectIds = normalizedAccess.assignedProjectIds;
    const rawToken = createRawInviteToken();
    const invitationId = getInvitationDocumentId();
    const targetRecord = await createPendingTargetRecord({
        inviteType,
        inviteeName,
        email: safeEmail,
        role: normalizedRole,
        assignedProjectIds: safeAssignedProjectIds,
        allProjectsAccess: normalizedAccess.allProjectsAccess,
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
        allProjectsAccess: normalizedAccess.allProjectsAccess,
        sessionUser,
        rawToken,
        targetRecord,
        origin,
        metadata
    });

    await upsertCollectionDocument('invitations', invitationId, invitationRecord);
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
        && !sessionUser.isWorkspaceOwner
    ) {
        throw new Error('This account is already attached to another workspace.');
    }

    const role = AccessControl.normalizeRole(record.role);
    const accessFields = buildProfileAccessFields(record);
    const profileFields = buildPermissionFields({
        ...session.userProfile,
        role,
        workspaceRole: role,
        permissionKeys: Array.isArray(record.permissionKeys) ? record.permissionKeys : [],
        permissionMode: record.permissionMode || 'default',
        workspaceId: record.workspaceId,
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

    const memberDocId = getWorkspaceMemberDocumentId(record.workspaceId, session.authUser.uid, safeSessionEmail);
    await upsertCollectionDocument('workspace_members', memberDocId, {
        workspaceId: record.workspaceId,
        userId: session.authUser.uid,
        email: safeSessionEmail,
        name: sessionUser.name || safeSessionEmail,
        role,
        workspaceRole: role,
        isWorkspaceOwner: false,
        permissionKeys: profileFields.permissionKeys,
        permissions: profileFields.permissions,
        permissionMode: profileFields.permissionMode,
        assignedProjectIds: accessFields.assignedProjectIds,
        allProjectsAccess: accessFields.allProjectsAccess,
        projectAccessScope: accessFields.projectAccessScope,
        status: 'active',
        inviteType: record.inviteType,
        joinedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });

    const assignmentIds = AccessControl.sanitizeAssignedProjectIds(accessFields.assignedProjectIds);
    if (!accessFields.allProjectsAccess) {
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
    }

    if (record.targetRecordCollection && record.targetRecordId) {
        await patchCollectionDocument(record.targetRecordCollection, record.targetRecordId, {
            invite_status: 'accepted',
            canonical_role: role,
            role: AccessControl.getRoleDisplayLabel(role),
            assigned_project_ids: assignmentIds,
            all_projects_access: accessFields.allProjectsAccess,
            project_access_scope: accessFields.projectAccessScope,
            project_id: accessFields.allProjectsAccess ? '' : (assignmentIds[0] || ''),
            primary_project_id: accessFields.allProjectsAccess ? '' : (assignmentIds[0] || ''),
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
            allProjectsAccess: accessFields.allProjectsAccess,
            projectAccessScope: accessFields.projectAccessScope,
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
