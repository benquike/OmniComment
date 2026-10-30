import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { CommentService } from './services/CommentService';
import { CommentDecorator } from './decorators/CommentDecorator';
import { CommentSidebarProvider } from './providers/CommentSidebarProvider';
import {
  InlineCommentController,
  OmniCommentInlineItem
} from './providers/InlineCommentController';
import { CommentCodeActionProvider } from './providers/CommentCodeActionProvider';
import { SelectionCodeLensProvider } from './providers/SelectionCodeLensProvider';
import { SelectionBadgeClickDetector } from './providers/SelectionBadgeClickDetector';
import { omniCommentPreviewPlugin } from './markdown/omniCommentPreviewPlugin';
import {
  CommentBoxConfig,
  CommentBoxWidthMode,
  DEFAULT_COMMENT_BOX_CONFIG,
  resolveCommentBoxDimensions,
  isSupportedCommentDocument,
  isSupportedCommentLanguage,
  isSupportedCommentUri
} from './core/types';

let commentService: CommentService;
let commentDecorator: CommentDecorator;
let sidebarProvider: CommentSidebarProvider;
let inlineCommentController: InlineCommentController;
let selectionCodeLensProvider: SelectionCodeLensProvider;
let lastActiveMarkdownUri: vscode.Uri | undefined;
let pendingInlineStateResolver: ((state: any) => void) | undefined;
let isTestMode = false;

/**
 * Automatically ensures any installed `cweijan.vscode-office` ("Markdown Editor") extension
 * has the latest inlined comment widget assets (`omniAnnotations.js`, `index.js`, `util.js`,
 * `imagePath.js`, `index.css`) synced into its `resource/markdown/` directory.
 */
function syncMarkdownEditorIntegration(extPath: string): void {
  try {
    let officeExtPath: string | undefined =
      vscode.extensions.getExtension('cweijan.vscode-office')?.extensionPath;

    if (!officeExtPath || !fs.existsSync(officeExtPath)) {
      const extensionsDir = path.join(os.homedir(), '.vscode', 'extensions');
      if (fs.existsSync(extensionsDir)) {
        const match = fs
          .readdirSync(extensionsDir)
          .filter(e => e.startsWith('cweijan.vscode-office-'))
          .sort()
          .pop();
        if (match) {
          officeExtPath = path.join(extensionsDir, match);
        }
      }
    }

    if (!officeExtPath || !fs.existsSync(officeExtPath)) {
      return;
    }

    const srcDir = path.join(extPath, 'media', 'markdown-editor');
    const dstDir = path.join(officeExtPath, 'resource', 'markdown');
    if (!fs.existsSync(srcDir) || !fs.existsSync(dstDir)) {
      return;
    }

    for (const file of [
      'omniAnnotations.js',
      'index.js',
      'util.js',
      'imagePath.js',
      'index.css',
      'index.html'
    ]) {
      const s = path.join(srcDir, file);
      const d = path.join(dstDir, file);
      if (fs.existsSync(s)) {
        const srcContent = fs.readFileSync(s, 'utf8');
        const dstContent = fs.existsSync(d) ? fs.readFileSync(d, 'utf8') : '';
        if (srcContent !== dstContent) {
          fs.writeFileSync(d, srcContent, 'utf8');
        }
      }
    }

    // Clean up any legacy markcoAnnotations.js file to avoid obsolete script references
    const legacyAnnotations = path.join(dstDir, 'markcoAnnotations.js');
    if (fs.existsSync(legacyAnnotations)) {
      try {
        fs.unlinkSync(legacyAnnotations);
      } catch {
        // Ignore removal error
      }
    }

    // Ensure out/extension.js in cweijan.vscode-office registers omni and legacy commands
    const officeOutExt = path.join(officeExtPath, 'out', 'extension.js');
    if (fs.existsSync(officeOutExt)) {
      let content = fs.readFileSync(officeOutExt, 'utf8');
      if (!content.includes('office.markdown.updateOmniCommentConfig')) {
        if (content.includes('office.markdown.openAddCommentInEditor')) {
          content = content.replace(
            'office.markdown.openAddCommentInEditor",t=>{zS("openAddCommentInEditor",{selectedText:t})});',
            'office.markdown.openAddCommentInEditor",t=>{zS("openAddCommentInEditor",{selectedText:t})});xP.commands.registerCommand("office.markdown.updateOmniCommentConfig",t=>{zS("updateOmniCommentConfig",t||{})});'
          );
          fs.writeFileSync(officeOutExt, content, 'utf8');
        } else {
          const hook = 'function zS(t,e){for(let r of yP.values())r.emit(t,e)}';
          const injection =
            'function zS(t,e){for(let r of yP.values())r.emit(t,e)}var xP=mt(require("vscode"));try{xP.commands.registerCommand("office.markdown.focusOmniComment",(t,e)=>{zS("focusOmniComment",{commentId:t,anchorText:e})});xP.commands.registerCommand("office.markdown.focusMarkcoComment",(t,e)=>{zS("focusOmniComment",{commentId:t,anchorText:e})});xP.commands.registerCommand("office.markdown.openAddCommentInEditor",t=>{zS("openAddCommentInEditor",{selectedText:t})});xP.commands.registerCommand("office.markdown.queryOmniInlineState",t=>{zS("queryOmniInlineState",t||{})});xP.commands.registerCommand("office.markdown.queryMarkcoInlineState",t=>{zS("queryOmniInlineState",t||{})});xP.commands.registerCommand("office.markdown.updateOmniCommentConfig",t=>{zS("updateOmniCommentConfig",t||{})})}catch{}';
          if (content.includes(hook)) {
            content = content.replace(hook, injection);
            fs.writeFileSync(officeOutExt, content, 'utf8');
          }
        }
      }
    }
  } catch (err) {
    console.warn('OmniComment: Could not auto-sync Markdown Editor assets:', err);
  }
}

const MARKDOWN_EXTENSIONS = [
  '.md',
  '.markdown',
  '.mdown',
  '.mkdn',
  '.mkd',
  '.mdwn',
  '.mdtxt',
  '.mdtext',
  '.skill',
  '.txt',
  '.text',
  '.log'
];

// Invariant: Checks whether the given language ID is supported for commenting.
// Why: Delegates to universal documentUtils to enable commenting across all supported languages.
// Example: isMarkdownCompatibleLanguage('plaintext') => true, isMarkdownCompatibleLanguage('python') => true.
export function isMarkdownCompatibleLanguage(languageId: string): boolean {
  return isSupportedCommentLanguage(languageId);
}

// Invariant: Checks whether the given URI is eligible for commenting.
// Why: Delegates to universal documentUtils scheme verification for workspace and virtual files.
// Example: isMarkdownCompatibleUri(vscode.Uri.file('/tmp/app.log')) => true.
export function isMarkdownCompatibleUri(uri: vscode.Uri): boolean {
  return isSupportedCommentUri(uri);
}

