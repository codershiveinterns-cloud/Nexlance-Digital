document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    const workspaceMode = params.get('workspace') === '1';
    const projectId = params.get('project') || '';

    if (!workspaceMode || !projectId) {
        return;
    }

    const parentWorkspace = window.parent && window.parent.NexlanceProjectWorkspace
        ? window.parent.NexlanceProjectWorkspace
        : null;

    if (!parentWorkspace) {
        console.warn('Template workspace parent API is unavailable.');
        return;
    }

    const templatePage = window.location.pathname.split('/').pop() || '';
    const templateConfig = typeof window.getTemplateConfigByPage === 'function'
        ? window.getTemplateConfigByPage(templatePage)
        : null;
    const templateName = templateConfig ? templateConfig.name : document.title.replace('Template', '').trim();

    let isEditMode = false;
    let editableElements = [];

    function ensureStyles() {
        if (document.getElementById('templateWorkspaceStyles')) return;

        const style = document.createElement('style');
        style.id = 'templateWorkspaceStyles';
        style.textContent = `
            .template-workspace-editable {
                transition: outline 0.2s ease, background-color 0.2s ease;
            }

            .template-workspace-editing .template-workspace-editable {
                outline: 2px dashed rgba(79, 70, 229, 0.65);
                outline-offset: 3px;
                cursor: text;
            }

            .template-workspace-editing .template-workspace-editable[contenteditable="true"] {
                background: rgba(79, 70, 229, 0.08);
                border-radius: 6px;
            }
        `;
        document.head.appendChild(style);
    }

    function getEditableCandidates() {
        return Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, li, a, button, label'))
            .filter(element => {
                if (!element.textContent.trim()) return false;
                if (element.closest('script, style')) return false;
                return true;
            });
    }

    function assignEditableKeys() {
        editableElements = getEditableCandidates();
        editableElements.forEach((element, index) => {
            element.dataset.templateEditKey = String(index);
            element.classList.add('template-workspace-editable');
            element.contentEditable = 'false';
            element.spellcheck = false;
            element.addEventListener('input', () => {
                parentWorkspace.setDirtyState(true);
            });
        });
    }

    function restoreSavedState() {
        const savedState = parentWorkspace.getProjectState(projectId);
        if (!savedState || !Array.isArray(savedState.elements)) return;

        savedState.elements.forEach(item => {
            const element = document.querySelector(`[data-template-edit-key="${item.key}"]`);
            if (element) {
                element.innerHTML = item.html;
            }
        });

        parentWorkspace.setDirtyState(false);
    }

    function setAllEditable(active) {
        document.body.classList.toggle('template-workspace-editing', active);
        editableElements.forEach(element => {
            element.contentEditable = active ? 'true' : 'false';
        });
    }

    function serializeState() {
        return {
            templateId: templateConfig ? templateConfig.id : templatePage.replace('.html', ''),
            templatePage,
            templateName,
            savedAt: new Date().toISOString(),
            elements: editableElements.map(element => ({
                key: element.dataset.templateEditKey,
                html: element.innerHTML
            }))
        };
    }

    function buildDownloadHtml() {
        const clone = document.documentElement.cloneNode(true);

        clone.querySelectorAll('[contenteditable]').forEach(element => element.removeAttribute('contenteditable'));
        clone.querySelectorAll('.template-workspace-editable').forEach(element => element.classList.remove('template-workspace-editable'));
        clone.querySelectorAll('#templateWorkspaceStyles').forEach(element => element.remove());

        clone.querySelectorAll('link[href], script[src], img[src], source[src]').forEach(element => {
            const attr = element.tagName.toLowerCase() === 'link' ? 'href' : 'src';
            const value = element.getAttribute(attr);
            if (!value || value.startsWith('data:') || value.startsWith('http')) return;
            try {
                element.setAttribute(attr, new URL(value, window.location.href).href);
            } catch (error) {
                console.warn('Could not normalize asset URL:', value, error);
            }
        });

        return `<!DOCTYPE html>\n${clone.outerHTML}`;
    }

    async function saveChanges(options = {}) {
        const state = serializeState();
        if (options.completed) {
            await parentWorkspace.completeProjectTemplate(projectId, state);
        } else {
            await parentWorkspace.saveProjectTemplateState(projectId, state);
        }
        parentWorkspace.setDirtyState(false);
    }

    document.addEventListener('click', event => {
        if (!isEditMode) return;
        const interactive = event.target.closest('a, button');
        if (interactive) {
            event.preventDefault();
            event.stopPropagation();
        }
    }, true);

    window.enterTemplateWorkspaceEditMode = function enterTemplateWorkspaceEditMode() {
        isEditMode = true;
        setAllEditable(true);
    };

    window.saveTemplateWorkspaceChanges = async function saveTemplateWorkspaceChanges() {
        await saveChanges({ completed: false });
        isEditMode = false;
        setAllEditable(false);
    };

    window.completeTemplateWorkspaceProject = async function completeTemplateWorkspaceProject() {
        await saveChanges({ completed: true });
        isEditMode = false;
        setAllEditable(false);
    };

    window.downloadTemplateWorkspaceOutput = async function downloadTemplateWorkspaceOutput() {
        if (isEditMode) {
            await window.saveTemplateWorkspaceChanges();
        }

        await parentWorkspace.downloadProjectTemplate(projectId, {
            html: buildDownloadHtml(),
            templateId: templateConfig ? templateConfig.id : templatePage.replace('.html', ''),
            templateName
        });
    };

    ensureStyles();
    assignEditableKeys();
    restoreSavedState();
});
