/**
 * markdown-it plugin for OmniComment preview highlighting.
 * Wraps commented anchor text in <span class="omni-highlight"> elements.
 */

import type MarkdownIt from 'markdown-it';
import { MarkdownStorageAdapter } from '../storage/MarkdownStorageAdapter';
import { Comment, CommentData } from '../core/types';

interface Token {
  type: string;
  tag: string;
  nesting: number;
  content: string;
  map?: [number, number] | null;
  children?: Token[] | null;
}

interface TokenConstructor {
  new(type: string, tag: string, nesting: number): Token;
}

function parseCommentsFromSource(src: string): Comment[] {
  const adapter = new MarkdownStorageAdapter();
  return adapter.parseCommentsFromText(src).filter(c => !c.orphaned && !c.resolved);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function groupCommentsByLine(comments: Comment[]): Map<number, Comment[]> {
  const lineMap = new Map<number, Comment[]>();
  for (const comment of comments) {
    const startLine = comment.anchor.startLine;
    const endLine = comment.anchor.endLine;
    for (let line = startLine; line <= endLine; line++) {
      if (!lineMap.has(line)) {
        lineMap.set(line, []);
      }
      lineMap.get(line)!.push(comment);
    }
  }
  return lineMap;
}

function processFenceTokens(
  tokens: Token[],
  lineComments: Map<number, Comment[]>,
  TokenCtor: TokenConstructor
): void {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== 'fence' || !token.map) {
      continue;
    }

    const [startLine, endLine] = token.map;
    const relevantComments: Comment[] = [];
    for (let line = startLine; line < endLine; line++) {
      const comments = lineComments.get(line);
      if (comments) {
        for (const c of comments) {
          if (!relevantComments.includes(c)) {
            relevantComments.push(c);
          }
        }
      }
    }

    if (relevantComments.length === 0) {
      continue;
    }

    const isResolved = relevantComments.every(c => c.resolved);
    const tooltip = relevantComments.map(c => `@${c.author}: ${c.content}`).join('\n---\n');

    const openToken = new TokenCtor('html_block', '', 0);
    openToken.content = `<div class="omni-code-commented" title="${escapeHtml(tooltip)}">\n`;

    const closeToken = new TokenCtor('html_block', '', 0);
    closeToken.content = '</div>\n';

    tokens.splice(i, 0, openToken);
    tokens.splice(i + 2, 0, closeToken);
    i += 2;
  }
}

function processInlineTokens(
  tokens: Token[],
  lineComments: Map<number, Comment[]>,
  TokenCtor: TokenConstructor
): void {
  for (const token of tokens) {
    if (token.type !== 'inline' || !token.children || !token.map) {
      continue;
    }

    const [startLine, endLine] = token.map;
    const relevantComments: Comment[] = [];
    for (let line = startLine; line < endLine; line++) {
      const comments = lineComments.get(line);
      if (comments) {
        for (const c of comments) {
          if (!relevantComments.includes(c)) {
            relevantComments.push(c);
          }
        }
      }
    }

    if (relevantComments.length === 0) {
      continue;
    }

    for (const comment of relevantComments) {
      const anchorText = comment.anchor.text;
      const newChildren: Token[] = [];

      for (const child of token.children) {
        if (child.type !== 'text' || !child.content.includes(anchorText)) {
          newChildren.push(child);
          continue;
        }

        const idx = child.content.indexOf(anchorText);
        const beforeText = child.content.substring(0, idx);
        const afterText = child.content.substring(idx + anchorText.length);

        if (beforeText) {
          const beforeToken = new TokenCtor('text', '', 0);
          beforeToken.content = beforeText;
          newChildren.push(beforeToken);
        }

        const openTag = new TokenCtor('html_inline', '', 0);
        const resolvedClass = comment.resolved ? ' omni-resolved' : '';
        openTag.content = `<span class="omni-highlight${resolvedClass}" title="${escapeHtml(`@${comment.author}: ${comment.content}`)}">`;
        newChildren.push(openTag);

        const matchToken = new TokenCtor('text', '', 0);
        matchToken.content = anchorText;
        newChildren.push(matchToken);

        const closeTag = new TokenCtor('html_inline', '', 0);
        closeTag.content = '</span>';
        newChildren.push(closeTag);

        if (afterText) {
          const afterToken = new TokenCtor('text', '', 0);
          afterToken.content = afterText;
          newChildren.push(afterToken);
        }
      }

      token.children = newChildren;
    }
  }
}

export function omniCommentPreviewPlugin(md: MarkdownIt): void {
  md.core.ruler.push('omnicomment_highlight', (state) => {
    const src = state.src;
    const comments = parseCommentsFromSource(src);
    if (comments.length === 0) {
      return;
    }

    const lineComments = groupCommentsByLine(comments);
    const TokenCtor = state.Token as unknown as TokenConstructor;

    processFenceTokens(state.tokens, lineComments, TokenCtor);
    processInlineTokens(state.tokens, lineComments, TokenCtor);
  });
}

export default omniCommentPreviewPlugin;
