/**
 * OmniComment Terminal User Interface (TUI) Renderer
 * Renders documents with inline comment boxes and ANSI highlights in terminal environments.
 */

import { MarkdownStorageAdapter } from '../storage/MarkdownStorageAdapter';
import { Comment } from '../core/types';

export interface TuiRenderOptions {
  useColor?: boolean;
  showResolved?: boolean;
  showCollapsed?: boolean;
}

// ANSI Escape sequences
const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  yellowBg: '\x1b[43;30m',       // Yellow background, black text
  blueBg: '\x1b[44;37m',         // Blue background, white text
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  gray: '\x1b[90m',
  cardBorder: '\x1b[38;5;244m',
  cardBg: '\x1b[48;5;236m'
};

/**
 * Formats an inline comment thread card using Unicode box-drawing characters
 */
export function formatTuiCommentCard(comment: Comment, useColor = true): string[] {
  const c = useColor ? ANSI : { reset: '', bold: '', dim: '', yellowBg: '', blueBg: '', cyan: '', green: '', gray: '', cardBorder: '', cardBg: '' };
  const status = comment.resolved ? `${c.green}✓ RESOLVED${c.reset}` : `${c.yellowBg} 💬 OPEN ${c.reset}`;
  const lines: string[] = [];

  lines.push(`    ${c.cardBorder}┌─${status} ${c.bold}@${comment.author}${c.reset} ${c.gray}(${comment.createdAt.substring(0, 10)})${c.cardBorder}────────────────────────┐${c.reset}`);
  lines.push(`    ${c.cardBorder}│${c.reset}  ${comment.content}`);

  if (comment.replies && comment.replies.length > 0) {
    lines.push(`    ${c.cardBorder}├─ Replies (${comment.replies.length}) ──────────────────────────────────────┤${c.reset}`);
    for (const reply of comment.replies) {
      lines.push(`    ${c.cardBorder}│${c.reset}  ${c.cyan}@${reply.author}${c.reset}: ${reply.content}`);
    }
  }

  lines.push(`    ${c.cardBorder}└────────────────────────────────────────────────────────┘${c.reset}`);
  return lines;
}

/**
 * Renders markdown text for terminal display with ANSI highlights and inline comment cards
 */
export function renderMarkdownWithTuiComments(
  markdownText: string,
  options: TuiRenderOptions = {}
): string {
  const useColor = options.useColor ?? true;
  const showResolved = options.showResolved ?? true;
  const c = useColor ? ANSI : { reset: '', bold: '', dim: '', yellowBg: '', blueBg: '', cyan: '', green: '', gray: '', cardBorder: '', cardBg: '' };

  const adapter = new MarkdownStorageAdapter();
  const comments = adapter.parseCommentsFromText(markdownText);

  // Exclude the storage block from display
  const blockLoc = MarkdownStorageAdapter.findCommentBlock(markdownText);
  const displaySource = blockLoc ? markdownText.substring(0, blockLoc.index).trimEnd() : markdownText;

  const docLines = displaySource.split('\n');
  const outputLines: string[] = [];

  // Index comments by startLine
  const commentsByLine = new Map<number, Comment[]>();
  for (const comment of comments) {
    if (!showResolved && comment.resolved) {
      continue;
    }
    const line = comment.anchor.endLine;
    if (!commentsByLine.has(line)) {
      commentsByLine.set(line, []);
    }
    commentsByLine.get(line)!.push(comment);
  }

  for (let lineIndex = 0; lineIndex < docLines.length; lineIndex++) {
    let lineText = docLines[lineIndex];

    // Highlight anchor text on this line if any comment starts here
    const matchingComments = comments.filter(comm =>
      comm.anchor.startLine <= lineIndex && comm.anchor.endLine >= lineIndex
    );

    if (useColor && matchingComments.length > 0) {
      for (const comm of matchingComments) {
        if (lineText.includes(comm.anchor.text)) {
          lineText = lineText.replace(
            comm.anchor.text,
            `${c.yellowBg}${comm.anchor.text}${c.reset}`
          );
        }
      }
    }

    outputLines.push(lineText);

    // If comments end on this line, render the inline thread card underneath
    const lineComments = commentsByLine.get(lineIndex);
    if (lineComments) {
      for (const comm of lineComments) {
        const cardLines = formatTuiCommentCard(comm, useColor);
        outputLines.push(...cardLines);
      }
    }
  }

  return outputLines.join('\n');
}
