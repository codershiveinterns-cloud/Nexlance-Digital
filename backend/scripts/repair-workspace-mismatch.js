/**
 * One-time migration: Repair corrupted workspace linkage.
 *
 * Background
 * ----------
 * Legacy accounts have a fully-consistent-but-wrong chain of workspace IDs:
 *
 *   users.workspaceId           = workspace_<uid>   (stale auto-generated)
 *   clients.workspace_id        = workspace_<uid>
 *   team_members.workspace_id   = workspace_<uid>
 *   project_assignments.workspace_id = workspace_<uid>
 *   projects/<id>.workspace_id  = <admin's real workspace>   ← truth
 *
 * Because every record agrees on the stale value, runtime self-heal cannot
 * detect a disagreement.  This script walks the chain starting from
 * projects/<id>.workspace_id (the source of truth) and rewrites every
 * downstream record to match.
 *
 * Strategy
 * --------
 * 1. Load all active project_assignments.
 * 2. For each, look up projects/<projectId>.workspace_id.  That's truth.
 * 3. Group assignments by user email.
 * 4. For each user:
 *      - Skip workspace owners (isWorkspaceOwner === true).
 *      - If all assignments point at a single TRUE workspace:
 *          a. Rewrite each project_assignments.workspace_id to truth.
 *          b. Rewrite users.workspaceId to truth.
 *          c. Rewrite matching clients/* and team_members/* to truth.
 *      - If assignments span multiple true workspaces, repair each
 *        assignment individually but leave user/clients/team_members
 *        alone (ambiguous — needs human review).
 *
 * Usage
 * -----
 *   node backend/scripts/repair-workspace-mismatch.js            # dry-run
 *   node backend/scripts/repair-workspace-mismatch.js --apply    # write changes
 *   node backend/scripts/repair-workspace-mismatch.js --email=user@example.com --apply
 */

const AccessControl = require('../../rbac.js');
const {
    findUserDocumentByEmail,
    getCollectionDocument,
    patchCollectionDocument,
    queryCollectionDocuments,
    queryCollectionDocumentsMulti
} = require('../services/firebase-service');

const APPLY = process.argv.includes('--apply');
const DRY_RUN = !APPLY;
const emailArg = process.argv.find(arg => arg.startsWith('--email='));
const SCOPED_EMAIL = emailArg ? AccessControl.normalizeEmail(emailArg.slice('--email='.length)) : '';

const projectWorkspaceCache = new Map();
async function resolveProjectWorkspace(projectId) {
    const pid = String(projectId || '').trim();
    if (!pid) return '';
    if (projectWorkspaceCache.has(pid)) return projectWorkspaceCache.get(pid);
    const doc = await getCollectionDocument('projects', pid).catch(() => null);
    const wsId = String(
        (doc && doc.data && (doc.data.workspace_id || doc.data.workspaceId)) || ''
    ).trim();
    projectWorkspaceCache.set(pid, wsId);
    return wsId;
}

function isNonEmptyDifferent(a, b) {
    return Boolean(a) && Boolean(b) && String(a).trim() !== String(b).trim();
}

async function loadAllActiveAssignments() {
    // active=true is the indexed flag written by the current pipeline.
    // Fall back to fetching everything and filtering if the indexed query fails.
    const indexed = await queryCollectionDocuments('project_assignments', {
        fieldPath: 'active',
        op: 'EQUAL',
        value: true,
        limit: 10000
    }).catch(() => []);
    if (Array.isArray(indexed) && indexed.length) return indexed;

    const all = await queryCollectionDocuments('project_assignments', {
        fieldPath: 'status',
        op: 'EQUAL',
        value: 'active',
        limit: 10000
    }).catch(() => []);
    return Array.isArray(all) ? all : [];
}

async function findRecordsByEmail(collectionId, email) {
    const normalizedEmail = AccessControl.normalizeEmail(email);
    if (!normalizedEmail) return [];
    const byEmail = await queryCollectionDocumentsMulti(collectionId, [
        { fieldPath: 'email', op: 'EQUAL', value: normalizedEmail }
    ], 100).catch(() => []);
    return Array.isArray(byEmail) ? byEmail : [];
}

