/**
 * OmniComment Angular SSR Application Server
 *
 * Implements an Angular SSR Express server that hosts both the OmniComment
 * persistence REST API and Angular server-side rendered application pages.
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import * as fs from 'fs';
import * as path from 'path';

import {
  OmniComment,
  CreateCommentDto,
  UpdateCommentDto,
  AddReplyDto,
  CommentReply
} from './src/app/models/omni-comment.model';

const app = express();
const PORT = process.env['PORT'] || 4000;
const DATA_FILE = process.env['OMNICOMMENT_DATA_PATH'] || path.join(__dirname, 'comments.json');

app.use(cors({ origin: true }));
app.use(express.json());

// -----------------------------------------------------------------------------
// In-Memory & Persistent Storage Engine (HC001, HC004)
// -----------------------------------------------------------------------------

// Invariant: Comments state must be persisted atomically to prevent JSON truncation.
// Why: Prevents data loss during server restarts or ungraceful container terminations.
// Example: In-memory Map serializes to comments.json with atomic rename.
interface StorageState {
  // documentId -> commentId -> OmniComment
  [documentId: string]: { [commentId: string]: OmniComment };
}

let store: StorageState = {};

function loadStorage(): void {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      if (raw.trim().length > 0) {
        store = JSON.parse(raw);
      }
    }
  } catch (err) {
    console.error('Warning: Failed to load storage file, initializing empty store:', err);
    store = {};
  }
}

function persistStorage(): void {
  try {
    const tmpFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(store, null, 2), 'utf-8');
    fs.renameSync(tmpFile, DATA_FILE);
  } catch (err) {
    console.error('Error persisting storage to disk:', err);
  }
}

loadStorage();

// -----------------------------------------------------------------------------
// Validation Helpers (HC001, HC003)
// -----------------------------------------------------------------------------

/**
 * Validates required comment creation fields.
 */
