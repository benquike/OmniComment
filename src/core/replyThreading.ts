import type { Comment } from './types';

const SNIPPET_MAX_LENGTH = 60;

export interface ReplyTarget {
  id: string;
  author: string;
  content: string;
  isRoot: boolean;
}

// Invariant: Resolves an inReplyTo id to the root comment or a reply inside the same thread.
// Why: Replies may only point at items of their own thread; anything else is treated as
//      a plain reply to the thread (e.g. the target was deleted).
// Example: findReplyTarget(comment, 'r2') => { id: 'r2', author: 'bob', isRoot: false, ... }.
export function findReplyTarget(comment: Comment, targetId?: string): ReplyTarget | undefined {
  if (!targetId) {
    return undefined;
  }
  if (targetId === comment.id) {
    return { id: comment.id, author: comment.author, content: comment.content, isRoot: true };
  }
  const reply = (comment.replies || []).find(r => r.id === targetId);
  if (!reply) {
    return undefined;
  }
  return { id: reply.id, author: reply.author, content: reply.content, isRoot: false };
}

// Invariant: Produces a one-line, length-capped preview of the replied-to text.
// Why: The quote above a reply must identify its target without repeating the whole message.
// Example: formatReplySnippet('line one\nline two') => 'line one line two'.
export function formatReplySnippet(content: string, maxLength = SNIPPET_MAX_LENGTH): string {
  const flat = content.replace(/\s+/g, ' ').trim();
  return flat.length > maxLength ? `${flat.slice(0, maxLength - 1)}…` : flat;
}
