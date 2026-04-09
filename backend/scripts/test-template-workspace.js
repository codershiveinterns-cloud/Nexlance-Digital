const assert = require('assert');
const AccessControl = require('../../rbac.js');
const {
    buildTemplateWorkspaceCompletePatch,
    buildTemplateWorkspaceSavePatch,
    buildTemplateWorkspaceUnlockPatch,
    isTemplateWorkspaceProjectPatch,
    resolveTemplateWorkspaceCapabilities
} = require('../services/template-workspace');

function createSessionUser(overrides = {}) {
    return {
        uid: 'user-1',
        email: 'member@example.com',
        role: 'developer',
        workspaceRole: 'developer',
        workspaceId: 'workspace-1',
        workspaceOwnerEmail: 'owner@example.com',
        assignedProjectIds: ['project-1'],
        allProjectsAccess: false,
        isWorkspaceOwner: false,
        ...overrides
    };
}

function createProject(overrides = {}) {
    return {
        id: 'project-1',
        owner_key: 'owner@example.com',
        owner_email: 'owner@example.com',
        workspace_id: 'workspace-1',
        template_id: 'fashion-store-template',
        template_name: 'Fashion Store',
        template_page: 'fashion-store-template.html',
        status: 'Development',
        progress: 50,
        template_workflow_status: 'in_progress',
        template_last_saved_at: '2026-04-03T10:00:00.000Z',
        template_saved_html: '<!DOCTYPE html><html><body>saved</body></html>',
        template_completed_at: '',
        template_download_paid: false,
        ...overrides
    };
}

function createContext(sessionUserOverrides = {}, projectOverrides = {}) {
    const sessionUser = createSessionUser(sessionUserOverrides);
    const project = createProject(projectOverrides);
    return {
        projectId: project.id,
        session: { sessionUser },
        project,
        capabilities: resolveTemplateWorkspaceCapabilities(sessionUser, project, project.id)
    };
}

function expectThrows(fn, expectedMessagePart) {
    let threw = false;
    try {
        fn();
    } catch (error) {
        threw = true;
        assert(
            String(error.message || '').toLowerCase().includes(String(expectedMessagePart || '').toLowerCase()),
            `Expected error message to include "${expectedMessagePart}", got "${error.message}"`
        );
    }
    assert(threw, 'Expected function to throw.');
}

function testClientViewOnly() {
    const capabilities = AccessControl.getTemplateWorkspaceRoleCapabilities({ role: 'client', workspaceRole: 'client' });
    assert.strictEqual(capabilities.view_template_workspace, true);
    assert.strictEqual(capabilities.edit_template, false);
    assert.strictEqual(capabilities.save_template, false);
    assert.strictEqual(capabilities.complete_template_project, false);
    assert.strictEqual(capabilities.download_template_output, false);

    const context = createContext({ role: 'client', workspaceRole: 'client' });
    expectThrows(() => buildTemplateWorkspaceSavePatch(context, {
        projectId: 'project-1',
        templateState: { elements: [] },
        renderedHtml: '<html></html>'
    }), 'permission');
    expectThrows(() => buildTemplateWorkspaceCompletePatch(context, {
        projectId: 'project-1',
        hasUnsavedChanges: false
    }), 'permission');
    expectThrows(() => buildTemplateWorkspaceUnlockPatch(context, {
        projectId: 'project-1',
        providerPaymentId: 'pay_123'
    }), 'permission');
}

function testTeamMemberCapabilitiesAndSavePath() {
    const context = createContext({ role: 'developer', workspaceRole: 'developer' });
    assert.strictEqual(context.capabilities.view_template_workspace, true);
    assert.strictEqual(context.capabilities.edit_template, true);
    assert.strictEqual(context.capabilities.save_template, true);
    assert.strictEqual(context.capabilities.complete_template_project, false);
    assert.strictEqual(context.capabilities.download_template_output, false);

    // Developers now have project management rights, but template completion/download
    // remains separately capability-gated.
    assert.strictEqual(AccessControl.canManageProjects(context.session.sessionUser), true);

    const patch = buildTemplateWorkspaceSavePatch(context, {
        projectId: 'project-1',
        templateState: {
            templateId: 'fashion-store-template',
            templatePage: 'fashion-store-template.html',
            templateName: 'Fashion Store',
            elements: [{ key: 'headline', kind: 'content', html: 'Updated copy', attrs: {} }]
        },
        renderedHtml: '<!DOCTYPE html><html><body>Updated</body></html>'
    });
    assert.strictEqual(typeof patch.template_last_saved_at, 'string');
    assert.strictEqual(patch.template_workflow_status, 'in_progress');
    assert.strictEqual(patch.status, 'Development');
}