function isValidCommentPayload(payload: any): boolean {
  if (!payload || typeof payload !== 'object') {
    return false;
  }
  const { anchor, content, author } = payload;
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return false;
  }
  if (!author || typeof author !== 'string' || author.trim().length === 0) {
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

function generateId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 7)}`;
}

// -----------------------------------------------------------------------------
// OmniComment Persistence REST API Endpoints
// -----------------------------------------------------------------------------

/**
 * Health check endpoint.
 */
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    service: 'omnicomment-angular-ssr-server',
    timestamp: new Date().toISOString()
  });
});

/**
 * GET /api/documents/:docId/comments
 * List all comments for a document.
 */
app.get('/api/documents/:docId/comments', (req: Request, res: Response) => {
  const { docId } = req.params;
  const includeResolved = req.query['includeResolved'] !== 'false';
  const sort = req.query['sort'] === 'desc' ? 'desc' : 'asc';

  const docComments = store[docId] || {};
  let list = Object.values(docComments);

  if (!includeResolved) {
    list = list.filter((c) => !c.resolved);
  }

  list.sort((a, b) => {
    return sort === 'desc'
      ? b.createdAt.localeCompare(a.createdAt)
      : a.createdAt.localeCompare(b.createdAt);
  });

  res.status(200).json({
    success: true,
    count: list.length,
    comments: list
  });
});

/**
 * GET /api/documents/:docId/comments/:commentId
 * Retrieve a single comment by ID.
 */
app.get('/api/documents/:docId/comments/:commentId', (req: Request, res: Response) => {
  const { docId, commentId } = req.params;
  const comment = store[docId]?.[commentId];

  if (!comment) {
    res.status(404).json({ success: false, error: 'Comment not found' });
    return;
  }

  res.status(200).json({ success: true, comment });
});

/**
 * POST /api/documents/:docId/comments
 * Create a new comment thread.
 */
app.post('/api/documents/:docId/comments', (req: Request, res: Response) => {
  const { docId } = req.params;
  const payload: CreateCommentDto = req.body;

  if (!isValidCommentPayload(payload)) {
    res.status(400).json({
      success: false,
      error: 'Invalid payload: anchor, content, and author are required'
    });
    return;
  }

  const commentId = payload.id && payload.id.trim().length > 0
    ? payload.id.trim()
    : generateId('comment');

  const now = new Date().toISOString();
  const newComment: OmniComment = {
    id: commentId,
    documentId: docId,
    anchor: payload.anchor,
    content: payload.content,
    author: payload.author,
    createdAt: now,
    updatedAt: now,
    resolved: false,
    orphaned: false,
    thumbsUp: [],
    replies: []
  };

  if (!store[docId]) {
    store[docId] = {};
  }
  store[docId][commentId] = newComment;
  persistStorage();

  res.status(201).json({ success: true, comment: newComment });
});

/**
 * PATCH /api/documents/:docId/comments/:commentId
 * Update comment content, resolved state, or reactions.
 */
app.patch('/api/documents/:docId/comments/:commentId', (req: Request, res: Response) => {
  const { docId, commentId } = req.params;
  const patch: UpdateCommentDto = req.body;
  const comment = store[docId]?.[commentId];

  if (!comment) {
    res.status(404).json({ success: false, error: 'Comment not found' });
    return;
  }

  const now = new Date().toISOString();
  comment.updatedAt = now;

  if (typeof patch.content === 'string' && patch.content.trim().length > 0) {
    comment.content = patch.content;
  }
  if (typeof patch.resolved === 'boolean') {
    comment.resolved = patch.resolved;
  }
  if (typeof patch.orphaned === 'boolean') {
    comment.orphaned = patch.orphaned;
  }
  if (Array.isArray(patch.thumbsUp)) {
    comment.thumbsUp = patch.thumbsUp;
  }

  persistStorage();
  res.status(200).json({ success: true, comment });
});

/**
 * POST /api/documents/:docId/comments/:commentId/replies
 * Append a reply to a thread.
 */
app.post('/api/documents/:docId/comments/:commentId/replies', (req: Request, res: Response) => {
  const { docId, commentId } = req.params;
  const payload: AddReplyDto = req.body;
  const comment = store[docId]?.[commentId];

  if (!comment) {
    res.status(404).json({ success: false, error: 'Target comment thread not found' });
    return;
  }

  if (!payload.content || !payload.author) {
    res.status(400).json({ success: false, error: 'Content and author are required' });
    return;
  }

  const now = new Date().toISOString();
  const reply: CommentReply = {
    id: payload.id || generateId('reply'),
    content: payload.content,
    author: payload.author,
    createdAt: now,
    updatedAt: now,
    thumbsUp: []
  };

  comment.replies.push(reply);
  comment.updatedAt = now;
  persistStorage();

  res.status(201).json({ success: true, reply });
});

/**
 * DELETE /api/documents/:docId/comments/:commentId
 * Delete a comment thread.
 */
app.delete('/api/documents/:docId/comments/:commentId', (req: Request, res: Response) => {
  const { docId, commentId } = req.params;

  if (!store[docId]?.[commentId]) {
    res.status(404).json({ success: false, error: 'Comment not found' });
    return;
  }

  delete store[docId][commentId];
  persistStorage();

  res.status(200).json({ success: true, message: `Comment ${commentId} deleted successfully` });
});

// -----------------------------------------------------------------------------
// Angular SSR HTML Fallback Page
// -----------------------------------------------------------------------------

/**
 * Default HTML response when running standalone or serving Angular SSR.
 */
app.get('*', (_req: Request, res: Response) => {
  res.status(200).send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>OmniComment Angular SSR Server</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #24292f; }
    code { background: #f6f8fa; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
    .badge { display: inline-block; background: #0969da; color: white; padding: 4px 10px; border-radius: 20px; font-size: 0.85em; font-weight: 600; margin-bottom: 12px; }
  </style>
</head>
<body>
  <div class="badge">Angular SSR + OmniComment REST Server</div>
  <h1>OmniComment Angular Server is Running</h1>
  <p>This Express server hosts the <strong>OmniComment Persistence REST API</strong> and serves Angular Server-Side Rendered (SSR) views.</p>
  
  <h3>Available Endpoints</h3>
  <ul>
    <li><code>GET /health</code> - Server health status</li>
    <li><code>GET /api/documents/:docId/comments</code> - Retrieve comments for document</li>
    <li><code>POST /api/documents/:docId/comments</code> - Create comment thread</li>
    <li><code>PATCH /api/documents/:docId/comments/:commentId</code> - Update comment</li>
    <li><code>POST /api/documents/:docId/comments/:commentId/replies</code> - Add reply</li>
    <li><code>DELETE /api/documents/:docId/comments/:commentId</code> - Delete thread</li>
  </ul>
</body>
</html>
  `);
});

app.listen(PORT, () => {
  console.log(`OmniComment Angular SSR Server listening on http://localhost:${PORT}`);
});
