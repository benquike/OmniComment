import { createReadAloud } from './readAloud.js';
import { getToolbar, bindShortcut, createContextMenu, setAIAvailable, openToolbarExport } from "./util.js";
import { observeWorkspaceAbsoluteImages, createMarkdownValueReader, restoreWorkspaceBaseUrls, } from "./imagePath.js";
import { mapVscodeLanguageToVditorLang } from "./lang.js";
import { bindLinkErrors } from "./linkError.js";
import { refreshExportDialogProState } from "./exportDialog.js";
import { toggleMarkmapView, refreshMarkmapProLock } from "./markmapView.js";
import { initOmniAnnotations } from "./omniAnnotations.js?v=0.1.3";


const removeLockedDecorations = (root) => {
  root?.querySelectorAll?.('.vditor-pro-locked__badge, .vditor-pro-locked__tooltip').forEach((node) => node.remove());
  root?.querySelectorAll?.('.vditor-pro-locked').forEach((node) => node.classList.remove('vditor-pro-locked'));
};

const hideToolbarEntry = (root, type) => {
  const item = root?.querySelector?.(`.vditor-toolbar [data-type="${type}"]`)?.closest('.vditor-toolbar__item');
  if (item) item.hidden = true;
};

const showToolbarEntry = (root, type) => {
  const item = root?.querySelector?.(`.vditor-toolbar [data-type="${type}"]`)?.closest('.vditor-toolbar__item');
  if (item) item.hidden = false;
};

const applyProState = (editor, isPro) => {
  document.body.classList.toggle('is-pro', !!isPro);
  if (!editor?.vditor?.options) {
    refreshExportDialogProState();
    return;
  }

  editor.vditor.options.isPro = !!isPro;
  if (editor.options) {
    editor.options.isPro = !!isPro;
  }

  if (isPro) {
    removeLockedDecorations(document);
    hideToolbarEntry(document, 'pro-upgrade');
    hideToolbarEntry(document, 'help');
  } else {
    showToolbarEntry(document, 'pro-upgrade');
    showToolbarEntry(document, 'help');
  }

  const keymapButton = editor.vditor.toolbar?.elements?.keymap?.firstElementChild;
  if (keymapButton) {
    keymapButton.classList.toggle('vditor-pro-locked', !isPro);
    keymapButton.querySelector('.vditor-pro-locked__badge')?.remove();
    keymapButton.querySelector('.vditor-pro-locked__tooltip')?.remove();
    if (!isPro) {
      keymapButton.insertAdjacentHTML('beforeend', '<span class="vditor-pro-locked__badge" aria-hidden="true">PRO</span>');
      const tooltip = document.createElement('span');
      tooltip.className = 'vditor-pro-locked__tooltip';
      tooltip.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.className = 'vditor-pro-locked__tooltip-text';
      text.textContent = `${keymapButton.title || keymapButton.getAttribute('aria-label')} · Pro`;
      tooltip.append(text);
      keymapButton.append(tooltip);
    }
  }
  if (!isPro) editor.vditor.element.querySelector('.vditor-keymap-dialog')?.remove();
  refreshExportDialogProState();
  refreshMarkmapProLock();
};

const applyProCancelledState = (editor, isProCancelled) => {
  document.body.classList.toggle('is-pro-cancelled', !!isProCancelled);
};

const interceptCancelledProAction = (event) => {
  if (!document.body.classList.contains('is-pro-cancelled')) return;
  if (!(event.target instanceof Element) || !event.target.closest('.vditor-toolbar, .vditor-outline, .vditor-mobile-outline-trigger')) return;
  event.stopImmediatePropagation();
  if (event.type === 'click') {
    event.preventDefault();
    handler.emit('openProPanel');
  }
};

for (const type of ['pointerdown', 'mousedown', 'touchstart', 'click']) {
  document.addEventListener(type, interceptCancelledProAction, true);
}

