import * as vscode from 'vscode';
import { Comment, SidebarMessage } from '../types';

/**
 * Provides the webview sidebar for displaying and managing comments
 */
export class CommentSidebarProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'omnicomment.commentSidebar';
  private _view?: vscode.WebviewView;
  private _comments: Comment[] = [];
  private _focusedCommentId: string | null = null;
  private _isReady = false;
  private _pendingAddCommentForm: {
    hasSelection: boolean;
    anchorText?: string;
    isCustomEditor?: boolean;
  } | null = null;
  private _pendingFocusCommentId: string | null = null;

  private _stateResolvers: Array<
    (state: {
      isFormOpen: boolean;
      anchorText: string;
      commentInput: string;
      renderedCount: number;
    }) => void
  > = [];

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _onNavigate: (commentId: string) => void | Promise<void>,
    private readonly _onDelete: (commentId: string) => void | Promise<void>,
    private readonly _onEdit: (commentId: string, content: string) => void | Promise<void>,
    private readonly _onReady?: () => void | Promise<void>,
    private readonly _onAddReply?: (
      commentId: string,
      content: string,
      inReplyTo?: string
    ) => void | Promise<void>,
    private readonly _onEditReply?: (commentId: string, replyId: string, content: string) => void | Promise<void>,
    private readonly _onDeleteReply?: (commentId: string, replyId: string) => void | Promise<void>,
    private readonly _onResolve?: (commentId: string) => void | Promise<void>,
    private readonly _onAddComment?: () => void | Promise<void>,
    private readonly _onSubmitNewComment?: (content: string, anchorText?: string) => void | Promise<void>,
    private readonly _onReAnchor?: (commentId: string) => void | Promise<void>,
    private readonly _onThumbsUpComment?: (commentId: string) => void | Promise<void>,
    private readonly _onThumbsUpReply?: (commentId: string, replyId: string) => void | Promise<void>
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this._view = webviewView;
    this._isReady = false;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this._getHtmlContent(webviewView.webview);

    webviewView.onDidDispose(() => {
      this._view = undefined;
      this._isReady = false;
    });

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(async (message: SidebarMessage) => {
      switch (message.type) {
        case 'navigateToComment':
          this._onNavigate(message.commentId);
          break;
        case 'deleteComment':
          this._onDelete(message.commentId);
          break;
        case 'editComment':
          this._onEdit(message.commentId, message.content);
          break;
        case 'addReply':
          if (this._onAddReply) {
            this._onAddReply(message.commentId, message.content, message.inReplyTo);
          }
          break;
        case 'editReply':
          if (this._onEditReply) {
            this._onEditReply(message.commentId, message.replyId, message.content);
          }
          break;
        case 'deleteReply':
          if (this._onDeleteReply) {
            this._onDeleteReply(message.commentId, message.replyId);
          }
          break;
        case 'resolveComment':
          if (this._onResolve) {
            this._onResolve(message.commentId);
          }
          break;
        case 'configureCommentBox':
          vscode.commands.executeCommand('omnicomment.configureCommentBox');
          break;
        case 'ready':
          this._isReady = true;
          // Webview is ready, request current comments from extension
          if (this._onReady) {
            await this._onReady();
          }
          if (this._pendingAddCommentForm && this._view) {
            const pending = this._pendingAddCommentForm;
            this._pendingAddCommentForm = null;
            this._view.webview.postMessage({
              type: 'showAddCommentForm',
              hasSelection: pending.hasSelection,
              anchorText: pending.anchorText,
              isCustomEditor: pending.isCustomEditor
            } as SidebarMessage);
          }
          if (this._pendingFocusCommentId && this._view) {
            const pendingFocus = this._pendingFocusCommentId;
            this._pendingFocusCommentId = null;
            this._view.webview.postMessage({
              type: 'focusComment',
              commentId: pendingFocus
            } as SidebarMessage);
          }
          break;
        case 'addComment':
          if (this._onAddComment) {
            await this._onAddComment();
          }
          break;
        case 'submitNewComment':
          if (this._onSubmitNewComment) {
            await this._onSubmitNewComment(message.content, message.anchorText);
          }
          break;
        case 'reAnchorComment':
          if (this._onReAnchor) {
            await this._onReAnchor(message.commentId);
          }
          break;
        case 'toggleThumbsUpComment':
          if (this._onThumbsUpComment) {
            await this._onThumbsUpComment(message.commentId);
          }
          break;
        case 'toggleThumbsUpReply':
          if (this._onThumbsUpReply) {
            await this._onThumbsUpReply(message.commentId, message.replyId);
          }
          break;
        case 'webviewState': {
          const resolvers = this._stateResolvers.splice(0, this._stateResolvers.length);
          for (const resolve of resolvers) {
            resolve({
              isFormOpen: message.isFormOpen,
              anchorText: message.anchorText,
              commentInput: message.commentInput,
              renderedCount: message.renderedCount
            });
          }
          break;
        }
      }
    });

    // Refresh view when it becomes visible
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.refresh(this._comments);
      }
    });
  }

  /**
   * Refresh the sidebar with updated comments
   */
  public refresh(comments: Comment[], currentUser?: string): void {
    this._comments = comments;
    if (this._view && this._isReady) {
      this._view.webview.postMessage({
        type: 'refresh',
        comments: comments,
        currentUser: currentUser
      });
    }
  }

  /**
   * Focus a specific comment in the sidebar
   */
  public focusComment(commentId: string): void {
    this._focusedCommentId = commentId;
    if (this._view && this._isReady) {
      this._view.webview.postMessage({
        type: 'focusComment',
        commentId: commentId
      } as SidebarMessage);
    } else {
      this._pendingFocusCommentId = commentId;
    }
  }

  // Invariant: Sends comment box configuration parameters to the active sidebar webview.
  // Why: Synchronizes markdown formatting, avatar visibility, and typography in the comments sidebar.
  // Example: updateCommentBoxConfig({ enableMarkdown: false }) re-renders sidebar comments as plain text.
  public updateCommentBoxConfig(config: import('../core/commentBoxConfig').CommentBoxConfig): void {
    if (this._view && this._isReady) {
      this._view.webview.postMessage({
        type: 'setCommentBoxConfig',
        config
      });
    }
  }

  /**
   * Show the add comment form in the sidebar
   */
  public showAddCommentForm(hasSelection: boolean, anchorText?: string, isCustomEditor?: boolean): void {
    if (this._view && this._isReady) {
      this._view.webview.postMessage({
        type: 'showAddCommentForm',
        hasSelection: hasSelection,
        anchorText: anchorText,
        isCustomEditor: isCustomEditor
      } as SidebarMessage);
    } else {
      this._pendingAddCommentForm = {
        hasSelection,
        anchorText,
        isCustomEditor
      };
    }
  }

  /**
   * Wait until the sidebar webview has initialized and reported 'ready'.
   */
  public async waitForReady(timeoutMs = 5000): Promise<boolean> {
    const start = Date.now();
    while (!this._isReady || !this._view) {
      if (Date.now() - start > timeoutMs) {
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    return true;
  }

  /**
   * Query the live DOM state of the sidebar webview (used by E2E tests).
   */
  public async getWebviewState(timeoutMs = 3000): Promise<{
    isFormOpen: boolean;
    anchorText: string;
    commentInput: string;
    renderedCount: number;
  }> {
    const ready = await this.waitForReady(timeoutMs);
    if (!ready || !this._view) {
      throw new Error('Sidebar webview is not ready');
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timed out waiting for webviewState'));
      }, timeoutMs);
      this._stateResolvers.push(state => {
        clearTimeout(timer);
        resolve(state);
      });
      this._view!.webview.postMessage({ type: 'getWebviewState' } as SidebarMessage);
    });
  }

  /**
   * Fill and submit the Add Comment form inside the sidebar webview DOM (used by E2E tests).
   */
  public async submitFormFromWebview(content: string, anchorText?: string): Promise<void> {
    const ready = await this.waitForReady();
    if (!ready || !this._view) {
      throw new Error('Sidebar webview is not ready');
    }
    this._view.webview.postMessage({
      type: 'fillAndSubmitForm',
      content,
      anchorText
    } as SidebarMessage);
  }

  private _getHtmlContent(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'sidebar.css')
    );

    // Load codicons locally from the bundled @vscode/codicons package
    const codiconsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.css')
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'unsafe-inline';">
  <link href="${styleUri}" rel="stylesheet">
  <link href="${codiconsUri}" rel="stylesheet">
  <title>Comments</title>