function toVscodeUri(candidate: unknown): vscode.Uri | undefined {
  // Invariant: Accept serialized URI strings (e.g. "file:///tmp/notes.txt").
  // Why: Hover markdown command links JSON-encode their args, so the Uri arrives as a string.
  // Example: toVscodeUri('file:///tmp/a.txt') => Uri(file, /tmp/a.txt).
  if (typeof candidate === 'string' && /^[a-z][\w+.-]*:/i.test(candidate)) {
    try {
      return vscode.Uri.parse(candidate, true);
    } catch {
      return undefined;
    }
  }
  if (!candidate || typeof candidate !== 'object') {
    return undefined;
  }
  if (candidate instanceof vscode.Uri) {
    return candidate;
  }
  const maybeUri = candidate as { scheme?: unknown; path?: unknown; fsPath?: unknown };
  if (typeof maybeUri.scheme === 'string' && typeof maybeUri.path === 'string') {
    try {
      if (maybeUri.scheme === 'file' && typeof maybeUri.fsPath === 'string') {
        return vscode.Uri.file(maybeUri.fsPath);
      }
      return vscode.Uri.from({
        scheme: maybeUri.scheme,
        path: maybeUri.path
      });
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Extracts a URI from a VS Code TabInput (supports standard text tabs, Custom Editors
 * such as "Markdown Editor", diff tabs, and notebook tabs).
 */
export function getUriFromTabInput(input: unknown): vscode.Uri | undefined {
  if (!input || typeof input !== 'object') {
    return undefined;
  }
  if ('uri' in input) {
    const uri = toVscodeUri((input as { uri?: unknown }).uri);
    if (uri) {
      return uri;
    }
  }
  if ('modified' in input) {
    const modified = toVscodeUri((input as { modified?: unknown }).modified);
    if (modified) {
      return modified;
    }
  }
  return undefined;
}

/**
 * Resolves the currently active Markdown/SKILL document and (if available) its TextEditor.
 * Works across standard text editors, custom editors (e.g. "Markdown Editor"), and previews.
 */
export async function getActiveMarkdownContext(preferredUri?: vscode.Uri): Promise<{
  document: vscode.TextDocument;
  editor?: vscode.TextEditor;
} | undefined> {
  // 0. If a preferred URI was passed (e.g. from editor/title menu command argument), check it first
  if (preferredUri && isMarkdownCompatibleUri(preferredUri)) {
    try {
      const existingDoc = vscode.workspace.textDocuments.find(
        d => d.uri.toString() === preferredUri.toString()
      );
      const document = existingDoc ?? (await vscode.workspace.openTextDocument(preferredUri));
      lastActiveMarkdownUri = document.uri;
      const matchingEditor = vscode.window.visibleTextEditors.find(
        e => e.document.uri.toString() === document.uri.toString()
      );
      return { document, editor: matchingEditor };
    } catch (err) {
      console.error('OmniComment: Failed to open preferred URI:', err);
    }
  }

  // 1. Check activeTextEditor first
  const activeEditor = vscode.window.activeTextEditor;
  if (
    activeEditor &&
    (isMarkdownCompatibleLanguage(activeEditor.document.languageId) ||
      isMarkdownCompatibleUri(activeEditor.document.uri))
  ) {
    lastActiveMarkdownUri = activeEditor.document.uri;
    return { document: activeEditor.document, editor: activeEditor };
  }

  // 2. Check active tab in tabGroups (handles Custom Editors like "Markdown Editor")
  const activeTab = vscode.window.tabGroups?.activeTabGroup?.activeTab;
  const tabUri = activeTab ? getUriFromTabInput(activeTab.input) : undefined;
  if (tabUri) {
    const existingDoc = vscode.workspace.textDocuments.find(
      d => d.uri.toString() === tabUri.toString()
    );
    if (
      isMarkdownCompatibleUri(tabUri) ||
      (existingDoc && isMarkdownCompatibleLanguage(existingDoc.languageId))
    ) {
      try {
        const document = existingDoc ?? (await vscode.workspace.openTextDocument(tabUri));
        lastActiveMarkdownUri = document.uri;
        const matchingEditor = vscode.window.visibleTextEditors.find(
          e => e.document.uri.toString() === document.uri.toString()
        );
        return { document, editor: matchingEditor };
      } catch (err) {
        console.error('OmniComment: Failed to open document from active tab:', err);
      }
    } else {
      // Active tab has a URI that is NOT markdown-compatible
      return undefined;
    }
  }

  // 3. Check visible text editors
  const visibleMdEditor = vscode.window.visibleTextEditors.find(
    e =>
      isMarkdownCompatibleLanguage(e.document.languageId) ||
      isMarkdownCompatibleUri(e.document.uri)
  );
  if (visibleMdEditor) {
    lastActiveMarkdownUri = visibleMdEditor.document.uri;
    return { document: visibleMdEditor.document, editor: visibleMdEditor };
  }

  // 4. Fallback to last active markdown URI if its tab is still open in any tab group
  if (lastActiveMarkdownUri) {
    const allTabs = vscode.window.tabGroups?.all.flatMap(group => group.tabs) ?? [];
    const stillOpen = allTabs.some(tab => {
      const u = getUriFromTabInput(tab.input);
      return u && u.toString() === lastActiveMarkdownUri?.toString();
    });
    if (stillOpen) {
      try {
        const document = await vscode.workspace.openTextDocument(lastActiveMarkdownUri);
        const matchingEditor = vscode.window.visibleTextEditors.find(
          e => e.document.uri.toString() === document.uri.toString()
        );
        return { document, editor: matchingEditor };
      } catch {
        // Ignore
      }
    }
  }

  return undefined;
}

function cleanCopiedSelection(text: string): string {
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\r\n/g, '\n')
    .trim();
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Checks if clipboard text exists as a valid anchor in the given document.
 */
async function getCandidateAnchorFromClipboard(
  document: vscode.TextDocument
): Promise<string | undefined> {
  try {
    const rawClip = await vscode.env.clipboard.readText();
    const clipText = cleanCopiedSelection(rawClip);
    if (!clipText || clipText.length > 2000) {
      return undefined;
    }
    const match = commentService.findAnchorTextInDocument(document, clipText);
    return match ? clipText : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Copies the current selection from an active Custom Editor / Webview (e.g. "Markdown Editor")
 * by ensuring the active editor group is focused before invoking `editor.action.clipboardCopyAction`
 * and waiting briefly for the asynchronous webview copy IPC to complete.
 */
async function captureSelectionFromCustomEditor(
  document: vscode.TextDocument
): Promise<string | undefined> {
  try {
    await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
    await delay(60);
    await vscode.commands.executeCommand('editor.action.clipboardCopyAction');
    await delay(150);
  } catch {
    // Ignore if focus or copy command is not supported in current view
  }
  return getCandidateAnchorFromClipboard(document);
}

async function saveDocumentIfCustomEditor(ctx: {
  document: vscode.TextDocument;
  editor?: vscode.TextEditor;
}): Promise<void> {
  if (!ctx.document.isUntitled && ctx.document.isDirty) {
    try {
      await ctx.document.save();
    } catch {
      // Ignore save errors
    }
  }
}

// Invariant: Ensures editor.glyphMargin is active for supported documents so gutter icons are visible.
// Why: Standard text editors (like plaintext .txt) collapse the glyph margin by default if not explicitly enabled.
// Example: ensureGlyphMarginForDocument(doc) ensures glyphMargin: true in configuration.
export function ensureGlyphMarginForDocument(document?: vscode.TextDocument): void {
  if (!document || !isSupportedCommentDocument(document)) {
    return;
  }
  try {
    const docConfig = vscode.workspace.getConfiguration('editor', document);
    if (!docConfig.get<boolean>('glyphMargin')) {
      docConfig.update('glyphMargin', true, vscode.ConfigurationTarget.Global);
    }
  } catch {
    // Non-critical if settings update is denied in test sandbox
  }
}

export function activate(context: vscode.ExtensionContext) {
  isTestMode = context.extensionMode === vscode.ExtensionMode.Test;
  console.log('OmniComment extension is now active');

  ensureGlyphMarginForDocument(vscode.window.activeTextEditor?.document);

  syncMarkdownEditorIntegration(context.extensionPath);

  // Initialize services
  commentService = new CommentService();
  commentDecorator = new CommentDecorator(context.extensionUri);
  inlineCommentController = new InlineCommentController();
  context.subscriptions.push(inlineCommentController);

  // Initialize sidebar provider with callbacks
  sidebarProvider = new CommentSidebarProvider(
    context.extensionUri,
    // Navigate callback
    async (commentId: string) => {
      console.log('OmniComment: Navigate to comment:', commentId);
      const ctx = await getActiveMarkdownContext();
      if (ctx) {
        const comment = commentService.findComment(ctx.document, commentId);
        console.log('OmniComment: Found comment:', comment);
        sidebarProvider.focusComment(commentId);
        if (comment && ctx.editor) {
          commentDecorator.navigateToComment(ctx.editor, comment);
          refreshDecorations(ctx.editor);
        } else if (comment) {
          vscode.commands
            .executeCommand(
              'office.markdown.focusOmniComment',
              comment.id,
              comment.anchor.text
            )
            .then(undefined, () => {});
        }
      } else {
        console.log('OmniComment: No markdown document active');
      }
    },
    // Delete callback
    async (commentId: string) => {
      const ctx = await getActiveMarkdownContext();
      if (ctx) {
        await commentService.deleteComment(ctx.document, commentId);
        await saveDocumentIfCustomEditor(ctx);
        await refreshForContext(ctx.document, ctx.editor);
      }
    },
    // Edit callback - now receives content directly from sidebar
    async (commentId: string, content: string) => {
      const ctx = await getActiveMarkdownContext();
      if (ctx) {
        await commentService.updateComment(ctx.document, commentId, content);
        await saveDocumentIfCustomEditor(ctx);
        await refreshForContext(ctx.document, ctx.editor);
        vscode.window.showInformationMessage('Comment updated');
      }
    },
    // Ready callback - sidebar is ready to receive data
    async () => {
      const ctx = await getActiveMarkdownContext();
      if (ctx) {
        await refreshForContext(ctx.document, ctx.editor);
      }
    },
    // Add reply callback - receives content directly from sidebar
    async (commentId: string, content: string) => {
      const ctx = await getActiveMarkdownContext();
      if (!ctx) {
        return;
      }

      const reply = await commentService.addReply(ctx.document, commentId, content);
      if (reply) {
        await saveDocumentIfCustomEditor(ctx);
        await refreshForContext(ctx.document, ctx.editor);
        vscode.window.showInformationMessage('Reply added');
      }
    },
    // Edit reply callback - receives content directly from sidebar
    async (commentId: string, replyId: string, content: string) => {
      const ctx = await getActiveMarkdownContext();
      if (!ctx) {
        return;
      }

      await commentService.updateReply(ctx.document, commentId, replyId, content);
      await saveDocumentIfCustomEditor(ctx);
      await refreshForContext(ctx.document, ctx.editor);
      vscode.window.showInformationMessage('Reply updated');
    },
    // Delete reply callback
    async (commentId: string, replyId: string) => {
      const ctx = await getActiveMarkdownContext();
      if (!ctx) {
        return;
      }

      const success = await commentService.deleteReply(ctx.document, commentId, replyId);
      if (success) {
        await saveDocumentIfCustomEditor(ctx);
        await refreshForContext(ctx.document, ctx.editor);
        vscode.window.showInformationMessage('Reply deleted');
      }
    },
    // Resolve comment callback
    async (commentId: string) => {
      const ctx = await getActiveMarkdownContext();
      if (!ctx) {
        return;
      }

      const comment = await commentService.resolveComment(ctx.document, commentId);
      if (comment) {
        await saveDocumentIfCustomEditor(ctx);
        await refreshForContext(ctx.document, ctx.editor);
        const action = comment.resolved ? 'resolved' : 'reopened';
        vscode.window.showInformationMessage(`Comment ${action}`);
      }
    },
    // Add comment callback - triggered from sidebar button, shows form in sidebar
    async () => {
      const ctx = await getActiveMarkdownContext();
      if (!ctx) {
        vscode.window.showErrorMessage('Please open a Markdown, text, or SKILL file to add comments');
        return;
      }

      if (ctx.editor) {
        // Standard text editor is available
        if (ctx.editor.selection.isEmpty) {
          ctx.editor.selection = expandSelectionAtCursor(
            ctx.editor.document,
            ctx.editor.selection.active
          );
        }
        const selectedText = ctx.editor.document.getText(ctx.editor.selection);
        sidebarProvider.showAddCommentForm(true, selectedText, false);
      } else {
        // Custom editor / viewer mode (e.g., "Markdown Editor")
        const clipAnchor = await captureSelectionFromCustomEditor(ctx.document);
        sidebarProvider.showAddCommentForm(Boolean(clipAnchor), clipAnchor, true);
        vscode.commands
          .executeCommand('office.markdown.openAddCommentInEditor', clipAnchor || '')
          .then(undefined, () => {});
      }
    },
    // Submit new comment callback - receives content and optional anchorText from sidebar form
    async (content: string, anchorText?: string) => {
      const ctx = await getActiveMarkdownContext();
      if (!ctx) {
        vscode.window.showErrorMessage('Please open a Markdown, text, or SKILL file to add comments');
        return;
      }

      let comment = null;
      const trimmedAnchor = anchorText?.trim();

      if (ctx.editor) {
        let selection = ctx.editor.selection;
        if (selection.isEmpty && !trimmedAnchor) {
          selection = expandSelectionAtCursor(ctx.document, selection.active);
          ctx.editor.selection = selection;
        }
        const selectedText = ctx.document.getText(selection).trim();
        if (!selection.isEmpty && (!trimmedAnchor || trimmedAnchor === selectedText)) {
          comment = await commentService.addComment(ctx.document, selection, content);
        } else if (trimmedAnchor) {
          comment = await commentService.addCommentByAnchorText(
            ctx.document,
            trimmedAnchor,
            content
          );
        }
      } else if (trimmedAnchor) {
        comment = await commentService.addCommentByAnchorText(
          ctx.document,
          trimmedAnchor,
          content
        );
      }

      if (comment) {
        await saveDocumentIfCustomEditor(ctx);
        await refreshForContext(ctx.document, ctx.editor);
        vscode.window.showInformationMessage('Comment added successfully');
      } else {
        vscode.window.showErrorMessage(
          trimmedAnchor
            ? 'Could not find the target text in the document to anchor the comment'
            : 'Please select or enter target text from the document to add a comment'
        );
      }
    },
    // Re-anchor callback - re-anchors an orphaned comment to current selection or entered text
    async (commentId: string) => {
      const ctx = await getActiveMarkdownContext();
      if (!ctx) {
        vscode.window.showErrorMessage('Please open a Markdown, text, or SKILL file');
        return;
      }

      if (ctx.editor && !ctx.editor.selection.isEmpty) {
        const comment = await commentService.reAnchorComment(
          ctx.document,
          commentId,
          ctx.editor.selection
        );
        if (comment) {
          await refreshForContext(ctx.document, ctx.editor);
          vscode.window.showInformationMessage('Comment re-anchored successfully');
        } else {
          vscode.window.showErrorMessage('Failed to re-anchor comment');
        }
        return;
      }

      // Custom editor or empty selection: prompt for target text (pre-filled from selection/clipboard if valid)
      const clipAnchor = await captureSelectionFromCustomEditor(ctx.document);
      const targetText = await vscode.window.showInputBox({
        prompt: 'Enter or paste text from the document to re-anchor this comment',
        value: clipAnchor || '',
        placeHolder: 'Target text in document...'
      });
      if (!targetText) {
        return;
      }

      const comment = await commentService.reAnchorCommentByText(
        ctx.document,
        commentId,
        targetText
      );
      if (comment) {
        await saveDocumentIfCustomEditor(ctx);
        await refreshForContext(ctx.document, ctx.editor);
        vscode.window.showInformationMessage('Comment re-anchored successfully');
      } else {
        vscode.window.showErrorMessage('Could not find the specified text in the document');
      }
    },
    // Thumbs up comment callback - toggles thumbs up on a comment
    async (commentId: string) => {
      const ctx = await getActiveMarkdownContext();
      if (!ctx) {
        return;
      }

      await commentService.toggleThumbsUpComment(ctx.document, commentId);
      await saveDocumentIfCustomEditor(ctx);
      await refreshForContext(ctx.document, ctx.editor);
    },
    // Thumbs up reply callback - toggles thumbs up on a reply
    async (commentId: string, replyId: string) => {
      const ctx = await getActiveMarkdownContext();
      if (!ctx) {
        return;
      }

      await commentService.toggleThumbsUpReply(ctx.document, commentId, replyId);
      await saveDocumentIfCustomEditor(ctx);
      await refreshForContext(ctx.document, ctx.editor);
    }
  );

  // Register sidebar webview provider
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      CommentSidebarProvider.viewType,
      sidebarProvider
    )
  );

  // Register Code Action Provider for in-editor selection quick actions
  // Invariant: Presents a visible lightbulb quick action when text is selected in standard text editors.
  // Why: Users in TextEditor mode see a prominent interactive prompt equivalent to the WYSIWYG comment chip.
  // Example: Selecting "heading" displays lightbulb "💬 Add OmniComment on \"heading\"".
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      [{ scheme: 'file' }, { scheme: 'untitled' }, { scheme: 'vscode-vfs' }],
      new CommentCodeActionProvider(),
      {
        providedCodeActionKinds: CommentCodeActionProvider.providedCodeActionKinds
      }
    )
  );

  // Status bar button for text editor commenting
  // Invariant: Displays an interactive status bar item when editing text/markdown documents.
  // Why: Gives an always-accessible clickable control to trigger OmniComment in any text editor.
  // Example: Clicking "$(comment) Add Comment" invokes omnicomment.addComment.
  const commentStatusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100
  );
  commentStatusBarItem.command = 'omnicomment.addComment';
  context.subscriptions.push(commentStatusBarItem);

  const updateStatusBar = (editor?: vscode.TextEditor): void => {
    if (!editor || !isSupportedCommentDocument(editor.document)) {
      commentStatusBarItem.hide();
      return;
    }
    const hasSelection = !editor.selection.isEmpty;
    if (hasSelection) {
      const selectedSnippet = editor.document.getText(editor.selection).slice(0, 30);
      commentStatusBarItem.text = '$(comment) Add Comment';
      commentStatusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      commentStatusBarItem.tooltip = `Add OmniComment on "${selectedSnippet}..." (Ctrl+Shift+M)`;
    } else {
      commentStatusBarItem.text = '$(comment) OmniComment';
      commentStatusBarItem.backgroundColor = undefined;
      commentStatusBarItem.tooltip = 'Add OmniComment at cursor (Ctrl+Shift+M)';
    }
    commentStatusBarItem.show();
  };

  // Invariant: A clickable CodeLens tracks the active selection in every supported TextEditor.
  // Why: Decoration gutter icons cannot receive clicks in VS Code; the lens is the clickable twin.
  // Example: select text in notes.txt -> "💬 Add Comment on ..." lens -> click -> comment prompt.
  selectionCodeLensProvider = new SelectionCodeLensProvider();
  context.subscriptions.push(
    selectionCodeLensProvider,
    vscode.languages.registerCodeLensProvider(
      [{ scheme: 'file' }, { scheme: 'untitled' }, { scheme: 'vscode-vfs' }],
      selectionCodeLensProvider
    )
  );

  const handleEditorSelectionOrActiveChange = (editor?: vscode.TextEditor): void => {
    if (editor?.document) {
      ensureGlyphMarginForDocument(editor.document);
    }
    updateStatusBar(editor);
    commentDecorator.updateSelectionDecoration(editor);
    selectionCodeLensProvider.onSelectionChanged(editor);
  };

  handleEditorSelectionOrActiveChange(vscode.window.activeTextEditor);
  const badgeClickDetector = new SelectionBadgeClickDetector();
  // Invariant: Seed the badge anchor from a selection that existed before any selection event.
  // Why: Activation or tab switches can show the badge without a prior selection-change event.
  // Example: text already selected when the extension activates -> first badge click still works.
  const primeBadgeDetector = (editor?: vscode.TextEditor): void => {
    if (editor) {
      badgeClickDetector.handle(editor.document, undefined, editor.selections);
    }
  };
  primeBadgeDetector(vscode.window.activeTextEditor);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      primeBadgeDetector(editor);
      handleEditorSelectionOrActiveChange(editor);
    }),
    vscode.window.onDidChangeTextEditorSelection(e => {
      const clickedRange = badgeClickDetector.handle(e.textEditor.document, e.kind, e.selections);
      writeDebugLog(
        `selection kind=${e.kind} sel=${e.selections
          .map(s => `${s.anchor.line}:${s.anchor.character}->${s.active.line}:${s.active.character}`)
          .join(',')} badgeClick=${clickedRange ? 'yes' : 'no'}`
      );
      if (clickedRange && isClickableSelectionBadgeEnabled()) {
        void openCommentFromSelectionBadge(e.textEditor, clickedRange);
        return;
      }
      handleEditorSelectionOrActiveChange(e.textEditor);
    })
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('omnicomment.addComment', addCommentCommand)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('omnicomment.deleteComment', deleteCommentCommand)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('omnicomment.editComment', editCommentCommand)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('omnicomment.toggleSidebar', async () => {
      try {
        await vscode.commands.executeCommand('omnicomment.commentSidebar.focus');
      } catch {
        const ctx = await getActiveMarkdownContext();
        if (ctx) {
          inlineCommentController.toggleAllThreads(ctx.document.uri);
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('omnicomment.navigateToComment', async (commentId: string) => {
      const ctx = await getActiveMarkdownContext();
      if (ctx) {
        const comment = commentService.findComment(ctx.document, commentId);
        if (comment) {
          sidebarProvider.focusComment(commentId);
          inlineCommentController.focusCommentThread(ctx.document.uri, comment.id);
          if (ctx.editor) {
            commentDecorator.navigateToComment(ctx.editor, comment);
            refreshDecorations(ctx.editor);
          } else {
            vscode.commands
              .executeCommand(
                'office.markdown.focusOmniComment',
                comment.id,
                comment.anchor.text
              )
              .then(undefined, () => {});
          }
        }
      }
    })
  );

  // In-editor comment action handler for custom editors (e.g. "Markdown Editor")
  context.subscriptions.push(
    vscode.commands.registerCommand('omnicomment.editorCommentAction', async (payload: {
      type:
        | 'addComment'
        | 'addReply'
        | 'editComment'
        | 'resolveComment'
        | 'thumbsUpComment'
        | 'deleteComment'
        | 'deleteReply'
        | 'reportInlineState';
      anchorText?: string;
      commentId?: string;
      replyId?: string;
      content?: string;
      uri?: vscode.Uri;
      state?: unknown;
    }) => {
      if (!payload || !payload.type) {
        return;
      }
      if (payload.type === 'reportInlineState') {
        if (pendingInlineStateResolver) {
          const resolve = pendingInlineStateResolver;
          pendingInlineStateResolver = undefined;
          resolve(payload.state);
        }
        return;
      }
      const ctx = await getActiveMarkdownContext(toVscodeUri(payload.uri));
      if (!ctx) {
        return;
      }

      switch (payload.type) {
        case 'addComment': {
          const content = payload.content?.trim();
          if (!content) {
            return;
          }
          let anchorText = payload.anchorText?.trim();
          if (!anchorText) {
            // Fallback to first non-empty line in the document if no target text was specified
            for (let i = 0; i < ctx.document.lineCount; i++) {
              const line = ctx.document.lineAt(i).text.trim();
              if (line && !line.startsWith('<!-- omnicomment')) {
                anchorText = line;
                break;
              }
            }
          }
          if (anchorText) {
            const added = await commentService.addCommentByAnchorText(
              ctx.document,
              anchorText,
              content
            );
            if (added) {
              await saveDocumentIfCustomEditor(ctx);
              await refreshForContext(ctx.document, ctx.editor);
            } else {
              vscode.window.showErrorMessage(
                'Could not find the specified target text in the Markdown document'
              );
            }
          }
          break;
        }
        case 'addReply': {
          if (payload.commentId && payload.content?.trim()) {
            await commentService.addReply(
              ctx.document,
              payload.commentId,
              payload.content.trim()
            );
            await saveDocumentIfCustomEditor(ctx);
            await refreshForContext(ctx.document, ctx.editor);
          }
          break;
        }
        case 'editComment': {
          if (payload.commentId && payload.content?.trim()) {
            await commentService.updateComment(
              ctx.document,
              payload.commentId,
              payload.content.trim()
            );
            await saveDocumentIfCustomEditor(ctx);
            await refreshForContext(ctx.document, ctx.editor);
          }
          break;
        }
        case 'resolveComment': {
          if (payload.commentId) {
            await commentService.resolveComment(ctx.document, payload.commentId);
            await saveDocumentIfCustomEditor(ctx);
            await refreshForContext(ctx.document, ctx.editor);
          }
          break;
        }
        case 'thumbsUpComment': {
          if (payload.commentId) {
            await commentService.toggleThumbsUpComment(ctx.document, payload.commentId);
            await saveDocumentIfCustomEditor(ctx);
            await refreshForContext(ctx.document, ctx.editor);
          }
          break;
        }
        case 'deleteComment': {
          if (payload.commentId) {
            await commentService.deleteComment(ctx.document, payload.commentId);
            await saveDocumentIfCustomEditor(ctx);
            await refreshForContext(ctx.document, ctx.editor);
          }
          break;
        }
        case 'deleteReply': {
          if (payload.commentId && payload.replyId) {
            await commentService.deleteReply(
              ctx.document,
              payload.commentId,
              payload.replyId
            );
            await saveDocumentIfCustomEditor(ctx);
            await refreshForContext(ctx.document, ctx.editor);
          }
          break;
        }
      }
    })
  );

  // Native VS Code Inline Comment Thread commands (for standard text editor)
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'omnicomment.inlineReplyComment',
      async (reply: vscode.CommentReply) => {
        if (!reply || !reply.text.trim()) {
          return;
        }
        const doc = await vscode.workspace.openTextDocument(reply.thread.uri);
        const existingId = inlineCommentController.getCommentIdForThread(reply.thread);
        const editor = vscode.window.visibleTextEditors.find(
          e => e.document.uri.toString() === doc.uri.toString()
        );
        if (existingId) {
          await commentService.addReply(doc, existingId, reply.text.trim());
          await saveDocumentIfCustomEditor({ document: doc, editor });
          await refreshForContext(doc, editor);
        } else {
          const selection = resolveAnchorSelectionForThread(doc, reply.thread.range);
          reply.thread.dispose();
          const comment = await commentService.addComment(doc, selection, reply.text.trim());
          if (comment) {
            await saveDocumentIfCustomEditor({ document: doc, editor });
            await refreshForContext(doc, editor);
          }
        }
      }
    ),
    vscode.commands.registerCommand(
      'omnicomment.inlineToggleResolve',
      async (thread: vscode.CommentThread) => {
        if (!thread) {
          return;
        }
        const commentId = inlineCommentController.getCommentIdForThread(thread);
        if (!commentId) {
          return;
        }
        const doc = await vscode.workspace.openTextDocument(thread.uri);
        const editor = vscode.window.visibleTextEditors.find(
          e => e.document.uri.toString() === doc.uri.toString()
        );
        await commentService.resolveComment(doc, commentId);
        await saveDocumentIfCustomEditor({ document: doc, editor });
        await refreshForContext(doc, editor);
      }
    ),
    vscode.commands.registerCommand(
      'omnicomment.inlineToggleCollapseThread',
      (thread: vscode.CommentThread) => {
        if (!thread) {
          return;
        }
        inlineCommentController.toggleThreadCollapsibleState(thread);
      }
    ),
    vscode.commands.registerCommand(
      'omnicomment.inlineDeleteThread',
      async (thread: vscode.CommentThread) => {
        if (!thread) {
          return;
        }
        const commentId = inlineCommentController.getCommentIdForThread(thread);
        if (!commentId) {
          thread.dispose();
          return;
        }
        const doc = await vscode.workspace.openTextDocument(thread.uri);
        const editor = vscode.window.visibleTextEditors.find(
          e => e.document.uri.toString() === doc.uri.toString()
        );
        await commentService.deleteComment(doc, commentId);
        await saveDocumentIfCustomEditor({ document: doc, editor });
        await refreshForContext(doc, editor);
      }
    ),
    vscode.commands.registerCommand(
      'omnicomment.inlineDeleteCommentItem',
      async (item: OmniCommentInlineItem) => {
        if (!item) {
          return;
        }
        const ctx = await getActiveMarkdownContext();
        if (!ctx) {
          return;
        }
        if (item.replyId) {
          await commentService.deleteReply(ctx.document, item.commentId, item.replyId);
        } else {
          await commentService.deleteComment(ctx.document, item.commentId);
        }
        await saveDocumentIfCustomEditor(ctx);
        await refreshForContext(ctx.document, ctx.editor);
      }
    ),
    vscode.commands.registerCommand('omnicomment.toggleCollapseAllComments', async () => {
      const ctx = await getActiveMarkdownContext();
      if (ctx) {
        inlineCommentController.toggleAllThreads(ctx.document.uri);
      }
    })
  );

  // Helper for agent API commands to locate target document
  const resolveDocumentContext = async (
    target?: string | vscode.Uri
  ): Promise<{ document: vscode.TextDocument; editor?: vscode.TextEditor } | undefined> => {
    if (target) {
      const uri =
        typeof target === 'string'
          ? target.startsWith('file://')
            ? vscode.Uri.parse(target)
            : vscode.Uri.file(target)
          : target;
      try {
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = vscode.window.visibleTextEditors.find(
          e => e.document.uri.toString() === doc.uri.toString()
        );
        return { document: doc, editor };
      } catch {
        return undefined;
      }
    }
    return getActiveMarkdownContext();
  };

  // Agent API Handlers (Programmatic access for AI agents and automation)
  const agentGetCommentsHandler = async (args?: {
    uri?: string | vscode.Uri;
    includeResolved?: boolean;
  }) => {
    const ctx = await resolveDocumentContext(args?.uri);
    if (!ctx) {
      return [];
    }
    const comments = commentService.getComments(ctx.document);
    if (args?.includeResolved === false) {
      return comments.filter(c => !c.resolved);
    }
    return comments;
  };

  const agentPostCommentHandler = async (args: {
    uri?: string | vscode.Uri;
    anchorText: string;
    content: string;
    author?: string;
  }) => {
    const ctx = await resolveDocumentContext(args?.uri);
    if (!ctx || !args?.anchorText || !args?.content) {
      return null;
    }
    const comment = await commentService.addCommentByAnchorText(
      ctx.document,
      args.anchorText,
      args.content
    );
    if (comment && args.author) {
      comment.author = args.author;
      const comments = commentService.getComments(ctx.document);
      await commentService.saveComments(ctx.document, comments);
    }
    if (comment) {
      await saveDocumentIfCustomEditor(ctx);
      await refreshForContext(ctx.document, ctx.editor);
    }
    return comment;
  };

  const agentReplyCommentHandler = async (args: {
    uri?: string | vscode.Uri;
    commentId: string;
    content: string;
    author?: string;
  }) => {
    const ctx = await resolveDocumentContext(args?.uri);
    if (!ctx || !args?.commentId || !args?.content) {
      return null;
    }
    const reply = await commentService.addReply(ctx.document, args.commentId, args.content);
    if (reply && args.author) {
      reply.author = args.author;
      const comments = commentService.getComments(ctx.document);
      await commentService.saveComments(ctx.document, comments);
    }
    if (reply) {
      await saveDocumentIfCustomEditor(ctx);
      await refreshForContext(ctx.document, ctx.editor);
    }
    return reply;
  };

  const agentResolveCommentHandler = async (args: {
    uri?: string | vscode.Uri;
    commentId: string;
    resolved?: boolean;
  }) => {
    const ctx = await resolveDocumentContext(args?.uri);
    if (!ctx || !args?.commentId) {
      return null;
    }
    const comment = commentService.findComment(ctx.document, args.commentId);
    if (!comment) {
      return null;
    }
    if (typeof args.resolved === 'boolean') {
      if (comment.resolved !== args.resolved) {
        comment.resolved = args.resolved;
        comment.updatedAt = new Date().toISOString();
        const comments = commentService.getComments(ctx.document);
        await commentService.saveComments(ctx.document, comments);
      }
    } else {
      await commentService.resolveComment(ctx.document, args.commentId);
    }
    await saveDocumentIfCustomEditor(ctx);
    await refreshForContext(ctx.document, ctx.editor);
    return commentService.findComment(ctx.document, args.commentId) || null;
  };

  const agentDeleteCommentHandler = async (args: {
    uri?: string | vscode.Uri;
    commentId: string;
  }) => {
    const ctx = await resolveDocumentContext(args?.uri);
    if (!ctx || !args?.commentId) {
      return { success: false };
    }
    const success = await commentService.deleteComment(ctx.document, args.commentId);
    if (success) {
      await saveDocumentIfCustomEditor(ctx);
      await refreshForContext(ctx.document, ctx.editor);
    }
    return { success };
  };

  const applyPresetHandler = async (presetName?: string) => {
    const presets = [
      { label: 'default', description: 'Standard in-file Markdown storage, balanced UI' },
      { label: 'documentation-site', description: 'Clean reading, lightweight chips, minimal UI overhead' },
      { label: 'git-file-review', description: 'Strict line anchoring, side-by-side diff focus, VC friendly' },
      { label: 'browser-annotator', description: 'High-contrast highlights, floating thread panels' },
      { label: 'team-collaboration', description: 'Full threading, author avatars, resolution workflows' },
      { label: 'ai-agent-reviewer', description: 'Agent badges, structured JSON output, automated check hooks' }
    ];

    let selectedPreset = presetName;
    if (!selectedPreset) {
      const picked = await vscode.window.showQuickPick(presets, {
        placeHolder: 'Select OmniComment Preset Profile'
      });
      if (!picked) {
        return;
      }
      selectedPreset = picked.label;
    }

    const config = vscode.workspace.getConfiguration('omnicomment');
    await config.update('preset', selectedPreset, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`OmniComment preset applied: ${selectedPreset}`);
  };

  // Register Agent APIs under omnicomment.agent.* and configuration commands
  context.subscriptions.push(
    vscode.commands.registerCommand('omnicomment.agent.getComments', agentGetCommentsHandler),
    vscode.commands.registerCommand('omnicomment.agent.postComment', agentPostCommentHandler),
    vscode.commands.registerCommand('omnicomment.agent.replyComment', agentReplyCommentHandler),
    vscode.commands.registerCommand('omnicomment.agent.resolveComment', agentResolveCommentHandler),
    vscode.commands.registerCommand('omnicomment.agent.deleteComment', agentDeleteCommentHandler),
    vscode.commands.registerCommand('omnicomment.applyPreset', applyPresetHandler),
    vscode.commands.registerCommand('omnicomment.configureCommentBox', configureCommentBoxHandler),
    vscode.commands.registerCommand('omnicomment.saveCommentBoxConfig', saveCommentBoxConfigHandler)
  );

  // Invariant: Listen for OmniComment configuration updates and broadcast to all active providers.
  // Why: Guarantees that adjustments made in settings.json or Settings UI take effect immediately.
  // Example: toggling omnicomment.commentBox.enableMarkdown updates open threads and webview cards.
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async event => {
      if (event.affectsConfiguration('omnicomment.commentBox')) {
        await broadcastCommentBoxConfig();
      }
    })
  );

  // Register backward compatibility aliases for OmniComment.* and OminiComment.*
  const aliasActionNames = [
    'addComment',
    'deleteComment',
    'editComment',
    'toggleSidebar',
    'navigateToComment',
    'editorCommentAction',
    'inlineReplyComment',
    'inlineToggleResolve',
    'inlineToggleCollapseThread',
    'inlineDeleteThread',
    'inlineDeleteCommentItem',
    'toggleCollapseAllComments'
  ];

  for (const action of aliasActionNames) {
    context.subscriptions.push(
      vscode.commands.registerCommand(`OmniComment.${action}`, (...args: any[]) =>
        vscode.commands.executeCommand(`omnicomment.${action}`, ...args)
      ),
      vscode.commands.registerCommand(`OminiComment.${action}`, (...args: any[]) =>
        vscode.commands.executeCommand(`omnicomment.${action}`, ...args)
      )
    );
  }

  // Listen for active editor changes
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async editor => {
      if (editor && (isMarkdownCompatibleLanguage(editor.document.languageId) || isMarkdownCompatibleUri(editor.document.uri))) {
        lastActiveMarkdownUri = editor.document.uri;
        await refreshAll(editor);
      } else {
        const ctx = await getActiveMarkdownContext();
        if (ctx) {
          await refreshForContext(ctx.document, ctx.editor);
        }
      }
    })
  );

  // Listen for tab changes to support Custom Editors (e.g., "Markdown Editor") and previews
  if (vscode.window.tabGroups) {
    context.subscriptions.push(
      vscode.window.tabGroups.onDidChangeTabs(async () => {
        const ctx = await getActiveMarkdownContext();
        if (ctx) {
          await refreshForContext(ctx.document, ctx.editor);
        }
      }),
      vscode.window.tabGroups.onDidChangeTabGroups(async () => {
        const ctx = await getActiveMarkdownContext();
        if (ctx) {
          await refreshForContext(ctx.document, ctx.editor);
        }
      })
    );
  }

  // Listen for document opens
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async doc => {
      ensureGlyphMarginForDocument(doc);
      if (
        isMarkdownCompatibleLanguage(doc.languageId) ||
        isMarkdownCompatibleUri(doc.uri)
      ) {
        const ctx = await getActiveMarkdownContext();
        if (ctx && ctx.document.uri.toString() === doc.uri.toString()) {
          await refreshForContext(ctx.document, ctx.editor);
        }
      }
    })
  );

  // Listen for document changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeTextDocument(async event => {
      if (
        isMarkdownCompatibleLanguage(event.document.languageId) ||
        isMarkdownCompatibleUri(event.document.uri)
      ) {
        commentService.clearCache(event.document);
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document === event.document) {
          refreshDecorations(editor);
        } else {
          const ctx = await getActiveMarkdownContext();
          if (ctx && ctx.document.uri.toString() === event.document.uri.toString()) {
            await refreshForContext(ctx.document, ctx.editor);
          }
        }
      }
    })
  );

  // Listen for document saves to reconcile anchors
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async document => {
      if (isMarkdownCompatibleLanguage(document.languageId) || isMarkdownCompatibleUri(document.uri)) {
        await commentService.reconcileAnchors(document);
        const ctx = await getActiveMarkdownContext();
        if (ctx && ctx.document.uri.toString() === document.uri.toString()) {
          await refreshForContext(ctx.document, ctx.editor);
        }
      }
    })
  );

  // Listen for cursor selection changes in text editors to focus active comments
  // Invariant: Tracks cursor movement across commented ranges to synchronize sidebar and thread focus.
  // Why: Clicking on highlighted text in standard editor immediately expands and highlights the active comment.
  // Example: Cursor moves into Line 12 "architecture" -> focuses comment thread and sidebar item.
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(event => {
      const editor = event.textEditor;
      if (!editor || !isMarkdownCompatibleLanguage(editor.document.languageId)) {
        return;
      }
      if (event.selections.length === 0) {
        return;
      }
      const comments = commentService.getComments(editor.document);
      const commentAtPos = commentDecorator.findCommentAtPosition(
        editor.document,
        event.selections[0].active,
        comments
      );
      if (commentAtPos && commentAtPos.id !== commentDecorator.getFocusedCommentId()) {
        commentDecorator.setFocusedComment(commentAtPos.id);
        refreshDecorations(editor);
        sidebarProvider.focusComment(commentAtPos.id);
        inlineCommentController.focusCommentThread(editor.document.uri, commentAtPos.id);
      }
    })
  );

  // Initial refresh if markdown file is already open in text editor or custom editor
  getActiveMarkdownContext().then(ctx => {
    if (ctx) {
      refreshForContext(ctx.document, ctx.editor);
    }
  });

  // Cleanup
  context.subscriptions.push({
    dispose: () => {
      commentDecorator.dispose();
    }
  });

  // Return markdown-it plugin for preview highlighting
  console.log('OmniComment: Returning extendMarkdownIt from activate()');
  return {
    extendMarkdownIt(md: any) {
      console.log('OmniComment: extendMarkdownIt called!');
      return md.use(omniCommentPreviewPlugin);
    }
  };
}