function summarizeAssignment(record) {
    const data = record && record.data ? record.data : {};
    return {
        id: String(record && record.id || '').trim(),
        projectId: String(data.projectId || data.project_id || '').trim(),
        currentWorkspaceId: String(data.workspace_id || data.workspaceId || '').trim(),
        email: AccessControl.normalizeEmail(data.email || data.user_email),
        userId: String(data.userId || data.user_id || '').trim()
    };
}

async function patchAssignment(assignmentId, trueWorkspaceId) {
    if (DRY_RUN) return;
    await patchCollectionDocument('project_assignments', assignmentId, {
        workspaceId: trueWorkspaceId,
        workspace_id: trueWorkspaceId,
        updatedAt: new Date().toISOString(),
        updated_at: new Date().toISOString()
    }).catch(err => {
        console.warn(`  ! patch project_assignments/${assignmentId} failed:`, err && err.message);
    });
}

async function patchUserDoc(userDocId, trueWorkspaceId) {
    if (DRY_RUN) return;
    await patchCollectionDocument('users', userDocId, {
        workspaceId: trueWorkspaceId,
        updatedAt: new Date().toISOString()
    }).catch(err => {
        console.warn(`  ! patch users/${userDocId} failed:`, err && err.message);
    });
}

async function patchMembershipRecord(collectionId, recordId, trueWorkspaceId) {
    if (DRY_RUN) return;
    await patchCollectionDocument(collectionId, recordId, {
        workspace_id: trueWorkspaceId,
        workspaceId: trueWorkspaceId,
        updated_at: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    }).catch(err => {
        console.warn(`  ! patch ${collectionId}/${recordId} failed:`, err && err.message);
    });
}

