const AccessControl = require('../../rbac.js');
const {
    findUserDocumentByEmail,
    getCollectionDocument,
    listCollectionDocuments,
    patchCollectionDocument,
    queryCollectionDocuments,
    sanitizeDocumentId,
    upsertCollectionDocument
} = require('./firebase-service');
const { resolveAssignedProjectIdsForWorkspace } = require('./project-assignment-resolution');

function buildWorkspaceName(profile = {}, authUser = {}) {
    const businessName = String(profile.businessName || '').trim();
    const displayName = String(profile.name || authUser.displayName || '').trim();
    if (businessName) return businessName;
    if (displayName) return `${displayName}'s Workspace`;
    const email = String(profile.email || authUser.email || '').trim().toLowerCase();
    return email ? `${email.split('@')[0]}'s Workspace` : 'Nexlance Workspace';
}

function hasPendingInviteState(profile = {}) {
    const workspaceId = String(profile.workspaceId || '').trim();
    const membershipStatus = String(profile.membershipStatus || profile.status || '').trim().toLowerCase();
    const inviteType = String(profile.inviteType || profile.memberType || '').trim().toLowerCase();
    return !workspaceId && membershipStatus === 'pending' && Boolean(inviteType);
}

function getWorkspaceId(profile = {}, authUser = {}) {
    const explicitId = String(profile.workspaceId || '').trim();
    if (explicitId) return explicitId;
    if (hasPendingInviteState(profile)) return '';
    return sanitizeDocumentId(`workspace_${authUser.uid || profile.uid || Date.now()}`);
}

function getWorkspaceOwnerEmail(profile = {}, authUser = {}) {
    const explicitOwnerEmail = AccessControl.normalizeEmail(profile.workspaceOwnerEmail || profile.ownerEmail);
    if (explicitOwnerEmail) return explicitOwnerEmail;
    if (hasPendingInviteState(profile)) return '';
    return AccessControl.normalizeEmail(authUser.email);
}

function getWorkspaceOwnerUserId(profile = {}, authUser = {}) {
    const explicitOwnerUserId = String(profile.workspaceOwnerUserId || profile.ownerUserId || '').trim();
    if (explicitOwnerUserId) return explicitOwnerUserId;
    if (hasPendingInviteState(profile)) return '';
    return String(authUser.uid || '').trim();
}

function getWorkspaceMemberDocumentId(workspaceId, userId, email) {
    return sanitizeDocumentId(`${workspaceId}_${userId || AccessControl.normalizeEmail(email)}`);
}

function getNormalizedAssignedProjectIds(profile = {}) {
    return AccessControl.sanitizeAssignedProjectIds(profile.assignedProjectIds);
}

function hasAllProjectsAccess(profile = {}) {
    return profile.allProjectsAccess === true
        || profile.all_projects_access === true
        || String(profile.projectAccessScope || profile.project_access_scope || '').trim().toLowerCase() === 'all';
}

function getNormalizedClientInvitationAccess(invitation = {}) {
    const allProjectsAccess = invitation.allProjectsAccess === true
        || invitation.all_projects_access === true
        || String(invitation.projectAccessScope || invitation.project_access_scope || '').trim().toLowerCase() === 'all';
    const assignedProjectIds = allProjectsAccess
        ? []
        : AccessControl.sanitizeAssignedProjectIds(
            invitation.assignedProjectIds !== undefined
                ? invitation.assignedProjectIds
                : invitation.assigned_project_ids
        );

    return {
        assignedProjectIds,
        allProjectsAccess,
        projectAccessScope: allProjectsAccess ? 'all' : 'selected',
        primaryProjectId: allProjectsAccess ? '' : (assignedProjectIds[0] || '')
    };
}

function isUsableClientInvitation(record = {}) {
    const inviteType = String(record.inviteType || '').trim().toLowerCase();
    if (inviteType !== 'client') return false;

    const role = AccessControl.normalizeRole(record.role || record.workspaceRole || record.dashboardRole || 'client');
    if (role !== AccessControl.ROLES.CLIENT) return false;

    const status = String(record.status || 'pending').trim().toLowerCase();
    if (status === 'accepted' || status === 'cancelled' || status === 'revoked' || status === 'expired' || status === 'superseded') {
        return false;
    }
    if (record.usedAt) return false;

    if (record.expiresAt) {
        const expiresAtMs = new Date(record.expiresAt).getTime();
        if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
            return false;
        }
    }

    return true;
}

