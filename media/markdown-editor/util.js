import { openExportDialog } from './exportDialog.js'
import { getContextMenuI18n } from './context-menu-i18n.js'
import { createMarkdownValueReader, restoreWorkspaceBaseUrls } from "./imagePath.js";

function loadRes(url) {
    return fetch(url).then(r => r.text())
}

const isMac = navigator.userAgent.includes('Mac OS');
const shortcutTip = isMac ? '⌘ ^ E' : 'Ctrl Alt E';

const modShortcut = (key) => (isMac ? `⌘${key}` : `Ctrl+${key}`);
const shiftModShortcut = (key) => (isMac ? `⌘⇧${key}` : `Ctrl+Shift+${key}`);

const CONTEXT_MENU_SHORTCUTS = {
    addComment: shiftModShortcut('M'),
    copy: modShortcut('C'),
    paste: modShortcut('V'),
    pasteAsPlainText: shiftModShortcut('V'),
};

const CONTEXT_MENU_LABEL_KEYS = {
    aiPolish: 'aiPolish',
    addToCodex: 'addToCodex',
    addToClaudeCode: 'addToClaudeCode',
    addToCopilotChat: 'addToCopilotChat',
    copy: 'copy',
    copyAs: 'copyAs',
    copyAsHtml: 'html',
    copyAsPlainText: 'plainText',
    paste: 'paste',
    pasteAsPlainText: 'pasteAsPlainText',
    exportPdf: 'exportPdf',
    exportDocx: 'exportDocx',
    exportHtml: 'exportHtml',
    insertImage: 'insertImage',
    showInFolder: 'showInFolder',
};

const applyContextMenuI18n = (menu, lang) => {
    const i18n = getContextMenuI18n(lang);
    for (const item of menu.querySelectorAll('[data-action]')) {
        const key = CONTEXT_MENU_LABEL_KEYS[item.dataset.action];
        if (!key || !i18n[key]) continue;
        const label = item.querySelector('.vditor-context-menu__label');
        if (label) label.textContent = i18n[key];
    }
    const copyAsLabel = menu.querySelector('[data-submenu-label="copyAs"]');
    if (copyAsLabel) copyAsLabel.textContent = i18n.copyAs;
};

const applyContextMenuShortcuts = (menu) => {
    for (const item of menu.querySelectorAll('[data-action]')) {
        const shortcut = CONTEXT_MENU_SHORTCUTS[item.dataset.action];
        if (!shortcut) continue;
        const el = item.querySelector('.vditor-context-menu__shortcut');
        if (el) el.textContent = shortcut;
    }
};

const pastePlainTextFromClipboard = async () => {
    const text = await navigator.clipboard.readText();
    if (document.getSelection()?.toString()) {
        document.execCommand('delete');
    }
    if (text) {
        document.execCommand('insertText', false, text.trim());
    }
};

const PRO_BADGE_KEY = 'office.pro.badgeDismissed';

function makeProUpgradeBtn() {
    const dismissed = localStorage.getItem(PRO_BADGE_KEY) === '1';
    return {
        name: 'pro-upgrade',
        tip: 'Upgrade to Pro',
        className: 'right',
        icon: `<span class="codicon codicon-mail" aria-hidden="true"></span>${dismissed ? '' : '<span class="vditor-pro-badge"></span>'}`,
        click() {
            handler.emit('telemetry', { event: 'markdown.toolbar.pro-letter-click' });
            handler.emit('openProPanel');
            localStorage.setItem(PRO_BADGE_KEY, '1');
            // Remove badge dot from DOM without re-rendering
            const btn = document.querySelector('.vditor-toolbar [data-type="pro-upgrade"]');
            if (btn) btn.querySelector('.vditor-pro-badge')?.remove();
        },
    };
}

export async function getToolbar(resPath, onSave = null, isPro = false, onExport = null, onMarkmap = null, readAloud = null) {
    const codicon = (name) => `<span class="codicon codicon-${name}" aria-hidden="true"></span>`;
    const toolbar = [
        'outline',
        {
            name: 'markmap',
            tip: 'Markmap',
            icon: codicon('type-hierarchy'),
            click() {
                onMarkmap?.()
            }
        },
        "|",
         {
            name: 'edit-in-vscode',
            tip: `Edit In VSCode (${shortcutTip})`,
            className: 'right',
            icon: codicon('vscode'),
            click() {
                handler.emit("editInVSCode", true)
            }
        },
        {
            name: 'save',
            tip: 'Save',
            className: 'right',
            icon: codicon('save'),
            click() {
                onSave?.()
            }
        },
        {
            name: 'add-comment',
            tip: `Add Comment (${shiftModShortcut('M')})`,
            className: 'right',
            icon: codicon('comment'),
            click() {
                triggerAddComment()
            }
        },
        "|",
        "headings",
        "bold",
        "italic",
        "strike",
        "link",
        "|",
        'font-color',
        'background-color',
        {
            name: 'export',
            tip: 'Export',
            icon: codicon('arrow-down'),
            click() {
                onExport?.()
            }
        },
        ...(isPro ? [] : [makeProUpgradeBtn()]),
        "|",
        "editor-theme",
        "editor-theme-toggle",
        "|",
        // "|",
        "list",
        "ordered-list",
        "check",
        "table",
        "|",
        "quote",
        "code",
        'upload',
        "|",
        "undo",
        "redo",
        "|",
        "find",
        ...(readAloud ? [readAloud] : []),
        "keymap",
        "settings"
    ]
    return toolbar
}

