/**
 * OmniComment Angular Client Service
 * 
 * Injectable Angular Service providing reactive RxJS observables for interacting
 * with the OmniComment persistence backend.
 */

import { Observable, map } from 'rxjs';
import {
  OmniComment,
  CreateCommentDto,
  UpdateCommentDto,
  CommentReply,
  ApiResponse
} from '../models/omni-comment.model';

export interface HttpClientLike {
  get<T>(url: string, options?: any): Observable<T>;
  post<T>(url: string, body: any, options?: any): Observable<T>;
  patch<T>(url: string, body: any, options?: any): Observable<T>;
  delete<T>(url: string, options?: any): Observable<T>;
}

export class OmniCommentService {
  private baseUrl: string;

  constructor(
    private http: HttpClientLike,
    apiBaseUrl: string = '/api'
  ) {
    this.baseUrl = apiBaseUrl.replace(/\/$/, '');
  }

  /**
   * Retrieves all comment threads for the target document.
   */
  getComments(docId: string, includeResolved: boolean = true): Observable<OmniComment[]> {
    const url = `${this.baseUrl}/documents/${encodeURIComponent(docId)}/comments?includeResolved=${includeResolved}`;
    return this.http.get<ApiResponse<OmniComment[]>>(url).pipe(
      map((res: ApiResponse<OmniComment[]>) => res.comments || [])
    );
  }

  /**
   * Creates a new comment thread anchored to document text.
   */
  createComment(docId: string, dto: CreateCommentDto): Observable<OmniComment> {
    const url = `${this.baseUrl}/documents/${encodeURIComponent(docId)}/comments`;
    return this.http.post<ApiResponse<OmniComment>>(url, dto).pipe(
      map((res: ApiResponse<OmniComment>) => {
        if (!res.comment) {
          throw new Error(res.error || 'Failed to create comment');
        }
        return res.comment;
      })
    );
  }

  /**
   * Updates an existing comment (e.g., resolve, edit content, thumbs up).
   */
  updateComment(docId: string, commentId: string, patch: UpdateCommentDto): Observable<OmniComment> {
    const url = `${this.baseUrl}/documents/${encodeURIComponent(docId)}/comments/${encodeURIComponent(commentId)}`;
    return this.http.patch<ApiResponse<OmniComment>>(url, patch).pipe(
      map((res: ApiResponse<OmniComment>) => {
        if (!res.comment) {
          throw new Error(res.error || 'Failed to update comment');
        }
        return res.comment;
      })
    );
  }

  /**
   * Appends a reply to an existing comment thread.
   */
  addReply(docId: string, commentId: string, content: string, author: string): Observable<CommentReply> {
    const url = `${this.baseUrl}/documents/${encodeURIComponent(docId)}/comments/${encodeURIComponent(commentId)}/replies`;
    return this.http.post<ApiResponse<CommentReply>>(url, { content, author }).pipe(
      map((res: ApiResponse<CommentReply>) => {
        if (!res.reply) {
          throw new Error(res.error || 'Failed to add reply');
        }
        return res.reply;
      })
    );
  }

  /**
   * Deletes a comment thread.
   */
  deleteComment(docId: string, commentId: string): Observable<void> {
    const url = `${this.baseUrl}/documents/${encodeURIComponent(docId)}/comments/${encodeURIComponent(commentId)}`;
    return this.http.delete<ApiResponse<void>>(url).pipe(
      map(() => void 0)
    );
  }
}
