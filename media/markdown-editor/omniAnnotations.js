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
  const blockEl = el.closest(
    'h1, h2, h3, h4, h5, h6, p, li, blockquote, [data-block="0"]'
  );
  if (blockEl && isEligibleBlock(blockEl, contentRoot)) {
    return blockEl;
  }
  return null;
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
        if (!parent) return NodeFilter.FILTER_REJECT;
        if (
          parent.closest(
            '.vditor-editor-boundary, .vditor-wysiwyg__marker, .vditor-ir__marker, .vditor-toolbar, .vditor-outline, .vditor-hint, .omni-inline-zones-layer, .omni-selection-chip, script, style'
          )
        ) {
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
    const parentBlock = resolveBlockElement(currentNode, container);
    const nextNode = walker.nextNode();
    if (nextNode) {
      const nextBlock = resolveBlockElement(nextNode, container);
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
  let activeBlockCounts = new Map(); // blockEl -> number of active comments on this block

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
        target.replies.push({
          id: generateId(),
          content,
          author: cachedAuthor,
          createdAt: nowIso
        });
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
      if (blockEl && !blockEl.classList.contains('omni-storage-block')) {
        const text = (blockEl.textContent || '')
          .replace(/[\u200B-\u200D\uFEFF]/g, '')
          .replace(/\u00A0/g, ' ')
          .trim();
        return { text, blockEl };
      }
    }
    return { text: '', blockEl: null };
  }

  function findBlockForAnchorText(anchorText, contentRoot) {
    if (!contentRoot) return null;
    const norm = stripMarkdownSyntax(anchorText);
    if (norm) {
      const domMap = buildDomTextMap(contentRoot);
      let idx = domMap.text.indexOf(norm);
      if (idx === -1) {
        idx = domMap.text.toLowerCase().indexOf(norm.toLowerCase());
      }
      if (idx !== -1 && domMap.positions[idx]) {
        const block = resolveBlockElement(domMap.positions[idx].node, contentRoot);
        if (block) return block;
      }
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

      zoneEl.style.top = `${top}px`;
      zoneEl.style.left = `${left}px`;
      zoneEl.style.width = 'fit-content';
      zoneEl.style.maxWidth = '320px';
      zoneEl.style.minWidth = '130px';

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

    // Render interactive DOM gutter chips for all blocks with comments
    if (gutterLayer) {
      gutterLayer.replaceChildren();
      for (const [blockEl, count] of activeBlockCounts.entries()) {
        if (!blockEl || !blockEl.isConnected || !contentRoot.contains(blockEl)) {
          continue;
        }
        const bRect = blockEl.getBoundingClientRect();
        if (!isBlockVisibleInViewport(bRect, clipTop, clipBottom)) {
          continue;
        }

        const blockItems = commentRanges.filter(i => i.blockEl === blockEl);
        const isCollapsed =
          blockItems.length > 0 &&
          blockItems.every(i => collapsedComments.has(i.comment.id));

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

        const chipTop = Math.round(
          bRect.top + (bRect.height > 32 ? 6 : Math.max(0, (bRect.height - 22) / 2))
        );
        const chipLeft = calculateGutterChipLeft(bRect.left, viewportRect.left);

        chip.style.top = `${chipTop}px`;
        chip.style.left = `${chipLeft}px`;

        chip.innerHTML = `💬${
          count > 1 ? `<span class="omni-gutter-chip__badge">${count}</span>` : ''
        }`;

        chip.addEventListener('click', e => {
          e.stopPropagation();
          e.preventDefault();
          const items = commentRanges.filter(i => i.blockEl === blockEl);
          if (items.length > 0) {
            const allCol = items.every(i => collapsedComments.has(i.comment.id));
            for (const item of items) {
              if (allCol) {
                collapsedComments.delete(item.comment.id);
                focusedCommentId = item.comment.id;
              } else {
                collapsedComments.add(item.comment.id);
              }
            }
            renderInlineZones();
          }
        });

        gutterLayer.appendChild(chip);
      }
    }
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
        <!-- Compact Single-Row Header -->
        <div class="omni-inline-thread__header">
          <div class="omni-inline-thread__header-left" data-action="toggle-collapse-comment" data-comment-id="${escapeHtml(
            comment.id
          )}" title="Click to toggle collapse">
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

        <div class="omni-inline-thread__body">
            <!-- Root Comment Text -->
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
                  : `<div class="omni-inline-item__text">${escapeHtml(
                      comment.content
                    )}</div>`
              }
            </div>

            <!-- Responses / Replies -->
            ${
              hasReplies
                ? `
              <div class="omni-inline-replies-section">
                <button type="button" class="omni-inline-replies-toggle" data-action="toggle-collapse-replies" data-comment-id="${escapeHtml(
                  comment.id
                )}">
                  ${areRepliesCollapsed ? '▸ Show' : '▾ Hide'} ${replies.length} ${
                    replies.length === 1 ? 'response' : 'responses'
                  }
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
                          <span class="omni-inline-item__author">${escapeHtml(
                            r.author
                          )}</span>
                          <span class="omni-inline-item__time">${escapeHtml(
                            formatCompactTime(r.createdAt)
                          )}</span>
                          <div class="omni-inline-item__actions">
                            <button type="button" class="omni-inline-item-btn is-danger" data-action="delete-reply" data-comment-id="${escapeHtml(
                              comment.id
                            )}" data-reply-id="${escapeHtml(
                              r.id
                            )}" title="Delete response"><i class="codicon codicon-trash"></i></button>
                          </div>
                        </div>
                        <div class="omni-inline-item__text">${escapeHtml(r.content)}</div>
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

            <!-- On-Demand Sleek Inline Reply Trigger / Box -->
            ${
              isReplying
                ? `
              <div class="omni-inline-reply-container is-active" data-reply-container="${escapeHtml(
                comment.id
              )}">
                <input
                  type="text"
                  id="omni-reply-input-${escapeHtml(comment.id)}"
                  class="omni-inline-reply-input"
                  data-comment-id="${escapeHtml(comment.id)}"
                  placeholder="Reply... (Enter to reply, Esc to cancel)"
                  autocomplete="off"
                />
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
                : hasReplies
                ? `
              <div class="omni-inline-reply-container" data-reply-container="${escapeHtml(
                comment.id
              )}">
                <button type="button" class="omni-inline-reply-trigger" data-action="open-reply" data-comment-id="${escapeHtml(
                  comment.id
                )}" title="Add a reply">
                  <i class="codicon codicon-reply"></i>
                  <span>Reply</span>
                </button>
              </div>
            `
                : ''
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
            <button type="button" class="omni-inline-header-btn" data-action="cancel-new-comment" title="Cancel">
              <i class="codicon codicon-close"></i>
            </button>
          </div>
        </div>
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
            placeholder="Add a comment... (Ctrl+Enter to save)"
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
              renderInlineZones();
              setTimeout(() => {
                const input = zonesLayer.querySelector(
                  `#omni-reply-input-${CSS.escape(commentId)}`
                );
                input?.focus();
              }, 20);
            }
            break;
          case 'cancel-reply':
            activeReplyCommentId = null;
            renderInlineZones();
            break;
          case 'submit-reply':
            if (commentId) {
              const input = zonesLayer.querySelector(
                `#omni-reply-input-${CSS.escape(commentId)}`
              );
              const content = input ? input.value.trim() : '';
              if (content) {
                activeReplyCommentId = null;
                collapsedReplies.delete(commentId);
                applyLocalCommentAction({
                  type: 'addReply',
                  commentId,
                  content
                });
              }
            }
            break;
          case 'cancel-new-comment':
            newCommentDraft = null;
            renderInlineZones();
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
        if (e.key === 'Enter' && !e.shiftKey) {
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

    commentRanges = [];
    const fallbackBlock = getFallbackBlock(contentRoot);

    if (activeComments.length > 0) {
      const domMap = buildDomTextMap(contentRoot);
      const normDomLower = domMap.text.toLowerCase();

      const normalHighlightRanges = [];
      const focusedHighlightRanges = [];
      const blockCounts = new Map();

      for (const comment of activeComments) {
        const searchNorm = stripMarkdownSyntax(comment.anchor?.text || '');
        let matchIdx = -1;
        if (searchNorm) {
          matchIdx = domMap.text.indexOf(searchNorm);
          if (matchIdx === -1) {
            matchIdx = normDomLower.indexOf(searchNorm.toLowerCase());
          }
        }

        if (matchIdx !== -1) {
          const startPos = domMap.positions[matchIdx];
          const endPos = domMap.positions[matchIdx + searchNorm.length - 1];
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
              commentRanges.push({ comment, range, blockEl });

              // Only highlight text for unresolved comments; when resolved, clear highlight
              if (!comment.resolved) {
                if (comment.id === focusedCommentId) {
                  focusedHighlightRanges.push(range);
                } else {
                  normalHighlightRanges.push(range);
                }

                if (blockEl) {
                  blockCounts.set(blockEl, (blockCounts.get(blockEl) || 0) + 1);
                }
              }
              continue;
            } catch {
              // Fall through to block fallback
            }
          }
        }

        if (fallbackBlock) {
          commentRanges.push({ comment, range: null, blockEl: fallbackBlock });
          blockCounts.set(
            fallbackBlock,
            (blockCounts.get(fallbackBlock) || 0) + 1
          );
        }
      }

      for (const [blockEl, count] of blockCounts.entries()) {
        blockEl.setAttribute('data-omni-comments', String(count));
      }
      activeBlockCounts = blockCounts;

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
        const blockItems = commentRanges.filter(item => item.blockEl === targetEl);
        if (blockItems.length > 0) {
          const allCollapsed = blockItems.every(item =>
            collapsedComments.has(item.comment.id)
          );
          for (const item of blockItems) {
            if (allCollapsed) {
              collapsedComments.delete(item.comment.id);
            } else {
              collapsedComments.add(item.comment.id);
            }
          }
          renderInlineZones();
          return;
        }
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
      let modeChanged = false;
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
            modeChanged = true;
            break;
          }
        }
      }
      if (modeChanged) {
        if (modeDebounceTimer) clearTimeout(modeDebounceTimer);
        modeDebounceTimer = setTimeout(() => {
          renderInlineZones();
          syncZonePositions();
        }, 60);
      }
    });
    mo.observe(rootEl, {
      attributes: true,
      attributeFilter: ['class', 'style'],
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
      threads
    };
  }

  window.__omniGetInlineState = getInlineState;
  
  return {
    refreshHighlights,
    focusCommentById,
    openAddCommentComposer,
    syncFromExternalUpdate,
    getInlineState
  };
}