const hideContextMenu = (menu) => {
    menu.hidden = true
    for (const panel of menu.querySelectorAll('.vditor-context-menu__submenu-panel--left')) {
        panel.classList.remove('vditor-context-menu__submenu-panel--left')
    }
}

const positionSubmenuPanel = (submenu) => {
    const panel = submenu.querySelector('.vditor-context-menu__submenu-panel')
    if (!panel) return
    panel.classList.remove('vditor-context-menu__submenu-panel--left')
    const prevDisplay = panel.style.display
    panel.style.display = 'flex'
    panel.style.flexDirection = 'column'
    const rect = panel.getBoundingClientRect()
    if (rect.right > window.innerWidth - 4) {
        panel.classList.add('vditor-context-menu__submenu-panel--left')
    }
    panel.style.display = prevDisplay
}

const showContextMenu = (menu, clientX, clientY) => {
    menu.hidden = false
    menu.style.left = `${clientX}px`
    menu.style.top = `${clientY}px`
    const rect = menu.getBoundingClientRect()
    const padding = 4
    let left = clientX
    let top = clientY
    if (left + rect.width > window.innerWidth - padding) {
        left = window.innerWidth - rect.width - padding
    }
    if (top + rect.height > window.innerHeight - padding) {
        top = window.innerHeight - rect.height - padding
    }
    if (left < padding) left = padding
    if (top < padding) top = padding
    menu.style.left = `${left}px`
    menu.style.top = `${top}px`
}

const getSelectedHtml = () => {
    const selection = document.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return ''
    const editorRoot = document.getElementById('vditor')
    if (!editorRoot?.contains(selection.anchorNode) || !editorRoot.contains(selection.focusNode)) return ''
    const container = document.createElement('div')
    for (let i = 0; i < selection.rangeCount; i++) {
        container.appendChild(selection.getRangeAt(i).cloneContents())
    }
    return container.innerHTML
}

const normalizePlainText = text => {
    return (text || '')
        .replace(/\u00a0/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
}

const htmlToPlainText = html => {
    if (!html) return ''
    const container = document.createElement('div')
    container.innerHTML = html
    container.querySelectorAll(
        '.vditor-ir__marker, .vditor-ir__preview, .vditor-toolbar, .vditor-hint, script, style',
    ).forEach(item => item.remove())
    container.querySelectorAll('br').forEach(item => item.replaceWith('\n'))
    container.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li, tr, pre, blockquote').forEach(item => {
        item.appendChild(document.createTextNode('\n'))
    })
    return normalizePlainText(container.textContent || '')
}

const getSelectedPlainText = () => {
    const selection = document.getSelection()
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return ''
    const editorRoot = document.getElementById('vditor')
    if (!editorRoot?.contains(selection.anchorNode) || !editorRoot.contains(selection.focusNode)) return ''
    const container = document.createElement('div')
    for (let i = 0; i < selection.rangeCount; i++) {
        container.appendChild(selection.getRangeAt(i).cloneContents())
    }
    return htmlToPlainText(container.innerHTML) || normalizePlainText(selection.toString())
}

const getCursorOrSelectedPlainText = () => {
    const selected = getSelectedPlainText()
    if (selected) return selected
    const selection = document.getSelection()
    if (!selection || !selection.anchorNode) return ''
    const editorRoot = document.getElementById('vditor')
    if (!editorRoot?.contains(selection.anchorNode)) return ''
    const anchorEl = selection.anchorNode.nodeType === 1 ? selection.anchorNode : selection.anchorNode.parentElement
    const blockEl = anchorEl?.closest?.('[data-block="0"], p, li, h1, h2, h3, h4, h5, h6, blockquote')
    if (blockEl && editorRoot.contains(blockEl)) {
        return htmlToPlainText(blockEl.innerHTML) || normalizePlainText(blockEl.textContent || '')
    }
    return ''
}