/**
 * Expands an empty selection to the containing word (including hyphens) or full line.
 * If cursor is at the beginning or end of the line, selects the entire line.
 * Otherwise, selects the word at the cursor position (including hyphenated words).
 */
function expandSelectionAtCursor(document: vscode.TextDocument, position: vscode.Position): vscode.Selection {
  const line = document.lineAt(position.line);
  const lineText = line.text;
  const charIndex = position.character;

  // If cursor is at beginning or end of line (or line is only whitespace), select entire line
  const trimmedLine = lineText.trim();
  if (charIndex === 0 || charIndex >= lineText.length || trimmedLine.length === 0) {
    return new vscode.Selection(line.range.start, line.range.end);
  }

  // Find word boundaries including hyphens
  // Word characters: letters, numbers, hyphens
  const wordPattern = /[\w-]+/g;
  let match: RegExpExecArray | null;
  
  while ((match = wordPattern.exec(lineText)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    
    // Check if cursor is within this word
    if (charIndex >= start && charIndex <= end) {
      return new vscode.Selection(
        new vscode.Position(position.line, start),
        new vscode.Position(position.line, end)
      );
    }
  }

  // If no word found at cursor, select entire line
  return new vscode.Selection(line.range.start, line.range.end);
}

// Invariant: Resolves a valid non-empty anchor selection for a newly created comment thread range.
// Why: When user clicks gutter (+) on empty or whitespace lines, standard selection is empty causing comment addition to fail.
// Example: Range on blank line 5 resolves to non-blank line 6 text selection.
export function resolveAnchorSelectionForThread(
  document: vscode.TextDocument,
  range?: vscode.Range
): vscode.Selection {
  if (range && !range.isEmpty) {
    const directText = document.getText(range).trim();
    if (directText.length > 0) {
      return new vscode.Selection(range.start, range.end);
    }
  }

  const baseLine = range ? range.start.line : 0;
  const clampedLine = Math.min(Math.max(0, baseLine), Math.max(0, document.lineCount - 1));

  // Check target line first
  const currentLineText = document.lineAt(clampedLine).text.trim();
  if (currentLineText.length > 0) {
    return expandSelectionAtCursor(document, new vscode.Position(clampedLine, 0));
  }

  // Scan downward, then upward for nearest non-empty line
  for (let offset = 1; offset < document.lineCount; offset++) {
    const downLine = clampedLine + offset;
    if (downLine < document.lineCount && document.lineAt(downLine).text.trim().length > 0) {
      return expandSelectionAtCursor(document, new vscode.Position(downLine, 0));
    }
    const upLine = clampedLine - offset;
    if (upLine >= 0 && document.lineAt(upLine).text.trim().length > 0) {
      return expandSelectionAtCursor(document, new vscode.Position(upLine, 0));
    }
  }

  return new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));
}

