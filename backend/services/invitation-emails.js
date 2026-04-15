const AccessControl = require('../../rbac.js');

const APP_NAME = 'Nexlance';

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function resolveProjectAccessType({ allProjectsAccess, projectNames }) {
    if (allProjectsAccess) return 'All projects in the workspace';
    if (Array.isArray(projectNames) && projectNames.length) return projectNames.join(', ');
    return 'Projects assigned to you';
}

function renderInvitationTemplate({ userName, ownerEmail, role, projectAccessType, inviteLink, appName }) {
    const safeName = escapeHtml(userName || 'there');
    const safeApp = escapeHtml(appName || APP_NAME);
    const safeOwner = escapeHtml(ownerEmail || 'your workspace owner');
    const safeRole = escapeHtml(role || 'Team member');
    const safeAccess = escapeHtml(projectAccessType || 'Projects assigned to you');
    const safeLink = escapeHtml(inviteLink || '');

    const html = `
        <div style="margin:0;padding:32px 16px;background:#f6f5ff;font-family:Arial,sans-serif;color:#2d1b69;">
            <div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:20px;padding:32px;border:1px solid rgba(108,92,231,0.12);box-shadow:0 20px 40px rgba(45,27,105,0.08);">
                <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#6c5ce7;">${safeApp}</p>
                <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;color:#2d1b69;">Hi ${safeName},</h1>
                <p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4f4b67;">You've been invited to join a workspace on <strong>${safeApp}</strong>.</p>
                <ul style="margin:0 0 20px;padding:0;list-style:none;font-size:15px;line-height:1.8;color:#2d1b69;">
                    <li>👤 <strong>Invited by:</strong> ${safeOwner}</li>
                    <li>🧑‍💻 <strong>Role assigned:</strong> ${safeRole}</li>
                    <li>📁 <strong>Access:</strong> ${safeAccess}</li>
                </ul>
                <p style="margin:0 0 12px;font-size:15px;color:#4f4b67;">Click below to accept your invitation and get started:</p>
                <div style="margin:20px 0;">
                    <a href="${safeLink}" style="display:inline-block;padding:14px 26px;border-radius:999px;background:#6c5ce7;color:#ffffff;text-decoration:none;font-weight:700;">👉 Accept Invitation</a>
                </div>
                <p style="margin:0 0 8px;font-size:15px;color:#4f4b67;"><strong>Once you accept:</strong></p>
                <ul style="margin:0 0 20px 20px;padding:0;font-size:15px;line-height:1.7;color:#4f4b67;">
                    <li>You'll get access to your assigned projects</li>
                    <li>You can start collaborating immediately</li>
                    <li>Your permissions will be automatically configured</li>
                </ul>
                <p style="margin:0 0 16px;font-size:14px;color:#6b7280;">⏳ <em>This invitation may expire, so please accept it soon.</em></p>
                <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">If the button does not work, open this secure link:</p>
                <p style="margin:0 0 20px;font-size:13px;word-break:break-all;"><a href="${safeLink}" style="color:#4b3fbf;text-decoration:none;">${safeLink}</a></p>
                <p style="margin:0 0 8px;font-size:13px;color:#8a869b;">If you did not expect this invitation, you can safely ignore this email.</p>
                <p style="margin:0;font-size:13px;color:#8a869b;">— Team ${safeApp}</p>
            </div>
        </div>
    `.trim();

    const text = [
        `Hi ${userName || 'there'},`,
        '',
        `You've been invited to join a workspace on ${appName || APP_NAME}.`,
        '',
        `Invited by: ${ownerEmail || 'your workspace owner'}`,
        `Role assigned: ${role || 'Team member'}`,
        `Access: ${projectAccessType || 'Projects assigned to you'}`,
        '',
        'Click below to accept your invitation and get started:',
        inviteLink || '',
        '',
        'Once you accept:',
        '- You\'ll get access to your assigned projects',
        '- You can start collaborating immediately',
        '- Your permissions will be automatically configured',
        '',
        'Note: This invitation may expire, so please accept it soon.',
        '',
        'If you did not expect this invitation, you can safely ignore this email.',
        '',
        `— Team ${appName || APP_NAME}`
    ].join('\n');

    return { html, text };
}

function buildClientInviteEmail({ inviteeName, workspaceName, inviteLink, projectNames, ownerEmail, allProjectsAccess, roleLabel }) {
    const role = roleLabel || AccessControl.getRoleDisplayLabel('client');
    const projectAccessType = resolveProjectAccessType({ allProjectsAccess, projectNames });
    const { html, text } = renderInvitationTemplate({
        userName: inviteeName,
        ownerEmail,
        role,
        projectAccessType,
        inviteLink,
        appName: APP_NAME
    });

    return {
        subject: `You've been invited to ${workspaceName || APP_NAME}`,
        html,
        text
    };
}

function buildTeamInviteEmail({ inviteeName, workspaceName, inviteLink, roleLabel, projectNames, ownerEmail, allProjectsAccess }) {
    const role = roleLabel || AccessControl.getRoleDisplayLabel('pm');
    const projectAccessType = resolveProjectAccessType({ allProjectsAccess, projectNames });
    const { html, text } = renderInvitationTemplate({
        userName: inviteeName,
        ownerEmail,
        role,
        projectAccessType,
        inviteLink,
        appName: APP_NAME
    });

    return {
        subject: `You've been invited to ${workspaceName || APP_NAME} as ${role}`,
        html,
        text
    };
}

module.exports = {
    buildClientInviteEmail,
    buildTeamInviteEmail
};