function getInvitationSortTimestamp(record = {}) {
    const createdAtMs = new Date(record.createdAt || record.created_at || '').getTime();
    if (Number.isFinite(createdAtMs) && createdAtMs > 0) return createdAtMs;
    const updatedAtMs = new Date(record.updatedAt || record.updated_at || '').getTime();
    if (Number.isFinite(updatedAtMs) && updatedAtMs > 0) return updatedAtMs;
    return 0;
}

function shouldTryClientInvitationAutoBootstrap(profile = {}) {
    if (AccessControl.isWorkspaceOwner(profile)) return false;
    const workspaceId = String(profile.workspaceId || '').trim();
    const role = AccessControl.normalizeRole(profile.role || profile.workspaceRole || profile.dashboardRole || '');
    const membershipStatus = String(profile.membershipStatus || profile.status || '').trim().toLowerCase();
    return Boolean(workspaceId) && role === AccessControl.ROLES.CLIENT && membershipStatus === 'pending';
}

async function findPendingClientInvitationByEmail(email, preferredWorkspaceId = '') {
    const safeEmail = AccessControl.normalizeEmail(email);
    if (!safeEmail) return null;

    const normalizedPreferredWorkspaceId = String(preferredWorkspaceId || '').trim();
    if (!normalizedPreferredWorkspaceId) {
        // Prevent implicit cross-workspace bootstrap from "latest"/"first" invitation fallback.
        return null;
    }
    let invitations = await queryCollectionDocuments('invitations', {
        fieldPath: 'email',
        op: 'EQUAL',
        value: safeEmail,
        limit: 200
    }).catch(() => []);

    if (!Array.isArray(invitations) || !invitations.length) {
        invitations = (await listCollectionDocuments('invitations', { pageSize: 500 }).catch(() => []))
            .filter(record => AccessControl.normalizeEmail(record.email) === safeEmail)
            .map(record => ({ id: record.id, data: record }));
    }

    const candidates = (Array.isArray(invitations) ? invitations : [])
        .map(record => ({
            id: record.id || (record.name ? record.name.split('/').pop() : ''),
            data: record.data || record
        }))
        .filter(entry => {
            const record = entry.data || {};
            if (!isUsableClientInvitation(record)) return false;
            if (!String(record.workspaceId || '').trim()) return false;
            return String(record.workspaceId || '').trim() === normalizedPreferredWorkspaceId;
        })
        .sort((left, right) => getInvitationSortTimestamp(right.data) - getInvitationSortTimestamp(left.data));

    if (candidates.length !== 1) {
        if (candidates.length > 1) {
            console.warn('[WorkspaceAssignment] Ambiguous pending invitations; skipping auto-bootstrap', {
                email: safeEmail,
                workspaceId: normalizedPreferredWorkspaceId,
                invitationIds: candidates.map(candidate => candidate.id).filter(Boolean)
            });
        }
        return null;
    }

    return candidates[0];
}

async function syncProjectAssignmentsForUser({ workspaceId, userId, email, access }) {
    if (!workspaceId || !userId) return;

    const records = await listCollectionDocuments('project_assignments', { pageSize: 500 }).catch(() => []);
    const currentAssignments = records.filter(record => (
        String(record.workspaceId || '').trim() === String(workspaceId).trim()
        && String(record.userId || '').trim() === String(userId).trim()
    ));
    const assignedProjectIdSet = new Set(access.assignedProjectIds);

    for (const assignment of currentAssignments) {
        const projectId = String(assignment.projectId || '').trim();
        const shouldBeActive = access.allProjectsAccess || assignedProjectIdSet.has(projectId);
        if (Boolean(assignment.active) === shouldBeActive) continue;
        await patchCollectionDocument('project_assignments', assignment.id, {
            active: shouldBeActive,
            updatedAt: new Date().toISOString()
        }).catch(() => undefined);
    }

    if (access.allProjectsAccess) {
        return;
    }

    const existingProjectIdSet = new Set(
        currentAssignments
            .map(record => String(record.projectId || '').trim())
            .filter(Boolean)
    );

    for (const projectId of access.assignedProjectIds) {
        if (existingProjectIdSet.has(projectId)) continue;
        const assignmentId = sanitizeDocumentId(`${workspaceId}_${projectId}_${userId}`);
        await upsertCollectionDocument('project_assignments', assignmentId, {
            workspaceId: String(workspaceId).trim(),
            projectId,
            userId: String(userId).trim(),
            email: AccessControl.normalizeEmail(email),
            role: AccessControl.ROLES.CLIENT,
            inviteType: 'client',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            active: true
        }).catch(() => undefined);
    }
}

