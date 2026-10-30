/**
 * OmniComment Robust 3-Tier Anchoring Engine
 * Platform-independent text matching with character-offset preservation.
 */

export interface AnchorMatchResult {
  startOffset: number;
  endOffset: number;
  matchedText: string;
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
}

export interface NormalizedTextMap {
  value: string;
  offsets: number[];
}

export class AnchorEngine {
  /**
   * Cleans raw anchor query string by removing non-breaking/zero-width chars and normalizing whitespace
   */
  public static cleanSearchText(text: string): string {
    return text
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\u00A0/g, ' ')
      .replace(/\r\n/g, '\n')
      .trim();
  }

  /**
   * Converts a character offset in text into 0-based (line, character) coordinates
   */
  public static offsetToPosition(
    text: string,
    offset: number
  ): { line: number; character: number } {
    let line = 0;
    let lastLineStart = 0;
    const clampedOffset = Math.min(Math.max(0, offset), text.length);

    for (let i = 0; i < clampedOffset; i++) {
      if (text[i] === '\n') {
        line++;
        lastLineStart = i + 1;
      }
    }
    return {
      line,
      character: clampedOffset - lastLineStart
    };
  }

  /**
   * Converts 0-based (line, character) coordinates into character offset
   */
  public static positionToOffset(
    text: string,
    line: number,
    character: number
  ): number {
    const lines = text.split('\n');
    let offset = 0;
    for (let i = 0; i < line && i < lines.length; i++) {
      offset += lines[i].length + 1; // +1 for newline
    }
    offset += character;
    return Math.min(offset, text.length);
  }

  /**
   * Builds a normalized representation of markdown text while preserving
   * an exact mapping from every normalized character index back to original character offset.
   */
  public static buildNormalizedMarkdownMap(text: string): NormalizedTextMap {
    const skip = new Uint8Array(text.length);

    const markSkipRegex = (regex: RegExp) => {
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        for (let i = match.index; i < match.index + match[0].length; i++) {
          skip[i] = 1;
        }
      }
    };

    // Skip zero-width characters (\u200B-\u200D, \uFEFF)
    markSkipRegex(/[\u200B-\u200D\uFEFF]/g);

    // Skip Markdown link syntax [label](url) but keep the label text
    const linkRegex = /\[([^\]]+)\]\([^)]+\)/g;
    let linkMatch: RegExpExecArray | null;
    while ((linkMatch = linkRegex.exec(text)) !== null) {
      const fullStart = linkMatch.index;
      const labelStart = fullStart + 1;
      const labelEnd = labelStart + linkMatch[1].length;
      const fullEnd = fullStart + linkMatch[0].length;
      for (let i = fullStart; i < labelStart; i++) {
        skip[i] = 1;
      }
      for (let i = labelEnd; i < fullEnd; i++) {
        skip[i] = 1;
      }
    }

    // Skip inline formatting delimiters (**, __, ~~, `) and single * / _
    markSkipRegex(/(\*\*|__|~~|`)/g);
    markSkipRegex(/(?<=^|[\s(])[*_](?=\S)|(?<=\S)[*_](?=[\s).,!?:;]|$)/gm);

    const chars: string[] = [];
    const offsets: number[] = [];
    let lastWasSpace = true; // Trim leading whitespace

    for (let i = 0; i < text.length; i++) {
      if (skip[i]) {
        continue;
      }
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

    // Trim trailing whitespace
    if (chars.length > 0 && chars[chars.length - 1] === ' ') {
      chars.pop();
      offsets.pop();
    }

    return {
      value: chars.join(''),
      offsets
    };
  }

  /**
   * Main 3-tier anchor resolution algorithm:
   * 1. Exact match in searchable text
   * 2. Normalized markdown match (preserving offsets)
   * 3. Case-insensitive / whitespace-normalized fallback
   */
  public static locateAnchor(
    fullText: string,
    queryText: string,
    commentBlockStart = -1
  ): AnchorMatchResult | null {
    const cleanedSearch = this.cleanSearchText(queryText);
    if (!cleanedSearch) {
      return null;
    }

    // Isolate searchable text (ignoring comment block at end)
    let searchableText = fullText;
    let removedLength = 0;
    if (commentBlockStart !== -1) {
      searchableText = fullText.substring(0, commentBlockStart);
      removedLength = fullText.length - commentBlockStart;
    }

    const toOriginalOffset = (searchableOffset: number): number => {
      if (commentBlockStart !== -1 && removedLength > 0 && searchableOffset >= commentBlockStart) {
        return searchableOffset + removedLength;
      }
      return searchableOffset;
    };

    // 1. Tier 1: Exact substring match
    const exactIndex = searchableText.indexOf(cleanedSearch);
    if (exactIndex !== -1) {
      const origExact = toOriginalOffset(exactIndex);
      const startPos = this.offsetToPosition(fullText, origExact);
      const endPos = this.offsetToPosition(fullText, origExact + cleanedSearch.length);
      return {
        startOffset: origExact,
        endOffset: origExact + cleanedSearch.length,
        matchedText: fullText.substring(origExact, origExact + cleanedSearch.length),
        startLine: startPos.line,
        startChar: startPos.character,
        endLine: endPos.line,
        endChar: endPos.character
      };
    }

    // 2. Tier 2: Character-offset preserving normalized markdown matching
    const normDoc = this.buildNormalizedMarkdownMap(searchableText);
    const normQuery = this.buildNormalizedMarkdownMap(cleanedSearch).value;

    if (!normQuery || normDoc.offsets.length === 0) {
      return null;
    }

    let normIndex = normDoc.value.indexOf(normQuery);
    if (normIndex === -1) {
      // Try case-insensitive
      normIndex = normDoc.value.toLowerCase().indexOf(normQuery.toLowerCase());
    }

    if (normIndex !== -1) {
      let origStart = toOriginalOffset(normDoc.offsets[normIndex]);
      let origEnd = toOriginalOffset(normDoc.offsets[normIndex + normQuery.length - 1] + 1);

      // Invariant: Expands normalized match boundaries to encompass formatting markers if query included them.
      // Why: Ensures symmetrical anchor coordinate recovery for bold (**), italic (*, _), and quoted (`) tokens.
      // Example: Query "**bold**" matching normalized "bold" expands offsets to cover "**bold**".
      if (cleanedSearch.startsWith('**') && cleanedSearch.endsWith('**')) {
        if (origStart >= 2 && fullText.substring(origStart - 2, origStart) === '**') {
          origStart -= 2;
        }
        if (origEnd + 2 <= fullText.length && fullText.substring(origEnd, origEnd + 2) === '**') {
          origEnd += 2;
        }
      } else if (cleanedSearch.startsWith('`') && cleanedSearch.endsWith('`')) {
        if (origStart >= 1 && fullText[origStart - 1] === '`') {
          origStart -= 1;
        }
        if (origEnd < fullText.length && fullText[origEnd] === '`') {
          origEnd += 1;
        }
      } else if (cleanedSearch.startsWith('__') && cleanedSearch.endsWith('__')) {
        if (origStart >= 2 && fullText.substring(origStart - 2, origStart) === '__') {
          origStart -= 2;
        }
        if (origEnd + 2 <= fullText.length && fullText.substring(origEnd, origEnd + 2) === '__') {
          origEnd += 2;
        }
      }

      // Balance any open Markdown formatting delimiters (e.g. **, `, *)
      const hasUnbalancedDelimiter = (slice: string, ch: string): boolean => {
        let count = 0;
        for (let i = 0; i < slice.length; i++) {
          if (slice[i] === ch) {
            count++;
          }
        }
        return count % 2 === 1;
      };

      while (
        origEnd < fullText.length &&
        /[*_~`]/.test(fullText[origEnd]) &&
        hasUnbalancedDelimiter(fullText.substring(origStart, origEnd), fullText[origEnd])
      ) {
        origEnd++;
      }

      const matchedRaw = fullText.substring(origStart, origEnd);
      const startPos = this.offsetToPosition(fullText, origStart);
      const endPos = this.offsetToPosition(fullText, origEnd);

      return {
        startOffset: origStart,
        endOffset: origEnd,
        matchedText: matchedRaw,
        startLine: startPos.line,
        startChar: startPos.character,
        endLine: endPos.line,
        endChar: endPos.character
      };
    }

    return null;
  }
}
