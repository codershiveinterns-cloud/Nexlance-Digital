/**
 * One-time migration: Deduplicate project_assignments collection.
 *
 * Duplicates arise when the same user+project has records keyed by both
 * email and user_id.  This script:
 *   1. Groups all active assignments by (workspace_id, project_id, email).
 *   2. Within each group, keeps the best record (prefers one with user_id,
 *      then most-recently updated).
 *   3. Deactivates the remaining duplicates.
 *
 * Usage:
 *   node backend/scripts/deduplicate-project-assignments.js [--dry-run]
 *
 * With --dry-run it only logs what it would do without writing anything.
 */

const {
    commitBatchedWrites,
    queryCollectionDocuments
} = require('../services/firebase-service');
const AccessControl = require('../../rbac.js');

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
    console.info('[Migration] Deduplicating project_assignments' + (DRY_RUN ? ' (DRY RUN)' : ''));

    // Fetch all active assignments
    const allAssignments = await queryCollectionDocuments('project_assignments', {
        fieldPath: 'active',
        op: 'EQUAL',
        value: true,
        limit: 10000
    }).catch(() => []);

    console.info(`[Migration] Loaded ${allAssignments.length} active assignments`);

    // Group by (workspace_id, project_id, normalized_email)
    const groups = new Map();
    for (const record of allAssignments) {
        const data = record && record.data ? record.data : {};
        const workspaceId = String(data.workspace_id || data.workspaceId || '').trim();
        const projectId = String(data.project_id || data.projectId || '').trim();
        const email = AccessControl.normalizeEmail(data.email || data.user_email || '');
        if (!workspaceId || !projectId || !email) continue;

        const key = `${workspaceId}::${projectId}::${email}`;
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key).push({
            id: record.id,
            data
        });
    }

    const deactivateOps = [];
    let duplicateCount = 0;

    for (const [key, records] of groups.entries()) {
        if (records.length <= 1) continue;

        // Sort: prefer record with user_id, then most recent
        const sorted = records.slice().sort((a, b) => {
            const aHasUser = String(a.data.userId || a.data.user_id || '').trim() ? 1 : 0;
            const bHasUser = String(b.data.userId || b.data.user_id || '').trim() ? 1 : 0;
            if (bHasUser !== aHasUser) return bHasUser - aHasUser;
            const aTime = new Date(a.data.updatedAt || a.data.updated_at || a.data.createdAt || a.data.created_at || '').getTime() || 0;
            const bTime = new Date(b.data.updatedAt || b.data.updated_at || b.data.createdAt || b.data.created_at || '').getTime() || 0;
            return bTime - aTime;
        });

        const keep = sorted[0];
        const duplicates = sorted.slice(1);
        duplicateCount += duplicates.length;

        console.info(`[Migration] Group ${key}: keeping ${keep.id}, deactivating ${duplicates.length} duplicate(s)`);

        for (const dup of duplicates) {
            deactivateOps.push({
                collectionId: 'project_assignments',
                docId: dup.id,
                data: {
                    status: 'inactive',
                    active: false,
                    mismatchReason: 'migration_duplicate_consolidated',
                    updatedAt: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }
            });
        }
    }

    console.info(`[Migration] Found ${duplicateCount} duplicates across ${groups.size} groups`);

    if (!DRY_RUN && deactivateOps.length) {
        // Firestore batch limit is 500, chunk if needed
        const CHUNK_SIZE = 450;
        for (let i = 0; i < deactivateOps.length; i += CHUNK_SIZE) {
            const chunk = deactivateOps.slice(i, i + CHUNK_SIZE);
            await commitBatchedWrites(chunk);
            console.info(`[Migration] Deactivated batch ${Math.floor(i / CHUNK_SIZE) + 1} (${chunk.length} records)`);
        }
        console.info(`[Migration] Done. Deactivated ${deactivateOps.length} duplicate assignments.`);
    } else if (DRY_RUN) {
        console.info(`[Migration] DRY RUN complete. Would deactivate ${deactivateOps.length} records.`);
    } else {
        console.info('[Migration] No duplicates found. Nothing to do.');
    }
}

main().catch(err => {
    console.error('[Migration] Fatal error:', err);
    process.exit(1);
});
