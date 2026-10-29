/**
 * OmniComment Angular Models
 * Aligned with W3C Web Annotation Data Model & OmniComment REST API Specification.
 */

export interface CommentAnchor {
  text: string;
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
}

export interface CommentReply {
  id: string;
  content: string;
  author: string;
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
  createdAt: string;
  updatedAt: string;
  resolved: boolean;
  orphaned: boolean;
  thumbsUp: string[];
  replies: CommentReply[];
}

export interface CreateCommentDto {
  id?: string;
  anchor: CommentAnchor;
  content: string;
  author: string;
}

export interface UpdateCommentDto {
  content?: string;
  resolved?: boolean;
  orphaned?: boolean;
  thumbsUp?: string[];
}

export interface AddReplyDto {
  id?: string;
  content: string;
  author: string;
}

export interface ApiResponse<T> {
  success: boolean;
  count?: number;
  comments?: OmniComment[];
  comment?: OmniComment;
  reply?: CommentReply;
  error?: string;
  message?: string;
}
