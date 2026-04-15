const AccessControl = require('../../rbac.js');
const {
    getCollectionDocument,
    patchCollectionDocument,
    queryCollectionDocuments,
    queryCollectionDocumentsMulti,
    sanitizeDocumentId,
    upsertCollectionDocument
} = require('./firebase-service');

const MEMBERSHIPS_COLLECTION = 'workspace_memberships';

function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
}

function buildMembershipDocId(userId, workspaceId) {
    const safeUser = String(userId || '').trim();
    const safeWs = String(workspaceId || '').trim();
    if (!safeUser || !safeWs) return '';
    return sanitizeDocumentId(`${safeUser}_${safeWs}`);
}

function toMembershipShape(record = {}) {
    return {
        userId: String(record.userId || '').trim(),
        email: normalizeEmail(record.email),
        workspaceId: String(record.workspaceId || '').trim(),
        workspaceName: String(record.workspaceName || '').trim(),
        workspaceOwnerEmail: normalizeEmail(record.workspaceOwnerEmail),
        workspaceOwnerUserId: String(record.workspaceOwnerUserId || '').trim(),
        role: AccessControl.normalizeRole(record.role),
        assignedProjectIds: AccessControl.sanitizeAssignedProjectIds(record.assignedProjectIds),
        allProjectsAccess: record.allProjectsAccess === true,
        isWorkspaceOwner: record.isWorkspaceOwner === true,
        membershipStatus: String(record.membershipStatus || 'active').trim().toLowerCase(),
        joinedAt: record.joinedAt || null,
        updatedAt: record.updatedAt || null
    };
}

async function listMembershipsForUser({ userId, email } = {}) {
    const safeUser = String(userId || '').trim();
    const safeEmail = normalizeEmail(email);
    if (!safeUser && !safeEmail) return [];

    const results = [];
    const seen = new Set();
    const collect = records => {
        for (const entry of (Array.isArray(records) ? records : [])) {
            const data = entry && entry.data ? entry.data : entry;
            const membershipUserId = String(data.userId || '').trim();
            const membershipEmail = normalizeEmail(data.email);
            const id = entry && entry.id
                ? entry.id
                : buildMembershipDocId(membershipUserId, data.workspaceId);
            if (!id || seen.has(id)) continue;
            seen.add(id);
            if (String(data.membershipStatus || 'active').trim().toLowerCase() !== 'active') continue;
            results.push(toMembershipShape(data));
        }
    };

    if (safeUser) {
        const byUser = await queryCollectionDocuments(MEMBERSHIPS_COLLECTION, {
            fieldPath: 'userId',
            op: 'EQUAL',
            value: safeUser,
            limit: 50
        }).catch(() => []);
        collect(byUser);
    }
    if (safeEmail) {
        const byEmail = await queryCollectionDocuments(MEMBERSHIPS_COLLECTION, {
            fieldPath: 'email',
            op: 'EQUAL',
            value: safeEmail,
            limit: 50
        }).catch(() => []);
        collect(byEmail);
    }
    return results;
}

async function upsertMembership({
    userId,
    email,
    workspaceId,
    workspaceName,
    workspaceOwnerEmail,
    workspaceOwnerUserId,
    role,
    assignedProjectIds,
    allProjectsAccess,
    isWorkspaceOwner
}) {
    const safeUser = String(userId || '').trim();
    const safeWs = String(workspaceId || '').trim();
    if (!safeUser || !safeWs) return null;

    const docId = buildMembershipDocId(safeUser, safeWs);
    const now = new Date().toISOString();
    const existing = await getCollectionDocument(MEMBERSHIPS_COLLECTION, docId).catch(() => null);

    const payload = {
        userId: safeUser,
        email: normalizeEmail(email),
        workspaceId: safeWs,
        workspaceName: String(workspaceName || '').trim(),
        workspaceOwnerEmail: normalizeEmail(workspaceOwnerEmail),
        workspaceOwnerUserId: String(workspaceOwnerUserId || '').trim(),
        role: AccessControl.normalizeRole(role),
        assignedProjectIds: AccessControl.sanitizeAssignedProjectIds(assignedProjectIds),
        allProjectsAccess: allProjectsAccess === true,
        isWorkspaceOwner: isWorkspaceOwner === true,
        membershipStatus: 'active',
        joinedAt: (existing && existing.data && existing.data.joinedAt) || now,
        updatedAt: now
    };
    await upsertCollectionDocument(MEMBERSHIPS_COLLECTION, docId, payload);
    return { id: docId, ...payload };
}

/**
 * Ensure a membership document exists for a user's currently-attached workspace.
 * Backfills the new multi-membership model from the legacy single-workspace fields
 * on users/{uid} without changing the user doc.
 */
async function ensureMembershipForProfile(profile = {}, authUser = {}) {
    const workspaceId = String(profile.workspaceId || '').trim();
    const userId = String(authUser.uid || profile.uid || '').trim();
    if (!workspaceId || !userId) return null;

    const docId = buildMembershipDocId(userId, workspaceId);
    const existing = await getCollectionDocument(MEMBERSHIPS_COLLECTION, docId).catch(() => null);
    if (existing && existing.data) return toMembershipShape(existing.data);

    return upsertMembership({
        userId,
        email: profile.email || authUser.email,
        workspaceId,
        workspaceName: profile.workspaceName || profile.businessName || '',
        workspaceOwnerEmail: profile.workspaceOwnerEmail,
        workspaceOwnerUserId: profile.workspaceOwnerUserId,
        role: profile.role || profile.workspaceRole,
        assignedProjectIds: profile.assignedProjectIds,
        allProjectsAccess: profile.allProjectsAccess,
        isWorkspaceOwner: profile.isWorkspaceOwner
    });
}

async function setActiveWorkspaceForUser(userId, workspaceId) {
    const safeUser = String(userId || '').trim();
    const safeWs = String(workspaceId || '').trim();
    if (!safeUser || !safeWs) return null;

    const docId = buildMembershipDocId(safeUser, safeWs);
    const existing = await getCollectionDocument(MEMBERSHIPS_COLLECTION, docId).catch(() => null);
    if (!existing || !existing.data) {
        const error = new Error('You are not a member of that workspace.');
        error.statusCode = 403;
        throw error;
    }
    const membership = toMembershipShape(existing.data);

    // Mirror the active selection into the users doc so the existing
    // session builder continues to work unchanged.
    await patchCollectionDocument('users', safeUser, {
        activeWorkspaceId: safeWs,
        workspaceId: safeWs,
        workspaceOwnerEmail: membership.workspaceOwnerEmail,
        workspaceOwnerUserId: membership.workspaceOwnerUserId,
        ownerEmail: membership.workspaceOwnerEmail,
        ownerUserId: membership.workspaceOwnerUserId,
        isWorkspaceOwner: membership.isWorkspaceOwner,
        role: membership.role,
        workspaceRole: membership.role,
        assignedProjectIds: membership.assignedProjectIds,
        allProjectsAccess: membership.allProjectsAccess,
        membershipStatus: 'active',
        updatedAt: new Date().toISOString()
    }).catch(() => undefined);

    return membership;
}

module.exports = {
    MEMBERSHIPS_COLLECTION,
    buildMembershipDocId,
    ensureMembershipForProfile,
    listMembershipsForUser,
    setActiveWorkspaceForUser,
    toMembershipShape,
    upsertMembership
};