async function autoBootstrapClientAccessFromInvitation({ existingProfile, authUser }) {
    if (!shouldTryClientInvitationAutoBootstrap(existingProfile)) {
        return null;
    }

    const invitation = await findPendingClientInvitationByEmail(
        authUser.email,
        existingProfile.workspaceId
    );
    if (!invitation || !invitation.data) {
        return null;
    }

    const invite = invitation.data;
    const workspaceId = String(invite.workspaceId || '').trim();
    if (!workspaceId) {
        return null;
    }

    console.info('[WorkspaceAssignment] Auto-bootstrap using pending invitation', {
        invitationId: invitation.id,
        workspaceId,
        email: AccessControl.normalizeEmail(authUser.email || existingProfile.email)
    });

    const safeEmail = AccessControl.normalizeEmail(authUser.email || existingProfile.email);
    const now = new Date().toISOString();
    const invitationAccess = getNormalizedClientInvitationAccess({
        ...invite,
        allProjectsAccess: false,
        all_projects_access: false,
        projectAccessScope: 'selected',
        project_access_scope: 'selected'
    });
    const resolvedScope = await resolveAssignedProjectIdsForWorkspace({
        assignedProjectIds: invitationAccess.assignedProjectIds,
        workspaceId,
        workspaceOwnerEmail: AccessControl.normalizeEmail(invite.workspaceOwnerEmail || invite.ownerEmail)
    }).catch(() => ({ assignedProjectIds: invitationAccess.assignedProjectIds }));
    const access = getNormalizedClientInvitationAccess({
        ...invitationAccess,
        assignedProjectIds: resolvedScope.assignedProjectIds,
        allProjectsAccess: false,
        all_projects_access: false,
        projectAccessScope: 'selected',
        project_access_scope: 'selected'
    });
    const workspaceOwnerEmail = AccessControl.normalizeEmail(invite.workspaceOwnerEmail || invite.ownerEmail);
    const workspaceOwnerUserId = String(invite.workspaceOwnerUserId || invite.ownerUserId || '').trim();
    const baseAutoProfile = {
        ...existingProfile,
        email: safeEmail,
        name: String(existingProfile.name || authUser.displayName || authUser.email).trim(),
        workspaceId,
        workspaceOwnerEmail,
        workspaceOwnerUserId,
        ownerEmail: workspaceOwnerEmail,
        ownerUserId: workspaceOwnerUserId,
        isWorkspaceOwner: false,
        role: AccessControl.ROLES.CLIENT,
        workspaceRole: AccessControl.ROLES.CLIENT,
        permissionMode: String(invite.permissionMode || invite.permission_mode || '').trim().toLowerCase() === 'explicit'
            ? 'explicit'
            : 'default',
        permissionKeys: Array.isArray(invite.permissionKeys)
            ? invite.permissionKeys
            : (Array.isArray(invite.permission_keys) ? invite.permission_keys : []),
        assignedProjectIds: access.assignedProjectIds,
        allProjectsAccess: access.allProjectsAccess,
        projectAccessScope: access.projectAccessScope,
        membershipStatus: 'active',
        inviteType: 'client',
        inviteAcceptedAt: now,
        joinedAt: existingProfile.joinedAt || now
    };
    const permissionFields = buildPermissionFields(baseAutoProfile, authUser);
    const autoProfile = {
        ...baseAutoProfile,
        ...permissionFields,
        updatedAt: now
    };

    const clientProfileId = sanitizeDocumentId(`${workspaceId}_${safeEmail}`);
    await upsertCollectionDocument('client_profiles', clientProfileId, {
        workspaceId,
        userId: String(authUser.uid || '').trim(),
        email: safeEmail,
        assignedProjectIds: access.assignedProjectIds,
        allProjectsAccess: access.allProjectsAccess,
        projectAccessScope: access.projectAccessScope,
        status: 'active',
        updatedAt: now
    }).catch(() => undefined);

    await syncProjectAssignmentsForUser({
        workspaceId,
        userId: String(authUser.uid || '').trim(),
        email: safeEmail,
        access
    }).catch(() => undefined);

    if (invite.targetRecordCollection && invite.targetRecordId) {
        await patchCollectionDocument(invite.targetRecordCollection, invite.targetRecordId, {
            invite_status: 'accepted',
            canonical_role: AccessControl.ROLES.CLIENT,
            role: AccessControl.getRoleDisplayLabel(AccessControl.ROLES.CLIENT),
            assigned_project_ids: access.assignedProjectIds,
            all_projects_access: access.allProjectsAccess,
            project_access_scope: access.projectAccessScope,
            project_id: access.primaryProjectId,
            primary_project_id: access.primaryProjectId,
            invited_user_id: String(authUser.uid || '').trim(),
            invite_accepted_at: now,
            updated_at: now
        }).catch(() => undefined);
    }

    await patchCollectionDocument('invitations', invitation.id, {
        status: 'accepted',
        usedAt: now,
        acceptedByUserId: String(authUser.uid || '').trim(),
        acceptedByEmail: safeEmail,
        updatedAt: now
    }).catch(() => undefined);

    console.info('[WorkspaceAssignment] Auto-bootstrap completed', {
        invitationId: invitation.id,
        workspaceId,
        email: safeEmail,
        assignedProjectIds: access.assignedProjectIds
    });

    return autoProfile;
}

