/**
 * OmniComment Firebase Cloud Functions Server
 *
 * Implements a high-performance REST API and Firestore background triggers
 * for persisting OmniComment threads, replies, and resolutions.
 */

import * as express from 'express';
import * as cors from 'cors';
import * as admin from 'firebase-admin';
import { onRequest } from 'firebase-functions/v2/https';
import {
  onDocumentCreated,
  onDocumentUpdated,
  FirestoreEvent,
  QueryDocumentSnapshot,
  Change
} from 'firebase-functions/v2/firestore';

import {
  OmniComment,
  CreateCommentDto,
  UpdateCommentDto,
  AddReplyDto,
  CommentReply
} from './types';

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const app = express();

app.use(cors({ origin: true }));
app.use(express.json());

// -----------------------------------------------------------------------------
// Domain Validation Helpers (HC001, HC003)
// -----------------------------------------------------------------------------

/**
 * Validates that the comment payload contains non-empty author, content, and valid anchor.
 *
 * // Invariant: Every persisted comment must have valid text anchor coordinates and author.
 * // Why: Prevents orphaned or un-renderable comment pins from entering Firestore.
 * // Example: isValidCommentPayload({ anchor: { text: "hello", ... }, content: "typo", author: "Alice" }) -> true
 */
function isValidCommentPayload(payload: any): boolean {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const { anchor, content, author } = payload;
  if (typeof content !== 'string' || content.trim().length === 0) {
    return false;
  }
  if (typeof author !== 'string' || author.trim().length === 0) {
    return false;
  }
  if (!anchor || typeof anchor !== 'object') {
    return false;
  }
  return typeof anchor.text === 'string' &&
    typeof anchor.startLine === 'number' &&
    typeof anchor.startChar === 'number' &&
    typeof anchor.endLine === 'number' &&
    typeof anchor.endChar === 'number';
}

/**
 * Helper to build Firestore comment collection reference.
 */
function getCommentsCollection(documentId: string): admin.firestore.CollectionReference {
  return db.collection('documents').doc(documentId).collection('comments');
}

// -----------------------------------------------------------------------------
// HTTP REST API Endpoints
// -----------------------------------------------------------------------------

/**
 * Health check endpoint for uptime monitors and readiness probes.
 */
app.get('/health', (_req: express.Request, res: express.Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'omnicomment-firebase-server',
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /api/documents/:docId/comments
 * Retrieves all comments associated with a specific document.
 */
app.get('/api/documents/:docId/comments', async (req: express.Request, res: express.Response) => {
  try {
    const { docId } = req.params;
    const includeResolved = req.query.includeResolved !== 'false';
    const sort = req.query.sort === 'desc' ? 'desc' : 'asc';

    let query: admin.firestore.Query = getCommentsCollection(docId);

    if (!includeResolved) {
      query = query.where('resolved', '==', false);
    }

    query = query.orderBy('createdAt', sort);

    const snapshot = await query.get();
    const comments: OmniComment[] = [];

    snapshot.forEach((doc) => {
      comments.push(doc.data() as OmniComment);
    });

    res.status(200).json({
      success: true,
      count: comments.length,
      comments
    });
  } catch (error: any) {
    console.error('Error fetching comments:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve comments',
      message: error?.message
    });
  }
});

/**
 * GET /api/documents/:docId/comments/:commentId
 * Retrieves a single comment thread by ID.
 */
app.get('/api/documents/:docId/comments/:commentId', async (req: express.Request, res: express.Response) => {
  try {
    const { docId, commentId } = req.params;
    const docRef = getCommentsCollection(docId).doc(commentId);
    const doc = await docRef.get();

    if (!doc.exists) {
      res.status(404).json({ success: false, error: 'Comment not found' });
      return;
    }

    res.status(200).json({
      success: true,
      comment: doc.data() as OmniComment
    });
  } catch (error: any) {
    console.error('Error fetching comment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve comment',
      message: error?.message
    });
  }
});

/**
 * POST /api/documents/:docId/comments
 * Creates a new comment thread anchored to document text.
 */
app.post('/api/documents/:docId/comments', async (req: express.Request, res: express.Response) => {
  try {
    const { docId } = req.params;
    const payload: CreateCommentDto = req.body;

    if (!isValidCommentPayload(payload)) {
      res.status(400).json({
        success: false,
        error: 'Invalid comment payload. Anchor, content, and author are required.'
      });
      return;
    }

    const commentsCol = getCommentsCollection(docId);
    const commentId = payload.id && payload.id.trim().length > 0
      ? payload.id.trim()
      : commentsCol.doc().id;

    const now = new Date().toISOString();
    const newComment: OmniComment = {
      id: commentId,
      documentId: docId,
      anchor: payload.anchor,
      content: payload.content,
      author: payload.author,
      authorId: payload.authorId,
      createdAt: now,
      updatedAt: now,
      resolved: false,
      orphaned: false,
      thumbsUp: [],
      replies: payload.replies || [],
      selector: payload.selector
    };

    await commentsCol.doc(commentId).set(newComment);

    res.status(201).json({
      success: true,
      comment: newComment
    });
  } catch (error: any) {
    console.error('Error creating comment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create comment',
      message: error?.message
    });
  }
});

/**
 * PATCH /api/documents/:docId/comments/:commentId
 * Updates an existing comment (edit content, resolve/unresolve, or add reaction).
 */
