import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { Comment, CommentAnchor, Reply } from '../core/types';
import { findReplyTarget } from '../core/replyThreading';
import { AnchorEngine } from '../core/AnchorEngine';
import { MarkdownStorageAdapter, OMNI_COMMENT_MARKER } from '../storage/MarkdownStorageAdapter';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * OmniComment Core Comment Service
 * Manages comment parsing, anchoring, thread lifecycles, and document storage.
 */
export class CommentService {
  private commentCache: Map<string, Comment[]> = new Map();
  private storageAdapter = new MarkdownStorageAdapter();

  /**
   * Get the Git username from git config, with fallback to 'user'
   */
  // Invariant: Return explicitly configured defaultAuthor, falling back to git user.name or 'user'.
  // Why: Allows users to configure their author identity directly in comment box settings.
  // Example: omnicomment.commentBox.defaultAuthor = 'Alice' -> returns 'Alice'.
  public async getGitUserName(document: vscode.TextDocument): Promise<string> {
    const omniConfig = vscode.workspace.getConfiguration('omnicomment');
    const configuredAuthor = omniConfig.get<string>('commentBox.defaultAuthor')?.trim();
    if (configuredAuthor) {
      return configuredAuthor;
    }
    try {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
      const cwd = workspaceFolder?.uri.fsPath ?? require('path').dirname(document.uri.fsPath);
      const { stdout } = await execAsync('git config user.name', { cwd });
      const name = stdout.trim();
      return name || 'user';
    } catch {
      return 'user';
    }
  }

  /**
   * Parse comments from a markdown document
   */
  parseComments(document: vscode.TextDocument): Comment[] {
    const uri = document.uri.toString();
    const text = document.getText();
    const comments = this.storageAdapter.parseCommentsFromText(text);
    this.commentCache.set(uri, comments);
    return comments;
  }

  /**
   * Get cached comments for a document
   */
  getComments(document: vscode.TextDocument): Comment[] {
    const uri = document.uri.toString();
    if (!this.commentCache.has(uri)) {
      return this.parseComments(document);
    }
    return this.commentCache.get(uri) || [];
  }

  /**
   * Save comments to a document
   */
  async saveComments(document: vscode.TextDocument, comments: Comment[]): Promise<boolean> {
    const uri = document.uri.toString();
    const text = document.getText();

    const sanitizedComments = comments.map(c => ({
      ...c,
      anchor: {
        ...c.anchor,
        text: MarkdownStorageAdapter.sanitizeForStorage(c.anchor.text)
      },
      content: MarkdownStorageAdapter.sanitizeForStorage(c.content),
      replies: c.replies?.map(r => ({
        ...r,
        content: MarkdownStorageAdapter.sanitizeForStorage(r.content)
      }))
    }));

    const data = {
      version: 2,
      comments: sanitizedComments
    };

    const loc = MarkdownStorageAdapter.findCommentBlock(text);
    const activeMarker = loc ? loc.marker : OMNI_COMMENT_MARKER;
    const jsonBlock = `${activeMarker}\n${JSON.stringify(data, null, 2)}\n-->`;

    const edit = new vscode.WorkspaceEdit();

    if (!loc) {
      // Append at end
      const lastLine = document.lineCount - 1;
      const lastChar = document.lineAt(lastLine).text.length;
      const insertPosition = new vscode.Position(lastLine, lastChar);
      edit.insert(document.uri, insertPosition, '\n\n' + jsonBlock);
    } else {
      // Replace existing block only
      const endIndex = text.indexOf('-->', loc.index);
      if (endIndex !== -1) {
        const startPos = document.positionAt(loc.index);
        const endPos = document.positionAt(endIndex + '-->'.length);
        edit.replace(document.uri, new vscode.Range(startPos, endPos), jsonBlock);
      }
    }

    const success = await vscode.workspace.applyEdit(edit);
    if (success) {
      this.commentCache.set(uri, [...comments]);
    }
    return success;
  }

  /**
   * Add a new comment anchored to an active selection
   */
  async addComment(
    document: vscode.TextDocument,
    selection: vscode.Selection,
    content: string
  ): Promise<Comment | null> {
    const selectedText = document.getText(selection);
    if (!selectedText.trim()) {
      return null;
    }

    const anchor: CommentAnchor = {
      text: selectedText,
      startLine: selection.start.line,
      startChar: selection.start.character,
      endLine: selection.end.line,
      endChar: selection.end.character
    };

    const author = await this.getGitUserName(document);

    const comment: Comment = {
      id: crypto.randomUUID(),
      anchor,
      content,
      author,
      createdAt: new Date().toISOString()
    };

    const comments = this.getComments(document);
    comments.push(comment);

    const success = await this.saveComments(document, comments);
    return success ? comment : null;
  }

