import * as vscode from 'vscode';
import { Comment, Reply } from '../types';

export class OmniCommentInlineItem implements vscode.Comment {
  public body: vscode.MarkdownString;
  public mode: vscode.CommentMode = vscode.CommentMode.Preview;
  public author: vscode.CommentAuthorInformation;
  public label?: string;
  public contextValue?: string;

  constructor(
    public readonly commentId: string,
    public readonly replyId: string | undefined,
    public readonly rawContent: string,
    authorName: string,
    createdAt: string,
    anchorText?: string,
    lineLabel?: string,
    resolved?: boolean
  ) {
    const md = new vscode.MarkdownString('', true);
    md.isTrusted = true;
    if (!replyId && anchorText) {
      const escapedQuote = anchorText.replace(/\r?\n/g, ' ');
      md.appendMarkdown(`> **${lineLabel || 'Target'}:** \`${escapedQuote}\`\n\n`);
    }
    md.appendText(rawContent);
    this.body = md;
    this.author = { name: authorName };
    const dateStr = InlineCommentController.formatShortDate(createdAt);
    this.label = resolved && !replyId ? `${dateStr} · Resolved` : dateStr;
    this.contextValue = replyId ? 'markcoReply' : 'markcoComment';
  }
}

export class MarkcoInlineCommentItem extends OmniCommentInlineItem {}

export class InlineCommentController implements vscode.Disposable {
  private readonly _controller: vscode.CommentController;
  private readonly _threadsByDoc = new Map<string, Map<string, vscode.CommentThread>>();
  private readonly _commentIdByThread = new WeakMap<vscode.CommentThread, string>();
  private readonly _collapsedByUser = new Map<string, vscode.CommentThreadCollapsibleState>();
  private _allCollapsed = false;

  constructor() {
    this._controller = vscode.comments.createCommentController(
      'omnicomment-inline',
      'OmniComment In-Editor Comments'
    );
    this._controller.options = {
      prompt: 'Write a comment or response...',
      placeHolder: 'Type your comment or response here ( visible directly in the editor )'
    };

    this._controller.commentingRangeProvider = {
      provideCommentingRanges: (document: vscode.TextDocument) => {
        if (document.languageId !== 'markdown' && document.languageId !== 'skill') {
          return [];
        }
        const text = document.getText();
        const blockIdx = text.lastIndexOf('<!-- markco-comments');
        const endLine =
          blockIdx !== -1
            ? Math.max(0, document.positionAt(blockIdx).line - 1)
            : Math.max(0, document.lineCount - 1);
        return [new vscode.Range(0, 0, endLine, 0)];
      }
    };
  }

  public static formatShortDate(iso: string): string {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return '';
    }
  }

  public static formatLineLabel(comment: Comment): string {
    const start = comment.anchor.startLine + 1;
    const end = comment.anchor.endLine + 1;
    return start === end ? `Line ${start}` : `Lines ${start}–${end}`;
  }

  public syncDocumentComments(document: vscode.TextDocument, comments: Comment[]): void {
    const docKey = document.uri.toString();
    let docThreads = this._threadsByDoc.get(docKey);
    if (!docThreads) {
      docThreads = new Map<string, vscode.CommentThread>();
      this._threadsByDoc.set(docKey, docThreads);
    }

    const activeIds = new Set<string>();

    for (const comment of comments) {
      if (comment.orphaned) {
        continue;
      }
      activeIds.add(comment.id);

      const startLine = Math.min(
        Math.max(0, comment.anchor.startLine),
        Math.max(0, document.lineCount - 1)
      );
      const endLine = Math.min(
        Math.max(startLine, comment.anchor.endLine),
        Math.max(0, document.lineCount - 1)
      );
      const range = new vscode.Range(
        startLine,
        Math.max(0, comment.anchor.startChar),
        endLine,
        Math.max(0, comment.anchor.endChar)
      );

      const lineLabel = InlineCommentController.formatLineLabel(comment);
      const items: vscode.Comment[] = [
        new MarkcoInlineCommentItem(
          comment.id,
          undefined,
          comment.content,
          comment.author,
          comment.createdAt,
          comment.anchor.text,
          lineLabel,
          comment.resolved
        ),
        ...(comment.replies || []).map(
          (r: Reply) =>
            new MarkcoInlineCommentItem(
              comment.id,
              r.id,
              r.content,
              r.author,
              r.createdAt
            )
        )
      ];

      let thread = docThreads.get(comment.id);
      if (!thread) {
        thread = this._controller.createCommentThread(document.uri, range, items);
        docThreads.set(comment.id, thread);
        this._commentIdByThread.set(thread, comment.id);
      } else {
        thread.range = range;
        thread.comments = items;
      }

      thread.canReply = true;
      thread.contextValue = comment.resolved ? 'resolved' : 'unresolved';
      thread.state = comment.resolved
        ? vscode.CommentThreadState.Resolved
        : vscode.CommentThreadState.Unresolved;
      thread.label = `${lineLabel} · "${comment.anchor.text}"${
        comment.resolved ? ' (Resolved)' : ''
      }`;

      const savedCollapse = this._collapsedByUser.get(comment.id);
      if (savedCollapse !== undefined) {
        thread.collapsibleState = savedCollapse;
      } else if (this._allCollapsed || comment.resolved) {
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
      } else {
        thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
      }
    }

    // Dispose removed threads
    for (const [id, thread] of docThreads.entries()) {
      if (!activeIds.has(id)) {
        thread.dispose();
        docThreads.delete(id);
      }
    }
  }

  public getCommentIdForThread(thread: vscode.CommentThread): string | undefined {
    return this._commentIdByThread.get(thread);
  }

  public focusCommentThread(documentUri: vscode.Uri, commentId: string): void {
    const docThreads = this._threadsByDoc.get(documentUri.toString());
    const thread = docThreads?.get(commentId);
    if (thread) {
      this._collapsedByUser.set(commentId, vscode.CommentThreadCollapsibleState.Expanded);
      thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    }
  }

  public toggleThreadCollapsibleState(thread: vscode.CommentThread): void {
    const commentId = this._commentIdByThread.get(thread);
    const nextState =
      thread.collapsibleState === vscode.CommentThreadCollapsibleState.Collapsed
        ? vscode.CommentThreadCollapsibleState.Expanded
        : vscode.CommentThreadCollapsibleState.Collapsed;
    thread.collapsibleState = nextState;
    if (commentId) {
      this._collapsedByUser.set(commentId, nextState);
    }
  }

  public toggleAllThreads(documentUri: vscode.Uri): boolean {
    this._allCollapsed = !this._allCollapsed;
    const docThreads = this._threadsByDoc.get(documentUri.toString());
    if (docThreads) {
      const targetState = this._allCollapsed
        ? vscode.CommentThreadCollapsibleState.Collapsed
        : vscode.CommentThreadCollapsibleState.Expanded;
      for (const [id, thread] of docThreads.entries()) {
        this._collapsedByUser.set(id, targetState);
        thread.collapsibleState = targetState;
      }
    }
    return this._allCollapsed;
  }

  public getThreadCount(documentUri: vscode.Uri): number {
    return this._threadsByDoc.get(documentUri.toString())?.size ?? 0;
  }

  public dispose(): void {
    for (const docThreads of this._threadsByDoc.values()) {
      for (const thread of docThreads.values()) {
        thread.dispose();
      }
    }
    this._threadsByDoc.clear();
    this._controller.dispose();
  }
}
