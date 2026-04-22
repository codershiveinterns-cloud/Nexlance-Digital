/**
 * Deletes a removed team_member's / client's Firebase Auth account when the
 * admin removes them from the workspace.
 *
 * Safety rules — DO NOT delete the Firebase Auth user when any of these are
 * true, because doing so would lock them out of other workspaces / accounts
 * they still legitimately belong to:
 *   - The removed record has no Firebase UID (invite never accepted, no account
 *     was ever created).
 *   - The target UID matches the current admin's UID (admin is acting on
 *     themselves somehow — should not happen, but guard against it).
 *   - The target user is a workspace owner (owners must delete themselves via
 *     the self-serve delete-account path, not through admin member removal).
 *   - The target user has any OTHER active workspace memberships besides the
 *     one they are being removed from.
 *   - Firestore / Admin SDK fails — fail closed so we never leave Firestore
 *     inconsistent with Firebase Auth.
 *
 * Also records the email in the `deleted_accounts` collection so the same
 * email cannot re-register and get another free trial, matching the
 * self-serve delete-account behavior.
 */
const admin = require('./firebase-admin-init');
const { listMembershipsForUser } = require('./memberships');

const MEMBER_COLLECTIONS = new Set(['team_members', 'clients']);

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function getDeletedAccountKey(email) {
    return normalizeEmail(email).replace(/[.#$/\[\]]/g, '_');
}

function extractTargetIdentity(record = {}) {
    const data = record && record.data ? record.data : record || {};
    const uid = String(
        data.invited_user_id
        || data.invitedUserId
        || data.userId
        || data.user_id
        || ''
    ).trim();
    const email = normalizeEmail(
        data.email
        || data.invited_email
        || data.invitedEmail
    );
    const isOwner = data.isWorkspaceOwner === true || data.is_workspace_owner === true;
    return { uid, email, isOwner };
}

async function deleteFirebaseAccountForRemovedMember({
    collectionId,
    deletedRecord,
    currentUserId,
    workspaceId
}) {
    if (!MEMBER_COLLECTIONS.has(collectionId)) {
        return { skipped: true, reason: 'not-a-member-collection' };
    }

    const { uid, email, isOwner } = extractTargetIdentity(deletedRecord);

    if (!uid) return { skipped: true, reason: 'no-firebase-uid' };
    if (currentUserId && uid === String(currentUserId).trim()) {
        return { skipped: true, reason: 'would-delete-self' };
    }
    if (isOwner) return { skipped: true, reason: 'target-is-workspace-owner' };

    const currentWorkspaceId = String(workspaceId || '').trim();

    let otherActiveMemberships = 0;
    try {
        const memberships = await listMembershipsForUser({ userId: uid, email });
        for (const m of memberships) {
            if (!m || !m.workspaceId) continue;
            if (currentWorkspaceId && m.workspaceId === currentWorkspaceId) continue;
            if (m.isWorkspaceOwner) {
                // User owns another workspace — keep their Auth record intact.
                return { skipped: true, reason: 'owns-another-workspace' };
            }
            otherActiveMemberships += 1;
        }
    } catch (error) {
        console.warn('[MemberAccountDelete] membership lookup failed — skipping auth delete to be safe', {
            uid,
            error: error && error.message
        });
        return { skipped: true, reason: 'membership-check-failed' };
    }

    if (otherActiveMemberships > 0) {
        return {
            skipped: true,
            reason: 'other-active-memberships',
            otherActiveMemberships
        };
    }

    const db = admin.firestore();

    if (email) {
        try {
            await db.collection('deleted_accounts').doc(getDeletedAccountKey(email)).set({
                email,
                uid,
                deletedAt: new Date().toISOString(),
                deletedBy: currentUserId || null,
                reason: `admin_removed_${collectionId}`,
                trialUsed: true
            });
        } catch (error) {
            console.warn('[MemberAccountDelete] could not record deleted_accounts entry', {
                uid,
                error: error && error.message
            });
        }
    }

    try {
        await db.collection('users').doc(uid).delete();
    } catch (error) {
        console.warn('[MemberAccountDelete] could not delete users/{uid} doc', {
            uid,
            error: error && error.message
        });
    }

    try {
        await admin.auth().deleteUser(uid);
    } catch (error) {
        const code = error && error.code;
        if (code === 'auth/user-not-found') {
            return { deleted: true, alreadyGone: true, uid, email };
        }
        console.error('[MemberAccountDelete] admin.auth().deleteUser failed', {
            uid,
            code,
            error: error && error.message
        });
        return { skipped: true, reason: 'auth-delete-failed', code };
    }

    console.info('[MemberAccountDelete] Firebase Auth account deleted', {
        collectionId,
        uid,
        email,
        workspaceId: currentWorkspaceId
    });
    return { deleted: true, uid, email };
}

module.exports = {
    deleteFirebaseAccountForRemovedMember
};
