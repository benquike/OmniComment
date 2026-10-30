const OMNI_COMMENT_BLOCK_START = '<!-- omnicomment';
const COMMENT_BLOCK_START = OMNI_COMMENT_BLOCK_START;
const COMMENT_BLOCK_END = '-->';
const ALL_COMMENT_MARKERS = [
  OMNI_COMMENT_BLOCK_START,
  '<!-- markco-comments',
  '<!-- markco',
  '<!-- commark-comments'
];

function sanitizeForStorage(text) {
  return typeof text === 'string' ? text.replace(/-->/g, '--\u200B>') : '';
}

function restoreFromStorage(text) {
  return typeof text === 'string' ? text.replace(/--\u200B>/g, '-->') : '';
}

function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function stripMarkdownSyntax(text) {
  return (text || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*[-*+][ \t]+(\[[ xX]\][ \t]+)?/gm, '')
    .replace(/^[ \t]*\d+\.[ \t]+(?=[a-zA-Z])/gm, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~|`)/g, '')
    .replace(/(?<=^|[\s(])[*_](?=\S)|(?<=\S)[*_](?=[\s).,!?:;]|$)/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isInsideCodeContext(text, position) {
  const beforeText = text.substring(0, position);
  const fenceMatches = beforeText.match(/```/g);
  return fenceMatches !== null && fenceMatches.length % 2 === 1;
}

function findCommentBlockSpan(markdown) {
  if (!markdown || typeof markdown !== 'string') {
    return null;
  }
  // Invariant: Recognize <!-- omnicomment delimiters (and legacy markco/commark markers) outside code blocks.
  // Why: Prevents false matches from code blocks or diagrams while supporting legacy comment blocks.
  // Example: <!-- omnicomment\n{...}\n--> or <!-- markco-comments\n{...}\n-->
  let bestSpan = null;
  for (const marker of ALL_COMMENT_MARKERS) {
    let searchStart = markdown.length;
    while (searchStart > 0) {
      const startIdx = markdown.lastIndexOf(marker, searchStart - 1);
      if (startIdx === -1) {
        break;
      }
      if (!isInsideCodeContext(markdown, startIdx)) {
        const endIdx = markdown.indexOf(
          COMMENT_BLOCK_END,
          startIdx + marker.length
        );
        if (endIdx !== -1) {
          const jsonStr = markdown.substring(startIdx + marker.length, endIdx).trim();
          if (jsonStr.startsWith('{')) {
            const fullEnd = endIdx + COMMENT_BLOCK_END.length;
            const span = {
              startIdx,
              endIdx: fullEnd,
              marker,
              blockText: markdown.substring(startIdx, fullEnd),
              jsonStr
            };
            if (!bestSpan || span.startIdx > bestSpan.startIdx) {
              bestSpan = span;
            }
            break;
          }
        }
      }
      searchStart = startIdx;
    }
  }
  return bestSpan;
}

export function parseOmniComments(markdown) {
  const span = findCommentBlockSpan(markdown);
  if (!span || !span.jsonStr.startsWith('{')) {
    return [];
  }
  try {
    const data = JSON.parse(span.jsonStr);
    return (data.comments || []).map(c => ({
      ...c,
      anchor: {
        ...c.anchor,
        text: restoreFromStorage(c.anchor?.text || '')
      },
      content: restoreFromStorage(c.content || ''),
      replies: (c.replies || []).map(r => ({
        ...r,
        content: restoreFromStorage(r.content || '')
      }))
    }));
  } catch {
    return [];
  }
}

// Invariant: Resolves an inReplyTo id to the root comment or a reply of the same thread.
// Why: Mirrors src/core/replyThreading.ts so the webview and the extension agree on targets.
// Example: findThreadItem(comment, 'r2') => { id: 'r2', author: 'bob', content: '...' }.
function findThreadItem(comment, itemId) {
  if (!comment || !itemId) return null;
  if (itemId === comment.id) {
    return { id: comment.id, author: comment.author, content: comment.content || '' };
  }
  const reply = (comment.replies || []).find(r => r.id === itemId);
  return reply ? { id: reply.id, author: reply.author, content: reply.content || '' } : null;
}

// Invariant: One-line, length-capped preview of a message for quotes and chips.
// Example: replySnippet('a\nb') => 'a b'.
function replySnippet(content, maxLength = 60) {
  const flat = String(content || '').replace(/\s+/g, ' ').trim();
  return flat.length > maxLength ? flat.slice(0, maxLength - 1) + '…' : flat;
}

function serializeCommentsBlock(comments, marker = OMNI_COMMENT_BLOCK_START) {
  const sanitizedComments = comments.map(c => {
    const item = {
      ...c,
      anchor: {
        ...c.anchor,
        text: sanitizeForStorage(c.anchor?.text || '')
      },
      content: sanitizeForStorage(c.content || '')
    };
    if (Array.isArray(c.replies) && c.replies.length > 0) {
      item.replies = c.replies.map(r => ({
        ...r,
        content: sanitizeForStorage(r.content || '')
      }));
    } else {
      delete item.replies;
    }
    return item;
  });
  const data = {
    version: 2,
    comments: sanitizedComments
  };
  return `${marker}\n${JSON.stringify(data, null, 2)}\n${COMMENT_BLOCK_END}`;
}

function replaceOrAppendCommentsBlock(markdown, blockStr) {
  const base = typeof markdown === 'string' ? markdown : '';
  const span = findCommentBlockSpan(base);
  if (!blockStr) {
    return base;
  }
  if (span) {
    return base.substring(0, span.startIdx) + blockStr + base.substring(span.endIdx);
  }
  const trimmedEnd = base.replace(/\s+$/, '');
  return trimmedEnd ? `${trimmedEnd}\n\n${blockStr}\n` : `${blockStr}\n`;
}

function offsetToLineChar(text, offset) {
  const clamped = Math.max(0, Math.min(text.length, offset));
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < clamped; i++) {
    if (text[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, character: clamped - lineStart };
}

function buildNormalizedMarkdownMap(text) {
  const skip = new Uint8Array(text.length);
  const markSkipRegex = regex => {
    let m;
    while ((m = regex.exec(text)) !== null) {
      for (let i = m.index; i < m.index + m[0].length; i++) {
        skip[i] = 1;
      }
    }
  };

  markSkipRegex(/[\u200B-\u200D\uFEFF]/g);
  markSkipRegex(/^[ \t]*#{1,6}[ \t]+/gm);
  markSkipRegex(/^[ \t]*>[ \t]?/gm);
  markSkipRegex(/^[ \t]*[-*+][ \t]+(\[[ xX]\][ \t]+)?/gm);
  markSkipRegex(/^[ \t]*\d+\.[ \t]+/gm);

  const linkRegex = /!?\[([^\]]*)\]\(([^)]*)\)/g;
  let linkMatch;
  while ((linkMatch = linkRegex.exec(text)) !== null) {
    const fullStart = linkMatch.index;
    const isImage = text[fullStart] === '!';
    const labelStart = fullStart + (isImage ? 2 : 1);
    const labelEnd = labelStart + linkMatch[1].length;
    const fullEnd = fullStart + linkMatch[0].length;
    for (let i = fullStart; i < labelStart; i++) skip[i] = 1;
    for (let i = labelEnd; i < fullEnd; i++) skip[i] = 1;
  }

  markSkipRegex(/(\*\*|__|~~|`)/g);
  markSkipRegex(/(?<=^|[\s(])[*_](?=\S)|(?<=\S)[*_](?=[\s).,!?:;]|$)/gm);

  const chars = [];
  const offsets = [];
  let lastWasSpace = true;

  for (let i = 0; i < text.length; i++) {
    if (skip[i]) continue;
    const ch = text[i];
    if (/\s|\u00A0/.test(ch)) {
      if (!lastWasSpace) {
        chars.push(' ');
        offsets.push(i);
        lastWasSpace = true;
      }
    } else {
      chars.push(ch);
      offsets.push(i);
      lastWasSpace = false;
    }
  }

  if (chars.length > 0 && chars[chars.length - 1] === ' ') {
    chars.pop();
    offsets.pop();
  }

  return {
    value: chars.join(''),
    offsets
  };
}

function findAnchorInMarkdown(fullMarkdown, searchText) {
  const span = findCommentBlockSpan(fullMarkdown);
  const searchableText = span
    ? fullMarkdown.substring(0, span.startIdx) + fullMarkdown.substring(span.endIdx)
    : fullMarkdown;

  const toOriginalOffset = off => {
    if (span && off >= span.startIdx) {
      return off + (span.endIdx - span.startIdx);
    }
    return off;
  };

  const cleanedSearch = (searchText || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\r\n/g, '\n')
    .trim();

  if (cleanedSearch) {
    // 1. Exact match
    const exactIdx = searchableText.indexOf(cleanedSearch);
    if (exactIdx !== -1) {
      const origStart = toOriginalOffset(exactIdx);
      const origEnd = origStart + cleanedSearch.length;
      const startPos = offsetToLineChar(fullMarkdown, origStart);
      const endPos = offsetToLineChar(fullMarkdown, origEnd);
      return {
        text: cleanedSearch,
        startLine: startPos.line,
        startChar: startPos.character,
        endLine: endPos.line,
        endChar: endPos.character
      };
    }

    // 2. Normalized Markdown match
    const normDoc = buildNormalizedMarkdownMap(searchableText);
    const normQuery = buildNormalizedMarkdownMap(cleanedSearch).value;
    if (normQuery) {
      let normIdx = normDoc.value.indexOf(normQuery);
      if (normIdx === -1) {
        normIdx = normDoc.value.toLowerCase().indexOf(normQuery.toLowerCase());
      }
      if (normIdx !== -1) {
        const sStart = normDoc.offsets[normIdx];
        const sEnd = normDoc.offsets[normIdx + normQuery.length - 1] + 1;
        const origStart = toOriginalOffset(sStart);
        let origEnd = toOriginalOffset(sEnd);

        const hasUnbalanced = (slice, ch) => {
          let count = 0;
          for (let i = 0; i < slice.length; i++) {
            if (slice[i] === ch) count++;
          }
          return count % 2 === 1;
        };

        while (
          origEnd < fullMarkdown.length &&
          /[*_~`]/.test(fullMarkdown[origEnd]) &&
          hasUnbalanced(
            fullMarkdown.substring(origStart, origEnd),
            fullMarkdown[origEnd]
          )
        ) {
          origEnd++;
        }

        const matchedRaw = fullMarkdown.substring(origStart, origEnd);
        const startPos = offsetToLineChar(fullMarkdown, origStart);
        const endPos = offsetToLineChar(fullMarkdown, origEnd);
        return {
          text: matchedRaw,
          startLine: startPos.line,
          startChar: startPos.character,
          endLine: endPos.line,
          endChar: endPos.character
        };
      }
    }
  }

  // Fallback to first non-empty line in searchableText
  const lines = searchableText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed) {
      const startChar = lines[i].indexOf(trimmed);
      return {
        text: cleanedSearch || trimmed,
        startLine: i,
        startChar: Math.max(0, startChar),
        endLine: i,
        endChar: Math.max(0, startChar) + trimmed.length
      };
    }
  }

  return {
    text: cleanedSearch || 'Document',
    startLine: 0,
    startChar: 0,
    endLine: 0,
    endChar: 0
  };
}

function hideStorageBlocks(root) {
  if (!root) return;
  const blocks = root.querySelectorAll('[data-type="html-block"]');
  for (const block of blocks) {
    const text = block.textContent || '';
    if (ALL_COMMENT_MARKERS.some(marker => text.includes(marker))) {
      block.classList.add('omni-storage-block');
      block.classList.add('markco-storage-block');
    } else {
      block.classList.remove('omni-storage-block');
      block.classList.remove('markco-storage-block');
    }
  }
}