function testTeamMemberCannotCompleteOrUnlock() {
    const context = createContext({ role: 'developer', workspaceRole: 'developer' });
    expectThrows(() => buildTemplateWorkspaceCompletePatch(context, {
        projectId: 'project-1',
        hasUnsavedChanges: false
    }), 'permission');
    expectThrows(() => buildTemplateWorkspaceUnlockPatch(context, {
        projectId: 'project-1',
        providerPaymentId: 'pay_123'
    }), 'permission');
}

function testAdminCanDoEverything() {
    const capabilities = AccessControl.getTemplateWorkspaceRoleCapabilities({
        role: 'admin',
        workspaceRole: 'admin',
        isWorkspaceOwner: true,
        email: 'owner@example.com',
        workspaceOwnerEmail: 'owner@example.com'
    });
    assert.strictEqual(capabilities.view_template_workspace, true);
    assert.strictEqual(capabilities.edit_template, true);
    assert.strictEqual(capabilities.save_template, true);
    assert.strictEqual(capabilities.complete_template_project, true);
    assert.strictEqual(capabilities.download_template_output, true);
    assert.strictEqual(capabilities.admin_override, true);
}

function testPatchClassificationIgnoresMetadata() {
    assert.strictEqual(isTemplateWorkspaceProjectPatch({
        owner_key: 'owner@example.com',
        owner_email: 'owner@example.com',
        updated_at: '2026-04-03T11:00:00.000Z',
        template_state: { elements: [] },
        template_last_saved_at: '2026-04-03T11:00:00.000Z',
        template_saved_html: '<html></html>',
        template_workflow_status: 'in_progress',
        status: 'Development',
        progress: 50
    }), true);
}

function testCompleteBlockedWhenDirty() {
    const context = createContext({ role: 'admin', workspaceRole: 'admin' });
    expectThrows(() => buildTemplateWorkspaceCompletePatch(context, {
        projectId: 'project-1',
        hasUnsavedChanges: true
    }), 'save changes');
}

function testDownloadBlockedBeforeCompletion() {
    const context = createContext({ role: 'admin', workspaceRole: 'admin' }, {
        template_workflow_status: 'in_progress',
        template_download_paid: false
    });
    expectThrows(() => buildTemplateWorkspaceUnlockPatch(context, {
        projectId: 'project-1',
        providerPaymentId: 'pay_123'
    }), 'complete the project');
}

function testCompleteAndUnlockHappyPath() {
    const completeContext = createContext({ role: 'admin', workspaceRole: 'admin' }, {
        template_workflow_status: 'in_progress',
        template_last_saved_at: '2026-04-03T10:00:00.000Z',
        template_saved_html: '<!DOCTYPE html><html><body>saved</body></html>'
    });
    const completePatch = buildTemplateWorkspaceCompletePatch(completeContext, {
        projectId: 'project-1',
        expectedLastSavedAt: '2026-04-03T10:00:00.000Z',
        hasUnsavedChanges: false
    });
    assert.strictEqual(completePatch.template_workflow_status, 'completed');
    assert.strictEqual(completePatch.progress, 100);

    const unlockContext = createContext({ role: 'admin', workspaceRole: 'admin' }, {
        template_workflow_status: 'completed',
        template_download_paid: false
    });
    const unlockPatch = buildTemplateWorkspaceUnlockPatch(unlockContext, {
        projectId: 'project-1',
        providerPaymentId: 'pay_123',
        amount: 199,
        hasUnsavedChanges: false
    });
    assert.strictEqual(unlockPatch.template_download_paid, true);
    assert.strictEqual(unlockPatch.template_download_payment_intent_id, 'pay_123');
}

function main() {
    testClientViewOnly();
    testTeamMemberCapabilitiesAndSavePath();
    testTeamMemberCannotCompleteOrUnlock();
    testAdminCanDoEverything();
    testPatchClassificationIgnoresMetadata();
    testCompleteBlockedWhenDirty();
    testDownloadBlockedBeforeCompletion();
    testCompleteAndUnlockHappyPath();
    console.log('Template workspace regression checks passed.');
}

main();