async function main() {
    const mode = DRY_RUN ? 'DRY-RUN' : 'APPLY';
    console.info('\n[RepairMigration] ========== ' + mode + ' ==========');
    if (SCOPED_EMAIL) console.info('[RepairMigration] Scoped to email:', SCOPED_EMAIL);

    const assignments = await loadAllActiveAssignments();
    console.info(`[RepairMigration] Loaded ${assignments.length} active project_assignments`);

    // Group assignments by normalized email
    const byEmail = new Map();
    for (const record of assignments) {
        const summary = summarizeAssignment(record);
        if (!summary.email || !summary.projectId) continue;
        if (SCOPED_EMAIL && summary.email !== SCOPED_EMAIL) continue;
        if (!byEmail.has(summary.email)) byEmail.set(summary.email, []);
        byEmail.get(summary.email).push(summary);
    }

    const stats = {
        usersScanned: 0,
        ownersSkipped: 0,
        usersAlreadyHealthy: 0,
        usersRepairedCleanly: 0,
        usersWithAmbiguousWorkspaces: 0,
        orphanedAssignments: 0,
        assignmentsRepaired: 0,
        clientsRepaired: 0,
        teamMembersRepaired: 0,
        usersDocumentsRepaired: 0
    };

    for (const [email, userAssignments] of byEmail.entries()) {
        stats.usersScanned += 1;
        console.info(`\n[User] ${email}  (${userAssignments.length} assignment${userAssignments.length > 1 ? 's' : ''})`);

        // Resolve the true workspace per assignment
        const perAssignment = [];
        const trueWorkspaces = new Set();
        for (const assignment of userAssignments) {
            const trueWs = await resolveProjectWorkspace(assignment.projectId);
            if (!trueWs) {
                stats.orphanedAssignments += 1;
                console.warn(`  - assignment ${assignment.id} → project ${assignment.projectId} has no workspace (orphan / missing project doc)`);
                perAssignment.push({ ...assignment, trueWs: '' });
                continue;
            }
            perAssignment.push({ ...assignment, trueWs });
            trueWorkspaces.add(trueWs);
        }

        // Load the user doc (by email — the id is usually the uid)
        const userDoc = await findUserDocumentByEmail(email).catch(() => null);
        const userProfile = userDoc && userDoc.data ? userDoc.data : null;
        const userDocId = userDoc && userDoc.id ? userDoc.id : '';
        const userIsWorkspaceOwner = Boolean(userProfile && (
            userProfile.isWorkspaceOwner === true
            || userProfile.workspaceOwner === true
            || userProfile.owner === true
            || String(userProfile.role || '').trim().toLowerCase() === 'owner'
        ));
        const currentUserWorkspaceId = userProfile ? String(userProfile.workspaceId || '').trim() : '';

        if (userIsWorkspaceOwner) {
            stats.ownersSkipped += 1;
            console.info('  · user is a workspace owner — skipping');
            continue;
        }

        if (trueWorkspaces.size === 0) {
            console.warn('  · no true workspace resolvable for any assignment — nothing to do');
            continue;
        }

        // Always repair per-assignment drift (even if the user doc is ambiguous).
        for (const entry of perAssignment) {
            if (!entry.trueWs) continue;
            if (isNonEmptyDifferent(entry.currentWorkspaceId, entry.trueWs)) {
                console.info(`  → project_assignments/${entry.id}: ${entry.currentWorkspaceId || '(empty)'} → ${entry.trueWs}`);
                await patchAssignment(entry.id, entry.trueWs);
                stats.assignmentsRepaired += 1;
            }
        }

        if (trueWorkspaces.size > 1) {
            stats.usersWithAmbiguousWorkspaces += 1;
            console.warn(`  · assignments span multiple workspaces ${JSON.stringify(Array.from(trueWorkspaces))} — leaving users/clients/team_members alone`);
            continue;
        }

        // Unambiguous — we have one true workspace for this user.
        const trueWorkspaceId = Array.from(trueWorkspaces)[0];
        const assignmentsAlreadyHealthy = perAssignment.every(entry => !entry.trueWs || entry.currentWorkspaceId === entry.trueWs);
        const userDocHealthy = currentUserWorkspaceId === trueWorkspaceId;

        // Repair users.workspaceId if needed
        if (userDocId && isNonEmptyDifferent(currentUserWorkspaceId, trueWorkspaceId)) {
            console.info(`  → users/${userDocId}.workspaceId: ${currentUserWorkspaceId || '(empty)'} → ${trueWorkspaceId}`);
            await patchUserDoc(userDocId, trueWorkspaceId);
            stats.usersDocumentsRepaired += 1;
        }

        // Repair clients records
        const clientRecords = await findRecordsByEmail('clients', email);
        for (const record of clientRecords) {
            const data = record.data || {};
            const currentWs = String(data.workspace_id || data.workspaceId || '').trim();
            if (isNonEmptyDifferent(currentWs, trueWorkspaceId)) {
                console.info(`  → clients/${record.id}.workspace_id: ${currentWs || '(empty)'} → ${trueWorkspaceId}`);
                await patchMembershipRecord('clients', record.id, trueWorkspaceId);
                stats.clientsRepaired += 1;
            }
        }

        // Repair team_members records
        const teamRecords = await findRecordsByEmail('team_members', email);
        for (const record of teamRecords) {
            const data = record.data || {};
            const currentWs = String(data.workspace_id || data.workspaceId || '').trim();
            if (isNonEmptyDifferent(currentWs, trueWorkspaceId)) {
                console.info(`  → team_members/${record.id}.workspace_id: ${currentWs || '(empty)'} → ${trueWorkspaceId}`);
                await patchMembershipRecord('team_members', record.id, trueWorkspaceId);
                stats.teamMembersRepaired += 1;
            }
        }

        if (assignmentsAlreadyHealthy && userDocHealthy) {
            stats.usersAlreadyHealthy += 1;
            console.info('  · already healthy');
        } else {
            stats.usersRepairedCleanly += 1;
        }
    }

    console.info('\n[RepairMigration] ========== SUMMARY (' + mode + ') ==========');
    console.info(JSON.stringify(stats, null, 2));
    if (DRY_RUN) {
        console.info('\nNo changes written.  Re-run with --apply to execute.\n');
    } else {
        console.info('\nChanges applied.  Users affected should reload their dashboard.\n');
    }
}

main()
    .then(() => process.exit(0))
    .catch(err => {
        console.error('[RepairMigration] FAILED:', err);
        process.exit(1);
    });