// Invariant: Reads comment box configuration parameters from workspace settings.
// Why: Provides unified configuration state for all editor modes (Markdown view, plain text, and sidebar).
// Example: getCommentBoxConfig() returns { widthMode: 'standard', minWidth: 320, maxWidth: 460, ... }
export function getCommentBoxConfig(): CommentBoxConfig {
  const config = vscode.workspace.getConfiguration('omnicomment');
  return {
    widthMode: config.get<CommentBoxWidthMode>('commentBox.widthMode', 'standard'),
    minWidth: config.get<number>('commentBox.minWidth', 320),
    maxWidth: config.get<number>('commentBox.maxWidth', 460),
    fontSize: config.get<number>('commentBox.fontSize', 12),
    enableMarkdown: config.get<boolean>('commentBox.enableMarkdown', true),
    showAvatars: config.get<boolean>('commentBox.showAvatars', true),
    showThreadGuide: config.get<boolean>('commentBox.showThreadGuide', true),
    defaultAuthor: config.get<string>('commentBox.defaultAuthor', '')
  };
}

// Invariant: Broadcasts comment box configuration changes to sidebar, inline controllers, and webviews.
// Why: Ensures all open comment cards across editors reflect user adjustments immediately without reload.
// Example: broadcastCommentBoxConfig() updates sidebar webview, inline comments, and Markdown Editor.
export async function broadcastCommentBoxConfig(customConfig?: CommentBoxConfig): Promise<void> {
  const cfg = customConfig || getCommentBoxConfig();
  if (sidebarProvider) {
    sidebarProvider.updateCommentBoxConfig(cfg);
  }
  if (inlineCommentController) {
    inlineCommentController.updateConfiguration();
  }
  try {
    await vscode.commands.executeCommand('office.markdown.updateOmniCommentConfig', cfg);
  } catch {
    // Office extension may not be active; ignore
  }
}