function buildPermissionFields(profile = {}, authUser = {}) {
    const role = AccessControl.normalizeRole(profile.role || profile.workspaceRole || profile.dashboardRole || 'admin');
    const enrichedProfile = {
        ...profile,
        email: AccessControl.normalizeEmail(profile.email || authUser.email),
        uid: authUser.uid || profile.uid || profile.userId || '',
        role,
        permissionMode: String(profile.permissionMode || profile.permission_mode || '').trim().toLowerCase() || '',
        permissionKeys: Array.isArray(profile.permissionKeys)
            ? profile.permissionKeys
            : (Array.isArray(profile.permission_keys) ? profile.permission_keys : [])
    };
    const accessProfile = AccessControl.getAccessProfile(enrichedProfile);
    return {
        role: accessProfile.role,
        workspaceRole: accessProfile.role,
        permissionKeys: accessProfile.permissionKeys,
        permissions: accessProfile.permissionMatrix,
        permissionMode: enrichedProfile.permissionMode === 'explicit' ? 'explicit' : 'default',
        isWorkspaceOwner: accessProfile.isWorkspaceOwner
    };
}

function buildWorkspaceMemberDocument(profile = {}, authUser = {}) {
    const assignedProjectIds = getNormalizedAssignedProjectIds(profile);
    const permissionFields = buildPermissionFields(profile, authUser);
    return {
        workspaceId: getWorkspaceId(profile, authUser),
        userId: authUser.uid || profile.uid || profile.userId || '',
        email: AccessControl.normalizeEmail(profile.email || authUser.email),
        name: String(profile.name || authUser.displayName || authUser.email || '').trim(),
        role: permissionFields.role,
        workspaceRole: permissionFields.workspaceRole,
        isWorkspaceOwner: permissionFields.isWorkspaceOwner,
        permissionKeys: permissionFields.permissionKeys,
        permissions: permissionFields.permissions,
        permissionMode: permissionFields.permissionMode,
        assignedProjectIds,
        allProjectsAccess: hasAllProjectsAccess(profile),
        projectAccessScope: hasAllProjectsAccess(profile) ? 'all' : 'selected',
        status: String(profile.membershipStatus || profile.status || 'active').trim().toLowerCase(),
        inviteType: String(profile.inviteType || profile.memberType || '').trim().toLowerCase(),
        joinedAt: profile.joinedAt || profile.inviteAcceptedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
}

async function loadUserProfileDocument(authUser) {
    let profileDocument = await getCollectionDocument('users', authUser.uid);

    if (!profileDocument && authUser.email) {
        const emailDocument = await findUserDocumentByEmail(authUser.email);
        if (emailDocument) {
            profileDocument = emailDocument;
        }
    }

    if (!profileDocument) {
        const created = await upsertCollectionDocument('users', authUser.uid, {
            email: AccessControl.normalizeEmail(authUser.email),
            name: authUser.email,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        });
        profileDocument = {
            id: created.id,
            name: '',
            data: created
        };
    }

    return profileDocument;
}

async function ensureWorkspaceDocument(profile = {}, authUser = {}) {
    const workspaceId = getWorkspaceId(profile, authUser);
    const ownerEmail = getWorkspaceOwnerEmail(profile, authUser);
    const ownerUserId = getWorkspaceOwnerUserId(profile, authUser);
    const now = new Date().toISOString();

    const workspaceDoc = await getCollectionDocument('workspaces', workspaceId);
    const fields = {
        workspaceId,
        name: buildWorkspaceName(profile, authUser),
        ownerUserId,
        ownerEmail,
        accountType: String(profile.accountType || 'individual').trim().toLowerCase(),
        businessName: String(profile.businessName || '').trim(),
        businessEmail: AccessControl.normalizeEmail(profile.businessEmail || ownerEmail),
        subscriptionPlanCode: String(profile.planCode || 'individual').trim().toLowerCase(),
        status: String(profile.workspaceStatus || 'active').trim().toLowerCase(),
        updatedAt: now
    };

    if (!workspaceDoc) {
        await upsertCollectionDocument('workspaces', workspaceId, {
            ...fields,
            createdAt: now
        });
        return {
            id: workspaceId,
            data: {
                ...fields,
                createdAt: now
            }
        };
    }

    await upsertCollectionDocument('workspaces', workspaceId, {
        ...workspaceDoc.data,
        ...fields,
        createdAt: workspaceDoc.data.createdAt || now
    });

    return {
        id: workspaceId,
        data: {
            ...workspaceDoc.data,
            ...fields,
            createdAt: workspaceDoc.data.createdAt || now
        }
    };
}

async function ensureWorkspaceMember(profile = {}, authUser = {}) {
    const workspaceId = getWorkspaceId(profile, authUser);
    const email = AccessControl.normalizeEmail(profile.email || authUser.email);
    const userId = authUser.uid || profile.uid || profile.userId || '';
    const memberDocId = getWorkspaceMemberDocumentId(workspaceId, userId, email);
    const memberDoc = buildWorkspaceMemberDocument(profile, authUser);
    const existing = await getCollectionDocument('workspace_members', memberDocId);
    await upsertCollectionDocument('workspace_members', memberDocId, {
        ...(existing && existing.data ? existing.data : {}),
        ...memberDoc,
        createdAt: existing && existing.data && existing.data.createdAt
            ? existing.data.createdAt
            : (profile.joinedAt || profile.inviteAcceptedAt || new Date().toISOString())
    });
}

async function ensureWorkspaceAccessProfile(authUser) {
    const profileDocument = await loadUserProfileDocument(authUser);
    let existingProfile = profileDocument && profileDocument.data ? profileDocument.data : {};
    const autoBootstrappedClientProfile = await autoBootstrapClientAccessFromInvitation({
        existingProfile,
        authUser
    }).catch(() => null);
    if (autoBootstrappedClientProfile) {
        existingProfile = autoBootstrappedClientProfile;
    }
    const pendingInviteBootstrap = hasPendingInviteState(existingProfile);
    const ownerEmail = getWorkspaceOwnerEmail(existingProfile, authUser);
    const ownerUserId = getWorkspaceOwnerUserId(existingProfile, authUser);
    const bootstrapRequired = !existingProfile.workspaceId && !pendingInviteBootstrap;
    const inferredOwner = existingProfile.isWorkspaceOwner === true
        || (bootstrapRequired && ownerEmail === AccessControl.normalizeEmail(authUser.email));

    const baseProfile = {
        ...existingProfile,
        email: AccessControl.normalizeEmail(existingProfile.email || authUser.email),
        name: String(existingProfile.name || authUser.email).trim(),
        workspaceId: pendingInviteBootstrap ? '' : getWorkspaceId(existingProfile, authUser),
        workspaceOwnerEmail: pendingInviteBootstrap ? '' : ownerEmail,
        workspaceOwnerUserId: pendingInviteBootstrap ? '' : ownerUserId,
        isWorkspaceOwner: pendingInviteBootstrap ? false : inferredOwner,
        assignedProjectIds: getNormalizedAssignedProjectIds(existingProfile),
        allProjectsAccess: hasAllProjectsAccess(existingProfile),
        projectAccessScope: hasAllProjectsAccess(existingProfile) ? 'all' : 'selected',
        membershipStatus: String(existingProfile.membershipStatus || 'active').trim().toLowerCase()
    };

    if (bootstrapRequired) {
        baseProfile.role = AccessControl.normalizeRole(existingProfile.role || 'admin');
        baseProfile.workspaceRole = baseProfile.role;
        baseProfile.isWorkspaceOwner = true;
        baseProfile.workspaceOwnerEmail = AccessControl.normalizeEmail(authUser.email);
        baseProfile.workspaceOwnerUserId = authUser.uid;
        baseProfile.ownerEmail = baseProfile.workspaceOwnerEmail;
        baseProfile.ownerUserId = baseProfile.workspaceOwnerUserId;
        baseProfile.joinedAt = baseProfile.joinedAt || new Date().toISOString();
    }

    const permissionFields = buildPermissionFields(baseProfile, authUser);
    const nextProfile = {
        ...baseProfile,
        ...permissionFields,
        updatedAt: new Date().toISOString()
    };

    if (nextProfile.workspaceId) {
        await ensureWorkspaceDocument(nextProfile, authUser);
        await ensureWorkspaceMember(nextProfile, authUser);
    }

    await patchCollectionDocument('users', profileDocument.id || authUser.uid, {
        workspaceId: nextProfile.workspaceId,
        workspaceOwnerEmail: nextProfile.workspaceOwnerEmail,
        workspaceOwnerUserId: nextProfile.workspaceOwnerUserId,
        ownerEmail: nextProfile.workspaceOwnerEmail,
        ownerUserId: nextProfile.workspaceOwnerUserId,
        isWorkspaceOwner: nextProfile.isWorkspaceOwner,
        role: nextProfile.role,
        workspaceRole: nextProfile.workspaceRole,
        permissionKeys: nextProfile.permissionKeys,
        permissions: nextProfile.permissions,
        permissionMode: nextProfile.permissionMode,
        assignedProjectIds: nextProfile.assignedProjectIds,
        allProjectsAccess: nextProfile.allProjectsAccess,
        projectAccessScope: nextProfile.projectAccessScope,
        membershipStatus: nextProfile.membershipStatus,
        updatedAt: nextProfile.updatedAt
    });

    return {
        id: profileDocument.id || authUser.uid,
        ...nextProfile
    };
}

function buildSessionUser(profile = {}, authUser = {}) {
    const accessProfile = AccessControl.getAccessProfile({
        ...profile,
        email: AccessControl.normalizeEmail(profile.email || authUser.email),
        uid: authUser.uid || profile.uid || profile.userId || '',
        role: profile.role || profile.workspaceRole || profile.dashboardRole || 'admin'
    });

    return {
        uid: authUser.uid || profile.uid || profile.userId || '',
        email: AccessControl.normalizeEmail(profile.email || authUser.email),
        name: String(profile.name || authUser.email || '').trim(),
        role: accessProfile.role,
        userKind: accessProfile.userKind,
        workspaceRole: accessProfile.role,
        workspaceId: String(profile.workspaceId || '').trim(),
        workspaceOwnerEmail: getWorkspaceOwnerEmail(profile, authUser),
        workspaceOwnerUserId: getWorkspaceOwnerUserId(profile, authUser),
        isWorkspaceOwner: accessProfile.isWorkspaceOwner,
        permissionKeys: accessProfile.permissionKeys,
        permissions: accessProfile.permissionMatrix,
        permissionMode: String(profile.permissionMode || profile.permission_mode || '').trim().toLowerCase() === 'explicit' ? 'explicit' : 'default',
        assignedProjectIds: getNormalizedAssignedProjectIds(profile),
        allProjectsAccess: hasAllProjectsAccess(profile),
        projectAccessScope: hasAllProjectsAccess(profile) ? 'all' : 'selected',
        membershipStatus: String(profile.membershipStatus || 'active').trim().toLowerCase(),
        accountType: String(profile.accountType || 'individual').trim().toLowerCase(),
        currentPlan: String(profile.currentPlan || '').trim(),
        planCode: String(profile.planCode || 'individual').trim().toLowerCase(),
        planPaid: Boolean(profile.planPaid),
        businessName: String(profile.businessName || '').trim()
    };
}

module.exports = {
    buildPermissionFields,
    buildSessionUser,
    ensureWorkspaceAccessProfile,
    getNormalizedAssignedProjectIds,
    hasPendingInviteState,
    getWorkspaceId,
    getWorkspaceMemberDocumentId,
    getWorkspaceOwnerEmail,
    getWorkspaceOwnerUserId,
    loadUserProfileDocument
};