  /**
   * Add a new comment using anchor text
   */
  async addCommentByAnchorText(
    document: vscode.TextDocument,
    anchorText: string,
    content: string
  ): Promise<Comment | null> {
    const trimmedAnchor = anchorText.trim();
    if (!trimmedAnchor) {
      return null;
    }

    const anchor = this.findAnchorTextInDocument(document, trimmedAnchor);
    if (!anchor) {
      return null;
    }

    const author = await this.getGitUserName(document);

    const comment: Comment = {
      id: crypto.randomUUID(),
      anchor,
      content,
      author,
      createdAt: new Date().toISOString()
    };

    const comments = this.getComments(document);
    comments.push(comment);

    const success = await this.saveComments(document, comments);
    return success ? comment : null;
  }

  /**
   * Re-anchor a comment using anchor text
   */
  async reAnchorCommentByText(
    document: vscode.TextDocument,
    commentId: string,
    anchorText: string
  ): Promise<Comment | null> {
    const trimmedAnchor = anchorText.trim();
    if (!trimmedAnchor) {
      return null;
    }

    const comments = this.getComments(document);
    const comment = comments.find(c => c.id === commentId);
    if (!comment) {
      return null;
    }

    const newAnchor = this.findAnchorTextInDocument(document, trimmedAnchor);
    if (!newAnchor) {
      return null;
    }

    comment.anchor = newAnchor;
    comment.orphaned = false;
    comment.updatedAt = new Date().toISOString();

    const success = await this.saveComments(document, comments);
    return success ? comment : null;
  }

  /**
   * Locate arbitrary anchor text in the document
   */
  public findAnchorTextInDocument(
    document: vscode.TextDocument,
    searchText: string
  ): CommentAnchor | null {
    const fullText = document.getText();
    const commentBlockLoc = MarkdownStorageAdapter.findCommentBlock(fullText);
    const match = AnchorEngine.locateAnchor(
      fullText,
      searchText,
      commentBlockLoc ? commentBlockLoc.index : -1
    );

    if (match) {
      return {
        text: match.matchedText,
        startLine: match.startLine,
        startChar: match.startChar,
        endLine: match.endLine,
        endChar: match.endChar
      };
    }

    return null;
  }

  /**
   * Delete a comment by ID
   */
  async deleteComment(document: vscode.TextDocument, commentId: string): Promise<boolean> {
    const comments = this.getComments(document);
    const index = comments.findIndex(c => c.id === commentId);

    if (index === -1) {
      return false;
    }

    comments.splice(index, 1);
    return this.saveComments(document, comments);
  }

  /**
   * Update a comment's content
   */
  async updateComment(
    document: vscode.TextDocument,
    commentId: string,
    newContent: string
  ): Promise<Comment | null> {
    const comments = this.getComments(document);
    const comment = comments.find(c => c.id === commentId);

    if (!comment) {
      return null;
    }

    comment.content = newContent;
    comment.updatedAt = new Date().toISOString();

    const success = await this.saveComments(document, comments);
    return success ? comment : null;
  }

  /**
   * Find a comment by ID
   */
  findComment(document: vscode.TextDocument, commentId: string): Comment | undefined {
    const comments = this.getComments(document);
    return comments.find(c => c.id === commentId);
  }

  /**
   * Add a reply to a comment
   */
  async addReply(
    document: vscode.TextDocument,
    commentId: string,
    content: string,
    inReplyTo?: string
  ): Promise<Reply | null> {
    const comments = this.getComments(document);
    const comment = comments.find(c => c.id === commentId);

    if (!comment) {
      return null;
    }

    const author = await this.getGitUserName(document);

    const reply: Reply = {
      id: crypto.randomUUID(),
      content,
      author,
      createdAt: new Date().toISOString()
    };
    // Invariant: Only keep inReplyTo when it names an item of this same thread.
    // Why: A dangling target would render a broken "replying to" quote.
    // Example: inReplyTo of a reply in another thread -> stored as a plain thread reply.
    if (findReplyTarget(comment, inReplyTo)) {
      reply.inReplyTo = inReplyTo;
    }

    if (!comment.replies) {
      comment.replies = [];
    }
    comment.replies.push(reply);

    const success = await this.saveComments(document, comments);
    return success ? reply : null;
  }

  /**
   * Delete a reply from a comment
   */
  async deleteReply(
    document: vscode.TextDocument,
    commentId: string,
    replyId: string
  ): Promise<boolean> {
    const comments = this.getComments(document);
    const comment = comments.find(c => c.id === commentId);

    if (!comment || !comment.replies) {
      return false;
    }

    const replyIndex = comment.replies.findIndex(r => r.id === replyId);
    if (replyIndex === -1) {
      return false;
    }

    comment.replies.splice(replyIndex, 1);
    return this.saveComments(document, comments);
  }

  /**
   * Update a reply's content
   */
  async updateReply(
    document: vscode.TextDocument,
    commentId: string,
    replyId: string,
    newContent: string
  ): Promise<Reply | null> {
    const comments = this.getComments(document);
    const comment = comments.find(c => c.id === commentId);

    if (!comment || !comment.replies) {
      return null;
    }

    const reply = comment.replies.find(r => r.id === replyId);
    if (!reply) {
      return null;
    }

    reply.content = newContent;
    reply.updatedAt = new Date().toISOString();

    const success = await this.saveComments(document, comments);
    return success ? reply : null;
  }