// Invariant: Block elements must be attached visible Markdown containers, never boundaries.
// Why: Vditor injects zero-height .vditor-editor-boundary spans that clobber document titles.
// Example: <span class="vditor-editor-boundary" data-block="0"> (rejected) vs <h1 data-block="0"> (accepted).
function isEligibleBlock(el, contentRoot) {
  if (!el || !contentRoot || !contentRoot.contains(el) || el === contentRoot) {
    return false;
  }
  if (
    el.classList.contains('vditor-editor-boundary') ||
    el.closest('.vditor-editor-boundary')
  ) {
    return false;
  }
  if (
    el.classList.contains('omni-storage-block') ||
    el.classList.contains('markco-storage-block')
  ) {
    return false;
  }
  return true;
}

// Invariant: Resolves enclosing block element from any DOM node within contentRoot.
// Why: Comments and gutter chips anchor to block headers/paragraphs/tables/code fences.
// Example: text node inside <code> inside <pre> resolves to <pre>.
function resolveBlockElement(node, contentRoot) {
  const el = node instanceof Element ? node : node?.parentElement;
  if (!el || !contentRoot || !contentRoot.contains(el)) {
    return null;
  }
  const tableEl = el.closest('table');
  if (tableEl && isEligibleBlock(tableEl, contentRoot)) {
    return tableEl;
  }
  const preEl = el.closest('pre, .vditor-wysiwyg__pre');
  if (preEl && isEligibleBlock(preEl, contentRoot)) {
    return preEl;
  }
  const cmLine = el.closest('.cm-line');
  if (cmLine && isEligibleBlock(cmLine, contentRoot)) {
    return cmLine;
  }
  const blockEl = el.closest(
    'h1, h2, h3, h4, h5, h6, p, li, blockquote, [data-block="0"]'
  );
  if (blockEl && isEligibleBlock(blockEl, contentRoot)) {
    return blockEl;
  }
  return null;
}

// Invariant: Resolves the closest semantic text boundary (including table cells and code lines) for DOM text walker tokenization.
// Why: Prevents adjacent table cell text and CodeMirror code lines from concatenating without word boundaries during anchor search.
// Example: text node in <td>Col 1</td> resolves to <td>; text node in <div class="cm-line"> resolves to .cm-line.
function resolveTextBoundaryElement(node, contentRoot) {
  const el = node instanceof Element ? node : node?.parentElement;
  if (!el || !contentRoot || !contentRoot.contains(el)) return null;
  const cellEl = el.closest('td, th');
  if (cellEl && isEligibleBlock(cellEl.closest('table'), contentRoot)) {
    return cellEl;
  }
  const cmLine = el.closest('.cm-line');
  if (cmLine && contentRoot.contains(cmLine)) {
    return cmLine;
  }
  return resolveBlockElement(node, contentRoot);
}

// Invariant: Resolves the precise row, code line, or block element for gutter bubble icon positioning.
// Why: Comments in table cells align with their <tr> row, and comments in code blocks align with their .cm-line.
// Example: comment on code line 2 targets that line's .cm-line element for its gutter chip.
function resolveGutterTargetElement(range, blockEl) {
  if (range && range.startContainer) {
    const parent = range.startContainer instanceof Element
      ? range.startContainer
      : range.startContainer.parentElement;
    const trEl = parent?.closest('tr');
    if (trEl && blockEl && blockEl.contains(trEl)) {
      return trEl;
    }
    const cmLine = parent?.closest('.cm-line');
    if (cmLine && blockEl && blockEl.contains(cmLine)) {
      return cmLine;
    }
  }
  return blockEl;
}

// Invariant: Fallback block must be a real visible content block with positive height.
// Why: Missing anchor matches must attach to first real block, never zero-height boundary spans.
// Example: Returns <h1>Fixed Offset...</h1> instead of <span class="vditor-editor-boundary">.
function getFallbackBlock(contentRoot) {
  if (!contentRoot) return null;
  const candidates = contentRoot.querySelectorAll(
    'h1, h2, h3, h4, h5, h6, p, blockquote, pre, table'
  );
  for (const candidate of candidates) {
    if (isEligibleBlock(candidate, contentRoot) && candidate.offsetHeight > 0) {
      return candidate;
    }
  }
  return contentRoot;
}

// Invariant: Verifies whether an element or any of its ancestors should be excluded from DOM text indexing.
// Why: Skips UI overlays, hidden code blocks (e.g. hidden raw <code> beneath CodeMirror), markers, and toolbars.
// Example: isTreeWalkerExcludedNode(<code style="display: none">) => true
function isTreeWalkerExcludedNode(parent) {
  if (!parent) return true;
  const isExcludedAncestor = Boolean(
    parent.closest(
      '.vditor-editor-boundary, .vditor-wysiwyg__marker, .vditor-ir__marker, .vditor-ir__preview, .vditor-toolbar, .vditor-outline, .vditor-hint, .omni-inline-zones-layer, .omni-selection-chip, .vditor-cm-chrome, .cm-gutters, .cm-announced, [hidden], [aria-hidden="true"], script, style'
    )
  );
  if (isExcludedAncestor) return true;
  return Boolean(
    parent.closest('code[style*="display: none"], code[style*="display:none"]')
  );
}

function buildDomTextMap(container) {
  const chars = [];
  const positions = [];
  let lastWasSpace = true;

  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        const parent = node.parentElement;
        if (isTreeWalkerExcludedNode(parent)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  let currentNode = walker.nextNode();
  while (currentNode) {
    const val = currentNode.nodeValue || '';
    for (let i = 0; i < val.length; i++) {
      const ch = val[i];
      if (/[\u200B-\u200D\uFEFF]/.test(ch)) {
        continue;
      }
      if (/\s|\u00A0/.test(ch)) {
        if (!lastWasSpace) {
          chars.push(' ');
          positions.push({ node: currentNode, offset: i });
          lastWasSpace = true;
        }
      } else {
        chars.push(ch);
        positions.push({ node: currentNode, offset: i });
        lastWasSpace = false;
      }
    }
    const parentBlock = resolveTextBoundaryElement(currentNode, container);
    const nextNode = walker.nextNode();
    if (nextNode) {
      const nextBlock = resolveTextBoundaryElement(nextNode, container);
      if (parentBlock !== nextBlock && !lastWasSpace && positions.length > 0) {
        chars.push(' ');
        positions.push(positions[positions.length - 1]);
        lastWasSpace = true;
      }
    }
    currentNode = nextNode;
  }

  return {
    text: chars.join(''),
    positions
  };
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function getAuthorInitial(author) {
  if (!author || typeof author !== 'string') return 'U';
  const trimmed = author.trim();
  return trimmed ? trimmed[0].toUpperCase() : 'U';
}

// Invariant: Converts comment raw text containing Markdown syntax into sanitized, structured HTML elements.
// Why: Enables rich technical formatting (bold, code, lists, quotes, links) in inline comments without XSS vulnerability.
// Example: "**bold** and `code`" -> "<strong>bold</strong> and <code class='omni-comment-inline-code'>code</code>"
function renderCommentMarkdown(text) {
  if (!text || typeof text !== 'string') return '';
  let escaped = escapeHtml(text);
  const codeBlocks = [];
  escaped = escaped.replace(/```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g, (match, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre class="omni-comment-code-block"><code>${code.trim()}</code></pre>`);
    return `%%CODEBLOCK_${idx}%%`;
  });
  escaped = escaped.replace(/`([^`\n]+)`/g, '<code class="omni-comment-inline-code">$1</code>');
  escaped = escaped.replace(/^(?:&gt;|>)[ \t]?(.*)$/gm, '<blockquote class="omni-comment-quote">$1</blockquote>');
  escaped = escaped.replace(/(\*{3}|_{3})(?=\S)([\s\S]*?\S)\1/g, '<strong><em>$2</em></strong>');
  escaped = escaped.replace(/(\*{2}|_{2})(?=\S)([\s\S]*?\S)\1/g, '<strong>$2</strong>');
  escaped = escaped.replace(/(^|[^\*])\*([^\*\s][^\*]*?[^\*\s]|\S)\*([^\*]|$)/g, '$1<em>$2</em>$3');
  escaped = escaped.replace(/(^|[^_])_([^_ \t\n][^_]*?[^_ \t\n]|\S)_([^_]|$)/g, '$1<em>$2</em>$3');
  escaped = escaped.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');
  escaped = escaped.replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/|mailto:)[^\s\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="omni-comment-link">$1</a>');
  escaped = escaped.replace(/^[ \t]*[\-\*][ \t]+(.+)$/gm, '<li class="omni-comment-list-item">$1</li>');
  escaped = escaped.replace(/((?:<li class="omni-comment-list-item">.*<\/li>\s*)+)/g, '<ul class="omni-comment-list">$1</ul>');
  escaped = escaped.replace(/^[ \t]*\d+\.[ \t]+(.+)$/gm, '<li class="omni-comment-num-item">$1</li>');
  escaped = escaped.replace(/((?:<li class="omni-comment-num-item">.*<\/li>\s*)+)/g, '<ol class="omni-comment-list">$1</ol>');
  escaped = escaped.replace(/\n/g, '<br>');
  escaped = escaped.replace(/(?:<br>\s*)+<(ul|ol|blockquote)/g, '<$1');
  escaped = escaped.replace(/<\/(ul|ol|blockquote)>(?:\s*<br>)+/g, '</$1>');
  escaped = escaped.replace(/<\/li>(?:\s*<br>\s*)+<li/g, '</li><li');
  escaped = escaped.replace(/%%CODEBLOCK_(\d+)%%/g, (match, idx) => codeBlocks[Number(idx)] || '');
  return escaped;
}

function formatLineLabel(anchor) {
  if (!anchor || typeof anchor.startLine !== 'number') return 'Comment';
  const start = anchor.startLine + 1;
  const end = typeof anchor.endLine === 'number' ? anchor.endLine + 1 : start;
  return start === end ? `Line ${start}` : `Lines ${start}–${end}`;
}

// Invariant: Outputs minimal-width human-readable relative time strings (e.g. "2m", "1h", "yesterday").
// Why: Prevents comment card header width bloat on short single-word comments.
// Example: formatCompactTime("2026-10-29T12:50:00Z") => "2m"
function formatCompactTime(iso) {
  if (!iso) return '';
  try {
    const date = new Date(iso);
    const diffMs = Date.now() - date.getTime();
    if (isNaN(diffMs)) return '';
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return 'just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h`;
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric'
    });
  } catch {
    return '';
  }
}

