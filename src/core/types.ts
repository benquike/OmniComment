/**
 * OmniComment Core Type Definitions
 * Aligned with W3C Web Annotation Data Model
 */

export interface CommentAnchor {
  /** The highlighted text snippet */
  text: string;
  /** Start line number (0-based) */
  startLine: number;
  /** Start character offset within the start line */
  startChar: number;
  /** End line number (0-based) */
  endLine: number;
  /** End character offset within the end line */
  endChar: number;
}

export interface W3CTextQuoteSelector {
  type: 'TextQuoteSelector';
  exact: string;
  prefix?: string;
  suffix?: string;
}

export interface W3CTextPositionSelector {
  type: 'TextPositionSelector';
  start: number;
  end: number;
}

export interface Reply {
  id: string;
  content: string;
  author: string;
  createdAt: string;
  updatedAt?: string;
  thumbsUp?: string[];
}

export interface Comment {
  id: string;
  anchor: CommentAnchor;
  content: string;
  author: string;
  createdAt: string;
  updatedAt?: string;
  resolved?: boolean;
  orphaned?: boolean;
  thumbsUp?: string[];
  replies?: Reply[];
  selector?: W3CTextQuoteSelector | W3CTextPositionSelector;
}

export interface CommentData {
  version: number;
  comments: Comment[];
}

export type OmniCommentPresetId =
  | 'default'
  | 'documentation-site'
  | 'git-file-review'
  | 'browser-annotator'
  | 'team-collaboration'
  | 'ai-agent-reviewer';

export interface OmniCommentPresetConfig {
  id: OmniCommentPresetId;
  name: string;
  description: string;
  uiDensity: 'compact' | 'balanced' | 'full';
  defaultStorage: 'markdown' | 'local' | 'sync' | 'rest';
  allowReactions: boolean;
  enableAgentHooks: boolean;
  zeroDomCollapsing: boolean;
  highlightColor: string;
  highlightBorderColor: string;
}

export interface IOmniCommentAgentAPI {
  getComments(args?: { uri?: string; includeResolved?: boolean }): Promise<Comment[]>;
  postComment(args: {
    uri?: string;
    anchorText: string;
    content: string;
    author?: string;
  }): Promise<Comment | null>;
  replyComment(args: {
    uri?: string;
    commentId: string;
    content: string;
    author?: string;
  }): Promise<Reply | null>;
  resolveComment(args: {
    uri?: string;
    commentId: string;
    resolved?: boolean;
  }): Promise<Comment | null>;
  deleteComment(args: { uri?: string; commentId: string }): Promise<{ success: boolean }>;
}

export type SidebarMessage =
  | { type: 'refresh'; comments: Comment[] }
  | { type: 'focusComment'; commentId: string }
  | { type: 'navigateToComment'; commentId: string }
  | { type: 'deleteComment'; commentId: string }
  | { type: 'resolveComment'; commentId: string }
  | { type: 'reAnchorComment'; commentId: string }
  | { type: 'editComment'; commentId: string; content: string }
  | { type: 'addReply'; commentId: string; content: string }
  | { type: 'editReply'; commentId: string; replyId: string; content: string }
  | { type: 'deleteReply'; commentId: string; replyId: string }
  | { type: 'commentDeleted'; commentId: string }
  | { type: 'commentUpdated'; comment: Comment }
  | { type: 'ready' }
  | { type: 'addComment' }
  | { type: 'showAddCommentForm'; hasSelection: boolean; anchorText?: string; isCustomEditor?: boolean }
  | { type: 'submitNewComment'; content: string; anchorText?: string }
  | { type: 'toggleThumbsUpComment'; commentId: string }
  | { type: 'toggleThumbsUpReply'; commentId: string; replyId: string }
  | { type: 'getWebviewState' }
  | {
      type: 'webviewState';
      isFormOpen: boolean;
      anchorText: string;
      commentInput: string;
      renderedCount: number;
    }
  | { type: 'fillAndSubmitForm'; content: string; anchorText?: string }
  | { type: 'configureCommentBox' }
  | { type: 'setCommentBoxConfig'; config: import('./commentBoxConfig').CommentBoxConfig };

export * from './commentBoxConfig';
export * from './documentUtils';

