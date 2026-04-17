/**
 * One-time recovery: Reactivate project_assignments that were deactivated
 * by the old `deactivateExistingProjectAssignments()` bug during
 * `acceptInvitation()`.
 *
 * The bug flow was:
 *   1. Admin assigned projects → active records created
 *   2. User accepted invitation → transaction merged records correctly
 *   3. Immediately after the transaction, deactivateExistingProjectAssignments()
 *      ran and marked ALL records status=inactive, active=false with
 *      deactivatedReason='invitation_accept_resync'
 *   4. User sees an empty dashboard because the filter only includes active records
 *
 * This script:
 *   1. Finds all project_assignments where active=false AND the deactivation
 *      reason matches the bug signature.
 *   2. Re-activates them: status='active', active=true, clears deactivation metadata.
 *   3. Writes a 'recoveredAt' and 'recoveredReason' field so we have an audit trail.
 *   4. Uses batched writes (chunked for Firestore's 500-op limit).
 *
 * Usage:
 *   node backend/scripts/reactivate-bug-deactivated-assignments.js [--dry-run]
 *
 * Safety:
 *   - Only touches records that match BOTH filters (active=false AND bug reason).
 *   - Records deactivated for legitimate reasons (workspace_mismatch,
 *     project_workspace_mismatch, not_in_requested_scope, replaced_by_new_assignment,
 *     duplicate_active_assignment, duplicate_consolidated) are NOT touched.
 *   - Idempotent: running it twice has no additional effect once records are active.
 *   - Reversible: the recoveredReason field identifies which records were touched.
 */

const {
    commitBatchedWrites,
    queryCollectionDocuments
} = require('../services/firebase-service');

const DRY_RUN = process.argv.includes('--dry-run');

// Only these reason codes identify records damaged by the bug.  Do NOT add
// legitimate deactivation reasons here or valid rejections will be reactivated.
const BUG_REASONS = new Set([
    'invitation_accept_resync',
    'assignment_resync'
]);

async function main() {
    console.info('[Recovery] Reactivating bug-deactivated project_assignments' + (DRY_RUN ? ' (DRY RUN)' : ''));

    // Fetch all inactive assignments.  We filter by the reason in-memory because
    // Firestore cannot do an OR on field values efficiently without composite indexes.
    const inactiveAssignments = await queryCollectionDocuments('project_assignments', {
        fieldPath: 'active',
        op: 'EQUAL',
        value: false,
        limit: 10000
    }).catch(err => {
        console.error('[Recovery] Failed to query inactive assignments', err);
        return [];
    });

    console.info(`[Recovery] Loaded ${inactiveAssignments.length} inactive assignments`);

    const reactivateOps = [];
    const skippedByReason = new Map();

    for (const record of inactiveAssignments) {
        const data = record && record.data ? record.data : {};
        const reason = String(
            data.deactivatedReason
            || data.mismatchReason
            || ''
        ).trim();

        if (!BUG_REASONS.has(reason)) {
            skippedByReason.set(reason || '(no reason)', (skippedByReason.get(reason || '(no reason)') || 0) + 1);
            continue;
        }

        reactivateOps.push({
            collectionId: 'project_assignments',
            docId: record.id,
            data: {
                status: 'active',
                active: true,
                // Clear deactivation metadata — use empty strings rather than
                // null because Firestore merge does not unset null fields.
                deactivatedReason: '',
                mismatchReason: '',
                expectedWorkspaceId: '',
                actualWorkspaceId: '',
                // Audit trail so we can identify recovered records later.
                recoveredAt: new Date().toISOString(),
                recoveredReason: 'bug_fix_invitation_accept_resync_deactivation',
                updatedAt: new Date().toISOString(),
                updated_at: new Date().toISOString()
            }
        });
    }

    console.info(`[Recovery] Matched ${reactivateOps.length} records for reactivation`);
    if (skippedByReason.size > 0) {
        console.info('[Recovery] Skipped records by reason (left untouched):');
        for (const [reason, count] of skippedByReason.entries()) {
            console.info(`  - ${reason}: ${count}`);
        }
    }

    if (!reactivateOps.length) {
        console.info('[Recovery] Nothing to do.');
        return;
    }

    if (DRY_RUN) {
        console.info(`[Recovery] DRY RUN — would reactivate ${reactivateOps.length} records.`);
        console.info('[Recovery] Sample of first 5 records that would be reactivated:');
        reactivateOps.slice(0, 5).forEach(op => {
            console.info(`  - ${op.docId}`);
        });
        return;
    }

    // Chunk to respect Firestore's 500-op batch limit.
    const CHUNK_SIZE = 450;
    let totalWritten = 0;
    for (let i = 0; i < reactivateOps.length; i += CHUNK_SIZE) {
        const chunk = reactivateOps.slice(i, i + CHUNK_SIZE);
        await commitBatchedWrites(chunk);
        totalWritten += chunk.length;
        console.info(`[Recovery] Reactivated batch ${Math.floor(i / CHUNK_SIZE) + 1}/${Math.ceil(reactivateOps.length / CHUNK_SIZE)} (${chunk.length} records, ${totalWritten}/${reactivateOps.length} total)`);
    }

    console.info(`[Recovery] Done. Reactivated ${totalWritten} project_assignments.`);
}

main().catch(err => {
    console.error('[Recovery] Fatal error:', err);
    process.exit(1);
});
