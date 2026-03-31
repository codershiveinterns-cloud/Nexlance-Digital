const { createCollectionDocument } = require('./firebase-service');

async function logAuditEvent(eventType, options = {}) {
    const now = new Date().toISOString();
    try {
        return await createCollectionDocument('audit_logs', {
            eventType: String(eventType || '').trim(),
            workspaceId: String(options.workspaceId || '').trim(),
            actorUserId: String(options.actorUserId || '').trim(),
            actorEmail: String(options.actorEmail || '').trim().toLowerCase(),
            targetUserId: String(options.targetUserId || '').trim(),
            targetEmail: String(options.targetEmail || '').trim().toLowerCase(),
            targetId: String(options.targetId || '').trim(),
            message: String(options.message || '').trim(),
            metadata: options.metadata && typeof options.metadata === 'object' ? options.metadata : {},
            createdAt: now,
            updatedAt: now
        });
    } catch (error) {
        return null;
    }
}

module.exports = {
    logAuditEvent
};