  /**
   * Find a reply by ID within a comment
   */
  findReply(
    document: vscode.TextDocument,
    commentId: string,
    replyId: string
  ): Reply | undefined {
    const comment = this.findComment(document, commentId);
    if (!comment || !comment.replies) {
      return undefined;
    }
    return comment.replies.find(r => r.id === replyId);
  }

  /**
   * Toggle thumbs up on a comment
   */
  async toggleThumbsUpComment(
    document: vscode.TextDocument,
    commentId: string
  ): Promise<Comment | null> {
    const comments = this.getComments(document);
    const comment = comments.find(c => c.id === commentId);

    if (!comment) {
      return null;
    }

    const author = await this.getGitUserName(document);

    if (!comment.thumbsUp) {
      comment.thumbsUp = [];
    }

    const index = comment.thumbsUp.indexOf(author);
    if (index === -1) {
      comment.thumbsUp.push(author);
    } else {
      comment.thumbsUp.splice(index, 1);
    }

    if (comment.thumbsUp.length === 0) {
      delete comment.thumbsUp;
    }

    const success = await this.saveComments(document, comments);
    return success ? comment : null;
  }

  /**
   * Toggle thumbs up on a reply
   */
  async toggleThumbsUpReply(
    document: vscode.TextDocument,
    commentId: string,
    replyId: string
  ): Promise<Reply | null> {
    const comments = this.getComments(document);
    const comment = comments.find(c => c.id === commentId);

    if (!comment || !comment.replies) {
      return null;
    }

    const reply = comment.replies.find(r => r.id === replyId);
    if (!reply) {
      return null;
    }

    const author = await this.getGitUserName(document);

    if (!reply.thumbsUp) {
      reply.thumbsUp = [];
    }

    const index = reply.thumbsUp.indexOf(author);
    if (index === -1) {
      reply.thumbsUp.push(author);
    } else {
      reply.thumbsUp.splice(index, 1);
    }

    if (reply.thumbsUp.length === 0) {
      delete reply.thumbsUp;
    }

    const success = await this.saveComments(document, comments);
    return success ? reply : null;
  }

  /**
   * Toggle the resolved status of a comment
   */
  async resolveComment(
    document: vscode.TextDocument,
    commentId: string
  ): Promise<Comment | null> {
    const comments = this.getComments(document);
    const comment = comments.find(c => c.id === commentId);

    if (!comment) {
      return null;
    }

    comment.resolved = !comment.resolved;
    comment.updatedAt = new Date().toISOString();

    const success = await this.saveComments(document, comments);
    return success ? comment : null;
  }

  /**
   * Re-anchor a comment to a new selection
   */
  async reAnchorComment(
    document: vscode.TextDocument,
    commentId: string,
    selection: vscode.Selection
  ): Promise<Comment | null> {
    const selectedText = document.getText(selection);
    if (!selectedText.trim()) {
      return null;
    }

    const comments = this.getComments(document);
    const comment = comments.find(c => c.id === commentId);

    if (!comment) {
      return null;
    }

    comment.anchor = {
      text: selectedText,
      startLine: selection.start.line,
      startChar: selection.start.character,
      endLine: selection.end.line,
      endChar: selection.end.character
    };
    comment.orphaned = false;
    comment.updatedAt = new Date().toISOString();

    const success = await this.saveComments(document, comments);
    return success ? comment : null;
  }

  /**
   * Reconcile comment anchors after document changes
   */
  async reconcileAnchors(document: vscode.TextDocument): Promise<void> {
    const comments = this.getComments(document);
    let modified = false;

    for (const comment of comments) {
      const newAnchor = this.findAnchorInDocument(document, comment.anchor);
      if (newAnchor) {
        if (
          newAnchor.startLine !== comment.anchor.startLine ||
          newAnchor.startChar !== comment.anchor.startChar ||
          newAnchor.endLine !== comment.anchor.endLine ||
          newAnchor.endChar !== comment.anchor.endChar ||
          comment.orphaned
        ) {
          comment.anchor = newAnchor;
          comment.orphaned = false;
          modified = true;
        }
      } else if (!comment.orphaned) {
        comment.orphaned = true;
        modified = true;
      }
    }

    if (modified) {
      await this.saveComments(document, comments);
    }
  }

  /**
   * Find anchor in document, excluding comment block
   */
  private findAnchorInDocument(
    document: vscode.TextDocument,
    anchor: CommentAnchor
  ): CommentAnchor | null {
    return this.findAnchorTextInDocument(document, anchor.text);
  }

  /**
   * Clear cache for a document
   */
  clearCache(document: vscode.TextDocument): void {
    this.commentCache.delete(document.uri.toString());
  }
}
