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
    let isDirty = false;
    let editableElements = [];
    let editableImages = [];
    let imagePicker = null;
    let pendingImageElement = null;

    function markDirty(dirty) {
        isDirty = Boolean(dirty);
        parentWorkspace.setDirtyState(isDirty);
    }

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

            .template-workspace-editable-image {
                transition: outline 0.2s ease, transform 0.2s ease;
            }

            .template-workspace-editing .template-workspace-editable-image {
                outline: 2px dashed rgba(79, 70, 229, 0.65);
                outline-offset: 4px;
                cursor: pointer;
            }
        `;
        document.head.appendChild(style);
    }

    function getEditableCandidates() {
        return Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, span, li, a, button, label, strong, small, blockquote'))
            .filter(element => {
                if (!element.textContent.trim()) return false;
                if (element.closest('script, style')) return false;
                return true;
            });
    }

    function getEditableImageCandidates() {
        return Array.from(document.querySelectorAll('img'))
            .filter(element => {
                if (!element.getAttribute('src')) return false;
                if (element.closest('script, style')) return false;
                return true;
            });
    }

    function ensureImagePicker() {
        if (imagePicker) return imagePicker;

        imagePicker = document.createElement('input');
        imagePicker.type = 'file';
        imagePicker.accept = 'image/*';
        imagePicker.id = 'templateWorkspaceImagePicker';
        imagePicker.hidden = true;
        imagePicker.addEventListener('change', event => {
            const file = event.target.files && event.target.files[0];
            if (!file || !pendingImageElement) return;

            const reader = new FileReader();
            reader.onload = loadEvent => {
                pendingImageElement.setAttribute('src', String(loadEvent.target && loadEvent.target.result ? loadEvent.target.result : ''));
                pendingImageElement.setAttribute('data-template-image-updated', '1');
                markDirty(true);
                pendingImageElement = null;
                imagePicker.value = '';
            };
            reader.readAsDataURL(file);
        });
        document.body.appendChild(imagePicker);
        return imagePicker;
    }

    function assignEditableKeys() {
        editableElements = getEditableCandidates();
        editableElements.forEach((element, index) => {
            element.dataset.templateEditKey = String(index);
            element.classList.add('template-workspace-editable');
            element.contentEditable = 'false';
            element.spellcheck = false;
            element.addEventListener('input', () => {
                if (element.classList.contains('counter')) {
                    const numericValue = String(element.textContent || '').replace(/[^\d.-]/g, '').trim();
                    if (numericValue) {
                        element.setAttribute('data-target', numericValue);
                    }
                }
                markDirty(true);
            });
        });

        editableImages = getEditableImageCandidates();
        editableImages.forEach((element, index) => {
            element.dataset.templateEditKey = `image-${index}`;
            element.classList.add('template-workspace-editable-image');
            element.addEventListener('click', event => {
                if (!isEditMode) return;
                event.preventDefault();
                event.stopPropagation();
                pendingImageElement = element;
                ensureImagePicker().click();
            });
        });
    }

    function restoreSavedState() {
        const savedState = parentWorkspace.getProjectState(projectId);
        if (!savedState || !Array.isArray(savedState.elements)) return;

        savedState.elements.forEach(item => {
            const element = document.querySelector(`[data-template-edit-key="${item.key}"]`);
            if (!element) return;

            if (item.kind === 'image' && element.tagName.toLowerCase() === 'img') {
                if (item.src) {
                    element.setAttribute('src', item.src);
                }
                if (item.alt !== undefined) {
                    element.setAttribute('alt', item.alt);
                }
                return;
            }

            if (item.kind === 'content' || !item.kind) {
                if (item.attrs && typeof item.attrs === 'object') {
                    Object.keys(item.attrs).forEach(attributeName => {
                        if (String(attributeName || '').trim()) {
                            element.setAttribute(attributeName, item.attrs[attributeName]);
                        }
                    });
                }
                element.innerHTML = item.html;
            }
        });

        markDirty(false);
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
            elements: [
                ...editableElements.map(element => ({
                    key: element.dataset.templateEditKey,
                    kind: 'content',
                    html: element.innerHTML,
                    attrs: {
                        ...(element.hasAttribute('data-target') ? { 'data-target': element.getAttribute('data-target') || '' } : {})
                    }
                })),
                ...editableImages.map(element => ({
                    key: element.dataset.templateEditKey,
                    kind: 'image',
                    src: element.getAttribute('src') || '',
                    alt: element.getAttribute('alt') || ''
                }))
            ]
        };
    }

    function buildRenderedHtml(options = {}) {
        const clone = document.documentElement.cloneNode(true);
        const normalizeAssetsAbsolute = options.normalizeAssetsAbsolute === true;

        clone.querySelectorAll('[contenteditable]').forEach(element => element.removeAttribute('contenteditable'));
        clone.querySelectorAll('.template-workspace-editable').forEach(element => element.classList.remove('template-workspace-editable'));
        clone.querySelectorAll('.template-workspace-editable-image').forEach(element => element.classList.remove('template-workspace-editable-image'));
        clone.querySelectorAll('#templateWorkspaceStyles').forEach(element => element.remove());
        clone.querySelectorAll('#templateWorkspaceImagePicker').forEach(element => element.remove());

        if (normalizeAssetsAbsolute) {
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
        }

        return `<!DOCTYPE html>\n${clone.outerHTML}`;
    }

    async function saveChanges(options = {}) {
        const state = serializeState();
        const renderedHtml = buildRenderedHtml();
        if (options.completed) {
            await parentWorkspace.completeProjectTemplate(projectId, state, { renderedHtml });
        } else {
            await parentWorkspace.saveProjectTemplateState(projectId, state, { renderedHtml });
        }
        isEditMode = false;
        setAllEditable(false);
        if (typeof parentWorkspace.setEditMode === 'function') {
            parentWorkspace.setEditMode(false);
        }
        markDirty(false);
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
        if (typeof parentWorkspace.setEditMode === 'function') {
            parentWorkspace.setEditMode(true);
        }
    };

    window.saveTemplateWorkspaceChanges = async function saveTemplateWorkspaceChanges() {
        await saveChanges({ completed: false });
    };

    window.completeTemplateWorkspaceProject = async function completeTemplateWorkspaceProject() {
        if (isEditMode || isDirty) {
            throw new Error('Save changes before completing the project.');
        }

        const currentState = serializeState();
        const renderedHtml = buildRenderedHtml();
        await parentWorkspace.completeProjectTemplate(projectId, currentState, { renderedHtml });
        isEditMode = false;
        setAllEditable(false);
        if (typeof parentWorkspace.setEditMode === 'function') {
            parentWorkspace.setEditMode(false);
        }
        markDirty(false);
    };

    window.downloadTemplateWorkspaceOutput = async function downloadTemplateWorkspaceOutput() {
        if (isEditMode || isDirty) {
            throw new Error('Save changes before downloading the final output.');
        }

        await parentWorkspace.downloadProjectTemplate(projectId, {
            renderedHtml: buildRenderedHtml(),
            templateId: templateConfig ? templateConfig.id : templatePage.replace('.html', ''),
            templateName
        });
    };

    ensureStyles();
    assignEditableKeys();
    restoreSavedState();
});
