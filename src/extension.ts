import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { CommentService } from './services/CommentService';
import { CommentDecorator } from './decorators/CommentDecorator';
import { CommentSidebarProvider } from './providers/CommentSidebarProvider';
import {
  InlineCommentController,
  MarkcoInlineCommentItem
} from './providers/InlineCommentController';
import { markcoPreviewPlugin } from './markdown/markcoPreviewPlugin';

let commentService: CommentService;
let commentDecorator: CommentDecorator;
let sidebarProvider: CommentSidebarProvider;
let inlineCommentController: InlineCommentController;
let lastActiveMarkdownUri: vscode.Uri | undefined;
let pendingInlineStateResolver: ((state: any) => void) | undefined;

/**
 * Automatically ensures any installed `cweijan.vscode-office` ("Markdown Editor") extension
 * has the latest inlined comment widget assets (`markcoAnnotations.js`, `index.js`, `util.js`,
 * `imagePath.js`, `index.css`) synced into its `resource/markdown/` directory.
 */
function syncMarkdownEditorIntegration(markcoExtPath: string): void {
  try {
    const officeExt = vscode.extensions.getExtension('cweijan.vscode-office');
    if (!officeExt?.extensionPath) {
      return;
    }
    const srcDir = path.join(markcoExtPath, 'media', 'markdown-editor');
    const dstDir = path.join(officeExt.extensionPath, 'resource', 'markdown');
    if (!fs.existsSync(srcDir) || !fs.existsSync(dstDir)) {
      return;
    }
    for (const file of [
      'markcoAnnotations.js',
      'index.js',
      'util.js',
      'imagePath.js',
      'index.css'
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
  } catch (err) {
    console.warn('Markco: Could not auto-sync Markdown Editor assets:', err);
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
  '.skill'
];

export function isMarkdownCompatibleLanguage(languageId: string): boolean {
  return languageId === 'markdown' || languageId === 'skill';
}

export function isMarkdownCompatibleUri(uri: vscode.Uri): boolean {
  if (uri.scheme !== 'file' && uri.scheme !== 'untitled' && uri.scheme !== 'vscode-vfs') {
    return false;
  }
  const lowerPath = uri.path.toLowerCase();
  return MARKDOWN_EXTENSIONS.some(ext => lowerPath.endsWith(ext));
}

function toVscodeUri(candidate: unknown): vscode.Uri | undefined {
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
      console.error('Markco: Failed to open preferred URI:', err);
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
        console.error('Markco: Failed to open document from active tab:', err);
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

export function activate(context: vscode.ExtensionContext) {
  console.log('Markco extension is now active');

  syncMarkdownEditorIntegration(context.extensionPath);

  // Initialize services
  commentService = new CommentService();
  commentDecorator = new CommentDecorator();
  inlineCommentController = new InlineCommentController();
  context.subscriptions.push(inlineCommentController);

  // Initialize sidebar provider with callbacks
  sidebarProvider = new CommentSidebarProvider(
    context.extensionUri,
    // Navigate callback
    async (commentId: string) => {
      console.log('Markco: Navigate to comment:', commentId);
      const ctx = await getActiveMarkdownContext();
      if (ctx) {
        const comment = commentService.findComment(ctx.document, commentId);
        console.log('Markco: Found comment:', comment);
        sidebarProvider.focusComment(commentId);
        if (comment && ctx.editor) {
          commentDecorator.navigateToComment(ctx.editor, comment);
          refreshDecorations(ctx.editor);
        } else if (comment) {
          vscode.commands
            .executeCommand(
              'office.markdown.focusMarkcoComment',
              comment.id,
              comment.anchor.text
            )
            .then(undefined, () => {});
        }
      } else {
        console.log('Markco: No markdown document active');
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
        vscode.window.showErrorMessage('Please open a Markdown or SKILL file to add comments');
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
        vscode.window.showErrorMessage('Please open a Markdown or SKILL file to add comments');
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
        vscode.window.showErrorMessage('Please open a Markdown or SKILL file');
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

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('markco.addComment', addCommentCommand)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markco.deleteComment', deleteCommentCommand)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markco.editComment', editCommentCommand)
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markco.toggleSidebar', async () => {
      const ctx = await getActiveMarkdownContext();
      if (ctx) {
        inlineCommentController.toggleAllThreads(ctx.document.uri);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('markco.navigateToComment', async (commentId: string) => {
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
                'office.markdown.focusMarkcoComment',
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
    vscode.commands.registerCommand('markco.editorCommentAction', async (payload: {
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
              if (line && !line.startsWith('<!-- markco-comments')) {
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
      'markco.inlineReplyComment',
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
          const range = reply.thread.range;
          let selection: vscode.Selection;
          if (!range || range.isEmpty) {
            const lineNum = range ? range.start.line : 0;
            selection = expandSelectionAtCursor(doc, new vscode.Position(lineNum, 0));
          } else {
            selection = new vscode.Selection(range.start, range.end);
          }
          reply.thread.dispose();
          await commentService.addComment(doc, selection, reply.text.trim());
          await saveDocumentIfCustomEditor({ document: doc, editor });
          await refreshForContext(doc, editor);
        }
      }
    ),
    vscode.commands.registerCommand(
      'markco.inlineToggleResolve',
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
      'markco.inlineDeleteThread',
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
      'markco.inlineDeleteCommentItem',
      async (item: MarkcoInlineCommentItem) => {
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
    vscode.commands.registerCommand('markco.toggleCollapseAllComments', async () => {
      const ctx = await getActiveMarkdownContext();
      if (ctx) {
        inlineCommentController.toggleAllThreads(ctx.document.uri);
      }
    })
  );

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
  console.log('Markco: Returning extendMarkdownIt from activate()');
  return {
    extendMarkdownIt(md: any) {
      console.log('Markco: extendMarkdownIt called!');
      return md.use(markcoPreviewPlugin);
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

async function addCommentCommand(arg?: unknown) {
  let preferredUri: vscode.Uri | undefined;
  let passedSelectedText: string | undefined;
  let openSidebar = false;

  if (arg) {
    const directUri = toVscodeUri(arg);
    if (directUri) {
      preferredUri = directUri;
    } else if (typeof arg === 'object') {
      const obj = arg as {
        uri?: unknown;
        selectedText?: unknown;
        openSidebar?: unknown;
      };
      if (obj.uri) {
        preferredUri = toVscodeUri(obj.uri);
      }
      if (typeof obj.selectedText === 'string' && obj.selectedText.trim()) {
        passedSelectedText = cleanCopiedSelection(obj.selectedText);
      }
      if (typeof obj.openSidebar === 'boolean') {
        openSidebar = obj.openSidebar;
      }
    }
  }

  const ctx = await getActiveMarkdownContext(preferredUri);
  if (!ctx) {
    vscode.window.showErrorMessage('Please open a Markdown or SKILL file to add comments');
    return;
  }

  await refreshForContext(ctx.document, ctx.editor);

  if (ctx.editor) {
    let selection = ctx.editor.selection;

    // If no text is selected, expand selection based on cursor position
    if (selection.isEmpty) {
      selection = expandSelectionAtCursor(ctx.editor.document, selection.active);
      // Update editor selection to show what will be commented
      ctx.editor.selection = selection;
    }

    const selectedText = ctx.editor.document.getText(selection);

    // Update form state in background for unit/e2e tests
    sidebarProvider.showAddCommentForm(true, selectedText, false);
    if (!openSidebar) {
      // Open native in-editor comment widget at cursor/selection
      await vscode.commands
        .executeCommand('workbench.action.addComment')
        .then(undefined, () => {});
    }
  } else {
    // Custom editor / viewer mode (e.g., "Markdown Editor")
    let anchorCandidate = passedSelectedText;
    if (!anchorCandidate) {
      anchorCandidate = await captureSelectionFromCustomEditor(ctx.document);
    }
    sidebarProvider.showAddCommentForm(Boolean(anchorCandidate), anchorCandidate, true);
    if (!openSidebar) {
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
  if (editor) {
    commentDecorator.applyDecorations(editor, comments);
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
    vscode.commands
      .executeCommand('office.markdown.queryMarkcoInlineState', {
        clickSelector,
        inputSelector,
        inputValue
      })
      .then(undefined, () => {
        clearTimeout(timer);
        pendingInlineStateResolver = undefined;
        resolve(null);
      });
  });
}

export function deactivate() {
  console.log('Markco extension deactivated');
}