app.patch('/api/documents/:docId/comments/:commentId', async (req: express.Request, res: express.Response) => {
  try {
    const { docId, commentId } = req.params;
    const patch: UpdateCommentDto = req.body;
    const docRef = getCommentsCollection(docId).doc(commentId);

    const doc = await docRef.get();
    if (!doc.exists) {
      res.status(404).json({ success: false, error: 'Comment not found' });
      return;
    }

    const updates: Record<string, any> = {
      updatedAt: new Date().toISOString()
    };

    if (typeof patch.content === 'string' && patch.content.trim().length > 0) {
      updates.content = patch.content;
    }
    if (typeof patch.resolved === 'boolean') {
      updates.resolved = patch.resolved;
    }
    if (typeof patch.orphaned === 'boolean') {
      updates.orphaned = patch.orphaned;
    }
    if (Array.isArray(patch.thumbsUp)) {
      updates.thumbsUp = patch.thumbsUp;
    }
    if (patch.reply) {
      updates.replies = admin.firestore.FieldValue.arrayUnion(patch.reply);
    }

    await docRef.update(updates);
    const updatedDoc = await docRef.get();

    res.status(200).json({
      success: true,
      comment: updatedDoc.data() as OmniComment
    });
  } catch (error: any) {
    console.error('Error updating comment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update comment',
      message: error?.message
    });
  }
});

/**
 * POST /api/documents/:docId/comments/:commentId/replies
 * Appends a new reply to an existing comment thread.
 */
app.post('/api/documents/:docId/comments/:commentId/replies', async (req: express.Request, res: express.Response) => {
  try {
    const { docId, commentId } = req.params;
    const payload: AddReplyDto = req.body;

    if (!payload.content || !payload.author) {
      res.status(400).json({
        success: false,
        error: 'Content and author are required for a reply.'
      });
      return;
    }

    const docRef = getCommentsCollection(docId).doc(commentId);
    const doc = await docRef.get();
    if (!doc.exists) {
      res.status(404).json({ success: false, error: 'Target comment thread not found' });
      return;
    }

    const replyId = payload.id || `reply-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const now = new Date().toISOString();

    const newReply: CommentReply = {
      id: replyId,
      content: payload.content,
      author: payload.author,
      authorId: payload.authorId,
      createdAt: now,
      updatedAt: now,
      thumbsUp: []
    };

    await docRef.update({
      replies: admin.firestore.FieldValue.arrayUnion(newReply),
      updatedAt: now
    });

    res.status(201).json({
      success: true,
      reply: newReply
    });
  } catch (error: any) {
    console.error('Error adding reply:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add reply',
      message: error?.message
    });
  }
});

/**
 * DELETE /api/documents/:docId/comments/:commentId
 * Deletes a comment thread permanently or soft-deletes if query param ?soft=true.
 */
app.delete('/api/documents/:docId/comments/:commentId', async (req: express.Request, res: express.Response) => {
  try {
    const { docId, commentId } = req.params;
    const soft = req.query.soft === 'true';
    const docRef = getCommentsCollection(docId).doc(commentId);

    const doc = await docRef.get();
    if (!doc.exists) {
      res.status(404).json({ success: false, error: 'Comment not found' });
      return;
    }

    if (soft) {
      await docRef.update({
        deleted: true,
        updatedAt: new Date().toISOString()
      });
    } else {
      await docRef.delete();
    }

    res.status(200).json({
      success: true,
      message: `Comment ${commentId} successfully deleted`
    });
  } catch (error: any) {
    console.error('Error deleting comment:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete comment',
      message: error?.message
    });
  }
});

// Export Cloud Functions v2 HTTP Handler
export const api = onRequest(
  {
    cors: true,
    region: 'us-central1',
    maxInstances: 10
  },
  app
);

// -----------------------------------------------------------------------------
// Cloud Functions v2 Firestore Reactive Triggers
// -----------------------------------------------------------------------------

/**
 * Triggered whenever a new comment document is created in Firestore.
 * Useful for automated notifications (Slack, Discord, Email) or AI triage.
 */
export const onCommentCreated = onDocumentCreated(
  'documents/{docId}/comments/{commentId}',
  async (event: FirestoreEvent<QueryDocumentSnapshot | undefined>) => {
    const snapshot = event.data;
    if (!snapshot) {
      return;
    }
    const comment = snapshot.data() as OmniComment;
    const docId = event.params.docId;
    console.log(`[Firestore Trigger] New comment ${comment.id} on document ${docId} by ${comment.author}`);
    // Optional integration: Trigger webhook or notify subscribed team members
  }
);

/**
 * Triggered whenever a comment document is modified in Firestore.
 * Useful for audit trails or alerting when a thread is resolved.
 */
export const onCommentUpdated = onDocumentUpdated(
  'documents/{docId}/comments/{commentId}',
  async (event: FirestoreEvent<Change<QueryDocumentSnapshot> | undefined>) => {
    const change = event.data;
    if (!change) {
      return;
    }
    const before = change.before.data() as OmniComment;
    const after = change.after.data() as OmniComment;

    if (!before.resolved && after.resolved) {
      console.log(`[Firestore Trigger] Comment ${after.id} was marked as RESOLVED.`);
    }
  }
);
