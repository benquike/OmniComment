/**
 * OmniComment Firebase Client Adapter
 * 
 * Provides client-side synchronization adapters for @omnicomment/web-plugin
 * supporting both Direct Firestore Realtime SDK (onSnapshot) and Cloud Functions REST API.
 */

import { OmniComment, CreateCommentDto, UpdateCommentDto } from './types';

export interface FirebaseClientOptions {
  /** Root Cloud Function endpoint URL (e.g., https://us-central1-my-project.cloudfunctions.net/api) */
  endpoint?: string;
  /** Custom auth token generator or bearer token */
  getAuthToken?: () => Promise<string | null>;
}

/**
 * REST API client that interacts with the OmniComment Firebase Cloud Functions backend.
 */
export class FirebaseRestClient {
  private endpoint: string;
  private getAuthToken?: () => Promise<string | null>;

  constructor(options: FirebaseClientOptions) {
    this.endpoint = (options.endpoint || '').replace(/\/$/, '');
    this.getAuthToken = options.getAuthToken;
  }

  private async getHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (this.getAuthToken) {
      const token = await this.getAuthToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }
    return headers;
  }

  /**
   * Fetches all comments for a document.
   */
  async getComments(documentId: string, includeResolved = true): Promise<OmniComment[]> {
    const headers = await this.getHeaders();
    const url = `${this.endpoint}/api/documents/${encodeURIComponent(documentId)}/comments?includeResolved=${includeResolved}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`Failed to load comments: ${res.statusText}`);
    }
    const data = await res.json();
    return data.comments || [];
  }

  /**
   * Creates a new comment thread.
   */
  async createComment(documentId: string, payload: CreateCommentDto): Promise<OmniComment> {
    const headers = await this.getHeaders();
    const url = `${this.endpoint}/api/documents/${encodeURIComponent(documentId)}/comments`;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      throw new Error(`Failed to create comment: ${res.statusText}`);
    }
    const data = await res.json();
    return data.comment;
  }

  /**
   * Updates an existing comment (e.g. resolve, content update, reply).
   */
  async updateComment(documentId: string, commentId: string, patch: UpdateCommentDto): Promise<OmniComment> {
    const headers = await this.getHeaders();
    const url = `${this.endpoint}/api/documents/${encodeURIComponent(documentId)}/comments/${encodeURIComponent(commentId)}`;
    const res = await fetch(url, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(patch)
    });
    if (!res.ok) {
      throw new Error(`Failed to update comment: ${res.statusText}`);
    }
    const data = await res.json();
    return data.comment;
  }

  /**
   * Appends a reply to an existing comment.
   */
  async addReply(documentId: string, commentId: string, content: string, author: string): Promise<any> {
    const headers = await this.getHeaders();
    const url = `${this.endpoint}/api/documents/${encodeURIComponent(documentId)}/comments/${encodeURIComponent(commentId)}/replies`;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ content, author })
    });
    if (!res.ok) {
      throw new Error(`Failed to add reply: ${res.statusText}`);
    }
    const data = await res.json();
    return data.reply;
  }

  /**
   * Deletes a comment thread.
   */
  async deleteComment(documentId: string, commentId: string, soft = false): Promise<void> {
    const headers = await this.getHeaders();
    const url = `${this.endpoint}/api/documents/${encodeURIComponent(documentId)}/comments/${encodeURIComponent(commentId)}?soft=${soft}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers
    });
    if (!res.ok) {
      throw new Error(`Failed to delete comment: ${res.statusText}`);
    }
  }
}

/**
 * Direct Firebase Firestore Client Integration Helper.
 * Demonstrates real-time onSnapshot synchronization using client-side Firebase SDK.
 *
 * Example Usage with @omnicomment/web-plugin:
 * ```typescript
 * import { initializeApp } from 'firebase/app';
 * import { getFirestore } from 'firebase/firestore';
 * import { createFirestoreStorageAdapter } from './client';
 * 
 * const firebaseApp = initializeApp(firebaseConfig);
 * const firestore = getFirestore(firebaseApp);
 * const storageAdapter = createFirestoreStorageAdapter(firestore);
 * 
 * initOmniComment({
 *   target: '#article-content',
 *   documentId: 'getting-started-guide',
 *   storage: storageAdapter
 * });
 * ```
 */
export function createFirestoreStorageAdapter(firestoreInstance: any) {
  return {
    type: 'custom',

    /**
     * Subscribe to real-time changes in Firestore comments collection.
     */
    subscribe(documentId: string, onUpdate: (comments: OmniComment[]) => void): () => void {
      // Lazy import or reference from firebase/firestore
      const { collection, query, orderBy, onSnapshot } = require('firebase/firestore');
      const commentsRef = collection(firestoreInstance, 'documents', documentId, 'comments');
      const q = query(commentsRef, orderBy('createdAt', 'asc'));

      const unsubscribe = onSnapshot(q, (snapshot: any) => {
        const comments: OmniComment[] = [];
        snapshot.forEach((doc: any) => {
          comments.push(doc.data() as OmniComment);
        });
        onUpdate(comments);
      });

      return unsubscribe;
    },

    /**
     * Save or update a comment in Firestore.
     */
    async saveComment(documentId: string, comment: OmniComment): Promise<void> {
      const { doc, setDoc } = require('firebase/firestore');
      const docRef = doc(firestoreInstance, 'documents', documentId, 'comments', comment.id);
      await setDoc(docRef, comment, { merge: true });
    },

    /**
     * Delete a comment from Firestore.
     */
    async deleteComment(documentId: string, commentId: string): Promise<void> {
      const { doc, deleteDoc } = require('firebase/firestore');
      const docRef = doc(firestoreInstance, 'documents', documentId, 'comments', commentId);
      await deleteDoc(docRef);
    }
  };
}
