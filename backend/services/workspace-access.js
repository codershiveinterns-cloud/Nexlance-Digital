const AccessControl = require('../../rbac.js');
const {
    findUserDocumentByEmail,
    getCollectionDocument,
    patchCollectionDocument,
    sanitizeDocumentId,
    upsertCollectionDocument
} = require('./firebase-service');

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

function buildPermissionFields(profile = {}, authUser = {}) {
    const role = AccessControl.normalizeRole(profile.role || profile.workspaceRole || profile.dashboardRole || 'admin');
    const enrichedProfile = {
        ...profile,
        email: AccessControl.normalizeEmail(profile.email || authUser.email),
        uid: authUser.uid || profile.uid || profile.userId || '',
        role
    };
    const accessProfile = AccessControl.getAccessProfile(enrichedProfile);
    return {
        role: accessProfile.role,
        workspaceRole: accessProfile.role,
        permissionKeys: accessProfile.permissionKeys,
        permissions: accessProfile.permissionMatrix,
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
    const existingProfile = profileDocument && profileDocument.data ? profileDocument.data : {};
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
        workspaceRole: accessProfile.role,
        workspaceId: String(profile.workspaceId || '').trim(),
        workspaceOwnerEmail: getWorkspaceOwnerEmail(profile, authUser),
        workspaceOwnerUserId: getWorkspaceOwnerUserId(profile, authUser),
        isWorkspaceOwner: accessProfile.isWorkspaceOwner,
        permissionKeys: accessProfile.permissionKeys,
        permissions: accessProfile.permissionMatrix,
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