</head>
<body>
  <div id="app">
    <div class="header">
      <h3>Comments <span id="comment-count">(0)</span></h3>
      <div class="header-actions">
        <button id="add-comment-btn" class="btn-add" title="Add Comment (select text first)">
          <i class="codicon codicon-add"></i>
        </button>
        <button id="toggle-resolved" class="btn-toggle" title="Toggle resolved comments">
          <i class="codicon codicon-eye"></i>
        </button>
        <button id="configure-box-btn" class="btn-toggle" title="Configure Comment Box">
          <i class="codicon codicon-settings-gear"></i>
        </button>
      </div>
    </div>
    
    <!-- Add Comment Form -->
    <div id="add-comment-form" class="input-form hidden">
      <div class="form-header">
        <span>New Comment</span>
        <button class="btn-icon btn-close" onclick="hideAddCommentForm()" title="Cancel">
          <i class="codicon codicon-close"></i>
        </button>
      </div>
      <div id="selection-warning" class="form-warning hidden">
        <i class="codicon codicon-info"></i>
        <span id="selection-warning-text">Please select or enter text from the document</span>
      </div>
      <div id="anchor-text-group" class="anchor-input-group">
        <label for="anchor-text-input" class="form-label">Target text in document</label>
        <textarea id="anchor-text-input" class="form-text-input" placeholder="Paste or type text from document to comment on..." rows="2"></textarea>
      </div>
      <textarea id="new-comment-input" class="form-input" placeholder="Type your comment..." rows="3"></textarea>
      <div class="form-actions">
        <button class="btn-secondary" onclick="hideAddCommentForm()">Cancel</button>
        <button class="btn-primary" onclick="submitNewComment()">Add Comment</button>
      </div>
    </div>
    
    <div id="comments-list" class="comments-list">
      <div class="no-comments">
        <p>No comments yet.</p>
        <p class="help-text">Select text and press <kbd>Ctrl+Shift+M</kbd> to add a comment.</p>
      </div>
    </div>
  </div>

  <script>
    const vscode = acquireVsCodeApi();
    let comments = [];
    let editingCommentId = null;
    let editingReplyId = null;
    let replyingToCommentId = null;
    let replyTargetId = null;
    let showResolved = true;
    let currentUser = null;
    let commentBoxConfig = {
      enableMarkdown: true,
      showAvatars: true
    };

    function getAuthorInitial(author) {
      if (!author || typeof author !== 'string') return 'U';
      var trimmed = author.trim();
      return trimmed ? trimmed[0].toUpperCase() : 'U';
    }

    function toggleResolved() {
      showResolved = !showResolved;
      const toggleBtn = document.getElementById('toggle-resolved');
      const icon = toggleBtn.querySelector('i');
      if (showResolved) {
        icon.className = 'codicon codicon-eye';
        toggleBtn.title = 'Hide resolved comments';
        toggleBtn.classList.remove('hidden-resolved');
      } else {
        icon.className = 'codicon codicon-eye-closed';
        toggleBtn.title = 'Show resolved comments';
        toggleBtn.classList.add('hidden-resolved');
      }
      renderComments();
    }

    function showAddCommentForm(hasSelection, anchorText, isCustomEditor) {
      const form = document.getElementById('add-comment-form');
      const warning = document.getElementById('selection-warning');
      const warningText = document.getElementById('selection-warning-text');
      const anchorInput = document.getElementById('anchor-text-input');
      const input = document.getElementById('new-comment-input');
      
      form.classList.remove('hidden');
      anchorInput.value = anchorText || '';
      input.disabled = false;
      anchorInput.disabled = false;
      
      if (isCustomEditor && !anchorText) {
        warningText.textContent = 'Copy text in the viewer or type the target text below';
        warning.classList.remove('hidden');
        anchorInput.focus();
      } else if (!hasSelection && !isCustomEditor && !anchorText) {
        warningText.textContent = 'Select text in the editor or enter target text below';
        warning.classList.remove('hidden');
        anchorInput.focus();
      } else {
        warning.classList.add('hidden');
        input.focus();
      }
    }

    function hideAddCommentForm() {
      const form = document.getElementById('add-comment-form');
      const anchorInput = document.getElementById('anchor-text-input');
      const input = document.getElementById('new-comment-input');
      form.classList.add('hidden');
      if (anchorInput) {
        anchorInput.value = '';
        anchorInput.disabled = false;
      }
      input.value = '';
      input.disabled = false;
    }

    function submitNewComment() {
      const anchorInput = document.getElementById('anchor-text-input');
      const input = document.getElementById('new-comment-input');
      const content = input.value.trim();
      const anchorText = anchorInput ? anchorInput.value.trim() : '';
      if (content) {
        vscode.postMessage({ type: 'submitNewComment', content: content, anchorText: anchorText });
        hideAddCommentForm();
      }
    }

    function renderComments() {
      const container = document.getElementById('comments-list');
      const countEl = document.getElementById('comment-count');
      const filteredComments = showResolved ? comments : comments.filter(c => !c.resolved);
      const resolvedCount = comments.filter(c => c.resolved).length;
      countEl.textContent = '(' + filteredComments.length + (resolvedCount > 0 && !showResolved ? ' / ' + comments.length : '') + ')';

      if (filteredComments.length === 0) {
        container.innerHTML = \`
          <div class="no-comments">
            <p>\${comments.length === 0 ? 'No comments yet.' : 'No unresolved comments.'}</p>
            <p class="help-text">\${comments.length === 0 ? 'Select text and press <kbd>Ctrl+Shift+M</kbd> to add a comment.' : 'Click the eye icon to show resolved comments.'}</p>
          </div>
        \`;
        return;
      }

      container.innerHTML = filteredComments.map(comment => \`
        <div class="comment-item \${comment.resolved ? 'resolved' : ''} \${comment.orphaned ? 'orphaned' : ''}" data-id="\${comment.id}" onclick="navigateToComment('\${comment.id}')">
          <div class="comment-header">
            <span class="comment-header-left" style="display:inline-flex;align-items:center;">
              \${commentBoxConfig.showAvatars ? \`<span class="comment-avatar">\${escapeHtml(getAuthorInitial(comment.author))}</span>\` : ''}
              <span class="comment-author">\${escapeHtml(comment.author)}</span>
            </span>
            <span class="comment-date">\${formatDate(comment.createdAt)}</span>
          </div>
          \${comment.orphaned ? \`
            <div class="orphaned-warning">
              <i class="codicon codicon-warning"></i>
              <span>Anchor text deleted</span>
              <button class="btn-reanchor" onclick="event.stopPropagation(); reAnchorComment('\${comment.id}')" title="Select text in editor, then click to re-anchor">
                <i class="codicon codicon-pin"></i> Re-anchor
              </button>
            </div>
          \` : ''}
          <div class="comment-anchor-box" title="Anchored at \${formatLineRange(comment.anchor)} — click to locate in document">
            <div class="comment-anchor-meta">
              <span class="comment-line-badge"><i class="codicon codicon-location"></i> \${formatLineRange(comment.anchor)}</span>
            </div>
            <div class="comment-anchor">\${escapeHtml(comment.anchor.text)}</div>
          </div>
          \${editingCommentId === comment.id ? renderEditCommentForm(comment) : \`
            <div class="comment-content">\${renderCommentMarkdown(comment.content)}</div>
          \`}
          \${editingCommentId !== comment.id ? \`
            <div class="comment-actions">
              <div class="actions-left">
                <button class="btn-icon btn-reply" onclick="event.stopPropagation(); startReply('\${comment.id}')" title="Reply"><i class="codicon codicon-comment"></i></button>
                \${currentUser && comment.author === currentUser ? \`<button class="btn-icon btn-edit" onclick="event.stopPropagation(); startEditComment('\${comment.id}')" title="Edit"><i class="codicon codicon-edit"></i></button>\` : ''}
                <button class="btn-icon btn-thumbsup \${comment.thumbsUp && comment.thumbsUp.includes(currentUser) ? 'active' : ''}" onclick="event.stopPropagation(); toggleThumbsUpComment('\${comment.id}')" title="\${comment.thumbsUp && comment.thumbsUp.length ? comment.thumbsUp.join(', ') : 'No reactions'}"><i class="codicon codicon-thumbsup"></i>\${comment.thumbsUp && comment.thumbsUp.length > 1 ? \`<span class="thumbsup-count">\${comment.thumbsUp.length}</span>\` : ''}</button>
              </div>
              <div class="actions-right">
                <button class="btn-icon btn-resolve \${comment.resolved ? 'resolved' : ''}" onclick="event.stopPropagation(); resolveComment('\${comment.id}')" title="\${comment.resolved ? 'Reopen' : 'Resolve'}"><i class="codicon codicon-\${comment.resolved ? 'issue-reopened' : 'check'}"></i></button>
                <button class="btn-icon btn-delete" onclick="event.stopPropagation(); deleteComment('\${comment.id}')" title="Delete"><i class="codicon codicon-trash"></i></button>
              </div>
            </div>
          \` : ''}
          \${renderReplies(comment)}
          \${replyingToCommentId === comment.id ? renderReplyForm(comment) : ''}
        </div>
      \`).join('');
      
      // Focus on any active input
      setTimeout(() => {
        const activeInput = document.querySelector('.edit-input:not([disabled]), .reply-input:not([disabled])');
        if (activeInput) {
          activeInput.focus();
        }
      }, 0);
    }

    function renderEditCommentForm(comment) {
      return \`
        <div class="inline-form" onclick="event.stopPropagation()">
          <textarea class="edit-input" id="edit-comment-\${comment.id}" rows="2">\${escapeHtml(comment.content)}</textarea>
          <div class="inline-form-actions">
            <button class="btn-secondary btn-sm" onclick="cancelEditComment()">Cancel</button>
            <button class="btn-primary btn-sm" onclick="saveEditComment('\${comment.id}')">Save</button>
          </div>
        </div>
      \`;
    }

    function renderReplyForm(comment) {
      const commentId = comment.id;
      return \`
        <div class="inline-form reply-form" onclick="event.stopPropagation()">
          \${renderReplyTargetChip(comment)}
          <textarea class="reply-input" id="reply-input-\${commentId}" placeholder="Type your reply..." rows="2"></textarea>
          <div class="inline-form-actions">
            <button class="btn-secondary btn-sm" onclick="cancelReply()">Cancel</button>
            <button class="btn-primary btn-sm" onclick="submitReply('\${commentId}')">Reply</button>
          </div>
        </div>
      \`;
    }

    function renderEditReplyForm(commentId, reply) {
      return \`
        <div class="inline-form" onclick="event.stopPropagation()">
          <textarea class="edit-input" id="edit-reply-\${reply.id}" rows="2">\${escapeHtml(reply.content)}</textarea>
          <div class="inline-form-actions">
            <button class="btn-secondary btn-sm" onclick="cancelEditReply()">Cancel</button>
            <button class="btn-primary btn-sm" onclick="saveEditReply('\${commentId}', '\${reply.id}')">Save</button>
          </div>
        </div>
      \`;
    }

    function navigateToComment(id) {
      vscode.postMessage({ type: 'navigateToComment', commentId: id });
    }

    function deleteComment(id) {
      vscode.postMessage({ type: 'deleteComment', commentId: id });
    }

    function resolveComment(id) {
      vscode.postMessage({ type: 'resolveComment', commentId: id });
    }

    function reAnchorComment(id) {
      vscode.postMessage({ type: 'reAnchorComment', commentId: id });
    }

    function toggleThumbsUpComment(id) {
      vscode.postMessage({ type: 'toggleThumbsUpComment', commentId: id });
    }

    function toggleThumbsUpReply(commentId, replyId) {
      vscode.postMessage({ type: 'toggleThumbsUpReply', commentId: commentId, replyId: replyId });
    }

    function startEditComment(id) {
      editingCommentId = id;
      editingReplyId = null;
      replyingToCommentId = null;
      renderComments();
    }

    function cancelEditComment() {
      editingCommentId = null;
      renderComments();
    }

    function saveEditComment(id) {
      const input = document.getElementById('edit-comment-' + id);
      const content = input.value.trim();
      if (content) {
        vscode.postMessage({ type: 'editComment', commentId: id, content: content });
        editingCommentId = null;
      }
    }

    // Invariant: targetId names the reply being answered; omitted = reply to the thread.
    // Example: startReply('c1', 'r2') -> composer shows "Replying to @bob".
    function startReply(commentId, targetId) {
      replyingToCommentId = commentId;
      replyTargetId = targetId || null;
      editingCommentId = null;
      editingReplyId = null;
      renderComments();
    }

    function clearReplyTarget() {
      replyTargetId = null;
      renderComments();
    }

    // Invariant: Mirrors src/core/replyThreading.ts findReplyTarget for the sidebar webview.
    function findThreadItem(comment, itemId) {
      if (!comment || !itemId) return null;
      if (itemId === comment.id) return { id: comment.id, author: comment.author, content: comment.content || '' };
      const reply = (comment.replies || []).find(r => r.id === itemId);
      return reply ? { id: reply.id, author: reply.author, content: reply.content || '' } : null;
    }

    function replySnippet(content, maxLength) {
      const limit = maxLength || 60;
      const flat = String(content || '').replace(/\\s+/g, ' ').trim();
      return flat.length > limit ? flat.slice(0, limit - 1) + '…' : flat;
    }

    function renderReplyQuote(comment, inReplyTo) {
      const target = findThreadItem(comment, inReplyTo);
      if (!target) return '';
      return \`<div class="reply-quote" title="\${escapeHtml(target.content)}"><i class="codicon codicon-reply"></i> <b>@\${escapeHtml(target.author)}</b>: “\${escapeHtml(replySnippet(target.content))}”</div>\`;
    }

    function renderReplyTargetChip(comment) {
      const target = findThreadItem(comment, replyTargetId);
      if (!target) return '';
      return \`<div class="reply-quote reply-target"><i class="codicon codicon-reply"></i> Replying to <b>@\${escapeHtml(target.author)}</b>: “\${escapeHtml(replySnippet(target.content, 50))}” <button class="btn-icon" onclick="clearReplyTarget()" title="Reply to the whole thread instead"><i class="codicon codicon-close"></i></button></div>\`;
    }

    function cancelReply() {
      replyingToCommentId = null;
      replyTargetId = null;
      renderComments();
    }

    function submitReply(commentId) {
      const input = document.getElementById('reply-input-' + commentId);
      const content = input.value.trim();
      if (content) {
        vscode.postMessage({ type: 'addReply', commentId: commentId, content: content, inReplyTo: replyTargetId || undefined });
        replyingToCommentId = null;
        replyTargetId = null;
      }
    }

    function startEditReply(commentId, replyId) {
      editingReplyId = { commentId, replyId };
      editingCommentId = null;
      replyingToCommentId = null;
      renderComments();
    }

    function cancelEditReply() {
      editingReplyId = null;
      renderComments();
    }

    function saveEditReply(commentId, replyId) {
      const input = document.getElementById('edit-reply-' + replyId);
      const content = input.value.trim();
      if (content) {
        vscode.postMessage({ type: 'editReply', commentId: commentId, replyId: replyId, content: content });
        editingReplyId = null;
      }
    }

    function deleteReply(commentId, replyId) {
      vscode.postMessage({ type: 'deleteReply', commentId: commentId, replyId: replyId });
    }

    function renderReplies(comment) {
      if (!comment.replies || comment.replies.length === 0) {
        return '';
      }
      return \`
        <div class="replies-container" onclick="event.stopPropagation()">
          \${comment.replies.map(reply => \`
            <div class="reply-item" data-reply-id="\${reply.id}">
              <div class="reply-header">
                <span class="reply-header-left" style="display:inline-flex;align-items:center;">
                  \${commentBoxConfig.showAvatars ? \`<span class="comment-avatar is-reply">\${escapeHtml(getAuthorInitial(reply.author))}</span>\` : ''}
                  <span class="reply-author">\${escapeHtml(reply.author)}</span>
                </span>
                <span class="reply-date">\${formatDate(reply.createdAt)}</span>
              </div>
              \${editingReplyId && editingReplyId.replyId === reply.id ? renderEditReplyForm(comment.id, reply) : \`
                \${renderReplyQuote(comment, reply.inReplyTo)}
                <div class="reply-content">\${renderCommentMarkdown(reply.content)}</div>
                <div class="reply-actions">
                  <button class="btn-icon btn-reply-to" onclick="startReply('\${comment.id}', '\${reply.id}')" title="Reply to this response"><i class="codicon codicon-reply"></i></button>
                  \${currentUser && reply.author === currentUser ? \`<button class="btn-icon btn-edit-reply" onclick="startEditReply('\${comment.id}', '\${reply.id}')" title="Edit"><i class="codicon codicon-edit"></i></button>\` : ''}
                  <button class="btn-icon btn-thumbsup \${reply.thumbsUp && reply.thumbsUp.includes(currentUser) ? 'active' : ''}" onclick="toggleThumbsUpReply('\${comment.id}', '\${reply.id}')" title="\${reply.thumbsUp && reply.thumbsUp.length ? reply.thumbsUp.join(', ') : 'No reactions'}"><i class="codicon codicon-thumbsup"></i>\${reply.thumbsUp && reply.thumbsUp.length > 1 ? \`<span class="thumbsup-count">\${reply.thumbsUp.length}</span>\` : ''}</button>
                  <button class="btn-icon btn-delete-reply" onclick="deleteReply('\${comment.id}', '\${reply.id}')" title="Delete"><i class="codicon codicon-trash"></i></button>
                </div>
              \`}
            </div>
          \`).join('')}
        </div>
      \`;
    }

    function focusComment(id) {
      document.querySelectorAll('.comment-item').forEach(el => {
        el.classList.remove('focused');
      });
      const el = document.querySelector(\`.comment-item[data-id="\${id}"]\`);
      if (el) {
        el.classList.add('focused');
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function renderCommentMarkdown(text) {
      if (!text || typeof text !== 'string') return '';
      if (commentBoxConfig && !commentBoxConfig.enableMarkdown) {
        return escapeHtml(text).replace(/\\n/g, '<br>');
      }
      var escaped = escapeHtml(text);
      var codeBlocks = [];
      var tick = String.fromCharCode(96);
      var tripleTick = tick + tick + tick;
      escaped = escaped.split(tripleTick).map(function(part, i) {
        if (i % 2 === 1) {
          var idx = codeBlocks.length;
          var newlineIdx = part.indexOf('\\n');
          var code = newlineIdx !== -1 ? part.substring(newlineIdx + 1) : part;
          codeBlocks.push('<pre class="omni-comment-code-block"><code>' + code.trim() + '</code></pre>');
          return '%%CODEBLOCK_' + idx + '%%';
        }
        return part;
      }).join('');
      escaped = escaped.split(tick).map(function(part, i) {
        if (i % 2 === 1) {
          return '<code class="omni-comment-inline-code">' + part + '</code>';
        }
        return part;
      }).join('');
      escaped = escaped.replace(/^(?:&gt;|>)[ \\t]?(.*)$/gm, '<blockquote class="omni-comment-quote">$1</blockquote>');
      escaped = escaped.replace(/(\\*{3}|_{3})(?=\\S)([\\s\\S]*?\\S)\\1/g, '<strong><em>$2</em></strong>');
      escaped = escaped.replace(/(\\*{2}|_{2})(?=\\S)([\\s\\S]*?\\S)\\1/g, '<strong>$2</strong>');
      escaped = escaped.replace(/(^|[^\\*])\\*([^\\*\\s][^\\*]*?[^\\*\\s]|\\S)\\*([^\\*]|$)/g, '$1<em>$2</em>$3');
      escaped = escaped.replace(/(^|[^_])_([^_ \\t\\n][^_]*?[^_ \\t\\n]|\\S)_([^_]|$)/g, '$1<em>$2</em>$3');
      escaped = escaped.replace(/~~(?=\\S)([\\s\\S]*?\\S)~~/g, '<del>$1</del>');
      escaped = escaped.replace(/\\[([^\\]]+)\\]\\(((?:https?:\\/\\/|\\/|mailto:)[^\\s\\)]+)\\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="omni-comment-link">$1</a>');
      escaped = escaped.replace(/^[ \\t]*[\\-\\*][ \\t]+(.+)$/gm, '<li class="omni-comment-list-item">$1</li>');
      escaped = escaped.replace(/((?:<li class="omni-comment-list-item">.*<\\/li>\\s*)+)/g, '<ul class="omni-comment-list">$1</ul>');
      escaped = escaped.replace(/^[ \\t]*\\d+\\.[ \\t]+(.+)$/gm, '<li class="omni-comment-num-item">$1</li>');
      escaped = escaped.replace(/((?:<li class="omni-comment-num-item">.*<\\/li>\\s*)+)/g, '<ol class="omni-comment-list">$1</ol>');
      escaped = escaped.replace(/\\n/g, '<br>');
      escaped = escaped.replace(/(?:<br>\\s*)+<(ul|ol|blockquote)/g, '<$1');
      escaped = escaped.replace(/<\\/(ul|ol|blockquote)>(?:\\s*<br>)+/g, '</$1>');
      escaped = escaped.replace(/<\\/li>(?:\\s*<br>\\s*)+<li/g, '</li><li');
      escaped = escaped.replace(/%%CODEBLOCK_(\\d+)%%/g, function(match, idx) {
        return codeBlocks[Number(idx)] || '';
      });
      return escaped;
    }

    function truncate(text, length) {
      if (text.length <= length) return text;
      return text.substring(0, length) + '...';
    }

    function formatLineRange(anchor) {
      if (!anchor || typeof anchor.startLine !== 'number') {
        return 'Document';
      }
      const start = anchor.startLine + 1;
      const end = typeof anchor.endLine === 'number' ? anchor.endLine + 1 : start;
      return start === end ? 'Line ' + start : 'Lines ' + start + '–' + end;
    }

    function formatDate(isoString) {
      const date = new Date(isoString);
      return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    // Handle keyboard shortcuts in textareas
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        if (editingCommentId) {
          cancelEditComment();
        } else if (editingReplyId) {
          cancelEditReply();
        } else if (replyingToCommentId) {
          cancelReply();
        } else {
          hideAddCommentForm();
        }
      }
      
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        const activeEl = document.activeElement;
        if (activeEl.id === 'new-comment-input') {
          submitNewComment();
        } else if (activeEl.classList.contains('edit-input')) {
          const id = activeEl.id.replace('edit-comment-', '').replace('edit-reply-', '');
          if (activeEl.id.startsWith('edit-comment-')) {
            saveEditComment(id);
          } else if (editingReplyId) {
            saveEditReply(editingReplyId.commentId, editingReplyId.replyId);
          }
        } else if (activeEl.classList.contains('reply-input')) {
          const commentId = activeEl.id.replace('reply-input-', '');
          submitReply(commentId);
        }
      }
    });

    window.addEventListener('message', event => {
      const message = event.data;
      switch (message.type) {
        case 'refresh':
          comments = message.comments || [];
          currentUser = message.currentUser || null;
          // Reset editing states on refresh
          editingCommentId = null;
          editingReplyId = null;
          replyingToCommentId = null;
          renderComments();
          break;
        case 'focusComment':
          focusComment(message.commentId);
          break;
        case 'showAddCommentForm':
          showAddCommentForm(message.hasSelection, message.anchorText, message.isCustomEditor);
          break;
        case 'getWebviewState': {
          const form = document.getElementById('add-comment-form');
          const anchorInput = document.getElementById('anchor-text-input');
          const commentInput = document.getElementById('new-comment-input');
          vscode.postMessage({
            type: 'webviewState',
            isFormOpen: form ? !form.classList.contains('hidden') : false,
            anchorText: anchorInput ? anchorInput.value : '',
            commentInput: commentInput ? commentInput.value : '',
            renderedCount: document.querySelectorAll('.comment-item').length
          });
          break;
        }
        case 'fillAndSubmitForm': {
          const anchorInput = document.getElementById('anchor-text-input');
          const commentInput = document.getElementById('new-comment-input');
          if (typeof message.anchorText === 'string' && anchorInput) {
            anchorInput.value = message.anchorText;
          }
          if (commentInput) {
            commentInput.value = message.content || '';
          }
          submitNewComment();
          break;
        }
        case 'setCommentBoxConfig':
          if (message.config) {
            commentBoxConfig = Object.assign({}, commentBoxConfig, message.config);
            renderComments();
          }
          break;
      }
    });

    // Initial render
    renderComments();
    
    // Setup toggle button
    document.getElementById('toggle-resolved').addEventListener('click', toggleResolved);

    // Setup configure box button
    const configureBoxBtn = document.getElementById('configure-box-btn');
    if (configureBoxBtn) {
      configureBoxBtn.addEventListener('click', function() {
        vscode.postMessage({ type: 'configureCommentBox' });
      });
    }
    
    // Setup add comment button
    document.getElementById('add-comment-btn').addEventListener('click', function() {
      vscode.postMessage({ type: 'addComment' });
    });
    
    // Tell extension we're ready to receive data
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}
