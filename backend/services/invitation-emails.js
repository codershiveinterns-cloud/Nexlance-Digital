const AccessControl = require('../../rbac.js');

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderEmailShell({ heading, bodyHtml, ctaLabel, ctaUrl, footerCopy }) {
    return `
        <div style="margin:0;padding:32px 16px;background:#f6f5ff;font-family:Arial,sans-serif;color:#2d1b69;">
            <div style="max-width:620px;margin:0 auto;background:#ffffff;border-radius:20px;padding:32px;border:1px solid rgba(108,92,231,0.12);box-shadow:0 20px 40px rgba(45,27,105,0.08);">
                <p style="margin:0 0 8px;font-size:13px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#6c5ce7;">Nexlance</p>
                <h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;color:#2d1b69;">${heading}</h1>
                <div style="font-size:15px;line-height:1.7;color:#4f4b67;">${bodyHtml}</div>
                <div style="margin:28px 0;">
                    <a href="${escapeHtml(ctaUrl)}" style="display:inline-block;padding:14px 24px;border-radius:999px;background:#6c5ce7;color:#ffffff;text-decoration:none;font-weight:700;">${escapeHtml(ctaLabel)}</a>
                </div>
                <p style="margin:0 0 8px;font-size:13px;color:#6b7280;">If the button does not work, open this secure link:</p>
                <p style="margin:0 0 20px;font-size:13px;word-break:break-all;"><a href="${escapeHtml(ctaUrl)}" style="color:#4b3fbf;text-decoration:none;">${escapeHtml(ctaUrl)}</a></p>
                <p style="margin:0;font-size:13px;color:#8a869b;">${footerCopy}</p>
            </div>
        </div>
    `.trim();
}

function buildClientInviteEmail({ inviteeName, workspaceName, inviteLink, projectNames }) {
    const safeName = escapeHtml(inviteeName || 'there');
    const safeWorkspaceName = escapeHtml(workspaceName || 'your workspace');
    const projectsMarkup = projectNames && projectNames.length
        ? `<p style="margin:0 0 16px;">Assigned projects: <strong>${escapeHtml(projectNames.join(', '))}</strong></p>`
        : '<p style="margin:0 0 16px;">Your access is limited to the project area assigned to you inside the workspace.</p>';

    const html = renderEmailShell({
        heading: 'Project Access Invitation',
        bodyHtml: `
            <p style="margin:0 0 16px;">Hi ${safeName},</p>
            <p style="margin:0 0 16px;">You have been granted client access to <strong>${safeWorkspaceName}</strong>.</p>
            ${projectsMarkup}
            <p style="margin:0 0 16px;">After accepting this secure invitation, you will only be able to access your allowed project area, plus Settings, Support Info, and Sign out.</p>
        `,
        ctaLabel: 'Accept Invitation',
        ctaUrl: inviteLink,
        footerCopy: 'This secure link expires automatically and can only be used once.'
    });

    return {
        subject: `You have been granted project access to ${workspaceName || 'Nexlance'}`,
        html,
        text: `Hi ${inviteeName || 'there'}, you have been granted client access to ${workspaceName || 'your workspace'}. Use this secure link to accept your invitation: ${inviteLink}`
    };
}

function buildTeamInviteEmail({ inviteeName, workspaceName, inviteLink, roleLabel, projectNames }) {
    const safeName = escapeHtml(inviteeName || 'there');
    const safeWorkspaceName = escapeHtml(workspaceName || 'your workspace');
    const safeRole = escapeHtml(roleLabel || AccessControl.getRoleDisplayLabel('pm'));
    const assignmentMarkup = projectNames && projectNames.length
        ? `<p style="margin:0 0 16px;">Assigned projects: <strong>${escapeHtml(projectNames.join(', '))}</strong></p>`
        : '<p style="margin:0 0 16px;">Any project assignments attached to your role will appear after you join.</p>';

    const html = renderEmailShell({
        heading: 'Team Invitation',
        bodyHtml: `
            <p style="margin:0 0 16px;">Hi ${safeName},</p>
            <p style="margin:0 0 16px;">You have been added to <strong>${safeWorkspaceName}</strong> as a <strong>${safeRole}</strong>.</p>
            ${assignmentMarkup}
            <p style="margin:0 0 16px;">Use the secure link below to join the workspace and access only the modules allowed for your role.</p>
        `,
        ctaLabel: 'Join Workspace',
        ctaUrl: inviteLink,
        footerCopy: 'This secure invitation expires automatically and cannot be reused after acceptance.'
    });

    return {
        subject: `You were added to ${workspaceName || 'Nexlance'} as ${roleLabel || 'a team member'}`,
        html,
        text: `Hi ${inviteeName || 'there'}, you were added to ${workspaceName || 'your workspace'} as ${roleLabel || 'a team member'}. Accept your secure invitation here: ${inviteLink}`
    };
}

module.exports = {
    buildClientInviteEmail,
    buildTeamInviteEmail
};