// Invariant: Prompts the user with density presets or custom pixel dimensions for comment box width.
// Why: Enables easy switching between compact, standard, wide, and custom box sizes.
// Example: user picks 'Compact' -> updates omnicomment.commentBox.widthMode to 'compact'.
async function configureWidthSetting(config: vscode.WorkspaceConfiguration, current: CommentBoxConfig): Promise<void> {
  const modePick = await vscode.window.showQuickPick([
    { label: 'Compact', description: '280px min, 360px max — ultra-compact footprint for narrow screens', mode: 'compact' },
    { label: 'Standard', description: '320px min, 460px max — balanced ergonomic layout (Recommended)', mode: 'standard' },
    { label: 'Wide', description: '420px min, 640px max — spacious card for large code blocks & discussions', mode: 'wide' },
    { label: 'Custom...', description: 'Specify exact minWidth and maxWidth in pixels', mode: 'custom' }
  ], { placeHolder: 'Select width density preset:' });
  if (!modePick) return;

  if (modePick.mode !== 'custom') {
    await config.update('commentBox.widthMode', modePick.mode, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Comment box width mode set to: ${modePick.label}`);
    return;
  }

  const minStr = await vscode.window.showInputBox({
    prompt: 'Enter minimum width in pixels (e.g. 350):',
    value: String(current.minWidth)
  });
  if (!minStr) return;
  const maxStr = await vscode.window.showInputBox({
    prompt: 'Enter maximum width in pixels (e.g. 550):',
    value: String(current.maxWidth)
  });
  if (!maxStr) return;
  const minW = parseInt(minStr, 10);
  const maxW = parseInt(maxStr, 10);
  if (!isNaN(minW) && !isNaN(maxW)) {
    await config.update('commentBox.widthMode', 'custom', vscode.ConfigurationTarget.Global);
    await config.update('commentBox.minWidth', minW, vscode.ConfigurationTarget.Global);
    await config.update('commentBox.maxWidth', maxW, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Comment box width set to custom: ${minW}px - ${maxW}px`);
  }
}

