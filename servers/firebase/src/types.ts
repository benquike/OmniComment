/**
 * OmniComment Firebase Server Types
 * Compatible with W3C Web Annotation data models and OmniComment Core.
 */

export interface CommentAnchor {
  text: string;
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
}

export interface W3CTextQuoteSelector {
  type: 'TextQuoteSelector';
  exact: string;
  prefix?: string;
  suffix?: string;
}

export interface CommentReply {
  id: string;
  content: string;
  author: string;
  authorId?: string;
  createdAt: string;
  updatedAt?: string;
  thumbsUp?: string[];
}

export interface OmniComment {
  id: string;
  documentId: string;
  anchor: CommentAnchor;
  content: string;
  author: string;
  authorId?: string;
  createdAt: string;
  updatedAt?: string;
  resolved?: boolean;
  orphaned?: boolean;
  thumbsUp?: string[];
  replies?: CommentReply[];
  selector?: W3CTextQuoteSelector;
}

export interface CreateCommentDto {
  id?: string;
  anchor: CommentAnchor;
  content: string;
  author: string;
  authorId?: string;
  selector?: W3CTextQuoteSelector;
  replies?: CommentReply[];
}

export interface UpdateCommentDto {
  content?: string;
  resolved?: boolean;
  orphaned?: boolean;
  thumbsUp?: string[];
  reply?: CommentReply;
}

export interface AddReplyDto {
  id?: string;
  content: string;
  author: string;
  authorId?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}