const triggerAddComment = async (fallbackText = '') => {
    const text = (getCursorOrSelectedPlainText() || fallbackText || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim()
    const openAddComment = window.__omniOpenAddComment || window.__markcoOpenAddComment;
    if (typeof openAddComment === 'function') {
        openAddComment(text)
        return
    }
    if (text) {
        await copyPlainText(text)
    }
    vscodeEvent.emit('command', 'omnicomment.addComment')
}

const copyHtml = async (html) => {
    if (!html) return
    if (navigator.clipboard?.write && window.ClipboardItem) {
        await navigator.clipboard.write([
            new ClipboardItem({
                'text/html': new Blob([html], { type: 'text/html' }),
                'text/plain': new Blob([html], { type: 'text/plain' }),
            }),
        ])
        return
    }
    await navigator.clipboard.writeText(html)
}

const copyPlainText = async (text) => {
    if (!text) return
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        return
    }
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    textarea.style.top = '0'
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    textarea.remove()
}

export const setAIAvailable = (available, editor) => {
    editor?.setCopilotAvailable?.(available);
}

export const openToolbarExport = (editor) => {
    openExportForEditor(editor, 'toolbar')
}

const openExportForEditor = (editor, source, initialFormat) => {
    handler.emit('telemetry', {
        event: 'markdown.exportDialog',
        properties: { source, format: initialFormat },
    })
    openExportDialog(editor, { initialFormat }).then(options => {
        if (!options) return
        emitExport(editor, options)
    })
}

const applyProExportSettings = (exportTheme, proSettings) => {
    if (!exportTheme || !proSettings) return exportTheme
    const layout = { ...(exportTheme.layout || {}) }
    if (proSettings.fontFamily && proSettings.fontFamily !== 'inherit') {
        layout.fontFamily = proSettings.fontFamily
    }
    if (proSettings.fontSize) {
        layout.fontSize = `${proSettings.fontSize}px`
    }
    return { ...exportTheme, layout }
}

const emitExport = (editor, payload) => {
    const { proSettings, useProExport, ...rest } = payload
    const exportPayload = { ...rest, useProExport: !!useProExport }
    if (useProExport) {
        let exportTheme = editor.exportExportSettings?.()
        if (proSettings) {
            exportTheme = applyProExportSettings(exportTheme, proSettings)
        }
        exportPayload.exportTheme = exportTheme
    }
    vscodeEvent.emit('export', exportPayload)
}

export const createContextMenu = (editor, lang = 'en_US', workspaceBaseUrl = '') => {
    const menu = document.getElementById('context-menu')
    if (!menu) return
    if (!menu.querySelector('[data-action="addComment"]')) {
        const group = document.createElement('div')
        group.className = 'vditor-context-menu__group'
        group.setAttribute('role', 'group')
        group.innerHTML = `
          <button class="vditor-context-menu__item" type="button" data-action="addComment" role="menuitem">
            <span class="vditor-context-menu__icon" aria-hidden="true">
              <span class="codicon codicon-comment"></span>
            </span>
            <span class="vditor-context-menu__label">Add Comment</span>
            <span class="vditor-context-menu__shortcut" aria-hidden="true"></span>
          </button>
        `
        const sep = document.createElement('div')
        sep.className = 'vditor-context-menu__separator'
        sep.setAttribute('role', 'separator')
        const copyBtn = menu.querySelector('[data-action="copy"]')?.closest('.vditor-context-menu__group')
        if (copyBtn) {
            menu.insertBefore(sep, copyBtn)
            menu.insertBefore(group, copyBtn)
        } else {
            menu.appendChild(sep)
            menu.appendChild(group)
        }
    }
    const selectionTargets = { addToCodex: 'codex', addToClaudeCode: 'claude', addToCopilotChat: 'copilot' }
    let sourceSelection = null
    let lastContextText = ''
    menu.addEventListener('mousedown', e => {
        const action = e.target.closest('[data-action]')?.dataset.action
        if (selectionTargets[action] || action === 'addComment') e.preventDefault()
    })
    applyContextMenuI18n(menu, lang)
    applyContextMenuShortcuts(menu)

    const closeMenu = () => hideContextMenu(menu)

    document.addEventListener('mousedown', e => {
        if (!menu.contains(e.target)) {
            closeMenu()
        }
    })
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') {
            closeMenu()
        }
    })
    document.oncontextmenu = e => {
        e.preventDefault()
        e.stopPropagation()
        lastContextText = getCursorOrSelectedPlainText()
        sourceSelection = editor.getSourceSelection()
        if (sourceSelection) {
            sourceSelection.blocks = sourceSelection.blocks.map(block => restoreWorkspaceBaseUrls(block, workspaceBaseUrl))
        }
        for (const action of Object.keys(selectionTargets)) {
            const el = menu.querySelector(`[data-action="${action}"]`)
            if (el) el.disabled = !sourceSelection
        }
        showContextMenu(menu, e.clientX, e.clientY)
    }
    for (const submenu of menu.querySelectorAll('.vditor-context-menu__submenu')) {
        submenu.addEventListener('mouseenter', () => positionSubmenuPanel(submenu))
    }
    menu.addEventListener('click', async e => {
        const item = e.target.closest('[data-action]')
        if (!item || (item.classList.contains('vditor-context-menu__item--desktop-only') && document.body.classList.contains('is-web'))) return
        closeMenu()
        const action = item.dataset.action
        switch (action) {
            case 'addComment':
                await triggerAddComment(lastContextText || sourceSelection?.text || '')
                break
            case 'addToCodex':
            case 'addToClaudeCode':
            case 'addToCopilotChat':
                if (sourceSelection) handler.emit('sendSelectionToAI', {
                    target: selectionTargets[action], selection: sourceSelection,
                })
                break
            case 'copy':
                document.execCommand('copy')
                break
            case 'copyAsHtml':
                copyHtml(getSelectedHtml() || editor.getHTML())
                break
            case 'copyAsPlainText':
                copyPlainText(getSelectedPlainText() || htmlToPlainText(editor.getHTML()))
                break
            case 'paste':
                if (document.getSelection()?.toString()) { document.execCommand('delete') }
                vscodeEvent.emit('command', 'office.markdown.paste')
                break
            case 'pasteAsPlainText':
                await pastePlainTextFromClipboard()
                break
            case 'exportPdf':
                openExportForEditor(editor, 'contextMenu', 'pdf')
                break
            case 'exportDocx':
                openExportForEditor(editor, 'contextMenu', 'docx')
                break
            case 'exportHtml':
                openExportForEditor(editor, 'contextMenu', 'html')
                break
            case 'showInFolder':
                vscodeEvent.emit('showInFolder')
                break
            case 'insertImage':
                vscodeEvent.emit('insertImage')
                break
            case 'aiPolish':
                editor.openAIPolishDialog()
                break
        }
    })
}

