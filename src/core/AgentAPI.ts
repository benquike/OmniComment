import { Comment } from './types';

/**
 * Formats a list of comments into a compact, human- and LLM-friendly prompt context block
 */
export function exportContextForLLM(comments: Comment[]): string {
  if (!comments || comments.length === 0) {
    return 'No comments or review threads present in document.';
  }

  return comments
    .map(c => {
      const status = c.resolved ? '[RESOLVED]' : '[OPEN]';
      const replies = (c.replies || [])
        .map(r => `    - Reply by @${r.author}: "${r.content}"`)
        .join('\n');
      return [
        `### Comment Thread [ID: ${c.id}] ${status}`,
        `Anchored to: "${c.anchor.text}" (lines ${c.anchor.startLine + 1}-${c.anchor.endLine + 1})`,
        `Author: @${c.author}`,
        `Message: "${c.content}"`,
        replies ? `Replies:\n${replies}` : null
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n\n---\n\n');
}
