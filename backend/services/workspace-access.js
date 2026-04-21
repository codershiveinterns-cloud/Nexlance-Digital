const AccessControl = require('../../rbac.js');
const {
    commitBatchedWrites,
    findUserDocumentByEmail,
    getCollectionDocument,
    patchCollectionDocument,
    queryCollectionDocuments,
    queryCollectionDocumentsMulti,
    sanitizeDocumentId,
    upsertCollectionDocument
} = require('./firebase-service');
const { resolveAssignedProjectIdsForWorkspace } = require('./project-assignment-resolution');

// ─── In-memory session cache (5-min TTL) with deduplication ───
// Prevents repeated Firestore reads on every /api/me call for the same user.
// Also deduplicates concurrent in-flight requests for the same uid.
const SESSION_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const SESSION_CACHE_MAX_SIZE = 500;
const SESSION_CACHE_CLEANUP_INTERVAL_MS = 60 * 1000; // sweep expired entries every 60s
const _sessionCache = new Map();
const _inflight = new Map(); // uid -> Promise — deduplicates concurrent requests

// Periodic cleanup: evict expired entries so they don't leak memory
let _cleanupTimer = null;
function _startCacheCleanup() {
    if (_cleanupTimer) return;
    _cleanupTimer = setInterval(() => {
        const now = Date.now();
        for (const [key, entry] of _sessionCache) {
            if (now - entry.timestamp > SESSION_CACHE_TTL_MS) {
                _sessionCache.delete(key);
            }
        }
        // If cache is empty, stop the timer to avoid keeping the process alive
        if (_sessionCache.size === 0) {
            clearInterval(_cleanupTimer);
            _cleanupTimer = null;
        }
    }, SESSION_CACHE_CLEANUP_INTERVAL_MS);
    // Allow the Node process to exit even if the timer is running (serverless)
    if (_cleanupTimer && typeof _cleanupTimer.unref === 'function') {
        _cleanupTimer.unref();
    }
}

function _getSessionCacheKey(authUser) {
    return String(authUser && authUser.uid || '').trim();
}

function _getSessionCache(authUser) {
    const key = _getSessionCacheKey(authUser);
    if (!key) return null;
    const entry = _sessionCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > SESSION_CACHE_TTL_MS) {
        _sessionCache.delete(key);
        return null;
    }
    return entry.profile;
}

function _setSessionCache(authUser, profile) {
    const key = _getSessionCacheKey(authUser);
    if (!key || !profile) return;
    // LRU eviction: delete oldest entries when at capacity
    if (_sessionCache.size >= SESSION_CACHE_MAX_SIZE) {
        const firstKey = _sessionCache.keys().next().value;
        _sessionCache.delete(firstKey);
    }
    // Stamp the profile with a cache version so consumers can detect staleness
    profile._cacheVersion = Date.now();
    _sessionCache.set(key, { profile, timestamp: Date.now() });
    _startCacheCleanup();
}

function invalidateSessionCache(uid) {
    const key = String(uid || '').trim();
    if (key) {
        _sessionCache.delete(key);
        _inflight.delete(key);
    }
}

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

// Broader invitation-shape detection.  Any of these signals indicates the
// account is an invitee (client or team member) rather than a standalone
// owner signup — auto-generating workspace_<uid> for such accounts permanently
// fragments them away from the admin's workspace.
function hasInvitationMetadata(profile = {}) {
    if (profile.isWorkspaceOwner === true) return false;
    const inviteType = String(profile.inviteType || profile.memberType || profile.invite_type || '').trim().toLowerCase();
    if (inviteType) return true;
    const membershipStatus = String(profile.membershipStatus || profile.status || '').trim().toLowerCase();
    if (membershipStatus === 'pending') return true;
    const inviteIdentifier = profile.invitationId
        || profile.invitation_id
        || profile.invitedBy
        || profile.invited_by
        || profile.invitedByEmail
        || profile.invited_by_email
        || profile.invited_user_id
        || profile.invitedUserId
        || profile.inviteAcceptedAt
        || profile.invite_accepted_at
        || profile.inviteStatus
        || profile.invite_status;
    return Boolean(inviteIdentifier);
}

function getWorkspaceId(profile = {}, authUser = {}) {
    const explicitId = String(profile.workspaceId || '').trim();
    if (explicitId) return explicitId;
    if (hasPendingInviteState(profile)) return '';
    if (hasInvitationMetadata(profile)) return '';
    return sanitizeDocumentId(`workspace_${authUser.uid || profile.uid || Date.now()}`);
}

function getWorkspaceOwnerEmail(profile = {}, authUser = {}) {
    const explicitOwnerEmail = AccessControl.normalizeEmail(profile.workspaceOwnerEmail || profile.ownerEmail);
    if (explicitOwnerEmail) return explicitOwnerEmail;
    // Owner-of-own-workspace: only when profile is unambiguously the workspace owner.
    if (profile.isWorkspaceOwner === true) {
        return AccessControl.normalizeEmail(authUser.email);
    }
    return '';
}

function getWorkspaceOwnerUserId(profile = {}, authUser = {}) {
    const explicitOwnerUserId = String(profile.workspaceOwnerUserId || profile.ownerUserId || '').trim();
    if (explicitOwnerUserId) return explicitOwnerUserId;
    if (profile.isWorkspaceOwner === true) {
        return String(authUser.uid || '').trim();
    }
    return '';
}

function getWorkspaceMemberDocumentId(workspaceId, userId, email) {
    return sanitizeDocumentId(`${workspaceId}_${userId || AccessControl.normalizeEmail(email)}`);
}