function formatRelativeTime(iso) {
  if (!iso) return '';
  try {
    const date = new Date(iso);
    const diffMs = Date.now() - date.getTime();
    if (isNaN(diffMs)) return '';
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return 'just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin} ${diffMin === 1 ? 'minute' : 'minutes'} ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr} ${diffHr === 1 ? 'hour' : 'hours'} ago`;
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays < 30) return `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch {
    return '';
  }
}

export function initOmniAnnotations(getMarkdownValue) {
  let activeComments = [];
  let commentRanges = []; // Array of { comment, range, blockEl }
  let focusedCommentId = null;
  let latestSerializedBlock = '';
  let cachedAuthor = 'Hui Peng';

  // Collapse state inside the Markdown view
  const collapsedComments = new Set(); // commentIds whose inline box is collapsed to a 1-line header bar
  const collapsedReplies = new Set(); // commentIds whose responses list is collapsed
  let activeEditCommentId = null;
  let activeReplyCommentId = null;
  // Id of the specific item (root comment or reply) the open composer answers; null = whole thread.
  let activeReplyTargetId = null;
  let activeBlockCounts = new Map(); // blockEl -> number of active comments on this block
  let activeGutterTargets = new Map(); // gutterTargetEl (e.g. TR or blockEl) -> number of active comments

  // Configurable comment box state
  let commentBoxConfig = {
    widthMode: 'standard',
    minWidth: 320,
    maxWidth: 460,
    fontSize: 12,
    enableMarkdown: true,
    showAvatars: true,
    showThreadGuide: true,
    defaultAuthor: ''
  };

  try {
    const storedConfig = localStorage.getItem('omnicomment.commentBoxConfig');
    if (storedConfig) {
      commentBoxConfig = { ...commentBoxConfig, ...JSON.parse(storedConfig) };
    }
  } catch {}

  let activeConfigPopoverZoneId = null;

  // Invariant: Resolves pixel boundaries and font size from current commentBoxConfig.
  // Why: Provides dynamic layout calculation for compact, standard, wide, and custom densities.
  // Example: resolveEffectiveDimensions() returns { minWidth: 280, maxWidth: 360, fontSize: 11 } for compact.
  function resolveEffectiveDimensions() {
    const mode = commentBoxConfig.widthMode || 'standard';
    if (mode === 'compact') {
      return {
        minWidth: 280,
        maxWidth: 360,
        fontSize: commentBoxConfig.fontSize || 11
      };
    }
    if (mode === 'wide') {
      return {
        minWidth: 420,
        maxWidth: 640,
        fontSize: commentBoxConfig.fontSize || 13
      };
    }
    if (mode === 'custom') {
      const minW = Math.max(160, commentBoxConfig.minWidth || 320);
      const maxW = Math.max(minW, commentBoxConfig.maxWidth || 460);
      return {
        minWidth: minW,
        maxWidth: maxW,
        fontSize: commentBoxConfig.fontSize || 12
      };
    }
    return {
      minWidth: 320,
      maxWidth: 460,
      fontSize: commentBoxConfig.fontSize || 12
    };
  }

  // Invariant: Merges new configuration updates, persists to localStorage, and updates UI.
  // Why: Guarantees instantaneous visual responsiveness when users adjust comment box settings.
  // Example: applyConfig({ widthMode: 'wide' }) immediately broadens cards and saves to localStorage.
  function applyConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return;
    commentBoxConfig = { ...commentBoxConfig, ...cfg };
    try {
      localStorage.setItem('omnicomment.commentBoxConfig', JSON.stringify(commentBoxConfig));
    } catch {}
    syncZonePositions();
    renderInlineZones();
  }

  // Inline new-comment draft state
  let newCommentDraft = null; // { anchorText: string, blockEl: Element | null }

  // Hook into imagePath.js restoreWorkspaceBaseUrls so Vditor's getValue() and input() always preserve the latest comments block
  window.__omniSyncMarkdownBlock = function (md) {
        if (typeof md !== 'string') return md;
    if (!latestSerializedBlock) return md;
    return replaceOrAppendCommentsBlock(md, latestSerializedBlock);
  };

  function syncFromExternalUpdate(markdownContent) {
    if (typeof markdownContent !== 'string') return;
    const span = findCommentBlockSpan(markdownContent);
    latestSerializedBlock = span ? span.blockText : '';
    const parsed = parseOmniComments(markdownContent);
    if (parsed.length > 0 && parsed[0].author) {
      cachedAuthor = parsed[0].author;
    }
  }

  function applyLocalCommentAction(actionPayload) {
    if (!actionPayload || !actionPayload.type) return;

    const currentMd = getMarkdownValue?.() || '';
    const comments = parseOmniComments(currentMd);
    if (comments.length > 0 && comments[0].author) {
      cachedAuthor = comments[0].author;
    }
    const nowIso = new Date().toISOString();

    switch (actionPayload.type) {
      case 'addComment': {
        const content = (actionPayload.content || '').trim();
        if (!content) return;
        const anchor = findAnchorInMarkdown(currentMd, actionPayload.anchorText || '');
        const newComment = {
          id: generateId(),
          anchor,
          content,
          author: cachedAuthor,
          createdAt: nowIso
        };
        comments.push(newComment);
        focusedCommentId = newComment.id;
        collapsedComments.delete(newComment.id);
        break;
      }
      case 'addReply': {
        const target = comments.find(c => c.id === actionPayload.commentId);
        const content = (actionPayload.content || '').trim();
        if (!target || !content) return;
        if (!Array.isArray(target.replies)) {
          target.replies = [];
        }
        const newReply = {
          id: generateId(),
          content,
          author: cachedAuthor,
          createdAt: nowIso
        };
        // Invariant: inReplyTo is kept only when it names an item of this same thread.
        // Why: A dangling target would render a broken "replying to" quote.
        // Example: answering bob's reply r2 -> { ..., inReplyTo: 'r2' }.
        if (findThreadItem(target, actionPayload.inReplyTo)) {
          newReply.inReplyTo = actionPayload.inReplyTo;
        }
        target.replies.push(newReply);
        collapsedReplies.delete(target.id);
        break;
      }
      case 'editComment': {
        const target = comments.find(c => c.id === actionPayload.commentId);
        const content = (actionPayload.content || '').trim();
        if (!target || !content) return;
        target.content = content;
        target.updatedAt = nowIso;
        break;
      }
      case 'resolveComment': {
        const target = comments.find(c => c.id === actionPayload.commentId);
        if (!target) return;
        target.resolved = !target.resolved;
        target.updatedAt = nowIso;
        if (target.resolved && focusedCommentId === target.id) {
          focusedCommentId = null;
        }
        break;
      }
      case 'thumbsUpComment': {
        const target = comments.find(c => c.id === actionPayload.commentId);
        if (!target) return;
        if (!Array.isArray(target.thumbsUp)) {
          target.thumbsUp = [];
        }
        const idx = target.thumbsUp.indexOf(cachedAuthor);
        if (idx === -1) {
          target.thumbsUp.push(cachedAuthor);
        } else {
          target.thumbsUp.splice(idx, 1);
        }
        if (target.thumbsUp.length === 0) {
          delete target.thumbsUp;
        }
        break;
      }
      case 'deleteComment': {
        const idx = comments.findIndex(c => c.id === actionPayload.commentId);
        if (idx === -1) return;
        comments.splice(idx, 1);
        break;
      }
      case 'deleteReply': {
        const target = comments.find(c => c.id === actionPayload.commentId);
        if (!target || !Array.isArray(target.replies)) return;
        const rIdx = target.replies.findIndex(r => r.id === actionPayload.replyId);
        if (rIdx === -1) return;
        target.replies.splice(rIdx, 1);
        if (target.replies.length === 0) {
          delete target.replies;
        }
        break;
      }
      default:
        return;
    }

    latestSerializedBlock = serializeCommentsBlock(comments);
    const updatedMarkdown = replaceOrAppendCommentsBlock(
      currentMd,
      latestSerializedBlock
    );

    // Immediately re-render the inline comment boxes in the Markdown view
    refreshHighlights(updatedMarkdown);

    // Persist directly to the TextDocument and save to disk via vscode-office's built-in doSave handler
    if (window.vscodeEvent) {
      window.vscodeEvent.emit('doSave', updatedMarkdown);
    }
  }

  // 1. Dynamic stylesheet in <head> that reserves exact vertical space (margin-bottom) beneath commented blocks
  let zoneStyleEl = document.getElementById('omni-zone-styles');
  if (!zoneStyleEl) {
    zoneStyleEl = document.createElement('style');
    zoneStyleEl.id = 'omni-zone-styles';
    document.head.appendChild(zoneStyleEl);
  }

  // 2. Inline Zones Overlay Layer (scroll-locked & clipped to the Markdown viewport, outside contenteditable)
  let zonesLayer = document.getElementById('omni-inline-zones-layer');
  if (!zonesLayer) {
    zonesLayer = document.createElement('div');
    zonesLayer.id = 'omni-inline-zones-layer';
    zonesLayer.className = 'omni-inline-zones-layer';
    document.body.appendChild(zonesLayer);
  }

  // 2b. Dedicated Gutter Chip Layer (DOM-level bulletproof reliability across all block types & headings)
  let gutterLayer = document.getElementById('omni-gutter-layer');
  if (!gutterLayer) {
    gutterLayer = document.createElement('div');
    gutterLayer.id = 'omni-gutter-layer';
    gutterLayer.className = 'omni-gutter-layer';
    document.body.appendChild(gutterLayer);
  }

  // 3. Floating Selection "💬 Comment" Chip on text selection
  const selectionChip = document.createElement('button');
  selectionChip.type = 'button';
  selectionChip.className = 'omni-selection-chip';
  selectionChip.hidden = true;
  selectionChip.innerHTML = '💬 Comment';
  const onChipTrigger = e => {
    e.preventDefault();
    e.stopPropagation();
    const info = getEditorSelectionInfo();
    openAddCommentComposer(info.text, info.blockEl);
    selectionChip.hidden = true;
  };
  selectionChip.addEventListener('mousedown', onChipTrigger);
  selectionChip.addEventListener('click', onChipTrigger);
  document.body.appendChild(selectionChip);

  function ensureToolbarCommentButton() {
    const toolbar = document.querySelector('.vditor-toolbar');
    if (!toolbar) return;
    if (toolbar.querySelector('[data-type="add-comment"]')) return;
    const saveBtn = toolbar.querySelector('[data-type="save"]')?.closest('.vditor-toolbar__item');
    const item = document.createElement('div');
    item.className = 'vditor-toolbar__item right';
    const btn = document.createElement('button');
    btn.setAttribute('data-type', 'add-comment');
    btn.className = 'vditor-tooltipped vditor-tooltipped__s';
    btn.setAttribute('aria-label', 'Add Comment');
    btn.innerHTML = '<span class="codicon codicon-comment" aria-hidden="true"></span>';
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      openAddCommentComposer();
    });
    item.appendChild(btn);
    if (saveBtn && saveBtn.nextSibling) {
      saveBtn.parentNode.insertBefore(item, saveBtn.nextSibling);
    } else {
      toolbar.appendChild(item);
    }
  }

  function ensureContextMenuCommentItem() {
    const menu = document.getElementById('context-menu');
    if (!menu) return;
    if (menu.querySelector('[data-action="addComment"]')) return;
    const group = document.createElement('div');
    group.className = 'vditor-context-menu__group';
    group.setAttribute('role', 'group');
    group.innerHTML = `
      <button class="vditor-context-menu__item" type="button" data-action="addComment" role="menuitem">
        <span class="vditor-context-menu__icon" aria-hidden="true">
          <span class="codicon codicon-comment"></span>
        </span>
        <span class="vditor-context-menu__label">Add Comment</span>
        <span class="vditor-context-menu__shortcut" aria-hidden="true"></span>
      </button>
    `;
    const sep = document.createElement('div');
    sep.className = 'vditor-context-menu__separator';
    sep.setAttribute('role', 'separator');

    const copyBtn = menu.querySelector('[data-action="copy"]')?.closest('.vditor-context-menu__group');
    if (copyBtn) {
      menu.insertBefore(sep, copyBtn);
      menu.insertBefore(group, copyBtn);
    } else {
      menu.appendChild(sep);
      menu.appendChild(group);
    }
  }

  ensureToolbarCommentButton();
  ensureContextMenuCommentItem();
  setTimeout(() => {
    ensureToolbarCommentButton();
    ensureContextMenuCommentItem();
  }, 100);

  // Active zone descriptors: Array of { zoneId, blockEl, zoneEl, anchorRange }
  let activeZones = [];

  function getContentRoot() {
    const root = document.getElementById('vditor');
    if (!root) return null;

    // Check visible panels according to active mode (wysiwyg, ir, sv)
    const panels = [
      root.querySelector('.vditor-wysiwyg'),
      root.querySelector('.vditor-ir'),
      root.querySelector('.vditor-sv')
    ].filter(Boolean);

    for (const panel of panels) {
      const isHidden =
        panel.classList.contains('vditor-panel--none') ||
        panel.style.display === 'none' ||
        (panel.offsetWidth === 0 && panel.offsetHeight === 0 && panel.getClientRects().length === 0);
      if (!isHidden) {
        const resetEl = panel.querySelector('.vditor-reset');
        if (resetEl) return resetEl;
        return panel;
      }
    }

    return (
      root.querySelector('.vditor-wysiwyg:not(.vditor-panel--none) .vditor-reset') ||
      root.querySelector('.vditor-ir:not(.vditor-panel--none) .vditor-reset') ||
      root.querySelector('.vditor-sv:not(.vditor-panel--none) .vditor-reset') ||
      root.querySelector('.vditor-wysiwyg .vditor-reset') ||
      root.querySelector('.vditor-ir .vditor-reset') ||
      root.querySelector('.vditor-sv .vditor-reset') ||
      root.querySelector('.vditor-reset') ||
      root
    );
  }

  function getEditorSelectionInfo() {
    const selection = document.getSelection();
    const contentRoot = getContentRoot();
    if (!selection || !contentRoot) {
      return { text: '', blockEl: null };
    }
    if (
      selection.rangeCount > 0 &&
      !selection.isCollapsed &&
      contentRoot.contains(selection.anchorNode) &&
      contentRoot.contains(selection.focusNode)
    ) {
      const raw = selection
        .toString()
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\u00A0/g, ' ')
        .trim();
      const blockEl = resolveBlockElement(selection.anchorNode, contentRoot);
      if (raw) {
        return { text: raw, blockEl };
      }
    }
    if (selection.anchorNode && contentRoot.contains(selection.anchorNode)) {
      const blockEl = resolveBlockElement(selection.anchorNode, contentRoot);
      const boundaryEl = resolveTextBoundaryElement(selection.anchorNode, contentRoot);
      const textEl = boundaryEl || blockEl;
      if (blockEl && !blockEl.classList.contains('omni-storage-block')) {
        const text = (textEl.textContent || '')
          .replace(/[\u200B-\u200D\uFEFF]/g, '')
          .replace(/\u00A0/g, ' ')
          .trim();
        return { text, blockEl };
      }
    }
    return { text: '', blockEl: null };
  }

  // Invariant: Resolves enclosing block element for candidate anchor text across raw and stripped representations.
  // Why: Guarantees reliable block anchoring for both code blocks (raw exact) and formatted markdown prose.
  // Example: findBlockForAnchorText("return amount * 0.15;", root) => <pre class="vditor-wysiwyg__pre...">
  function findBlockForAnchorText(anchorText, contentRoot) {
    if (!contentRoot) return null;
    const raw = (anchorText || '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const norm = stripMarkdownSyntax(anchorText);
    const domMap = buildDomTextMap(contentRoot);
    let idx = -1;
    if (raw) {
      idx = domMap.text.indexOf(raw);
    }
    if (idx === -1 && norm) {
      idx = domMap.text.indexOf(norm);
      if (idx === -1) {
        idx = domMap.text.toLowerCase().indexOf(norm.toLowerCase());
      }
    }
    if (idx === -1 && raw) {
      idx = domMap.text.toLowerCase().indexOf(raw.toLowerCase());
    }
    if (idx !== -1 && domMap.positions[idx]) {
      const block = resolveBlockElement(domMap.positions[idx].node, contentRoot);
      if (block) return block;
    }
    return getFallbackBlock(contentRoot);
  }

  function openAddCommentComposer(selectedText = '', preferredBlockEl = null) {
    const contentRoot = getContentRoot();
    const selInfo = getEditorSelectionInfo();
    const candidate = (selectedText || selInfo.text || '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\u00A0/g, ' ')
      .trim();
    const targetBlock =
      preferredBlockEl ||
      selInfo.blockEl ||
      findBlockForAnchorText(candidate, contentRoot);

    newCommentDraft = {
      anchorText: candidate,
      blockEl: targetBlock
    };

    renderInlineZones();
    setTimeout(() => {
      const textarea = zonesLayer.querySelector('#omni-inline-new-comment-input');
      const anchorInput = zonesLayer.querySelector('#omni-inline-new-comment-anchor');
      if (candidate && textarea) {
        textarea.focus();
      } else if (anchorInput) {
        anchorInput.focus();
      }
      if (targetBlock) {
        targetBlock.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 30);
  }

  window.__omniOpenAddComment = openAddCommentComposer;
  window.__markcoOpenAddComment = openAddCommentComposer;
  
  // Invariant: Verifies that the commented block is currently visible in the active scroll viewport.
  // Why: Avoids rendering floating gutter chips for blocks scrolled past the top toolbar or bottom edge.
  // Example: isBlockVisibleInViewport({ top: 580, bottom: 608 }, 36, 0) => true
  function isBlockVisibleInViewport(bRect, clipTop, clipBottom) {
    if (bRect.bottom <= clipTop) return false;
    if (bRect.top >= window.innerHeight - clipBottom) return false;
    if (bRect.width === 0 && bRect.height === 0) return false;
    return true;
  }

  // Invariant: Calculates pixel-precise gutter chip horizontal offset to the left of the commented block.
  // Why: Ensures chips never clip into the outline sidebar or wander offscreen while maintaining breathing room from headline text.
  // Example: calculateGutterChipLeft(240, 180) => 210
  function calculateGutterChipLeft(blockLeft, viewportLeft) {
    const minAllowedLeft = Math.max(4, Math.round(viewportLeft + 4));
    const desiredLeft = Math.round(blockLeft - 30);
    return Math.max(minAllowedLeft, desiredLeft);
  }

  // Invariant: Calculates vertical pixel placement for gutter chip aligned to block, table row, or code line.
  // Why: Table rows and code lines require row-centered alignment, while standard paragraph blocks align near top edge.
  // Example: calculateGutterChipTop(cmLineEl, { top: 254, height: 28 }) => 257
  function calculateGutterChipTop(targetEl, bRect) {
    if (targetEl.tagName === 'TR' || targetEl.classList?.contains('cm-line')) {
      return Math.round(bRect.top + Math.max(0, (bRect.height - 22) / 2));
    }
    return Math.round(
      bRect.top + (bRect.height > 32 ? 6 : Math.max(0, (bRect.height - 22) / 2))
    );
  }

  // Invariant: Resolves horizontal anchor element to measure left gutter offset for a comment target.
  // Why: Table rows and code lines inherit left margin from enclosing table or pre block rather than arbitrary inner boundaries.
  // Example: resolveGutterAnchorBlock(cmLineEl) => preElement
  function resolveGutterAnchorBlock(targetEl) {
    if (targetEl.tagName === 'TR') {
      return targetEl.closest('table') || targetEl;
    }
    if (targetEl.classList?.contains('cm-line')) {
      return targetEl.closest('pre') || targetEl;
    }
    return targetEl;
  }

  // Invariant: Returns true if every active comment associated with the given target element is collapsed.
  // Why: Determines whether the gutter bubble chip should display the collapsed styling (.is-collapsed).
  // Example: isCommentCollapsedOnTarget(trEl, [{ comment: { id: 'c1' } }]) => true
  function isCommentCollapsedOnTarget(targetEl, items) {
    const targetItems = items.filter(
      i => i.gutterTargetEl === targetEl || (!i.gutterTargetEl && i.blockEl === targetEl)
    );
    if (targetItems.length === 0) return false;
    return targetItems.every(i => collapsedComments.has(i.comment.id));
  }

  // Invariant: Toggles the collapsed state for all comments associated with the target element.
  // Why: Enables clicking a row's gutter bubble icon to expand or collapse that specific row's comments.
  // Example: toggleCommentsForTarget(trEl, commentRanges) => flips collapsed state of row comments
  function toggleCommentsForTarget(targetEl, items) {
    const targetItems = items.filter(
      i => i.gutterTargetEl === targetEl || (!i.gutterTargetEl && i.blockEl === targetEl)
    );
    if (targetItems.length === 0) return;
    const allCollapsed = targetItems.every(i => collapsedComments.has(i.comment.id));
    for (const item of targetItems) {
      if (allCollapsed) {
        collapsedComments.delete(item.comment.id);
        focusedCommentId = item.comment.id;
      } else {
        collapsedComments.add(item.comment.id);
      }
    }
    renderInlineZones();
  }

  function syncZonePositions() {
    const root = document.getElementById('vditor');
    const contentRoot = getContentRoot();
    if (!root || !contentRoot) {
      zoneStyleEl.textContent = '';
      if (gutterLayer) gutterLayer.replaceChildren();
      return;
    }

    const viewportRect = contentRoot.getBoundingClientRect();
    const toolbarBottom =
      root.querySelector('.vditor-toolbar')?.getBoundingClientRect().bottom || 0;
    const clipTop = Math.max(0, viewportRect.top, toolbarBottom);
    const clipBottom = Math.max(0, window.innerHeight - viewportRect.bottom);
    const clipLeft = Math.max(0, viewportRect.left);
    const clipRight = Math.max(0, window.innerWidth - viewportRect.right);
    zonesLayer.style.clipPath = `inset(${clipTop}px ${clipRight}px ${clipBottom}px ${clipLeft}px)`;

    const cssRules = [];
    for (const zone of activeZones) {
      const { zoneId, blockEl, zoneEl } = zone;
      if (!blockEl || !blockEl.isConnected || !zoneEl || !zoneEl.isConnected) {
        continue;
      }
      if (zoneEl.style.display === 'none') {
        continue;
      }

      const zoneHeight = zoneEl.offsetHeight;
      if (zoneHeight <= 0) {
        continue;
      }
      cssRules.push(
        `[data-omni-zone="${zoneId}"] { margin-bottom: ${zoneHeight + 2}px !important; }`
      );
    }

    const nextCss = cssRules.join('\n');
    if (zoneStyleEl.textContent !== nextCss) {
      zoneStyleEl.textContent = nextCss;
    }

    for (const zone of activeZones) {
      const { blockEl, zoneEl, anchorRange } = zone;
      if (!blockEl || !blockEl.isConnected || !zoneEl || !zoneEl.isConnected) {
        continue;
      }
      if (zoneEl.style.display === 'none') {
        continue;
      }
      const blockRect = blockEl.getBoundingClientRect();
      const top = Math.round(blockRect.bottom + 2);
      const left = Math.round(blockRect.left);

      // Invariant: Apply configured width boundaries and typography parameters to the inline comment card.
      // Why: Respects user-configured density (compact, standard, wide, custom) and visual toggles.
      // Example: zoneEl styled with minWidth 280px, maxWidth 360px, fontSize 11px in compact mode.
      const dims = resolveEffectiveDimensions();
      zoneEl.style.top = `${top}px`;
      zoneEl.style.left = `${left}px`;
      zoneEl.style.width = 'fit-content';
      zoneEl.style.maxWidth = `${dims.maxWidth}px`;
      zoneEl.style.minWidth = `${dims.minWidth}px`;
      zoneEl.style.setProperty('--omni-comment-min-width', `${dims.minWidth}px`);
      zoneEl.style.setProperty('--omni-comment-max-width', `${dims.maxWidth}px`);
      zoneEl.style.setProperty('--omni-comment-font-size', `${dims.fontSize}px`);

      if (!commentBoxConfig.showAvatars) {
        zoneEl.classList.add('no-avatars');
      } else {
        zoneEl.classList.remove('no-avatars');
      }

      if (!commentBoxConfig.showThreadGuide) {
        zoneEl.classList.add('no-thread-guide');
      } else {
        zoneEl.classList.remove('no-thread-guide');
      }

      const arrowEl = zoneEl.querySelector('.omni-inline-zone__arrow');
      if (arrowEl) {
        let arrowOffset = 20;
        if (anchorRange) {
          const rects = anchorRange.getClientRects();
          if (rects.length > 0) {
            const cardWidth = zoneEl.offsetWidth || 240;
            arrowOffset = Math.max(
              12,
              Math.min(cardWidth - 24, Math.round(rects[0].left - blockRect.left + 8))
            );
          }
        }
        arrowEl.style.left = `${arrowOffset}px`;
      }
    }

    // Render interactive DOM gutter chips for all blocks or table rows with comments
    if (gutterLayer) {
      gutterLayer.replaceChildren();
      for (const [targetEl, count] of activeGutterTargets.entries()) {
        if (!targetEl || !targetEl.isConnected || !contentRoot.contains(targetEl)) {
          continue;
        }
        const bRect = targetEl.getBoundingClientRect();
        if (!isBlockVisibleInViewport(bRect, clipTop, clipBottom)) {
          continue;
        }

        const isCollapsed = isCommentCollapsedOnTarget(targetEl, commentRanges);

        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = `omni-gutter-chip ${isCollapsed ? 'is-collapsed' : ''}`;
        chip.setAttribute(
          'aria-label',
          `${isCollapsed ? 'Expand' : 'Collapse'} comments (${count})`
        );
        chip.title = `${isCollapsed ? 'Click to show' : 'Click to hide'} ${count} ${
          count === 1 ? 'comment' : 'comments'
        }`;

        const chipTop = calculateGutterChipTop(targetEl, bRect);
        const anchorBlock = resolveGutterAnchorBlock(targetEl);
        const chipLeft = calculateGutterChipLeft(
          anchorBlock.getBoundingClientRect().left,
          viewportRect.left
        );

        chip.style.top = `${chipTop}px`;
        chip.style.left = `${chipLeft}px`;

        chip.innerHTML = `💬${
          count > 1 ? `<span class="omni-gutter-chip__badge">${count}</span>` : ''
        }`;

        chip.addEventListener('click', e => {
          e.stopPropagation();
          e.preventDefault();
          toggleCommentsForTarget(targetEl, commentRanges);
        });

        gutterLayer.appendChild(chip);
      }
    }
  }

  // Invariant: Constructs the interactive configuration popover HTML anchored to a comment card.
  // Why: Allows in-place adjustment of comment box density, typography, markdown parsing, and thread guide.
  // Example: renderConfigPopoverHtml('c1') generates popover with segmented buttons and toggle checkboxes.
  function renderConfigPopoverHtml(targetId) {
    const dims = resolveEffectiveDimensions();
    const mode = commentBoxConfig.widthMode || 'standard';
    const fs = dims.fontSize;

    return `
      <div class="omni-config-popover" data-popover-target="${escapeHtml(targetId)}">
        <div class="omni-config-popover__title">
          <span>Comment Box Settings</span>
          <button type="button" class="omni-config-popover__close" data-action="close-config-popover" title="Close">
            <i class="codicon codicon-close"></i>
          </button>
        </div>
        <div class="omni-config-popover__section">
          <label class="omni-config-popover__label">Size / Width</label>
          <div class="omni-config-segmented">
            <button type="button" class="omni-config-seg-btn ${mode === 'compact' ? 'is-active' : ''}" data-config-set="widthMode" data-config-val="compact">Compact</button>
            <button type="button" class="omni-config-seg-btn ${mode === 'standard' ? 'is-active' : ''}" data-config-set="widthMode" data-config-val="standard">Standard</button>
            <button type="button" class="omni-config-seg-btn ${mode === 'wide' ? 'is-active' : ''}" data-config-set="widthMode" data-config-val="wide">Wide</button>
          </div>
        </div>
        <div class="omni-config-popover__section">
          <label class="omni-config-popover__label">Font Size</label>
          <div class="omni-config-segmented">
            <button type="button" class="omni-config-seg-btn ${fs === 11 ? 'is-active' : ''}" data-config-set="fontSize" data-config-val="11">11px</button>
            <button type="button" class="omni-config-seg-btn ${fs === 12 ? 'is-active' : ''}" data-config-set="fontSize" data-config-val="12">12px</button>
            <button type="button" class="omni-config-seg-btn ${fs === 14 ? 'is-active' : ''}" data-config-set="fontSize" data-config-val="14">14px</button>
          </div>
        </div>
        <div class="omni-config-popover__section omni-config-toggles">
          <label class="omni-config-checkbox-label">
            <input type="checkbox" data-config-toggle="enableMarkdown" ${commentBoxConfig.enableMarkdown ? 'checked' : ''} />
            <span>Markdown formatting</span>
          </label>
          <label class="omni-config-checkbox-label">
            <input type="checkbox" data-config-toggle="showAvatars" ${commentBoxConfig.showAvatars ? 'checked' : ''} />
            <span>Author avatars</span>
          </label>
          <label class="omni-config-checkbox-label">
            <input type="checkbox" data-config-toggle="showThreadGuide" ${commentBoxConfig.showThreadGuide ? 'checked' : ''} />
            <span>Thread connector line</span>
          </label>
        </div>
        <div class="omni-config-popover__footer">
          <button type="button" class="omni-config-more-btn" data-action="open-full-settings">More settings...</button>
        </div>
      </div>
    `;
  }

  // Invariant: A reply aimed at a specific earlier item shows a quote naming that item.
  // Why: Replies stay in chronological order; the quote shows which message each one answers.
  // Example: <div class="omni-inline-reply-quote">↪ @bob: “use a mutex here”</div>.
  function renderReplyQuoteHtml(comment, inReplyTo) {
    const target = findThreadItem(comment, inReplyTo);
    if (!target) return '';
    return `<div class="omni-inline-reply-quote" data-quote-target="${escapeHtml(target.id)}" title="${escapeHtml(
      target.content
    )}"><i class="codicon codicon-reply"></i><span class="omni-inline-reply-quote__author">@${escapeHtml(
      target.author || 'User'
    )}</span><span class="omni-inline-reply-quote__text">“${escapeHtml(replySnippet(target.content))}”</span></div>`;
  }

  // Invariant: The open composer names its target when replying to a specific item.
  // Why: Users must see (and be able to clear) which message they are answering.
  // Example: "Replying to @bob: “use a mutex…” ✕".
  function renderReplyTargetChipHtml(comment) {
    const target = findThreadItem(comment, activeReplyTargetId);
    if (!target) return '';
    return `<div class="omni-inline-reply-target"><i class="codicon codicon-reply"></i><span>Replying to <b>@${escapeHtml(
      target.author || 'User'
    )}</b>: “${escapeHtml(replySnippet(target.content, 50))}”</span><button type="button" class="omni-inline-item-btn" data-action="clear-reply-target" data-comment-id="${escapeHtml(
      comment.id
    )}" title="Reply to the whole thread instead"><i class="codicon codicon-close"></i></button></div>`;
  }

  function renderThreadHtml(comment) {
    if (collapsedComments.has(comment.id)) {
      return '';
    }

    const isFocused = comment.id === focusedCommentId;
    const replies = comment.replies || [];
    const hasReplies = replies.length > 0;
    const areRepliesCollapsed = collapsedReplies.has(comment.id);
    const isEditing = activeEditCommentId === comment.id;
    const isReplying = activeReplyCommentId === comment.id;
    const thumbsCount = (comment.thumbsUp || []).length;

    return `
      <div class="omni-inline-thread ${isFocused ? 'is-focused' : ''} ${
      comment.resolved ? 'is-resolved' : ''
    }" data-comment-id="${escapeHtml(comment.id)}">
        <!-- Compact Header with Avatar -->
        <div class="omni-inline-thread__header">
          <div class="omni-inline-thread__header-left" data-action="toggle-collapse-comment" data-comment-id="${escapeHtml(
            comment.id
          )}" title="Click to toggle collapse">
            <span class="omni-inline-avatar">${escapeHtml(getAuthorInitial(comment.author))}</span>
            <span class="omni-inline-author">${escapeHtml(comment.author || 'User')}</span>
            <span class="omni-inline-sep">·</span>
            <span class="omni-inline-time">${escapeHtml(
              formatCompactTime(comment.createdAt)
            )}</span>
            ${
              comment.resolved
                ? '<span class="omni-inline-status-badge is-resolved">Resolved</span>'
                : ''
            }
          </div>
          <div class="omni-inline-thread__header-actions">
            <button type="button" class="omni-inline-header-btn omni-hover-action" data-action="configure-comment-box" data-comment-id="${escapeHtml(
              comment.id
            )}" title="Configure Comment Box">
              <i class="codicon codicon-settings-gear"></i>
            </button>
            <button type="button" class="omni-inline-header-btn omni-hover-action" data-action="thumbs-up" data-comment-id="${escapeHtml(
              comment.id
            )}" title="Thumbs up">
              <i class="codicon codicon-thumbsup"></i>${thumbsCount > 0 ? `<span style="font-size:10px;margin-left:2px">${thumbsCount}</span>` : ''}
            </button>
            <button type="button" class="omni-inline-header-btn" data-action="open-reply" data-comment-id="${escapeHtml(
              comment.id
            )}" title="Reply">
              <i class="codicon codicon-reply"></i>
            </button>
            <button type="button" class="omni-inline-header-btn" data-action="toggle-resolve" data-comment-id="${escapeHtml(
              comment.id
            )}" title="${comment.resolved ? 'Reopen comment' : 'Resolve comment'}">
              <i class="codicon codicon-${comment.resolved ? 'issue-reopened' : 'check'}"></i>
            </button>
            <button type="button" class="omni-inline-header-btn omni-hover-action" data-action="start-edit" data-comment-id="${escapeHtml(
              comment.id
            )}" title="Edit comment">
              <i class="codicon codicon-edit"></i>
            </button>
            <button type="button" class="omni-inline-header-btn omni-hover-action is-danger" data-action="delete-comment" data-comment-id="${escapeHtml(
              comment.id
            )}" title="Delete comment thread">
              <i class="codicon codicon-trash"></i>
            </button>
            <button type="button" class="omni-inline-header-btn omni-collapse-chevron" data-action="toggle-collapse-comment" data-comment-id="${escapeHtml(
              comment.id
            )}" title="Collapse comment">
              <i class="codicon codicon-chevron-up"></i>
            </button>
          </div>
        </div>

        ${activeConfigPopoverZoneId === comment.id ? renderConfigPopoverHtml(comment.id) : ''}

        <div class="omni-inline-thread__body">
            <!-- Root Comment Text with Markdown Support -->
            <div class="omni-inline-item omni-inline-item--root">
              ${
                isEditing
                  ? `
                <div class="omni-inline-edit-box">
                  <textarea id="omni-edit-input-${escapeHtml(
                    comment.id
                  )}" class="omni-inline-textarea" rows="2">${escapeHtml(
                      comment.content
                    )}</textarea>
                  <div class="omni-inline-form-actions">
                    <button type="button" class="omni-inline-btn is-secondary" data-action="cancel-edit" data-comment-id="${escapeHtml(
                      comment.id
                    )}">Cancel</button>
                    <button type="button" class="omni-inline-btn is-primary" data-action="save-edit" data-comment-id="${escapeHtml(
                      comment.id
                    )}">Save</button>
                  </div>
                </div>
              `
                  : `<div class="omni-inline-item__text">${
                      commentBoxConfig.enableMarkdown
                        ? renderCommentMarkdown(comment.content)
                        : escapeHtml(comment.content).replace(/\n/g, '<br>')
                    }</div>`
              }
            </div>

            <!-- Responses / Replies Thread -->
            ${
              hasReplies
                ? `
              <div class="omni-inline-replies-section">
                <button type="button" class="omni-inline-replies-toggle" data-action="toggle-collapse-replies" data-comment-id="${escapeHtml(
                  comment.id
                )}">
                  <i class="codicon codicon-${areRepliesCollapsed ? 'chevron-right' : 'chevron-down'}"></i>
                  <span>${replies.length} ${
                    replies.length === 1 ? 'reply' : 'replies'
                  }</span>
                </button>
                ${
                  areRepliesCollapsed
                    ? ''
                    : `
                  <div class="omni-inline-replies-list">
                    ${replies
                      .map(
                        r => `
                      <div class="omni-inline-item omni-inline-item--reply" data-reply-id="${escapeHtml(
                        r.id
                      )}">
                        <div class="omni-inline-item__meta">
                          <span class="omni-inline-avatar is-reply">${escapeHtml(getAuthorInitial(r.author))}</span>
                          <span class="omni-inline-item__author">${escapeHtml(
                            r.author
                          )}</span>
                          <span class="omni-inline-item__time">${escapeHtml(
                            formatCompactTime(r.createdAt)
                          )}</span>
                          <div class="omni-inline-item__actions">
                            <button type="button" class="omni-inline-item-btn" data-action="open-reply" data-comment-id="${escapeHtml(
                              comment.id
                            )}" data-reply-to="${escapeHtml(r.id)}" title="Reply to ${escapeHtml(
                              r.author || 'this response'
                            )}"><i class="codicon codicon-reply"></i></button>
                            <button type="button" class="omni-inline-item-btn is-danger" data-action="delete-reply" data-comment-id="${escapeHtml(
                              comment.id
                            )}" data-reply-id="${escapeHtml(
                              r.id
                            )}" title="Delete response"><i class="codicon codicon-trash"></i></button>
                          </div>
                        </div>
                        ${renderReplyQuoteHtml(comment, r.inReplyTo)}
                        <div class="omni-inline-item__text">${
                          commentBoxConfig.enableMarkdown
                            ? renderCommentMarkdown(r.content)
                            : escapeHtml(r.content).replace(/\n/g, '<br>')
                        }</div>
                      </div>
                    `
                      )
                      .join('')}
                  </div>
                `
                }
              </div>
            `
                : ''
            }

            <!-- On-Demand Inline Reply Composer -->
            ${
              isReplying
                ? `
              <div class="omni-inline-reply-container is-active" data-reply-container="${escapeHtml(
                comment.id
              )}">
                ${renderReplyTargetChipHtml(comment)}
                <textarea
                  id="omni-reply-input-${escapeHtml(comment.id)}"
                  class="omni-inline-textarea omni-inline-reply-input"
                  rows="2"
                  data-comment-id="${escapeHtml(comment.id)}"
                  placeholder="Reply... (${commentBoxConfig.enableMarkdown ? 'Markdown supported, ' : ''}Ctrl+Enter to reply, Esc to cancel)"
                ></textarea>
                <div class="omni-inline-reply-actions">
                  <button type="button" class="omni-inline-btn is-secondary" data-action="cancel-reply" data-comment-id="${escapeHtml(
                    comment.id
                  )}">Cancel</button>
                  <button type="button" class="omni-inline-btn is-primary" data-action="submit-reply" data-comment-id="${escapeHtml(
                    comment.id
                  )}">Reply</button>
                </div>
              </div>
            `
                : `
              <div class="omni-inline-reply-container" data-reply-container="${escapeHtml(
                comment.id
              )}">
                <button type="button" class="omni-inline-reply-trigger" data-action="open-reply" data-comment-id="${escapeHtml(
                  comment.id
                )}" title="Add a reply">
                  <i class="codicon codicon-reply"></i>
                  <span>Reply...</span>
                </button>
              </div>
            `
            }
          </div>
      </div>
    `;
  }

  function renderNewCommentDraftHtml(draft) {
    return `
      <div class="omni-inline-thread omni-inline-new-comment is-focused">
        <div class="omni-inline-thread__header">
          <div class="omni-inline-thread__header-left">
            <span class="omni-inline-avatar">💬</span>
            <span class="omni-inline-author">New Comment</span>
            ${
              draft.anchorText
                ? `<span class="omni-inline-anchor-pill">&ldquo;${escapeHtml(
                    draft.anchorText
                  )}&rdquo;</span>`
                : ''
            }
          </div>
          <div class="omni-inline-thread__header-actions">
            <button type="button" class="omni-inline-header-btn" data-action="configure-comment-box" data-comment-id="new-comment" title="Configure Comment Box">
              <i class="codicon codicon-settings-gear"></i>
            </button>
            <button type="button" class="omni-inline-header-btn" data-action="cancel-new-comment" title="Cancel">
              <i class="codicon codicon-close"></i>
            </button>
          </div>
        </div>
        ${activeConfigPopoverZoneId === 'new-comment' ? renderConfigPopoverHtml('new-comment') : ''}
        <div class="omni-inline-thread__body">
          ${
            !draft.anchorText
              ? `
            <div class="omni-inline-field">
              <input id="omni-inline-new-comment-anchor" class="omni-inline-anchor-input" type="text" placeholder="Target text in Markdown..." value="" />
            </div>
          `
              : `<input id="omni-inline-new-comment-anchor" type="hidden" value="${escapeHtml(
                  draft.anchorText
                )}" />`
          }
          <textarea
            id="omni-inline-new-comment-input"
            class="omni-inline-textarea"
            rows="2"
            placeholder="Add a comment... (${commentBoxConfig.enableMarkdown ? 'Markdown supported, ' : ''}Ctrl+Enter to save)"
          ></textarea>
          <div class="omni-inline-form-actions">
            <button type="button" class="omni-inline-btn is-secondary" data-action="cancel-new-comment">Cancel</button>
            <button type="button" class="omni-inline-btn is-primary" data-action="submit-new-comment">Comment</button>
          </div>
        </div>
      </div>
    `;
  }

  function bindZoneEvents() {
    zonesLayer.querySelectorAll('[data-action]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        const action = el.getAttribute('data-action');
        const commentId = el.getAttribute('data-comment-id');
        const replyId = el.getAttribute('data-reply-id');

        switch (action) {
          case 'toggle-collapse-comment':
            if (commentId) {
              if (collapsedComments.has(commentId)) {
                collapsedComments.delete(commentId);
              } else {
                collapsedComments.add(commentId);
              }
              renderInlineZones();
            }
            break;
          case 'toggle-collapse-replies':
            if (commentId) {
              if (collapsedReplies.has(commentId)) {
                collapsedReplies.delete(commentId);
              } else {
                collapsedReplies.add(commentId);
              }
              renderInlineZones();
            }
            break;
          case 'toggle-resolve':
            if (commentId) {
              applyLocalCommentAction({
                type: 'resolveComment',
                commentId
              });
            }
            break;
          case 'delete-comment':
            if (commentId) {
              applyLocalCommentAction({
                type: 'deleteComment',
                commentId
              });
            }
            break;
          case 'thumbs-up':
            if (commentId) {
              applyLocalCommentAction({
                type: 'thumbsUpComment',
                commentId
              });
            }
            break;
          case 'start-edit':
            if (commentId) {
              activeEditCommentId =
                activeEditCommentId === commentId ? null : commentId;
              renderInlineZones();
              if (activeEditCommentId) {
                setTimeout(() => {
                  const input = zonesLayer.querySelector(
                    `#omni-edit-input-${CSS.escape(commentId)}`
                  );
                  input?.focus();
                }, 20);
              }
            }
            break;
          case 'cancel-edit':
            activeEditCommentId = null;
            renderInlineZones();
            break;
          case 'save-edit':
            if (commentId) {
              const input = zonesLayer.querySelector(
                `#omni-edit-input-${CSS.escape(commentId)}`
              );
              const content = input ? input.value.trim() : '';
              if (content) {
                activeEditCommentId = null;
                applyLocalCommentAction({
                  type: 'editComment',
                  commentId,
                  content
                });
              }
            }
            break;
          case 'delete-reply':
            if (commentId && replyId) {
              applyLocalCommentAction({
                type: 'deleteReply',
                commentId,
                replyId
              });
            }
            break;
          case 'open-reply':
            if (commentId) {
              activeReplyCommentId = commentId;
              activeReplyTargetId = el.getAttribute('data-reply-to') || null;
              renderInlineZones();
              setTimeout(() => {
                const input = zonesLayer.querySelector(
                  `#omni-reply-input-${CSS.escape(commentId)}`
                );
                input?.focus();
              }, 20);
            }
            break;
          case 'clear-reply-target':
            activeReplyTargetId = null;
            renderInlineZones();
            break;
          case 'cancel-reply':
            activeReplyCommentId = null;
            activeReplyTargetId = null;
            renderInlineZones();
            break;
          case 'submit-reply':
            if (commentId) {
              const input = zonesLayer.querySelector(
                `#omni-reply-input-${CSS.escape(commentId)}`
              );
              const content = input ? input.value.trim() : '';
              if (content) {
                const inReplyTo = activeReplyTargetId || undefined;
                activeReplyCommentId = null;
                activeReplyTargetId = null;
                collapsedReplies.delete(commentId);
                applyLocalCommentAction({
                  type: 'addReply',
                  commentId,
                  content,
                  inReplyTo
                });
              }
            }
            break;
          case 'cancel-new-comment':
            newCommentDraft = null;
            renderInlineZones();
            break;
          case 'configure-comment-box':
            activeConfigPopoverZoneId =
              activeConfigPopoverZoneId === commentId ? null : commentId;
            renderInlineZones();
            break;
          case 'close-config-popover':
            activeConfigPopoverZoneId = null;
            renderInlineZones();
            break;
          case 'open-full-settings':
            if (window.vscodeEvent) {
              window.vscodeEvent.emit('command', 'omnicomment.configureCommentBox');
            }
            break;
          case 'submit-new-comment': {
            const anchorEl = zonesLayer.querySelector('#omni-inline-new-comment-anchor');
            const contentEl = zonesLayer.querySelector('#omni-inline-new-comment-input');
            const anchorText = anchorEl
              ? anchorEl.value.trim()
              : newCommentDraft?.anchorText || '';
            const content = contentEl ? contentEl.value.trim() : '';
            if (content) {
              newCommentDraft = null;
              applyLocalCommentAction({
                type: 'addComment',
                anchorText,
                content
              });
            }
            break;
          }
        }
      });
    });

    // Invariant: Bind segmented density and font-size buttons inside the comment box configuration popover.
    // Why: Updates active comment box bounds instantly and persists preference to local storage and VS Code.
    // Example: clicking 'Compact' sets widthMode to 'compact' and triggers live card resize.
    zonesLayer.querySelectorAll('[data-config-set]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const prop = btn.getAttribute('data-config-set');
        let val = btn.getAttribute('data-config-val');
        if (prop === 'fontSize') {
          val = parseInt(val, 10);
        }
        applyConfig({ [prop]: val });
        if (window.vscodeEvent) {
          window.vscodeEvent.emit('command', 'omnicomment.saveCommentBoxConfig', { [prop]: val });
        }
      });
    });

    // Invariant: Bind toggle checkboxes for markdown parsing, avatars, and thread guide lines.
    // Why: Allows immediate customization of comment card visual complexity directly from the header popover.
    // Example: unchecking 'enableMarkdown' switches from formatted markdown to plain text with line breaks.
    zonesLayer.querySelectorAll('[data-config-toggle]').forEach(chk => {
      chk.addEventListener('change', e => {
        e.stopPropagation();
        const prop = chk.getAttribute('data-config-toggle');
        const val = chk.checked;
        applyConfig({ [prop]: val });
        if (window.vscodeEvent) {
          window.vscodeEvent.emit('command', 'omnicomment.saveCommentBoxConfig', { [prop]: val });
        }
      });
    });

    zonesLayer.querySelectorAll('.omni-inline-reply-input').forEach(input => {
      const commentId = input.getAttribute('data-comment-id');
      const container = commentId
        ? zonesLayer.querySelector(`[data-reply-container="${CSS.escape(commentId)}"]`)
        : null;

      input.addEventListener('focus', () => {
        container?.classList.add('is-active');
        if ('rows' in input && input.rows < 2) {
          input.rows = 2;
        }
        syncZonePositions();
      });

      input.addEventListener('input', () => {
        container?.classList.add('is-active');
        syncZonePositions();
      });

      input.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          container?.querySelector('[data-action="submit-reply"]')?.click();
        } else if (e.key === 'Enter' && !e.shiftKey && input.tagName !== 'TEXTAREA') {
          e.preventDefault();
          container?.querySelector('[data-action="submit-reply"]')?.click();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          container?.querySelector('[data-action="cancel-reply"]')?.click();
        }
      });
    });

    const newCommentInput = zonesLayer.querySelector('#omni-inline-new-comment-input');
    if (newCommentInput) {
      newCommentInput.addEventListener('keydown', e => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          zonesLayer.querySelector('[data-action="submit-new-comment"]')?.click();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          zonesLayer.querySelector('[data-action="cancel-new-comment"]')?.click();
        }
      });
    }

    if (activeEditCommentId) {
      const editInput = zonesLayer.querySelector(
        `#omni-edit-input-${CSS.escape(activeEditCommentId)}`
      );
      if (editInput) {
        editInput.addEventListener('keydown', e => {
          if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            zonesLayer.querySelector('[data-action="save-edit"]')?.click();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            zonesLayer.querySelector('[data-action="cancel-edit"]')?.click();
          }
        });
      }
    }
  }

  function renderInlineZones() {
    const root = document.getElementById('vditor');
    const contentRoot = getContentRoot();
    if (!root || !contentRoot) return;

    root.querySelectorAll('[data-omni-zone]').forEach(el => {
      el.removeAttribute('data-omni-zone');
    });

    const blockZoneMap = new Map();
    const fallbackBlock = getFallbackBlock(contentRoot);

    const sortedItems = [...commentRanges].sort((a, b) => {
      const lineDiff =
        (a.comment.anchor?.startLine ?? 0) - (b.comment.anchor?.startLine ?? 0);
      if (lineDiff !== 0) return lineDiff;
      return (
        (a.comment.anchor?.startChar ?? 0) - (b.comment.anchor?.startChar ?? 0)
      );
    });

    for (const item of sortedItems) {
      const targetBlock = item.blockEl || fallbackBlock;
      if (!targetBlock) continue;
      if (!blockZoneMap.has(targetBlock)) {
        blockZoneMap.set(targetBlock, { comments: [], hasNewDraft: false });
      }
      blockZoneMap.get(targetBlock).comments.push(item);
    }

    if (newCommentDraft) {
      const draftBlock =
        (newCommentDraft.blockEl && newCommentDraft.blockEl.isConnected
          ? newCommentDraft.blockEl
          : null) ||
        findBlockForAnchorText(newCommentDraft.anchorText, contentRoot) ||
        fallbackBlock;
      if (draftBlock) {
        newCommentDraft.blockEl = draftBlock;
        if (!blockZoneMap.has(draftBlock)) {
          blockZoneMap.set(draftBlock, { comments: [], hasNewDraft: false });
        }
        blockZoneMap.get(draftBlock).hasNewDraft = true;
      }
    }

    zonesLayer.replaceChildren();
    activeZones = [];

    let zoneCounter = 0;
    for (const [blockEl, group] of blockZoneMap.entries()) {
      const visibleComments = group.comments.filter(
        item => !collapsedComments.has(item.comment.id)
      );
      const isZoneVisible = visibleComments.length > 0 || group.hasNewDraft;

      if (!isZoneVisible) {
        blockEl.removeAttribute('data-omni-zone');
        continue;
      }

      const zoneId = `omni-zone-${zoneCounter++}`;
      blockEl.setAttribute('data-omni-zone', zoneId);

      const zoneEl = document.createElement('div');
      zoneEl.className = 'omni-inline-zone';
      zoneEl.setAttribute('data-zone-id', zoneId);

      const threadsHtml = visibleComments
        .map(item => renderThreadHtml(item.comment))
        .join('');
      const draftHtml = group.hasNewDraft
        ? renderNewCommentDraftHtml(newCommentDraft)
        : '';

      zoneEl.innerHTML = `
        <div class="omni-inline-zone__arrow"></div>
        <div class="omni-inline-zone__stack">
          ${threadsHtml}
          ${draftHtml}
        </div>
      `;

      zonesLayer.appendChild(zoneEl);
      activeZones.push({
        zoneId,
        blockEl,
        zoneEl,
        anchorRange: visibleComments[0]?.range || null,
        isVisible: true
      });
    }

    bindZoneEvents();
    syncZonePositions();
    requestAnimationFrame(syncZonePositions);
  }

  function refreshHighlights(markdownContent) {
    const root = document.getElementById('vditor');
    const contentRoot = getContentRoot();
    if (!root || !contentRoot) return;

    hideStorageBlocks(root);

    if (typeof markdownContent === 'string') {
      const span = findCommentBlockSpan(markdownContent);
      if (span) {
        latestSerializedBlock = span.blockText;
      }
    }

    const md =
      typeof markdownContent === 'string'
        ? markdownContent
        : getMarkdownValue?.() || '';
    activeComments = parseOmniComments(md);
    if (activeComments.length > 0 && activeComments[0].author) {
      cachedAuthor = activeComments[0].author;
    }

    root.querySelectorAll('[data-omni-comments]').forEach(el => {
      el.removeAttribute('data-omni-comments');
    });
    root.querySelectorAll('[data-omni-inline-highlight]').forEach(el => {
      el.removeAttribute('data-omni-inline-highlight');
    });

    commentRanges = [];
    const fallbackBlock = getFallbackBlock(contentRoot);

    if (activeComments.length > 0) {
      const domMap = buildDomTextMap(contentRoot);
      const normDomLower = domMap.text.toLowerCase();

      const normalHighlightRanges = [];
      const focusedHighlightRanges = [];
      const blockCounts = new Map();
      const gutterTargetsMap = new Map();

      for (const comment of activeComments) {
        const rawAnchor = (comment.anchor?.text || '')
          .replace(/[\u200B-\u200D\uFEFF]/g, '')
          .replace(/\u00A0/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        const searchNorm = stripMarkdownSyntax(comment.anchor?.text || '');
        let matchIdx = -1;
        let matchedSearchLen = 0;

        if (rawAnchor) {
          matchIdx = domMap.text.indexOf(rawAnchor);
          if (matchIdx !== -1) {
            matchedSearchLen = rawAnchor.length;
          }
        }
        if (matchIdx === -1 && searchNorm) {
          matchIdx = domMap.text.indexOf(searchNorm);
          if (matchIdx !== -1) {
            matchedSearchLen = searchNorm.length;
          } else {
            matchIdx = normDomLower.indexOf(searchNorm.toLowerCase());
            if (matchIdx !== -1) {
              matchedSearchLen = searchNorm.length;
            }
          }
          if (matchIdx === -1) {
            const wrappedVariants = [
              `**${searchNorm}**`,
              `\`${searchNorm}\``,
              `*${searchNorm}*`,
              `_${searchNorm}_`,
              `__${searchNorm}__`
            ];
            for (const variant of wrappedVariants) {
              matchIdx = domMap.text.indexOf(variant);
              if (matchIdx !== -1) {
                matchedSearchLen = variant.length;
                break;
              }
            }
          }
        }
        if (matchIdx === -1 && rawAnchor) {
          matchIdx = normDomLower.indexOf(rawAnchor.toLowerCase());
          if (matchIdx !== -1) {
            matchedSearchLen = rawAnchor.length;
          }
        }

        if (matchIdx !== -1 && matchedSearchLen > 0) {
          const startPos = domMap.positions[matchIdx];
          const endPos = domMap.positions[matchIdx + matchedSearchLen - 1];
          if (startPos && endPos) {
            try {
              const range = new Range();
              range.setStart(startPos.node, startPos.offset);
              range.setEnd(
                endPos.node,
                Math.min((endPos.node.nodeValue || '').length, endPos.offset + 1)
              );

              const blockEl =
                resolveBlockElement(startPos.node, contentRoot) || fallbackBlock;
              const gutterTargetEl = resolveGutterTargetElement(range, blockEl);
              commentRanges.push({ comment, range, blockEl, gutterTargetEl });

              // Only highlight text for unresolved comments; when resolved, clear highlight
              if (!comment.resolved) {
                const isFocused = comment.id === focusedCommentId;
                if (isFocused) {
                  focusedHighlightRanges.push(range);
                } else {
                  normalHighlightRanges.push(range);
                }

                // Invariant: Apply data-omni-inline-highlight attribute directly to enclosing inline elements (code, strong, em).
                // Why: Guarantees visible highlighting even if ::highlight is occluded by opaque background or unsupported.
                // Example: <code data-omni-inline-highlight="normal"> displays high-contrast yellow background + border.
                const inlineParent =
                  startPos.node.parentElement?.closest('code, strong, em, b, i, span') ||
                  endPos.node.parentElement?.closest('code, strong, em, b, i, span');
                if (inlineParent && contentRoot.contains(inlineParent)) {
                  inlineParent.setAttribute(
                    'data-omni-inline-highlight',
                    isFocused ? 'focused' : 'normal'
                  );
                }

                if (blockEl) {
                  blockCounts.set(blockEl, (blockCounts.get(blockEl) || 0) + 1);
                }
                if (gutterTargetEl) {
                  gutterTargetsMap.set(
                    gutterTargetEl,
                    (gutterTargetsMap.get(gutterTargetEl) || 0) + 1
                  );
                }
              }
              continue;
            } catch {
              // Fall through to block fallback
            }
          }
        }

        if (fallbackBlock) {
          const gutterTargetEl = resolveGutterTargetElement(null, fallbackBlock);
          commentRanges.push({
            comment,
            range: null,
            blockEl: fallbackBlock,
            gutterTargetEl
          });
          if (!comment.resolved) {
            blockCounts.set(
              fallbackBlock,
              (blockCounts.get(fallbackBlock) || 0) + 1
            );
            gutterTargetsMap.set(
              gutterTargetEl,
              (gutterTargetsMap.get(gutterTargetEl) || 0) + 1
            );
          }
        }
      }

      for (const [targetEl, count] of gutterTargetsMap.entries()) {
        targetEl.setAttribute('data-omni-comments', String(count));
      }
      for (const [blockEl, count] of blockCounts.entries()) {
        blockEl.setAttribute('data-omni-comments', String(count));
      }
      activeBlockCounts = blockCounts;
      activeGutterTargets = gutterTargetsMap;

      if (window.CSS && CSS.highlights && window.Highlight) {
        if (normalHighlightRanges.length > 0) {
          CSS.highlights.set(
            'omni-comment',
            new Highlight(...normalHighlightRanges)
          );
        } else {
          CSS.highlights.delete('omni-comment');
        }
        if (focusedHighlightRanges.length > 0) {
          CSS.highlights.set(
            'omni-comment-focused',
            new Highlight(...focusedHighlightRanges)
          );
        } else {
          CSS.highlights.delete('omni-comment-focused');
        }
      }
    } else {
      activeBlockCounts = new Map();
      activeGutterTargets = new Map();
      root.querySelectorAll('[data-omni-inline-highlight]').forEach(el => {
        el.removeAttribute('data-omni-inline-highlight');
      });
      if (window.CSS && CSS.highlights) {
        CSS.highlights.delete('omni-comment');
        CSS.highlights.delete('omni-comment-focused');
      }
    }

    renderInlineZones();
  }

  function findMatchingItemsAtPoint(clientX, clientY) {
    const matched = [];
    for (const item of commentRanges) {
      if (!item.range || item.comment.resolved) continue;
      const rects = item.range.getClientRects();
      for (const rect of rects) {
        if (
          clientX >= rect.left - 4 &&
          clientX <= rect.right + 4 &&
          clientY >= rect.top - 4 &&
          clientY <= rect.bottom + 4
        ) {
          matched.push(item);
          break;
        }
      }
    }
    return matched;
  }

  document.addEventListener('click', e => {
    if (
      zonesLayer.contains(e.target) ||
      selectionChip.contains(e.target) ||
      (gutterLayer && gutterLayer.contains(e.target))
    ) {
      return;
    }

    const targetEl =
      e.target instanceof Element
        ? e.target.closest('[data-omni-comments]')
        : null;
    if (targetEl) {
      const blockRect = targetEl.getBoundingClientRect();
      const isGutterClick =
        !e.isTrusted ||
        (e.clientX === 0 && e.clientY === 0) ||
        e.clientX <= blockRect.left + 16 ||
        e.clientX >= blockRect.right - 40;
      if (isGutterClick) {
        toggleCommentsForTarget(targetEl, commentRanges);
        return;
      }
    }

    const matches = findMatchingItemsAtPoint(e.clientX, e.clientY);
    if (matches.length > 0) {
      const cid = matches[0].comment.id;
      focusedCommentId = cid;
      collapsedComments.delete(cid);
      renderInlineZones();
    }
  });

  function updateSelectionChip() {
    const selection = document.getSelection();
    const contentRoot = getContentRoot();
    if (
      !selection ||
      selection.rangeCount === 0 ||
      selection.isCollapsed ||
      !contentRoot ||
      !contentRoot.contains(selection.anchorNode) ||
      zonesLayer.contains(selection.anchorNode)
    ) {
      selectionChip.hidden = true;
      return;
    }
    const text = selection
      .toString()
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .trim();
    if (!text) {
      selectionChip.hidden = true;
      return;
    }
    const range = selection.getRangeAt(0);
    let rect = range.getBoundingClientRect();
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      const clientRects = range.getClientRects();
      if (clientRects && clientRects.length > 0) {
        rect = clientRects[0];
      }
    }
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      selectionChip.hidden = true;
      return;
    }
    selectionChip.hidden = false;
    const top = Math.max(44, rect.top - 32);
    const left = Math.min(
      window.innerWidth - 130,
      Math.max(12, rect.right - 30)
    );
    selectionChip.style.top = `${top}px`;
    selectionChip.style.left = `${left}px`;
  }

  document.addEventListener('mouseup', () => {
    setTimeout(updateSelectionChip, 30);
  });
  document.addEventListener('keyup', () => {
    setTimeout(updateSelectionChip, 30);
  });
  let selectionChangeTimer = null;
  document.addEventListener('selectionchange', () => {
    if (selectionChangeTimer) clearTimeout(selectionChangeTimer);
    selectionChangeTimer = setTimeout(updateSelectionChip, 40);
  });

  document.addEventListener('scroll', syncZonePositions, true);
  window.addEventListener('resize', syncZonePositions);

  const rootEl = document.getElementById('vditor');
  if (rootEl && window.ResizeObserver) {
    const ro = new ResizeObserver(() => {
      syncZonePositions();
    });
    ro.observe(rootEl);
  }

  if (rootEl && window.MutationObserver) {
    let modeDebounceTimer = null;
    const mo = new MutationObserver(mutations => {
      let shouldRefresh = false;
      for (const m of mutations) {
        if (
          m.type === 'attributes' &&
          (m.attributeName === 'class' || m.attributeName === 'style')
        ) {
          const target = m.target;
          if (
            target &&
            (target.classList?.contains('vditor-wysiwyg') ||
              target.classList?.contains('vditor-ir') ||
              target.classList?.contains('vditor-sv') ||
              target.id === 'vditor')
          ) {
            shouldRefresh = true;
            break;
          }
        } else if (m.type === 'childList') {
          const target = m.target;
          if (
            target &&
            !zonesLayer.contains(target) &&
            !(gutterLayer && gutterLayer.contains(target)) &&
            target.id !== 'omni-inline-zones-layer' &&
            target.id !== 'omni-gutter-layer'
          ) {
            shouldRefresh = true;
            break;
          }
        }
      }
      if (shouldRefresh) {
        if (modeDebounceTimer) clearTimeout(modeDebounceTimer);
        modeDebounceTimer = setTimeout(() => {
          refreshHighlights();
          syncZonePositions();
        }, 80);
      }
    });
    mo.observe(rootEl, {
      attributes: true,
      attributeFilter: ['class', 'style'],
      childList: true,
      subtree: true
    });
  }

  function focusCommentById(commentId, anchorText) {
    focusedCommentId = commentId;
    collapsedComments.delete(commentId);
    refreshHighlights();

    let targetItem = commentRanges.find(item => item.comment.id === commentId);
    if (!targetItem && anchorText) {
      const norm = stripMarkdownSyntax(anchorText);
      targetItem = commentRanges.find(
        item => stripMarkdownSyntax(item.comment.anchor?.text || '') === norm
      );
    }
    if (targetItem && targetItem.blockEl) {
      targetItem.blockEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setTimeout(syncZonePositions, 100);
    }
  }

  function getInlineState() {
    const contentRoot = getContentRoot();
    const threadElsMap = new Map();
    zonesLayer.querySelectorAll('.omni-inline-thread[data-comment-id]').forEach(el => {
      const cid = el.getAttribute('data-comment-id');
      if (cid) {
        threadElsMap.set(cid, el);
      }
    });

    syncZonePositions();
    const threads = activeComments.map(comment => {
      const el = threadElsMap.get(comment.id);
      const isCollapsed = collapsedComments.has(comment.id);
      const isHidden =
        isCollapsed ||
        !el ||
        el.offsetParent === null ||
        window.getComputedStyle(el).display === 'none';
      const zoneEl =
        el?.closest('.omni-inline-zone[data-zone-id]') ||
        el?.closest('[data-zone-id]');
      const zoneId = zoneEl?.getAttribute('data-zone-id');
      const matchedZone = activeZones.find(z => z.zoneId === zoneId);
      const blockEl =
        matchedZone?.blockEl ||
        (zoneId
          ? document.querySelector(`[data-omni-zone="${CSS.escape(zoneId)}"]`)
          : null);
      const blockRect = blockEl ? blockEl.getBoundingClientRect() : null;
      const threadRect = el ? el.getBoundingClientRect() : null;

      return {
        commentId: comment.id,
        isCollapsed,
        isHidden,
        isResolved: Boolean(comment.resolved),
        text: el ? (el.textContent || '') : (comment.content || ''),
        replyCount: el
          ? el.querySelectorAll('.omni-inline-item--reply').length
          : (comment.replies || []).length,
        hasReplyBox: el
          ? Boolean(
              el.querySelector(
                '.omni-inline-reply-container, .omni-inline-reply-input, .omni-inline-reply-trigger, [data-action="open-reply"]'
              )
            )
          : false,
        isBelowBlock: Boolean(
          blockRect && threadRect && !isHidden && threadRect.top >= blockRect.bottom - 2
        )
      };
    });

    return {
      zoneCount: activeZones.length,
      totalZoneCount: activeZones.length,
      threadCount: threads.length,
      visibleThreadCount: threads.filter(t => !t.isHidden).length,
      highlightCount:
        (window.CSS && CSS.highlights && window.Highlight)
          ? (CSS.highlights.get('omni-comment')?.size || 0) +
            (CSS.highlights.get('omni-comment-focused')?.size || 0)
          : 0,
      threads,
      gutterChipCount: gutterLayer ? gutterLayer.querySelectorAll('.omni-gutter-chip').length : 0,
      gutterChips: gutterLayer
        ? Array.from(gutterLayer.querySelectorAll('.omni-gutter-chip')).map(c => ({
            top: c.style.top,
            left: c.style.left,
            className: c.className,
            isCollapsed: c.classList.contains('is-collapsed'),
            text: c.textContent
          }))
        : [],
      activeBlockCountsSize: activeBlockCounts.size,
      activeGutterTargetsSize: activeGutterTargets.size,
      activeGutterTargets: Array.from(activeGutterTargets.keys()).map(
        b => {
          if (!b || typeof b.getBoundingClientRect !== 'function') {
            return { tag: 'unknown', top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
          }
          const rect = b.getBoundingClientRect();
          return {
            tag: b.tagName,
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
            width: rect.width,
            height: rect.height
          };
        }
      ),
      activeBlocks: Array.from(activeBlockCounts.keys()).map(
        b => {
          if (!b || typeof b.getBoundingClientRect !== 'function') {
            return { tag: 'unknown', top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
          }
          const rect = b.getBoundingClientRect();
          return {
            tag: b.tagName,
            top: rect.top,
            bottom: rect.bottom,
            left: rect.left,
            right: rect.right,
            width: rect.width,
            height: rect.height
          };
        }
      ),
      viewportRect: (contentRoot && typeof contentRoot.getBoundingClientRect === 'function') ? (() => {
        const r = contentRoot.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
      })() : null,
      commentRangesCount: commentRanges.length,
      commentRangesDetails: commentRanges.map(cr => {
        const rects = cr.range ? cr.range.getClientRects() : [];
        const firstRect = rects.length > 0 ? rects[0] : null;
        return {
          commentId: cr.comment.id,
          blockTag: cr.blockEl?.tagName,
          gutterTargetTag: cr.gutterTargetEl?.tagName,
          hasRange: Boolean(cr.range),
          rectsLength: rects.length,
          rangeTop: firstRect ? firstRect.top : null,
          rangeBottom: firstRect ? firstRect.bottom : null,
          rangeLeft: firstRect ? firstRect.left : null
        };
      }),
      commentRangesBlocks: commentRanges.map(cr => cr.blockEl?.tagName || '')
    };
  }

  window.__omniGetInlineState = getInlineState;
  
  return {
    refreshHighlights,
    focusCommentById,
    openAddCommentComposer,
    syncFromExternalUpdate,
    getInlineState,
    applyConfig,
    getConfig: () => ({ ...commentBoxConfig })
  };
}