function matchShortcut(hotkey, event) {

    const matchAlt = hotkey.match(/!/) != null == event.altKey
    const matchMeta = hotkey.match(/⌘/) != null == event.metaKey
    const matchCtrl = hotkey.match(/\^/) != null == event.ctrlKey
    const matchShifter = hotkey.match(/\+/) != null == event.shiftKey

    if (matchAlt && matchCtrl && matchShifter && matchMeta) {
        return hotkey.match(new RegExp(`\\b${event.key}\\b`, "i"))
    }

}


const isInsideCodeMirrorTarget = (target) => {
    const node = target?.nodeType === 1 ? target : target?.parentElement;
    return !!node?.closest?.(".vditor-code-block--cm .cm-editor");
};

export const bindShortcut = (handler, editor, workspaceBaseUrl = '') => {
    const getMarkdownValue = createMarkdownValueReader(() => editor, workspaceBaseUrl);
    let _exec = document.execCommand.bind(document)
    document.execCommand = (cmd, ...args) => {
        if (cmd === 'delete') {
            setTimeout(() => {
                return _exec(cmd, ...args)
            })
        } else {
            return _exec(cmd, ...args)
        }
    }
    window.addEventListener('keydown', async e => {
        if (matchShortcut('^⌘e', e) || matchShortcut('^!e', e)) {
            e.stopPropagation();
            e.preventDefault();
            return handler.emit("editInVSCode", true);
        }

        if (e.code == 'F12') return handler.emit('developerTool')
        if (isCompose(e) && e.shiftKey && !e.altKey && e.code === 'KeyM') {
            e.stopPropagation();
            e.preventDefault();
            await triggerAddComment(editor.getSourceSelection?.()?.text || '');
            return;
        }
        if (isCompose(e)) {
            switch (e.code) {
                case 'KeyS':
                    vscodeEvent.emit("doSave", getMarkdownValue());
                    editor.markSaved();
                    e.stopPropagation();
                    e.preventDefault();
                    break;
                case 'KeyV':
                    if (isInsideCodeMirrorTarget(e.target) || isInsideCodeMirrorTarget(document.activeElement)) {
                        return;
                    }
                    if (e.shiftKey) {
                        await pastePlainTextFromClipboard();
                        e.stopPropagation();
                    }
                    else if (document.getSelection()?.toString()) {
                        // vscode webview only: 修复剪切后选中文本没有被清除
                        document.execCommand("delete")
                    }
                    e.preventDefault();
                    break;
            }
        }
    }, isMac ? true : undefined)

    window.onresize = () => {
        document.getElementById('vditor').style.height = '100%'
    }
}