handler.on("open", async (md) => {
  const { content, rootPath, workspaceBaseUrl, documentCacheId, pendingFragment, shouldRestoreFocus, config, fileName } = md;
  window.__officeMarkdownFileName = fileName || 'Note';
  const {
    language, isWeb, isDev, isPro, isProCancelled, markdown,
    editMode, editorTheme, codeMirrorTheme, mermaidTheme
  } = config;
  if (isWeb) {
    document.body.classList.add('is-web')
  }
  applyProState(null, isPro)
  applyProCancelledState(null, isProCancelled)
  let editor;
  let omniAnnotations;
  const getMarkdownValue = createMarkdownValueReader(() => editor, workspaceBaseUrl);
  editor = new Vditor('vditor', {
    value: content,
    cdn: rootPath,
    preventMacOptionKey: config.preventMacOptionKey !== false,
    height: '100%',
    outline: {
      position: 'left',
    },
    cache: {
      enable: false,
      id: documentCacheId,
      focusHost: 'vscode',
    },
    mode: editMode,
    editorTheme,
    codeMirrorTheme,
    mermaidTheme,
    isPro,
    onRequirePro() {
      handler.emit('openProPanel')
    },
    lang: mapVscodeLanguageToVditorLang(language),
    tab: '\t',
    toolbar: await getToolbar(rootPath, () => {
      handler.emit('doSave', getMarkdownValue());
      editor?.markSaved();
    }, isPro, () => openToolbarExport(editor), () => toggleMarkmapView(editor), createReadAloud(() => editor, language, isWeb)),
    onAboutOpen: () => handler.emit('openAbout'),
    onSponsorLogoClick: () => handler.emit('openSponsor'),
    onSponsorSiteClick: () => handler.emit('openExternal', 'https://database-client.com/'),
    onLinkClick(payload, event) {
      if (payload.type === "tag") {
        return;
      }
      const isCompose = event.metaKey || event.ctrlKey;
      if (payload.action !== "dblclick" && !(payload.action === "click" && isCompose)) {
        return;
      }
      if (payload.type === "footnote-ref") {
        editor.scrollToBlock(`footnote:${payload.href}`);
        return;
      }
      if (payload.href?.startsWith("#")) {
        editor.scrollToBlock(payload.href);
        if (payload.type === "wikilink" || payload.type === "wikilink-embed") {
          handler.emit('telemetry', { event: 'markdown.wikilink.open' });
        }
        return;
      }
      let uri = payload.href;
      if (payload.type === "wikilink" || payload.type === "wikilink-embed") {
        const hashIndex = uri.indexOf("#");
        const page = hashIndex < 0 ? uri : uri.slice(0, hashIndex);
        const fragment = hashIndex < 0 ? "" : uri.slice(hashIndex + 1);
        if (!page && fragment) {
          editor.scrollToBlock(fragment);
          handler.emit('telemetry', { event: 'markdown.wikilink.open' });
          return;
        }
        uri = `wiki:${payload.href}`;
      }
      handler.emit("openLink", uri);
    },
    debugger: isDev,
    wysiwygInputPerf: isDev && false,
    changeEditorTheme(theme) {
      handler.emit('editorTheme', theme)
    },
    changeCodeTheme(theme) {
      handler.emit('codeMirrorTheme', theme)
    },
    changeMermaidTheme(theme) {
      handler.emit('mermaidTheme', theme)
    },
    changeEditMode(mode) {
      handler.emit('editMode', mode);
      setTimeout(() => omniAnnotations?.refreshHighlights(getMarkdownValue()), 80);
    },
    onSettingsChange(settings) {
      handler.emit('syncViewerSettings', settings)
    },
    onEditSettings() {
      handler.emit('editViewerSettings', editor.exportViewerSettings())
    },
    input(content) {
      const restored = restoreWorkspaceBaseUrls(content, workspaceBaseUrl);
      handler.emit("save", restored);
      setTimeout(() => omniAnnotations?.refreshHighlights(restored), 60);
    },
    upload: {
      url: '/image',
      accept: 'image/*',
      handler(files) {
        const file = files[0];
        const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
        let reader = new FileReader();
        reader.readAsBinaryString(file);
        reader.onloadend = () => {
          handler.emit("img", { data: reader.result, ext })
        };
      }
    },
    onTelemetry(event, properties) {
      handler.emit('telemetry', { event, properties });
    },
    ai: {
      onPolish(markdown, apply, options) {
        handler.emit('aiPolish', { markdown, options })
      },
      onCancelPolish() {
        handler.emit('aiPolishCancel')
      }
    },
    preview: {
      math: {
        macros: markdown?.math?.macros ?? {},
      },
    },
    after() {
      bindLinkErrors(handler, editor);
      omniAnnotations = initOmniAnnotations(getMarkdownValue);
      setTimeout(() => omniAnnotations.refreshHighlights(content), 80);
      const { viewerSettings } = md;
      observeWorkspaceAbsoluteImages(document.getElementById('vditor'), workspaceBaseUrl);
      if (viewerSettings?.enabled) {
        editor.setViewerSettingsSyncEnabled(true);
        if (viewerSettings.settings) {
          editor.applyViewerSettings(viewerSettings.settings);
        }
      }
      handler.on('viewerSettingsSync', ({ enabled }) => {
        editor.setViewerSettingsSyncEnabled(!!enabled);
      });
      handler.on('viewerSettings', (settings) => {
        editor.applyViewerSettings(settings);
      });
      handler.on('markdownConfig', (update) => {
        if (Object.prototype.hasOwnProperty.call(update, 'preventMacOptionKey')) {
          editor.vditor.options.preventMacOptionKey = update.preventMacOptionKey !== false;
        }
        if (update.editorTheme !== undefined) {
          editor.setEditorTheme(update.editorTheme);
        }
        if (update.codeMirrorTheme !== undefined) {
          Vditor.setCodeTheme(update.codeMirrorTheme, editor.vditor?.element);
        }
        if (update.mermaidTheme !== undefined) {
          editor.setMermaidTheme(update.mermaidTheme);
        }
        if (update.editMode !== undefined) {
          editor.switchEditMode(update.editMode);
          setTimeout(() => omniAnnotations?.refreshHighlights(getMarkdownValue()), 80);
        }
      });
      handler.on('proStatus', ({ isPro, isProCancelled }) => {
        applyProState(editor, !!isPro);
        applyProCancelledState(editor, !!isProCancelled);
        if (!isPro) {
          // Clear badge dismissed state so the dot reappears
          localStorage.removeItem('office.pro.badgeDismissed');
          // Re-inject badge dot into DOM if button is visible and dot was removed
          const btn = document.querySelector('.vditor-toolbar [data-type="pro-upgrade"]');
          if (btn && !btn.querySelector('.vditor-pro-badge')) {
            const dot = document.createElement('span');
            dot.className = 'vditor-pro-badge';
            btn.appendChild(dot);
          }
        }
      });
      handler.on("update", content => {
        if (document.querySelector("[data-type='yaml-front-matter'].vditor-code-block--cm .cm-editor.cm-focused")) {
          return;
        }
        omniAnnotations?.syncFromExternalUpdate?.(content);
        if (getMarkdownValue() === content) {
          setTimeout(() => omniAnnotations?.refreshHighlights(content), 40);
          return;
        }
        const scrollContainer =
          document.querySelector('#vditor .vditor-wysiwyg .vditor-reset') ||
          document.querySelector('#vditor .vditor-ir .vditor-reset');
        const prevScrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
        editor.setValue(content);
        editor.markSaved();
        if (scrollContainer) {
          scrollContainer.scrollTop = prevScrollTop;
        }
        setTimeout(() => {
          if (scrollContainer) {
            scrollContainer.scrollTop = prevScrollTop;
          }
          omniAnnotations?.refreshHighlights(content);
        }, 50);
      })
      const handleFocusComment = (payload) => {
        const commentId = typeof payload === 'string' ? payload : payload?.commentId;
        const anchorText = typeof payload === 'object' ? payload?.anchorText : undefined;
        if (commentId && omniAnnotations) {
          omniAnnotations.focusCommentById(commentId, anchorText);
        }
      };
      handler.on("focusOmniComment", handleFocusComment);
      handler.on("focusMarkcoComment", handleFocusComment);
      handler.on("openAddCommentInEditor", (payload) => {
        const text = typeof payload === 'string' ? payload : (payload?.selectedText || '');
        if (omniAnnotations) {
          omniAnnotations.openAddCommentComposer(text);
        } else if (typeof window.__omniOpenAddComment === 'function') {
          window.__omniOpenAddComment(text);
        } else if (typeof window.__markcoOpenAddComment === 'function') {
          window.__markcoOpenAddComment(text);
        }
      })
      const handleQueryInlineState = (payload) => {
        if (payload?.inputSelector && typeof payload.inputValue === 'string') {
          let inputEl = document.querySelector(payload.inputSelector);
          if (!inputEl && payload.inputSelector.includes('markco')) {
            inputEl = document.querySelector(payload.inputSelector.replace(/markco/g, 'omni'));
          } else if (!inputEl && payload.inputSelector.includes('omni')) {
            inputEl = document.querySelector(payload.inputSelector.replace(/omni/g, 'markco'));
          }
          if (inputEl && 'value' in inputEl) {
            inputEl.value = payload.inputValue;
            inputEl.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
        if (payload?.clickSelector) {
          let btn = document.querySelector(payload.clickSelector);
          if (!btn && payload.clickSelector.includes('markco')) {
            btn = document.querySelector(payload.clickSelector.replace(/markco/g, 'omni'));
          } else if (!btn && payload.clickSelector.includes('omni')) {
            btn = document.querySelector(payload.clickSelector.replace(/omni/g, 'markco'));
          }
          if (btn instanceof HTMLElement) {
            btn.click();
          }
        }
        const state = omniAnnotations?.getInlineState?.() || null;
        handler.emit("command", {
          command: "omnicomment.editorCommentAction",
          args: [{ type: "reportInlineState", state }]
        });
      };
      handler.on("queryOmniInlineState", handleQueryInlineState);
      handler.on("queryMarkcoInlineState", handleQueryInlineState);
      handler.on("insertImageMarkdown", (markdown) => {
        editor.insertMarkdown(markdown);
      })
      handler.on("gotoBlock", (fragment) => {
        if (typeof fragment === 'string' && (fragment.startsWith('omnicomment:') || fragment.startsWith('markco:'))) {
          const [, commentId, ...rest] = fragment.split(':');
          omniAnnotations?.focusCommentById(commentId, rest.join(':'));
          return;
        }
        if (fragment) {
          editor.scrollToBlock(fragment);
        }
      })
      handler.emit('queryAIAvailable')
      handler.on("aiAvailable", (available) => {
        setAIAvailable(available, editor)
        if (available) {
          handler.emit('queryVSCodeModels')
        }
      })
      handler.on("vscodeModels", (models) => {
        editor.setVSCodeModels(models)
      })
      handler.on('aiPolishChunk', (chunk) => {
        editor.streamAIChunk(chunk)
      })
      handler.on('aiPolishEnd', () => {
        editor.endAIStream()
      })
      editor.restoreDocumentSession(true, !!shouldRestoreFocus)
      if (pendingFragment) {
        editor.scrollToBlock(pendingFragment);
      }
    }
  })
  bindShortcut(handler, editor, workspaceBaseUrl);
  createContextMenu(editor, mapVscodeLanguageToVditorLang(language), workspaceBaseUrl)
}).emit("init")