function getNormalizedAssignedProjectIds(profile = {}) {
    return AccessControl.sanitizeAssignedProjectIds(
        profile.assignedProjectIds !== undefined
            ? profile.assignedProjectIds
            : profile.assigned_project_ids
    );
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

function normalizeProjectAssignmentRecord(record = {}) {
    const data = record && record.data ? record.data : record;
    return {
        id: String(record && record.id ? record.id : '').trim(),
        workspaceId: String(data && (data.workspaceId || data.workspace_id) || '').trim(),
        userId: String(data && (data.userId || data.user_id) || '').trim(),
        projectId: String(data && (data.projectId || data.project_id) || '').trim(),
        email: AccessControl.normalizeEmail(data && (data.email || data.user_email)),
        role: AccessControl.normalizeRole(data && data.role),
        status: String(data && data.status || '').trim().toLowerCase(),
        active: data && Object.prototype.hasOwnProperty.call(data, 'active')
            ? data.active === true
            : true,
        data: data || {}
    };
}

function isProjectAssignmentActive(assignment = {}) {
    const status = String(assignment.status || '').trim().toLowerCase();
    if (assignment.active === false) return false;
    if (!status) return true;
    return !['inactive', 'revoked', 'cancelled', 'deleted'].includes(status);
}

async function deactivateAllActiveAssignmentsForUser({ workspaceId = '', userId = '', email = '' } = {}) {
    const normalizedWorkspaceId = String(workspaceId || '').trim();
    const normalizedUserId = String(userId || '').trim();
    const normalizedEmail = AccessControl.normalizeEmail(email);
    if (!normalizedWorkspaceId || (!normalizedUserId && !normalizedEmail)) {
        return;
    }
    const assignments = await listProjectAssignmentsForUser({
        workspaceId: normalizedWorkspaceId,
        userId: normalizedUserId,
        email: normalizedEmail
    });
    for (const assignment of assignments) {
        const assignmentWorkspaceId = String(assignment.workspaceId || '').trim();
        if (assignmentWorkspaceId !== normalizedWorkspaceId) continue;
        if (!isProjectAssignmentActive(assignment)) continue;
        await markProjectAssignmentInactive(
            assignment,
            'replaced_by_new_assignment',
            normalizedWorkspaceId,
            assignmentWorkspaceId
        );
    }
    console.info('[ProjectAssignmentScope] Deactivated all old assignments', {
        workspaceId: normalizedWorkspaceId,
        userId: normalizedUserId,
        email: normalizedEmail
    });
}

async function listProjectAssignmentsForUser({ workspaceId = '', userId = '', email = '', includeInactive = false } = {}) {
    const normalizedWorkspaceId = String(workspaceId || '').trim();
    const normalizedUserId = String(userId || '').trim();
    const normalizedEmail = AccessControl.normalizeEmail(email);
    if (!normalizedWorkspaceId || (!normalizedUserId && !normalizedEmail)) {
        return includeInactive ? { active: [], inactive: [] } : [];
    }
    const results = [];
    const inactiveResults = [];
    const seenIds = new Set();

    const pushRecords = (records = []) => {
        (Array.isArray(records) ? records : []).forEach(record => {
            const entry = normalizeProjectAssignmentRecord(record);
            if (!entry.id || seenIds.has(entry.id)) return;
            if (!entry.workspaceId || entry.workspaceId !== normalizedWorkspaceId) return;
            // Accept the record if it matches by either userId or email.
            // This prevents misses when a record was created with email only
            // and later backfilled with userId (or vice-versa).
            const matchesByEmail = normalizedEmail && entry.email === normalizedEmail;
            const matchesByUserId = normalizedUserId && entry.userId === normalizedUserId;
            if (!matchesByEmail && !matchesByUserId) return;
            seenIds.add(entry.id);
            if (isProjectAssignmentActive(entry)) {
                results.push(entry);
            } else if (includeInactive) {
                inactiveResults.push(entry);
            }
        });
    };

    // ─── Query by userId first (preferred identity), then email as fallback ───
    // When both are available, run all queries in parallel so records created
    // under either identity are found and merged.
    const queries = [];

    if (normalizedUserId) {
        queries.push(
            queryCollectionDocuments('project_assignments', {
                fieldPath: 'userId',
                op: 'EQUAL',
                value: normalizedUserId,
                limit: 500
            }).catch(() => []),
            queryCollectionDocuments('project_assignments', {
                fieldPath: 'user_id',
                op: 'EQUAL',
                value: normalizedUserId,
                limit: 500
            }).catch(() => [])
        );
    }

    if (normalizedEmail) {
        queries.push(
            queryCollectionDocuments('project_assignments', {
                fieldPath: 'email',
                op: 'EQUAL',
                value: normalizedEmail,
                limit: 500
            }).catch(() => []),
            queryCollectionDocuments('project_assignments', {
                fieldPath: 'user_email',
                op: 'EQUAL',
                value: normalizedEmail,
                limit: 500
            }).catch(() => [])
        );
    }

    const queryResults = await Promise.all(queries);
    for (const batch of queryResults) {
        pushRecords(batch);
    }

    console.info('[ProjectAssignmentScope] Fetched assignments', {
        workspaceId: normalizedWorkspaceId,
        userId: normalizedUserId,
        email: normalizedEmail,
        activeCount: results.length,
        inactiveCount: inactiveResults.length,
        ids: results.map(r => r.id)
    });

    if (includeInactive) {
        return { active: results, inactive: inactiveResults };
    }
    return results;
}

async function markProjectAssignmentInactive(assignment, reason, expectedWorkspaceId = '', actualWorkspaceId = '') {
    if (!assignment || !assignment.id) return;
    await patchCollectionDocument('project_assignments', assignment.id, {
        status: 'inactive',
        active: false,
        mismatchReason: String(reason || '').trim(),
        expectedWorkspaceId: String(expectedWorkspaceId || '').trim(),
        actualWorkspaceId: String(actualWorkspaceId || '').trim(),
        updatedAt: new Date().toISOString(),
        updated_at: new Date().toISOString()
    }).catch(() => undefined);
}

async function resolveScopedAssignedProjectsForLogin({ workspaceId = '', userId = '', email = '', role = '' } = {}) {
    const normalizedWorkspaceId = String(workspaceId || '').trim();
    const normalizedUserId = String(userId || '').trim();
    const normalizedEmail = AccessControl.normalizeEmail(email);
    const normalizedRole = AccessControl.normalizeRole(role);
    if (!normalizedWorkspaceId || (!normalizedUserId && !normalizedEmail)) {
        console.warn('[ProjectAssignmentScope] Invalid input - returning empty', { workspaceId, userId, email });
        return {
            assignedProjectIds: []
        };
    }

    console.info('[ProjectAssignmentScope] ========== START RESOLUTION ==========', {
        workspaceId: normalizedWorkspaceId,
        userId: normalizedUserId,
        email: normalizedEmail,
        role: normalizedRole,
        timestamp: new Date().toISOString()
    });

    const assignmentBuckets = await listProjectAssignmentsForUser({
        workspaceId: normalizedWorkspaceId,
        userId: normalizedUserId,
        email: normalizedEmail,
        includeInactive: true
    });
    const assignments = assignmentBuckets.active || [];
    const inactiveAssignments = assignmentBuckets.inactive || [];

    // ─── SAFETY GUARD: all-inactive detection ───
    // If we found zero active assignments but inactive records DO exist with
    // bug-signature deactivation reasons, auto-reactivate them.  This unsticks
    // users whose records were deactivated by the old acceptInvitation bug
    // without requiring admin intervention or a manual migration run.
    if (assignments.length === 0 && inactiveAssignments.length > 0) {
        const BUG_REASONS = new Set(['invitation_accept_resync', 'assignment_resync']);
        const recoverable = inactiveAssignments.filter(entry => {
            const data = entry && entry.data ? entry.data : {};
            const reason = String(data.deactivatedReason || data.mismatchReason || '').trim();
            return BUG_REASONS.has(reason);
        });
        if (recoverable.length > 0) {
            console.warn('[ProjectAssignmentScope] All-inactive state detected — auto-reactivating bug-deactivated records', {
                workspaceId: normalizedWorkspaceId,
                userId: normalizedUserId,
                email: normalizedEmail,
                totalInactive: inactiveAssignments.length,
                recoverableCount: recoverable.length
            });
            const now = new Date().toISOString();
            const reactivateOps = recoverable.map(entry => ({
                collectionId: 'project_assignments',
                docId: entry.id,
                data: {
                    status: 'active',
                    active: true,
                    deactivatedReason: '',
                    mismatchReason: '',
                    expectedWorkspaceId: '',
                    actualWorkspaceId: '',
                    recoveredAt: now,
                    recoveredReason: 'auto_reactivated_all_inactive_guard',
                    updatedAt: now,
                    updated_at: now
                }
            }));
            await commitBatchedWrites(reactivateOps).catch(err => {
                console.warn('[ProjectAssignmentScope] Auto-reactivation batch failed', { error: err.message });
            });
            // Promote the recovered records into the active list for the rest
            // of this resolution pass.
            for (const entry of recoverable) {
                assignments.push({
                    ...entry,
                    status: 'active',
                    active: true
                });
            }
        }
    }

    console.info('[ProjectAssignmentScope] ========== ACTIVE ASSIGNMENTS SNAPSHOT ==========', {
        userId: normalizedUserId,
        email: normalizedEmail,
        activeAssignments: assignments.length,
        inactiveAssignments: inactiveAssignments.length,
        assignments: assignments.map(a => ({ id: a.id, projectId: a.projectId, workspaceId: a.workspaceId, role: a.role, active: a.active, status: a.status }))
    });
    const validProjectIds = new Set();
    const activeAssignmentsByProjectId = new Map();
    // ─── Local project document cache: prevents duplicate reads for the same projectId ───
    const _projectDocCache = new Map();
    async function _getProjectDoc(projectId) {
        if (_projectDocCache.has(projectId)) return _projectDocCache.get(projectId);
        const doc = await getCollectionDocument('projects', projectId).catch(() => null);
        _projectDocCache.set(projectId, doc);
        return doc;
    }

    const getAssignmentTimestamp = assignment => {
        const timestamps = [
            assignment && assignment.data && assignment.data.updatedAt,
            assignment && assignment.data && assignment.data.updated_at,
            assignment && assignment.data && assignment.data.createdAt,
            assignment && assignment.data && assignment.data.created_at
        ];
        const parsed = timestamps
            .map(value => new Date(value || '').getTime())
            .filter(value => Number.isFinite(value) && value > 0);
        return parsed.length ? Math.max(...parsed) : 0;
    };

    for (const assignment of assignments) {
        const assignmentWorkspaceId = String(assignment.workspaceId || '').trim();
        if (!assignmentWorkspaceId || assignmentWorkspaceId !== normalizedWorkspaceId) {
            console.warn('[WorkspaceConsistency] Assignment workspace mismatch — deactivating', {
                assignmentId: assignment.id,
                userId: normalizedUserId,
                email: normalizedEmail,
                projectId: String(assignment.projectId || '').trim(),
                expectedWorkspaceId: normalizedWorkspaceId,
                actualWorkspaceId: assignmentWorkspaceId,
                reason: 'assignment.workspaceId does not equal user.workspaceId'
            });
            await markProjectAssignmentInactive(
                assignment,
                'workspace_mismatch',
                normalizedWorkspaceId,
                assignmentWorkspaceId
            );
            continue;
        }

        const projectId = String(assignment.projectId || '').trim();
        if (!projectId) {
            console.warn('[WorkspaceConsistency] Assignment missing projectId — deactivating', {
                assignmentId: assignment.id,
                userId: normalizedUserId,
                email: normalizedEmail,
                workspaceId: normalizedWorkspaceId,
                reason: 'assignment has no projectId/project_id field'
            });
            await markProjectAssignmentInactive(
                assignment,
                'missing_project_id',
                normalizedWorkspaceId,
                assignmentWorkspaceId
            );
            continue;
        }

        const projectRecord = await _getProjectDoc(projectId);
        const projectWorkspaceId = String(projectRecord && projectRecord.data && projectRecord.data.workspace_id || '').trim();
        if (!projectRecord || !projectWorkspaceId || projectWorkspaceId !== normalizedWorkspaceId) {
            console.warn('[WorkspaceConsistency] Project workspace mismatch — deactivating assignment', {
                assignmentId: assignment.id,
                userId: normalizedUserId,
                email: normalizedEmail,
                projectId: projectId,
                expectedWorkspaceId: normalizedWorkspaceId,
                projectWorkspaceId: projectWorkspaceId,
                projectExists: Boolean(projectRecord),
                reason: !projectRecord
                    ? 'project document does not exist in Firestore'
                    : !projectWorkspaceId
                        ? 'project document has no workspace_id field'
                        : 'project.workspace_id does not equal user.workspaceId'
            });
            await markProjectAssignmentInactive(
                assignment,
                'project_workspace_mismatch',
                normalizedWorkspaceId,
                projectWorkspaceId
            );
            continue;
        }

        if (!isProjectAssignmentActive(assignment)) {
            continue;
        }

        // Role mismatch: auto-repair the assignment to the user's current
        // session role instead of silently skipping it.  Skipping leaves the
        // assignment frozen at its old role (e.g. the invite said 'client' but
        // the user was later elevated to 'developer'), which makes the project
        // permanently invisible until an admin manually re-invites.  Rewriting
        // the assignment's role to the current session role keeps
        // project_assignments as a self-healing single source of truth.
        const assignmentRole = AccessControl.normalizeRole(assignment.role);
        if (normalizedRole && assignmentRole && assignmentRole !== normalizedRole && assignmentRole !== 'member') {
            console.info('[ProjectAssignmentScope] Repairing role-mismatched assignment', {
                assignmentId: assignment.id,
                previousRole: assignmentRole,
                sessionRole: normalizedRole,
                projectId: String(assignment.projectId || '').trim()
            });
            patchCollectionDocument('project_assignments', assignment.id, {
                role: normalizedRole,
                previousRole: assignmentRole,
                roleRepairedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }).catch(err => {
                console.warn('[ProjectAssignmentScope] Role auto-repair write failed', {
                    assignmentId: assignment.id,
                    error: err && err.message
                });
            });
            assignment.role = normalizedRole;
        }

        if (!activeAssignmentsByProjectId.has(projectId)) {
            activeAssignmentsByProjectId.set(projectId, []);
        }
        activeAssignmentsByProjectId.get(projectId).push(assignment);
    }

    for (const [projectId, projectAssignments] of activeAssignmentsByProjectId.entries()) {
        const sortedAssignments = (Array.isArray(projectAssignments) ? projectAssignments.slice() : [])
            .sort((left, right) => getAssignmentTimestamp(right) - getAssignmentTimestamp(left));
        const primaryAssignment = sortedAssignments[0] || null;
        const duplicateAssignments = sortedAssignments.slice(1);

        if (duplicateAssignments.length) {
            console.warn('[WorkspaceAssignment] Multiple active project assignments detected; deactivating duplicates', {
                workspaceId: normalizedWorkspaceId,
                projectId,
                userId: normalizedUserId,
                email: normalizedEmail,
                keptAssignmentId: primaryAssignment && primaryAssignment.id ? primaryAssignment.id : '',
                duplicateAssignmentIds: duplicateAssignments.map(entry => String(entry && entry.id || '').trim()).filter(Boolean)
            });
            for (const duplicate of duplicateAssignments) {
                await markProjectAssignmentInactive(
                    duplicate,
                    'duplicate_active_assignment',
                    normalizedWorkspaceId,
                    normalizedWorkspaceId
                );
            }
        }

        // Reuse cached project document — already fetched in the first loop
        const projectRecord = await _getProjectDoc(projectId);
        const projectWorkspaceId = String(projectRecord && projectRecord.data && projectRecord.data.workspace_id || '').trim();
        if (!projectRecord || !projectWorkspaceId || projectWorkspaceId !== normalizedWorkspaceId) {
            if (primaryAssignment) {
                await markProjectAssignmentInactive(
                    primaryAssignment,
                    'project_workspace_mismatch',
                    normalizedWorkspaceId,
                    projectWorkspaceId
                );
            }
            continue;
        }

        validProjectIds.add(projectId);
    }

    console.info('[ProjectAssignmentScope] ========== FINAL RESULT ==========', {
        workspaceId: normalizedWorkspaceId,
        userId: normalizedUserId,
        email: normalizedEmail,
        role: normalizedRole,
        assignedProjectIds: Array.from(validProjectIds),
        count: validProjectIds.size,
        timestamp: new Date().toISOString()
    });

    return {
        assignedProjectIds: AccessControl.sanitizeAssignedProjectIds(Array.from(validProjectIds))
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
    const role = AccessControl.normalizeRole(profile.role || profile.workspaceRole || profile.dashboardRole || '');
    const membershipStatus = String(profile.membershipStatus || profile.status || '').trim().toLowerCase();
    if (role !== AccessControl.ROLES.CLIENT || membershipStatus !== 'pending') {
        return false;
    }
    // Pending client profiles may not have workspaceId yet; do not block bootstrap on empty workspace.
    return true;
}

async function findPendingClientInvitationByEmail(email, preferredWorkspaceId = '', preferredInvitationId = '') {
    const safeEmail = AccessControl.normalizeEmail(email);
    if (!safeEmail) return null;

    const normalizedPreferredWorkspaceId = String(preferredWorkspaceId || '').trim();
    const normalizedPreferredInvitationId = String(preferredInvitationId || '').trim();
    // Indexed email lookup only — no fallback full scan
    const invitations = await queryCollectionDocuments('invitations', {
        fieldPath: 'email',
        op: 'EQUAL',
        value: safeEmail,
        limit: 200
    }).catch(() => []);

    let candidates = (Array.isArray(invitations) ? invitations : [])
        .map(record => ({
            id: record.id || (record.name ? record.name.split('/').pop() : ''),
            data: record.data || record
        }))
        .filter(entry => {
            const record = entry.data || {};
            if (!isUsableClientInvitation(record)) return false;
            if (!String(record.workspaceId || '').trim()) return false;
            return true;
        })
        .sort((left, right) => getInvitationSortTimestamp(right.data) - getInvitationSortTimestamp(left.data));

    if (normalizedPreferredInvitationId) {
        candidates = candidates.filter(candidate => String(candidate.id || '').trim() === normalizedPreferredInvitationId);
    } else if (normalizedPreferredWorkspaceId) {
        candidates = candidates.filter(candidate => (
            String(candidate && candidate.data && candidate.data.workspaceId || '').trim() === normalizedPreferredWorkspaceId
        ));
    }

    if (candidates.length !== 1) {
        if (candidates.length > 1) {
            console.warn('[WorkspaceAssignment] Ambiguous pending invitations; skipping auto-bootstrap', {
                email: safeEmail,
                workspaceId: normalizedPreferredWorkspaceId,
                invitationId: normalizedPreferredInvitationId,
                invitationIds: candidates.map(candidate => candidate.id).filter(Boolean)
            });
        }
        return null;
    }

    return candidates[0];
}

async function syncProjectAssignmentsForUser({ workspaceId, userId, email, access, role, inviteType }) {
    const normalizedWorkspaceId = String(workspaceId || '').trim();
    const normalizedUserId = String(userId || '').trim();
    const normalizedEmail = AccessControl.normalizeEmail(email);
    const identityToken = normalizedEmail || normalizedUserId;
    if (!normalizedWorkspaceId || (!normalizedUserId && !normalizedEmail)) return;
    const normalizedRole = AccessControl.normalizeRole(
        role || (access && (access.role || access.workspaceRole)) || AccessControl.ROLES.CLIENT
    );
    const normalizedInviteType = String(inviteType || (access && access.inviteType) || 'client')
        .trim()
        .toLowerCase();

    const now = new Date().toISOString();
    // Indexed composite query: workspace_id + email (or user_id) — no full scan
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
    const currentAssignments = [];
    for (const batch of assignmentResults) {
        for (const record of (Array.isArray(batch) ? batch : [])) {
            if (!record || !record.id || seenAssignmentIds.has(record.id)) continue;
            seenAssignmentIds.add(record.id);
            currentAssignments.push(record);
        }
    }

    // Batch deactivate — 1 chunked op instead of N sequential writes
    if (currentAssignments.length) {
        const deactivateOps = currentAssignments.map(assignment => ({
            collectionId: 'project_assignments',
            docId: assignment.id,
            data: {
                status: 'inactive',
                active: false,
                updatedAt: now,
                updated_at: now
            }
        }));
        await commitBatchedWrites(deactivateOps).catch(() => undefined);
    }

    if (access.allProjectsAccess) {
        return;
    }

    // Validate project workspace membership in parallel — source of truth is
    // the project doc itself.  Stamp workspaceId from the project, not from
    // the caller, so invites can't write cross-workspace records.
    const projectIdList = (access.assignedProjectIds || [])
        .map(p => String(p || '').trim())
        .filter(Boolean);
    const projectDocs = await Promise.all(projectIdList.map(id =>
        getCollectionDocument('projects', id).catch(() => null)
    ));
    const validProjectEntries = [];
    projectIdList.forEach((projectId, idx) => {
        const projectRecord = projectDocs[idx];
        const projectWorkspaceId = String(projectRecord && projectRecord.data && projectRecord.data.workspace_id || '').trim();
        if (!projectRecord || !projectWorkspaceId || projectWorkspaceId !== normalizedWorkspaceId) {
            console.error('[WorkspaceConsistency] Auto-bootstrap assignment rejected due to workspace mismatch', {
                workspaceId: normalizedWorkspaceId,
                projectId,
                projectWorkspaceId
            });
            return;
        }
        validProjectEntries.push({ projectId, projectWorkspaceId });
    });

    const sanitizedIds = AccessControl.sanitizeAssignedProjectIds(validProjectEntries.map(e => e.projectId));
    const sanitizedIdSet = new Set(sanitizedIds);
    if (sanitizedIds.length) {
        const upsertOps = validProjectEntries
            .filter(entry => sanitizedIdSet.has(entry.projectId))
            .map(({ projectId, projectWorkspaceId }) => ({
                collectionId: 'project_assignments',
                docId: `${projectWorkspaceId}_${projectId}_${identityToken}`,
                data: {
                    workspaceId: projectWorkspaceId,
                    workspace_id: projectWorkspaceId,
                    projectId,
                    project_id: projectId,
                    userId: normalizedUserId,
                    user_id: normalizedUserId,
                    email: normalizedEmail,
                    user_email: normalizedEmail,
                    role: normalizedRole,
                    inviteType: normalizedInviteType,
                    status: 'active',
                    createdAt: now,
                    created_at: now,
                    updatedAt: now,
                    updated_at: now,
                    active: true
                }
            }));
        await commitBatchedWrites(upsertOps).catch(() => undefined);
    }
}

async function resolveWorkspaceFromTeamMembership(email) {
    const normalizedEmail = AccessControl.normalizeEmail(email);
    if (!normalizedEmail) return null;

    // Query team_members by email to find workspace membership
    const teamResults = await queryCollectionDocuments('team_members', {
        fieldPath: 'email',
        op: 'EQUAL',
        value: normalizedEmail,
        limit: 10
    }).catch(() => []);

    // Find the first active team member record with a valid workspace_id
    for (const doc of (Array.isArray(teamResults) ? teamResults : [])) {
        const data = doc && doc.data ? doc.data : {};
        const wsId = String(data.workspace_id || data.workspaceId || '').trim();
        const status = String(data.invite_status || data.status || '').trim().toLowerCase();
        if (wsId && status === 'accepted') {
            console.info('[WorkspaceResolution] Found workspace from team_members', {
                email: normalizedEmail,
                workspaceId: wsId,
                role: data.canonical_role || data.role || '',
                assignedProjectIds: data.assigned_project_ids || data.assignedProjectIds || []
            });
            return {
                workspaceId: wsId,
                role: data.canonical_role || data.role || '',
                workspaceOwnerEmail: AccessControl.normalizeEmail(data.workspace_owner_email || data.workspaceOwnerEmail || ''),
                workspaceOwnerUserId: String(data.workspace_owner_user_id || data.workspaceOwnerUserId || '').trim(),
                assignedProjectIds: AccessControl.sanitizeAssignedProjectIds(
                    data.assigned_project_ids || data.assignedProjectIds
                ),
                allProjectsAccess: data.all_projects_access === true || data.allProjectsAccess === true,
                inviteType: String(data.invite_type || data.inviteType || 'team').trim()
            };
        }
    }

    // Also check clients collection
    const clientResults = await queryCollectionDocuments('clients', {
        fieldPath: 'email',
        op: 'EQUAL',
        value: normalizedEmail,
        limit: 10
    }).catch(() => []);

    for (const doc of (Array.isArray(clientResults) ? clientResults : [])) {
        const data = doc && doc.data ? doc.data : {};
        const wsId = String(data.workspace_id || data.workspaceId || '').trim();
        const status = String(data.invite_status || data.status || '').trim().toLowerCase();
        if (wsId && status === 'accepted') {
            console.info('[WorkspaceResolution] Found workspace from clients', {
                email: normalizedEmail,
                workspaceId: wsId,
                role: 'client',
                assignedProjectIds: data.assigned_project_ids || data.assignedProjectIds || []
            });
            return {
                workspaceId: wsId,
                role: 'client',
                workspaceOwnerEmail: AccessControl.normalizeEmail(data.workspace_owner_email || data.workspaceOwnerEmail || ''),
                workspaceOwnerUserId: String(data.workspace_owner_user_id || data.workspaceOwnerUserId || '').trim(),
                assignedProjectIds: AccessControl.sanitizeAssignedProjectIds(
                    data.assigned_project_ids || data.assignedProjectIds
                ),
                allProjectsAccess: data.all_projects_access === true || data.allProjectsAccess === true,
                inviteType: 'client'
            };
        }
    }

    console.warn('[WorkspaceResolution] No workspace membership found for email', { email: normalizedEmail });
    return null;
}

async function autoBootstrapClientAccessFromInvitation({ existingProfile, authUser }) {
    if (!shouldTryClientInvitationAutoBootstrap(existingProfile)) {
        return null;
    }

    const invitation = await findPendingClientInvitationByEmail(
        authUser.email,
        existingProfile.workspaceId,
        existingProfile.invitationId || existingProfile.invitation_id || ''
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
    }).catch(() => ({
        assignedProjectIds: invitationAccess.assignedProjectIds,
        unresolvedProjectIds: invitationAccess.assignedProjectIds
    }));
    const unresolvedProjectIds = Array.isArray(resolvedScope.unresolvedProjectIds)
        ? resolvedScope.unresolvedProjectIds
        : [];
    if (unresolvedProjectIds.length) {
        console.error('[WorkspaceConsistency] Auto-bootstrap blocked due to unresolved project assignments', {
            invitationId: invitation.id,
            workspaceId,
            unresolvedProjectIds: AccessControl.sanitizeAssignedProjectIds(unresolvedProjectIds)
        });
        return null;
    }
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
        access,
        role: AccessControl.ROLES.CLIENT,
        inviteType: 'client'
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

    // Invalidate cache — bootstrap just changed this user's workspace/role
    invalidateSessionCache(authUser.uid);

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
    // ─── OPTIMIZATION 1: Return cached profile if available (5-min TTL) ───
    const cachedProfile = _getSessionCache(authUser);
    if (cachedProfile) {
        // Cache-bust for stale empty-assignment profiles.  A client/developer/
        // designer with an empty assignedProjectIds list is almost always a
        // transient state (e.g. cached before session-repair completed) — force
        // a fresh rebuild rather than serving the empty cache.
        const cachedRole = AccessControl.normalizeRole(cachedProfile.role || cachedProfile.workspaceRole);
        const cachedNeedsAssignments = cachedRole === AccessControl.ROLES.CLIENT
            || cachedRole === AccessControl.ROLES.DEVELOPER
            || cachedRole === AccessControl.ROLES.DESIGNER;
        const cachedAssignedIds = Array.isArray(cachedProfile.assignedProjectIds) ? cachedProfile.assignedProjectIds : [];
        const cachedAllAccess = cachedProfile.allProjectsAccess === true
            || cachedProfile.all_projects_access === true;
        if (cachedNeedsAssignments && !cachedAllAccess && cachedAssignedIds.length === 0) {
            console.warn('[SessionCache] Cache-busting stale empty-assignment profile — forcing fresh rebuild', {
                userId: authUser.uid,
                role: cachedRole,
                workspaceId: String(cachedProfile.workspaceId || '').trim()
            });
            invalidateSessionCache(authUser && authUser.uid);
        } else {
            console.info('[SessionCache] Returning cached profile', {
                userId: authUser.uid,
                workspaceId: String(cachedProfile.workspaceId || '').trim()
            });
            return cachedProfile;
        }
    }

    // ─── REQUEST DEDUPLICATION: If a resolution is already in-flight for this uid, reuse it ───
    const dedupeKey = _getSessionCacheKey(authUser);
    if (dedupeKey && _inflight.has(dedupeKey)) {
        console.info('[SessionCache] Joining in-flight resolution', { userId: authUser.uid });
        return _inflight.get(dedupeKey);
    }

    const resolutionPromise = _resolveWorkspaceAccessProfile(authUser);
    if (dedupeKey) {
        _inflight.set(dedupeKey, resolutionPromise);
        resolutionPromise.finally(() => _inflight.delete(dedupeKey));
    }
    return resolutionPromise;
}

// The actual heavy resolution logic, extracted so deduplication wrapper stays clean
async function _resolveWorkspaceAccessProfile(authUser) {
    let profileDocument = await loadUserProfileDocument(authUser);
    let existingProfile = profileDocument && profileDocument.data ? profileDocument.data : {};
    const autoBootstrappedClientProfile = await autoBootstrapClientAccessFromInvitation({
        existingProfile,
        authUser
    }).catch(() => null);
    if (autoBootstrappedClientProfile) {
        existingProfile = autoBootstrappedClientProfile;
    }

    // ─── SESSION REPAIR ───
    // If workspaceId missing or membership inactive, auto-apply a matching pending invitation.
    const repairNeeded = !String(existingProfile.workspaceId || '').trim()
        || String(existingProfile.membershipStatus || '').trim().toLowerCase() !== 'active';
    // Allow session repair for all authenticated users, including those with
    // unverified email.  Invited users skip email verification (the invitation
    // token proves ownership), so gating repair on emailVerified would block
    // them if their first /api/me call needs repair after partial acceptance.
    if (repairNeeded && authUser && authUser.email) {
        console.info('[SessionRepair] triggered', {
            userId: authUser.uid,
            email: AccessControl.normalizeEmail(authUser.email),
            workspaceId: String(existingProfile.workspaceId || '').trim(),
            membershipStatus: existingProfile.membershipStatus || ''
        });
        // Lazy require to avoid circular dependency (invitations.js → workspace-access.js)
        const { findPendingInvitationForEmail, acceptInvitation } = require('./invitations');
        const pendingInvite = await findPendingInvitationForEmail(authUser.email).catch(() => null);
        if (pendingInvite) {
            console.info('[SessionRepair] invitation found', {
                userId: authUser.uid,
                invitationId: pendingInvite.id,
                workspaceId: String(pendingInvite.data && pendingInvite.data.workspaceId || '').trim(),
                role: pendingInvite.data && pendingInvite.data.role
            });
            try {
                await acceptInvitation({
                    session: {
                        authUser,
                        userProfile: existingProfile,
                        sessionUser: {
                            email: AccessControl.normalizeEmail(authUser.email),
                            name: existingProfile.name || authUser.email,
                            workspaceId: existingProfile.workspaceId || ''
                        }
                    },
                    invitation: pendingInvite
                });
                profileDocument = await loadUserProfileDocument(authUser);
                existingProfile = profileDocument && profileDocument.data ? profileDocument.data : existingProfile;
                console.info('[SessionRepair] repaired successfully', {
                    userId: authUser.uid,
                    workspaceId: String(existingProfile.workspaceId || '').trim(),
                    role: existingProfile.role
                });
            } catch (repairError) {
                console.error('[SessionRepair] repair failed', {
                    userId: authUser.uid,
                    invitationId: pendingInvite.id,
                    error: repairError && repairError.message
                });
            }
        }
    }

    // CRITICAL: If workspaceId is still empty, resolve from team_members/clients by email
    if (!String(existingProfile.workspaceId || '').trim()) {
        const membership = await resolveWorkspaceFromTeamMembership(authUser.email).catch(() => null);
        if (membership && membership.workspaceId) {
            console.info('[WorkspaceResolution] Patching user profile with resolved workspace', {
                userId: authUser.uid,
                email: AccessControl.normalizeEmail(authUser.email),
                workspaceId: membership.workspaceId,
                role: membership.role
            });
            existingProfile.workspaceId = membership.workspaceId;
            existingProfile.workspaceOwnerEmail = membership.workspaceOwnerEmail || existingProfile.workspaceOwnerEmail;
            existingProfile.workspaceOwnerUserId = membership.workspaceOwnerUserId || existingProfile.workspaceOwnerUserId;
            existingProfile.assignedProjectIds = membership.assignedProjectIds.length
                ? membership.assignedProjectIds
                : existingProfile.assignedProjectIds;
            existingProfile.allProjectsAccess = membership.allProjectsAccess;
            existingProfile.inviteType = membership.inviteType || existingProfile.inviteType;
            existingProfile.membershipStatus = 'active';
            if (membership.role) {
                existingProfile.role = membership.role;
                existingProfile.workspaceRole = membership.role;
                existingProfile.canonical_role = AccessControl.normalizeRole(membership.role);
            }
            // Persist this back to users document so future lookups don't repeat this
            await patchCollectionDocument('users', profileDocument.id || authUser.uid, {
                workspaceId: membership.workspaceId,
                workspaceOwnerEmail: existingProfile.workspaceOwnerEmail,
                workspaceOwnerUserId: existingProfile.workspaceOwnerUserId,
                assignedProjectIds: existingProfile.assignedProjectIds,
                allProjectsAccess: existingProfile.allProjectsAccess,
                membershipStatus: 'active',
                role: existingProfile.role,
                workspaceRole: existingProfile.workspaceRole,
                canonical_role: existingProfile.canonical_role,
                inviteType: existingProfile.inviteType,
                updatedAt: new Date().toISOString()
            }).catch(err => {
                console.warn('[WorkspaceResolution] Failed to persist workspace to users doc', { error: err.message });
            });
        }
    }

    // CRITICAL: Detect stale users.workspaceId pointing at a leftover auto-generated
    // workspace (e.g. workspace_<uid>) when the authoritative team_members/clients
    // record for this email lives under a different workspace.  Align on every login
    // so retroactive repair happens without requiring an admin edit.
    // Workspace owners are exempt — we never flip an owner out of their own workspace.
    {
        const userIsWorkspaceOwner = existingProfile.isWorkspaceOwner === true
            || existingProfile.workspaceOwner === true
            || existingProfile.owner === true
            || String(existingProfile.role || '').trim().toLowerCase() === 'owner';
        const currentWorkspaceId = String(existingProfile.workspaceId || '').trim();
        if (!userIsWorkspaceOwner && currentWorkspaceId) {
            const authoritativeMembership = await resolveWorkspaceFromTeamMembership(authUser.email).catch(() => null);
            const authoritativeWorkspaceId = authoritativeMembership && authoritativeMembership.workspaceId
                ? String(authoritativeMembership.workspaceId).trim()
                : '';
            if (authoritativeWorkspaceId && authoritativeWorkspaceId !== currentWorkspaceId) {
                console.warn('[WorkspaceResolution] Aligning stale users.workspaceId to authoritative team_members/clients record', {
                    userId: authUser.uid,
                    email: AccessControl.normalizeEmail(authUser.email),
                    previousWorkspaceId: currentWorkspaceId,
                    nextWorkspaceId: authoritativeWorkspaceId,
                    role: authoritativeMembership.role
                });
                existingProfile.workspaceId = authoritativeWorkspaceId;
                existingProfile.workspaceOwnerEmail = authoritativeMembership.workspaceOwnerEmail || existingProfile.workspaceOwnerEmail;
                existingProfile.workspaceOwnerUserId = authoritativeMembership.workspaceOwnerUserId || existingProfile.workspaceOwnerUserId;
                // Old assignedProjectIds belonged to the stale workspace — drop them so
                // resolveScopedAssignedProjectsForLogin rehydrates from project_assignments.
                existingProfile.assignedProjectIds = authoritativeMembership.assignedProjectIds.length
                    ? authoritativeMembership.assignedProjectIds
                    : [];
                existingProfile.allProjectsAccess = authoritativeMembership.allProjectsAccess;
                existingProfile.inviteType = authoritativeMembership.inviteType || existingProfile.inviteType;
                existingProfile.membershipStatus = 'active';
                if (authoritativeMembership.role) {
                    existingProfile.role = authoritativeMembership.role;
                    existingProfile.workspaceRole = authoritativeMembership.role;
                    existingProfile.canonical_role = AccessControl.normalizeRole(authoritativeMembership.role);
                }
                await patchCollectionDocument('users', profileDocument.id || authUser.uid, {
                    workspaceId: authoritativeWorkspaceId,
                    workspaceOwnerEmail: existingProfile.workspaceOwnerEmail,
                    workspaceOwnerUserId: existingProfile.workspaceOwnerUserId,
                    assignedProjectIds: existingProfile.assignedProjectIds,
                    allProjectsAccess: existingProfile.allProjectsAccess,
                    membershipStatus: 'active',
                    role: existingProfile.role,
                    workspaceRole: existingProfile.workspaceRole,
                    canonical_role: existingProfile.canonical_role,
                    inviteType: existingProfile.inviteType,
                    updatedAt: new Date().toISOString()
                }).catch(err => {
                    console.warn('[WorkspaceResolution] Failed to persist aligned workspace to users doc', { error: err.message });
                });
                invalidateSessionCache(authUser.uid);
            }
        }
    }

    // SECONDARY ALIGNMENT: Follow the projects collection as the ultimate source
    // of truth.  Some legacy accounts have a corrupted chain where users.workspaceId,
    // the clients/team_members record, AND the project_assignments record all point
    // at the same stale auto-generated workspace (workspace_<uid>), while the actual
    // projects/<id> docs live under the admin's real workspace.  In that case the
    // primary Fix 4a pass sees no mismatch (stale == stale) and cannot heal.
    // Here we look up each assigned project's actual workspace — if they all agree
    // on a single workspace different from the current one, align + repair the
    // downstream project_assignments records too.
    {
        const userIsWorkspaceOwner = existingProfile.isWorkspaceOwner === true
            || existingProfile.workspaceOwner === true
            || existingProfile.owner === true
            || String(existingProfile.role || '').trim().toLowerCase() === 'owner';
        const currentWorkspaceId = String(existingProfile.workspaceId || '').trim();
        const normalizedEmailForProjectScan = AccessControl.normalizeEmail(existingProfile.email || authUser.email);
        if (!userIsWorkspaceOwner && currentWorkspaceId && normalizedEmailForProjectScan) {
            const assignmentRecords = await queryCollectionDocumentsMulti('project_assignments', [
                { fieldPath: 'email', op: 'EQUAL', value: normalizedEmailForProjectScan }
            ], 100).catch(() => []);
            const activeAssignments = (Array.isArray(assignmentRecords) ? assignmentRecords : []).filter(record => {
                const data = record && record.data ? record.data : {};
                const status = String(data.status || '').trim().toLowerCase();
                return data.active !== false && !['inactive', 'revoked', 'cancelled', 'deleted'].includes(status);
            });
            const assignedProjectIds = new Set();
            for (const record of activeAssignments) {
                const data = record.data || {};
                const pid = String(data.projectId || data.project_id || '').trim();
                if (pid) assignedProjectIds.add(pid);
            }
            if (assignedProjectIds.size > 0) {
                const projectWorkspaceIds = new Set();
                for (const pid of assignedProjectIds) {
                    const projectDoc = await getCollectionDocument('projects', pid).catch(() => null);
                    const wsId = String(
                        (projectDoc && projectDoc.data && (projectDoc.data.workspace_id || projectDoc.data.workspaceId)) || ''
                    ).trim();
                    if (wsId) projectWorkspaceIds.add(wsId);
                }
                if (projectWorkspaceIds.size === 1) {
                    const projectWorkspaceId = Array.from(projectWorkspaceIds)[0];
                    if (projectWorkspaceId !== currentWorkspaceId) {
                        console.warn('[WorkspaceResolution] Aligning users.workspaceId to actual project workspace (corrupted-chain recovery)', {
                            userId: authUser.uid,
                            email: normalizedEmailForProjectScan,
                            previousWorkspaceId: currentWorkspaceId,
                            nextWorkspaceId: projectWorkspaceId,
                            assignedProjectIds: Array.from(assignedProjectIds)
                        });
                        existingProfile.workspaceId = projectWorkspaceId;
                        const nowIso = new Date().toISOString();
                        await patchCollectionDocument('users', profileDocument.id || authUser.uid, {
                            workspaceId: projectWorkspaceId,
                            updatedAt: nowIso
                        }).catch(err => {
                            console.warn('[WorkspaceResolution] Failed to persist project-aligned workspace to users doc', { error: err.message });
                        });
                        // Repair downstream project_assignments records so the
                        // dashboard scope query finds them under the correct workspace.
                        for (const record of activeAssignments) {
                            if (!record || !record.id) continue;
                            const data = record.data || {};
                            const recordWorkspaceId = String(data.workspace_id || data.workspaceId || '').trim();
                            if (recordWorkspaceId === projectWorkspaceId) continue;
                            await patchCollectionDocument('project_assignments', record.id, {
                                workspaceId: projectWorkspaceId,
                                workspace_id: projectWorkspaceId,
                                updatedAt: nowIso,
                                updated_at: nowIso
                            }).catch(() => undefined);
                        }
                        invalidateSessionCache(authUser.uid);
                    }
                } else if (projectWorkspaceIds.size > 1) {
                    console.warn('[WorkspaceResolution] Multiple project workspaces detected — cannot auto-align', {
                        userId: authUser.uid,
                        email: normalizedEmailForProjectScan,
                        workspaceIds: Array.from(projectWorkspaceIds)
                    });
                }
            }
        }
    }

    let pendingInviteBootstrap = hasPendingInviteState(existingProfile);

    // If user has invite-shaped state but no workspace could be resolved (including post-repair),
    // fail explicitly rather than silently promoting them to owner of a phantom workspace.
    if (pendingInviteBootstrap && !String(existingProfile.workspaceId || '').trim()) {
        const error = new Error('No active workspace could be resolved for this account. Ask your workspace owner to re-send the invitation.');
        error.statusCode = 403;
        error.code = 'WORKSPACE_UNRESOLVED';
        throw error;
    }

    const existingRole = AccessControl.normalizeRole(existingProfile.role || existingProfile.workspaceRole || existingProfile.canonical_role);
    const isInviteOnlyRole = existingRole === AccessControl.ROLES.CLIENT
        || existingRole === AccessControl.ROLES.DEVELOPER
        || existingRole === AccessControl.ROLES.DESIGNER;
    if (!String(existingProfile.workspaceId || '').trim() && isInviteOnlyRole) {
        const error = new Error('No active workspace is attached to this account. Ask your workspace owner to re-send the invitation.');
        error.statusCode = 403;
        error.code = 'WORKSPACE_UNRESOLVED';
        throw error;
    }

    const bootstrapRequired = !existingProfile.workspaceId && !pendingInviteBootstrap;
    const ownerEmailExplicit = getWorkspaceOwnerEmail(existingProfile, authUser);
    const ownerUserIdExplicit = getWorkspaceOwnerUserId(existingProfile, authUser);
    const ownerEmail = ownerEmailExplicit || (bootstrapRequired ? AccessControl.normalizeEmail(authUser.email) : '');
    const ownerUserId = ownerUserIdExplicit || (bootstrapRequired ? String(authUser.uid || '').trim() : '');
    const inferredOwner = existingProfile.isWorkspaceOwner === true
        || (bootstrapRequired && ownerEmail === AccessControl.normalizeEmail(authUser.email));

    const normalizedEmail = AccessControl.normalizeEmail(existingProfile.email || authUser.email);
    const workspaceIdForLookup = pendingInviteBootstrap ? '' : getWorkspaceId(existingProfile, authUser);
    let canonicalRole = existingProfile.canonical_role || existingProfile.role;
    if (!canonicalRole && workspaceIdForLookup && normalizedEmail) {
        const teamMemberDoc = await getCollectionDocument('team_members', sanitizeDocumentId(`${workspaceIdForLookup}_${normalizedEmail}`)).catch(() => null);
        if (teamMemberDoc && teamMemberDoc.data && teamMemberDoc.data.canonical_role) {
            canonicalRole = teamMemberDoc.data.canonical_role;
            existingProfile.canonical_role = canonicalRole;
            existingProfile.role = AccessControl.getRoleDisplayLabel(canonicalRole);
        }
    }

    const baseProfile = {
        ...existingProfile,
        email: AccessControl.normalizeEmail(existingProfile.email || authUser.email),
        name: String(existingProfile.name || authUser.email).trim(),
        workspaceId: pendingInviteBootstrap ? '' : getWorkspaceId(existingProfile, authUser),
        workspaceOwnerEmail: pendingInviteBootstrap ? '' : ownerEmail,
        workspaceOwnerUserId: pendingInviteBootstrap ? '' : ownerUserId,
        isWorkspaceOwner: pendingInviteBootstrap ? false : inferredOwner,
        canonical_role: canonicalRole || AccessControl.normalizeRole(existingProfile.role || existingProfile.workspaceRole),
        role: AccessControl.getRoleDisplayLabel(canonicalRole || AccessControl.normalizeRole(existingProfile.role || existingProfile.workspaceRole)),
        workspaceRole: canonicalRole || AccessControl.normalizeRole(existingProfile.role || existingProfile.workspaceRole),
        assignedProjectIds: getNormalizedAssignedProjectIds(existingProfile),
        allProjectsAccess: hasAllProjectsAccess(existingProfile),
        projectAccessScope: hasAllProjectsAccess(existingProfile) ? 'all' : 'selected',
        membershipStatus: String(existingProfile.membershipStatus || 'active').trim().toLowerCase()
    };

    // Sanitize workspaceId — filter out empty/whitespace-only values
    baseProfile.workspaceId = String(baseProfile.workspaceId || '').trim();

    console.info('[RoleResolution] Profile role lookup', {
        userId: authUser.uid,
        email: normalizedEmail,
        workspaceId: baseProfile.workspaceId,
        existingRole: existingProfile.role,
        canonicalRole: baseProfile.canonical_role,
        role: baseProfile.role,
        source: canonicalRole ? 'team_members' : 'users'
    });

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
    let nextProfile = {
        ...baseProfile,
        ...permissionFields,
        updatedAt: new Date().toISOString()
    };

    const normalizedRole = AccessControl.normalizeRole(nextProfile.role || nextProfile.workspaceRole);
    const shouldUseProjectAssignmentScope = !AccessControl.isWorkspaceOwner(nextProfile)
        && (
            normalizedRole === AccessControl.ROLES.CLIENT
            || normalizedRole === AccessControl.ROLES.DEVELOPER
            || normalizedRole === AccessControl.ROLES.DESIGNER
        );
    if (shouldUseProjectAssignmentScope && nextProfile.workspaceId) {
        console.info('[ProjectAssignmentScope] Starting resolution', {
            userId: authUser.uid,
            email: nextProfile.email,
            workspaceId: nextProfile.workspaceId,
            normalizedRole,
            shouldUseProjectAssignmentScope
        });
        const scopedAssignmentState = await resolveScopedAssignedProjectsForLogin({
            workspaceId: nextProfile.workspaceId,
            userId: String(authUser.uid || '').trim(),
            email: nextProfile.email,
            role: normalizedRole
        }).catch(() => ({ assignedProjectIds: [] }));
        console.info('[ProjectAssignmentScope] Resolution complete', {
            userId: authUser.uid,
            assignedProjectIds: scopedAssignmentState.assignedProjectIds,
            count: scopedAssignmentState.assignedProjectIds ? scopedAssignmentState.assignedProjectIds.length : 0
        });

        let resolvedIds = scopedAssignmentState.assignedProjectIds || [];

        // Fallback: if project_assignments returned empty, cross-check team_members/clients as source of truth
        if (!resolvedIds.length && nextProfile.workspaceId) {
            console.info('[ProjectAssignmentScope] Empty from project_assignments — checking team_members/clients fallback', {
                userId: authUser.uid,
                email: nextProfile.email,
                workspaceId: nextProfile.workspaceId
            });
            const targetCollection = normalizedRole === AccessControl.ROLES.CLIENT ? 'clients' : 'team_members';

            // Query by fields instead of relying on document ID format (workspaceId_email).
            // Documents may use random IDs, so a direct getCollectionDocument would miss them.
            const fallbackResults = await queryCollectionDocumentsMulti(targetCollection, [
                { fieldPath: 'workspace_id', op: 'EQUAL', value: nextProfile.workspaceId },
                { fieldPath: 'email', op: 'EQUAL', value: nextProfile.email }
            ], 10).catch(() => []);

            // Also try by document ID as a secondary fallback for legacy data
            const targetDocId = sanitizeDocumentId(`${nextProfile.workspaceId}_${nextProfile.email}`);
            const targetDocById = await getCollectionDocument(targetCollection, targetDocId).catch(() => null);

            // Merge results — collect assigned project IDs from ALL matching
            // documents so that no project is lost when data is split across
            // multiple records (e.g. different doc ID formats).
            const candidateDocs = [
                ...(Array.isArray(fallbackResults) ? fallbackResults : []),
                ...(targetDocById ? [targetDocById] : [])
            ];
            const seenDocIds = new Set();
            const mergedProjectIdSet = new Set();
            for (const doc of candidateDocs) {
                if (!doc || !doc.id || seenDocIds.has(doc.id)) continue;
                seenDocIds.add(doc.id);
                const docData = doc && doc.data ? doc.data : {};
                const ids = AccessControl.sanitizeAssignedProjectIds(
                    docData.assigned_project_ids || docData.assignedProjectIds
                );
                ids.forEach(id => mergedProjectIdSet.add(id));
            }
            const targetAssignedIds = Array.from(mergedProjectIdSet);

            if (targetAssignedIds.length) {
                console.info('[ProjectAssignmentScope] Recovered assignments from ' + targetCollection, {
                    userId: authUser.uid,
                    recoveredIds: targetAssignedIds,
                    count: targetAssignedIds.length
                });

                // Query EXISTING project_assignments for this user so we can
                // force-reactivate any inactive records rather than creating
                // duplicates with a different doc ID format.  Records may have
                // been created under the old buggy code with email-only doc IDs
                // while new records use a different identity token — we need to
                // cover both cases.
                const existingAssignments = await queryCollectionDocumentsMulti('project_assignments', [
                    { fieldPath: 'workspace_id', op: 'EQUAL', value: nextProfile.workspaceId },
                    { fieldPath: 'email', op: 'EQUAL', value: nextProfile.email }
                ], 500).catch(() => []);

                // Index existing records by projectId so we can look them up.
                const existingByProjectId = new Map();
                for (const record of (Array.isArray(existingAssignments) ? existingAssignments : [])) {
                    const data = record && record.data ? record.data : {};
                    const pid = String(data.projectId || data.project_id || '').trim();
                    if (!pid) continue;
                    if (!existingByProjectId.has(pid)) {
                        existingByProjectId.set(pid, []);
                    }
                    existingByProjectId.get(pid).push({ id: record.id, data });
                }

                const now = new Date().toISOString();
                const batchOps = [];

                // Pre-resolve each project's workspaceId from its own doc so
                // we stamp the assignment with the project's workspace (source
                // of truth), not the user profile's — preventing silent drops
                // when the two drift apart.
                const projectWorkspaceLookups = await Promise.all(
                    targetAssignedIds.map(pid => getCollectionDocument('projects', pid).catch(() => null))
                );
                const resolvedProjectWorkspaceById = new Map();
                targetAssignedIds.forEach((pid, idx) => {
                    const rec = projectWorkspaceLookups[idx];
                    const ws = String(rec && rec.data && (rec.data.workspace_id || rec.data.workspaceId) || '').trim();
                    if (ws) resolvedProjectWorkspaceById.set(pid, ws);
                });

                for (const projectId of targetAssignedIds) {
                    const existingForProject = existingByProjectId.get(projectId) || [];
                    const projectWorkspaceId = resolvedProjectWorkspaceById.get(projectId) || nextProfile.workspaceId;

                    // Build the authoritative active-record payload.  Explicitly
                    // clear ALL deactivation metadata so stale records become
                    // visible again to resolveScopedAssignedProjectsForLogin.
                    const activePayload = {
                        workspaceId: projectWorkspaceId,
                        workspace_id: projectWorkspaceId,
                        projectId: projectId,
                        project_id: projectId,
                        userId: authUser.uid,
                        user_id: authUser.uid,
                        email: nextProfile.email,
                        user_email: nextProfile.email,
                        role: normalizedRole,
                        inviteType: String(nextProfile.inviteType || '').trim().toLowerCase(),
                        status: 'active',
                        active: true,
                        // Force-clear deactivation metadata.
                        deactivatedReason: '',
                        mismatchReason: '',
                        expectedWorkspaceId: '',
                        actualWorkspaceId: '',
                        // Audit trail: mark that this record was reactivated by fallback.
                        recoveredAt: now,
                        recoveredReason: 'fallback_from_' + targetCollection,
                        updatedAt: now,
                        updated_at: now
                    };

                    if (existingForProject.length > 0) {
                        // Reactivate every existing record (primary + any duplicates).
                        // Preserve original createdAt from the primary to keep the audit trail intact.
                        const primary = existingForProject[0];
                        activePayload.createdAt = primary.data.createdAt || primary.data.created_at || now;
                        activePayload.created_at = primary.data.created_at || primary.data.createdAt || now;
                        for (const existing of existingForProject) {
                            batchOps.push({
                                collectionId: 'project_assignments',
                                docId: existing.id,
                                data: activePayload
                            });
                        }
                    } else {
                        // No existing record — create a fresh one with the canonical doc ID.
                        activePayload.createdAt = now;
                        activePayload.created_at = now;
                        batchOps.push({
                            collectionId: 'project_assignments',
                            docId: `${projectWorkspaceId}_${projectId}_${nextProfile.email}`,
                            data: activePayload
                        });
                    }
                }

                if (batchOps.length) {
                    await commitBatchedWrites(batchOps).catch(err => {
                        console.warn('[ProjectAssignmentScope] Fallback batch reactivate failed', { error: err.message });
                    });
                    console.info('[ProjectAssignmentScope] Fallback reactivated/created assignments', {
                        userId: authUser.uid,
                        writeCount: batchOps.length,
                        projectCount: targetAssignedIds.length
                    });
                }

                resolvedIds = targetAssignedIds;
            }
        }

        // ─── Backfill user_id on email-only assignments ───
        // Assignments created before the user signed up only have an email.
        // Now that we have authUser.uid, patch those records so future lookups
        // by userId also find them, preventing duplicates on the next sync.
        if (resolvedIds.length && authUser.uid && nextProfile.email) {
            const emailOnlyAssignments = await queryCollectionDocumentsMulti('project_assignments', [
                { fieldPath: 'workspace_id', op: 'EQUAL', value: nextProfile.workspaceId },
                { fieldPath: 'email', op: 'EQUAL', value: nextProfile.email }
            ], 500).catch(() => []);
            const backfillOps = [];
            for (const record of (Array.isArray(emailOnlyAssignments) ? emailOnlyAssignments : [])) {
                const data = record && record.data ? record.data : {};
                const existingUserId = String(data.userId || data.user_id || '').trim();
                const isActive = data.active !== false && !['inactive', 'revoked', 'cancelled', 'deleted'].includes(
                    String(data.status || '').trim().toLowerCase()
                );
                if (isActive && !existingUserId) {
                    backfillOps.push({
                        collectionId: 'project_assignments',
                        docId: record.id,
                        data: {
                            userId: authUser.uid,
                            user_id: authUser.uid,
                            updatedAt: new Date().toISOString(),
                            updated_at: new Date().toISOString()
                        }
                    });
                }
            }
            if (backfillOps.length) {
                console.info('[ProjectAssignmentScope] Backfilling user_id on email-only assignments', {
                    userId: authUser.uid,
                    email: nextProfile.email,
                    count: backfillOps.length
                });
                await commitBatchedWrites(backfillOps).catch(err => {
                    console.warn('[ProjectAssignmentScope] user_id backfill failed', { error: err.message });
                });
            }
        }

        nextProfile = {
            ...nextProfile,
            assignedProjectIds: resolvedIds,
            allProjectsAccess: false,
            projectAccessScope: 'selected'
        };
    }

    const cleanWorkspaceId = String(nextProfile.workspaceId || '').trim();
    if (cleanWorkspaceId) {
        nextProfile.workspaceId = cleanWorkspaceId;
        await ensureWorkspaceDocument(nextProfile, authUser);
        await ensureWorkspaceMember(nextProfile, authUser);
    } else {
        console.warn('[WorkspaceResolution] Empty workspaceId after full resolution — skipping workspace document/member creation', {
            userId: authUser.uid,
            email: AccessControl.normalizeEmail(authUser.email),
            isOwner: nextProfile.isWorkspaceOwner,
            membershipStatus: nextProfile.membershipStatus
        });
        nextProfile.workspaceId = '';
    }

    // ─── OPTIMIZATION 3: Skip user doc patch if nothing changed (dirty check) ───
    const userPatchFields = {
        workspaceId: nextProfile.workspaceId,
        workspaceOwnerEmail: nextProfile.workspaceOwnerEmail,
        workspaceOwnerUserId: nextProfile.workspaceOwnerUserId,
        ownerEmail: nextProfile.workspaceOwnerEmail,
        ownerUserId: nextProfile.workspaceOwnerUserId,
        isWorkspaceOwner: nextProfile.isWorkspaceOwner,
        role: nextProfile.role,
        workspaceRole: nextProfile.workspaceRole,
        canonical_role: nextProfile.canonical_role || AccessControl.normalizeRole(nextProfile.role || nextProfile.workspaceRole),
        permissionKeys: nextProfile.permissionKeys,
        permissions: nextProfile.permissions,
        permissionMode: nextProfile.permissionMode,
        assignedProjectIds: nextProfile.assignedProjectIds,
        allProjectsAccess: nextProfile.allProjectsAccess,
        projectAccessScope: nextProfile.projectAccessScope,
        membershipStatus: nextProfile.membershipStatus
    };
    const existingData = profileDocument && profileDocument.data ? profileDocument.data : {};
    const hasChanges = Object.keys(userPatchFields).some(key => {
        const newVal = userPatchFields[key];
        const oldVal = existingData[key];
        if (Array.isArray(newVal) && Array.isArray(oldVal)) {
            return newVal.length !== oldVal.length || newVal.some((v, i) => v !== oldVal[i]);
        }
        if (newVal && typeof newVal === 'object' && oldVal && typeof oldVal === 'object') {
            return JSON.stringify(newVal) !== JSON.stringify(oldVal);
        }
        return newVal !== oldVal;
    });

    if (hasChanges) {
        await patchCollectionDocument('users', profileDocument.id || authUser.uid, {
            ...userPatchFields,
            updatedAt: nextProfile.updatedAt
        });
    }

    const result = {
        id: profileDocument.id || authUser.uid,
        ...nextProfile
    };

    // Store in cache so subsequent /api/me calls skip all DB operations.
    // BUT: do not cache an empty-assignment profile for a role that requires
    // assignments — that would pin the user to an empty dashboard until the
    // 5-minute TTL expires.  Letting the next /api/me call rebuild fresh is a
    // tiny cost and guarantees recovery as soon as assignments appear.
    const resultRole = AccessControl.normalizeRole(result.role || result.workspaceRole);
    const resultNeedsAssignments = resultRole === AccessControl.ROLES.CLIENT
        || resultRole === AccessControl.ROLES.DEVELOPER
        || resultRole === AccessControl.ROLES.DESIGNER;
    const resultAllAccess = result.allProjectsAccess === true || result.all_projects_access === true;
    const resultAssignedIds = Array.isArray(result.assignedProjectIds) ? result.assignedProjectIds : [];
    const shouldCache = !(resultNeedsAssignments && !resultAllAccess && resultAssignedIds.length === 0);
    if (shouldCache) {
        _setSessionCache(authUser, result);
    } else {
        console.warn('[SessionCache] Skipping cache write — empty assignments for role that requires them', {
            userId: authUser.uid,
            role: resultRole,
            workspaceId: String(result.workspaceId || '').trim()
        });
    }

    return result;
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
    hasInvitationMetadata,
    getWorkspaceId,
    resolveWorkspaceFromTeamMembership,
    getWorkspaceMemberDocumentId,
    getWorkspaceOwnerEmail,
    getWorkspaceOwnerUserId,
    invalidateSessionCache,
    loadUserProfileDocument,
    deactivateAllActiveAssignmentsForUser,
    resolveScopedAssignedProjectsForLogin
};