// Invariant: Prompts the user to pick a text font size for the comment cards.
// Why: Lets users tune readability according to screen scaling and personal preference.
// Example: user picks '11px' -> updates omnicomment.commentBox.fontSize to 11.
async function configureFontSizeSetting(config: vscode.WorkspaceConfiguration): Promise<void> {
  const sizePick = await vscode.window.showQuickPick([
    { label: '11px', description: 'Compact text', size: 11 },
    { label: '12px', description: 'Standard text (Default)', size: 12 },
    { label: '13px', description: 'Medium text', size: 13 },
    { label: '14px', description: 'Large text', size: 14 },
    { label: '16px', description: 'Extra large text', size: 16 }
  ], { placeHolder: 'Select comment text font size:' });
  if (!sizePick) return;
  await config.update('commentBox.fontSize', sizePick.size, vscode.ConfigurationTarget.Global);
  vscode.window.showInformationMessage(`Comment box font size set to: ${sizePick.label}`);
}

// Invariant: Prompts the user for a preferred default author name.
// Why: Customizes author identity attached to new comments without modifying git globals.
// Example: user enters 'Alice' -> updates omnicomment.commentBox.defaultAuthor to 'Alice'.
async function configureAuthorSetting(config: vscode.WorkspaceConfiguration, current: CommentBoxConfig): Promise<void> {
  const authorInput = await vscode.window.showInputBox({
    prompt: 'Enter your preferred default author name (leave blank to use Git/System username):',
    value: current.defaultAuthor
  });
  if (authorInput !== undefined) {
    await config.update('commentBox.defaultAuthor', authorInput.trim(), vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Default author set to: ${authorInput.trim() || '(Git / System user)'}`);
  }
}

// Invariant: Presents an interactive QuickPick allowing users to configure comment box dimensions, typography, and features.
// Why: Gives users a direct, frictionless way to configure the comment box without manual JSON editing.
// Example: user selects "Width / Density" to configure card size.
export async function configureCommentBoxHandler(): Promise<void> {
  const current = getCommentBoxConfig();
  const dims = resolveCommentBoxDimensions(current);

  const options: (vscode.QuickPickItem & { action: string })[] = [
    {
      label: `$(symbol-ruler) Width / Density: ${current.widthMode.toUpperCase()}`,
      description: `Min ${dims.minWidth}px, Max ${dims.maxWidth}px`,
      detail: 'Switch between Compact (280-360px), Standard (320-460px), Wide (420-640px), or Custom width',
      action: 'width'
    },
    {
      label: `$(text-size) Font Size: ${dims.fontSize}px`,
      description: `Current: ${dims.fontSize}px`,
      detail: 'Adjust base text size for comment body and replies',
      action: 'fontSize'
    },
    {
      label: `$(markdown) Markdown Formatting: ${current.enableMarkdown ? 'Enabled' : 'Disabled'}`,
      description: current.enableMarkdown ? 'Formatting bold, code, quotes, lists' : 'Rendering plain text',
      detail: 'Toggle rich Markdown rendering inside comment cards',
      action: 'markdown'
    },
    {
      label: `$(account) Author Avatars: ${current.showAvatars ? 'Shown' : 'Hidden'}`,
      description: current.showAvatars ? 'Author initial circles visible' : 'Hidden',
      detail: 'Toggle author initial circle badges in headers and replies',
      action: 'avatars'
    },
    {
      label: `$(list-tree) Thread Connector Guide: ${current.showThreadGuide ? 'Shown' : 'Hidden'}`,
      description: current.showThreadGuide ? 'Vertical connector line visible' : 'Hidden',
      detail: 'Toggle vertical connector indent guide for discussion replies',
      action: 'threadGuide'
    },
    {
      label: `$(person) Default Author Name: ${current.defaultAuthor ? current.defaultAuthor : '(Git / OS username)'}`,
      description: 'Display name attached to your comments and replies',
      detail: 'Customize default author identity',
      action: 'author'
    },
    {
      label: '$(gear) Open Full Settings in VS Code',
      description: 'Open OmniComment section in Settings Editor',
      detail: 'View and adjust all OmniComment configuration options',
      action: 'settings'
    }
  ];

  const picked = await vscode.window.showQuickPick(options, {
    placeHolder: 'Select a Comment Box option to configure:'
  });

  if (!picked) return;

  const config = vscode.workspace.getConfiguration('omnicomment');
  if (picked.action === 'width') {
    await configureWidthSetting(config, current);
  } else if (picked.action === 'fontSize') {
    await configureFontSizeSetting(config);
  } else if (picked.action === 'markdown') {
    const nextVal = !current.enableMarkdown;
    await config.update('commentBox.enableMarkdown', nextVal, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Comment Markdown formatting: ${nextVal ? 'Enabled' : 'Disabled'}`);
  } else if (picked.action === 'avatars') {
    const nextVal = !current.showAvatars;
    await config.update('commentBox.showAvatars', nextVal, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Comment author avatars: ${nextVal ? 'Shown' : 'Hidden'}`);
  } else if (picked.action === 'threadGuide') {
    const nextVal = !current.showThreadGuide;
    await config.update('commentBox.showThreadGuide', nextVal, vscode.ConfigurationTarget.Global);
    vscode.window.showInformationMessage(`Thread connector guide: ${nextVal ? 'Shown' : 'Hidden'}`);
  } else if (picked.action === 'author') {
    await configureAuthorSetting(config, current);
  } else if (picked.action === 'settings') {
    await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:benquike.omnicomment');
  }
}

// Invariant: Saves comment box configuration parameters submitted from the webview into VS Code settings.
// Why: Synchronizes changes made via the in-editor gear popover with persistent workspace configuration.
// Example: saveCommentBoxConfigHandler({ widthMode: 'compact' }) updates omnicomment.commentBox.widthMode.
export async function saveCommentBoxConfigHandler(newConfig: Partial<CommentBoxConfig>): Promise<void> {
  if (!newConfig || typeof newConfig !== 'object') {
    return;
  }
  const config = vscode.workspace.getConfiguration('omnicomment');
  if (newConfig.widthMode !== undefined) {
    await config.update('commentBox.widthMode', newConfig.widthMode, vscode.ConfigurationTarget.Global);
  }
  if (newConfig.minWidth !== undefined) {
    await config.update('commentBox.minWidth', newConfig.minWidth, vscode.ConfigurationTarget.Global);
  }
  if (newConfig.maxWidth !== undefined) {
    await config.update('commentBox.maxWidth', newConfig.maxWidth, vscode.ConfigurationTarget.Global);
  }
  if (newConfig.fontSize !== undefined) {
    await config.update('commentBox.fontSize', newConfig.fontSize, vscode.ConfigurationTarget.Global);
  }
  if (newConfig.enableMarkdown !== undefined) {
    await config.update('commentBox.enableMarkdown', newConfig.enableMarkdown, vscode.ConfigurationTarget.Global);
  }
  if (newConfig.showAvatars !== undefined) {
    await config.update('commentBox.showAvatars', newConfig.showAvatars, vscode.ConfigurationTarget.Global);
  }
  if (newConfig.showThreadGuide !== undefined) {
    await config.update('commentBox.showThreadGuide', newConfig.showThreadGuide, vscode.ConfigurationTarget.Global);
  }
  if (newConfig.defaultAuthor !== undefined) {
    await config.update('commentBox.defaultAuthor', newConfig.defaultAuthor, vscode.ConfigurationTarget.Global);
  }
}

// Invariant: Prompts user for comment text in standard TextEditor mode using VS Code input box.
// Why: workbench.action.addComment fails silently without an existing interactive thread; prompt guarantees comment creation.
// Example: User selects "heading", prompt displays 'Add comment on "heading"', user types "needs revision".
async function promptForTextEditorCommentContent(selectedText: string): Promise<string | undefined> {
  if (isTestMode) {
    return undefined;
  }
  const promptText =
    selectedText.length > 36
      ? `Add comment on "${selectedText.slice(0, 33)}..."`
      : `Add comment on "${selectedText}"`;

  const entered = await vscode.window.showInputBox({
    prompt: promptText,
    placeHolder: 'Type your comment and press Enter...'
  });

  return entered && entered.trim() ? entered.trim() : undefined;
}

// Invariant: Appends a line to $OMNICOMMENT_DEBUG_LOG only when that variable is set.
// Why: Real mouse interactions cannot be observed from tests; this records what VS Code reports.
// Example: OMNICOMMENT_DEBUG_LOG=/tmp/oc.log -> "selection kind=2 sel=1:0->1:5 badgeClick=no".
function writeDebugLog(message: string): void {
  const logPath = process.env.OMNICOMMENT_DEBUG_LOG;
  if (!logPath) {
    return;
  }
  try {
    fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // Debug logging must never break the extension
  }
}

// Invariant: Badge clicks are on by default and can be disabled per user.
// Why: Detection is positional, so a plain click exactly at a selection's end also matches.
// Example: "omnicomment.clickableSelectionBadge": false -> badge is display-only.
function isClickableSelectionBadgeEnabled(): boolean {
  return vscode.workspace
    .getConfiguration('omnicomment')
    .get<boolean>('clickableSelectionBadge', true);
}

// Invariant: Re-selects the text the badge belonged to, then opens the comment prompt for it.
// Why: The click collapsed the selection; restoring it shows the user what is being commented.
// Example: click "💬 Comment" after "bravo" -> "bravo" re-highlighted -> "Add comment on "bravo"".
export async function openCommentFromSelectionBadge(
  editor: vscode.TextEditor,
  clickedRange: vscode.Range
): Promise<void> {
  writeDebugLog(`badge click -> addComment ${clickedRange.start.line}:${clickedRange.start.character}`);
  editor.selection = new vscode.Selection(clickedRange.start, clickedRange.end);
  await vscode.commands.executeCommand('omnicomment.addComment', {
    uri: editor.document.uri,
    range: clickedRange,
    source: 'selectionBadge'
  });
}

export interface ParsedAddCommentOptions {
  preferredUri?: vscode.Uri;
  selectedText?: string;
  content?: string;
  targetRange?: vscode.Range;
  openSidebar: boolean;
  quietCancel: boolean;
}

// Invariant: Parses polymorphic arguments passed to omnicomment.addComment from menus, hover links, and gutter icons.
// Why: Unifies handling of Uri, CommentReply, LineNumberContext, hover parameter arrays, and object payloads.
// Example: parseAddCommentArgument({ thread: { uri, range } }) => extracts preferredUri and targetRange.
export function parseAddCommentArgument(arg?: unknown): ParsedAddCommentOptions {
  const result: ParsedAddCommentOptions = {
    openSidebar: false,
    quietCancel: false
  };

  if (!arg) {
    return result;
  }

  // Handle single Uri
  const directUri = toVscodeUri(arg);
  if (directUri) {
    result.preferredUri = directUri;
    return result;
  }

  // Handle array from markdown link command:command?args
  const candidate = Array.isArray(arg) && arg.length > 0 ? arg[0] : arg;
  if (!candidate || typeof candidate !== 'object') {
    return result;
  }

  const obj = candidate as Record<string, unknown>;

  // Check for VS Code native CommentReply (from gutter + comment range)
  if (obj.thread && typeof obj.thread === 'object') {
    const thread = obj.thread as { uri?: unknown; range?: unknown };
    result.preferredUri = toVscodeUri(thread.uri);
    if (thread.range instanceof vscode.Range) {
      result.targetRange = thread.range;
    }
    if (typeof obj.text === 'string' && obj.text.trim()) {
      result.content = obj.text.trim();
    }
  }

  // Check for line number context (from editor/lineNumber/context)
  if (typeof obj.lineNumber === 'number' && obj.uri) {
    result.preferredUri = toVscodeUri(obj.uri);
    const lineZero = Math.max(0, obj.lineNumber - 1);
    result.targetRange = new vscode.Range(lineZero, 0, lineZero, 0);
  }

  // Check for standard fields
  if (obj.uri && !result.preferredUri) {
    result.preferredUri = toVscodeUri(obj.uri);
  }
  if (typeof obj.selectedText === 'string' && obj.selectedText.trim()) {
    result.selectedText = cleanCopiedSelection(obj.selectedText);
  }
  if (typeof obj.content === 'string' && obj.content.trim()) {
    result.content = obj.content.trim();
  }
  if (typeof obj.openSidebar === 'boolean') {
    result.openSidebar = obj.openSidebar;
  }
  if (obj.source === 'selectionBadge') {
    result.quietCancel = true;
  }
  if (obj.range instanceof vscode.Range && !result.targetRange) {
    result.targetRange = obj.range;
  }

  return result;
}

// Invariant: The live, non-empty editor selection wins; a passed range is only a fallback.
// Why: CodeLens/hover/line-menu args are captured earlier and would reuse an old anchor,
//      making every new selection open the same comment box.
// Example: live "bravo" + stale range "alpha" => "bravo"; empty caret + range "alpha" => "alpha".
export function resolveTextEditorCommentSelection(
  editor: vscode.TextEditor,
  fallbackRange?: vscode.Range
): vscode.Selection {
  const live = editor.selection;
  if (!live.isEmpty && editor.document.getText(live).trim()) {
    return live;
  }
  if (fallbackRange && !fallbackRange.isEmpty) {
    return new vscode.Selection(fallbackRange.start, fallbackRange.end);
  }
  const caret = fallbackRange ? fallbackRange.start : live.active;
  return expandSelectionAtCursor(editor.document, caret);
}

async function addCommentCommand(arg?: unknown) {
  const options = parseAddCommentArgument(arg);

  const ctx = await getActiveMarkdownContext(options.preferredUri);
  if (!ctx) {
    vscode.window.showErrorMessage('Please open an active document to add comments');
    return;
  }

  await refreshForContext(ctx.document, ctx.editor);

  if (ctx.editor) {
    const selection = resolveTextEditorCommentSelection(ctx.editor, options.targetRange);
    ctx.editor.selection = selection;

    // Invariant: The anchor text always comes from the document at the resolved selection.
    // Why: Lens/hover args carry text captured at render time and go stale after reselection.
    // Example: lens built for "alpha", user selects "bravo" -> anchor "bravo".
    const selectedText = ctx.editor.document.getText(selection);

    if (options.openSidebar) {
      sidebarProvider.showAddCommentForm(true, selectedText, true);
      return;
    }

    const commentBody =
      options.content || (await promptForTextEditorCommentContent(selectedText));
    if (!commentBody) {
      // Invariant: Cancelling a badge-click prompt is silent.
      // Why: An accidental badge match must not pop open the sidebar form.
      // Example: click at selection end, press Escape -> nothing else happens.
      if (options.quietCancel) {
        return;
      }
      sidebarProvider.showAddCommentForm(true, selectedText, false);
      return;
    }

    const comment = await commentService.addComment(ctx.document, selection, commentBody);
    if (comment) {
      await saveDocumentIfCustomEditor(ctx);
      await refreshForContext(ctx.document, ctx.editor);
      vscode.window.showInformationMessage('Comment added');
    }
  } else {
    // Custom editor / viewer mode (e.g., "Markdown Editor")
    let anchorCandidate = options.selectedText;
    if (!anchorCandidate) {
      anchorCandidate = await captureSelectionFromCustomEditor(ctx.document);
    }
    sidebarProvider.showAddCommentForm(Boolean(anchorCandidate), anchorCandidate, true);
    if (!options.openSidebar) {
      // Open the inline comment composer directly inside "Markdown Editor"
      await vscode.commands
        .executeCommand(
          'office.markdown.openAddCommentInEditor',
          anchorCandidate || ''
        )
        .then(undefined, () => {});
    }
  }
}

async function deleteCommentCommand(commentId?: string) {
  const ctx = await getActiveMarkdownContext();
  if (!ctx) {
    return;
  }

  if (!commentId) {
    if (!ctx.editor) {
      return;
    }
    // If no ID provided, try to find comment at cursor position
    const comments = commentService.getComments(ctx.document);
    const comment = commentDecorator.findCommentAtPosition(
      ctx.document,
      ctx.editor.selection.active,
      comments
    );
    if (comment) {
      commentId = comment.id;
    } else {
      vscode.window.showErrorMessage('No comment found at cursor position');
      return;
    }
  }

  const success = await commentService.deleteComment(ctx.document, commentId);
  if (success) {
    await saveDocumentIfCustomEditor(ctx);
    await refreshForContext(ctx.document, ctx.editor);
    vscode.window.showInformationMessage('Comment deleted');
  }
}

async function editCommentCommand(commentId?: string) {
  const ctx = await getActiveMarkdownContext();
  if (!ctx) {
    return;
  }

  if (!commentId) {
    if (!ctx.editor) {
      return;
    }
    const comments = commentService.getComments(ctx.document);
    const comment = commentDecorator.findCommentAtPosition(
      ctx.document,
      ctx.editor.selection.active,
      comments
    );
    if (comment) {
      commentId = comment.id;
    } else {
      vscode.window.showErrorMessage('No comment found at cursor position');
      return;
    }
  }

  inlineCommentController.focusCommentThread(ctx.document.uri, commentId);
  sidebarProvider.focusComment(commentId);
}

async function refreshAll(editor: vscode.TextEditor) {
  await refreshForContext(editor.document, editor);
}

async function refreshForContext(
  document: vscode.TextDocument,
  editor?: vscode.TextEditor
) {
  const comments = commentService.parseComments(document);
  const matchingEditors = vscode.window.visibleTextEditors.filter(
    e => e.document.uri.toString() === document.uri.toString()
  );
  if (editor && !matchingEditors.some(e => e === editor)) {
    matchingEditors.push(editor);
  }
  for (const e of matchingEditors) {
    commentDecorator.applyDecorations(e, comments);
  }
  inlineCommentController.syncDocumentComments(document, comments);
  // Sort comments by line number for logical ordering
  const sortedComments = [...comments].sort((a, b) => {
    if (a.anchor.startLine !== b.anchor.startLine) {
      return a.anchor.startLine - b.anchor.startLine;
    }
    return a.anchor.startChar - b.anchor.startChar;
  });
  const currentUser = await commentService.getGitUserName(document);
  sidebarProvider.refresh(sortedComments, currentUser);
}

function refreshDecorations(editor: vscode.TextEditor) {
  const comments = commentService.getComments(editor.document);
  commentDecorator.applyDecorations(editor, comments);
  inlineCommentController.syncDocumentComments(editor.document, comments);
}

export function getSidebarProviderForTesting(): CommentSidebarProvider {
  return sidebarProvider;
}

export function getCommentServiceForTesting(): CommentService {
  return commentService;
}

export function getInlineCommentControllerForTesting(): InlineCommentController {
  return inlineCommentController;
}

// Invariant: Exposes the active CommentDecorator instance for test verification.
// Why: Enables automated testing of gutter icons and text selection decorations.
// Example: getCommentDecoratorForTesting().updateSelectionDecoration(editor);
export function getCommentDecoratorForTesting(): CommentDecorator {
  return commentDecorator;
}

export function getSelectionCodeLensProviderForTesting(): SelectionCodeLensProvider {
  return selectionCodeLensProvider;
}

export async function queryMarkdownEditorInlineStateForTesting(
  clickSelector?: string,
  timeoutMs = 2000,
  inputSelector?: string,
  inputValue?: string
): Promise<{
  zoneCount: number;
  totalZoneCount?: number;
  threadCount: number;
  visibleThreadCount?: number;
  highlightCount?: number;
  gutterChipCount?: number;
  gutterChips?: Array<{
    top: string;
    left: string;
    className: string;
    isCollapsed: boolean;
    text: string;
  }>;
  activeBlockCountsSize?: number;
  activeBlocks?: any[];
  activeGutterTargetsSize?: number;
  activeGutterTargets?: any[];
  viewportRect?: any;
  commentRangesCount?: number;
  commentRangesDetails?: any[];
  commentRangesBlocks?: string[];
  threads: Array<{
    commentId: string;
    isCollapsed: boolean;
    isHidden?: boolean;
    isResolved: boolean;
    text: string;
    replyCount: number;
    hasReplyBox: boolean;
    isBelowBlock: boolean;
  }>;
} | null> {
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      if (pendingInlineStateResolver) {
        pendingInlineStateResolver = undefined;
      }
      resolve(null);
    }, timeoutMs);
    pendingInlineStateResolver = (state: any) => {
      clearTimeout(timer);
      resolve(state);
    };
    const payload = {
      clickSelector,
      inputSelector,
      inputValue
    };
    (async () => {
      try {
        await vscode.commands.executeCommand('office.markdown.queryOmniInlineState', payload);
      } catch {
        clearTimeout(timer);
        pendingInlineStateResolver = undefined;
        resolve(null);
      }
    })();
  });
}

export function deactivate() {
  console.log('OmniComment extension deactivated');
}
