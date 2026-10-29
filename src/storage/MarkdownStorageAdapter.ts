import { Comment, CommentData } from '../core/types';
import { IStorageAdapter } from './IStorageAdapter';

export const OMNI_COMMENT_MARKER = '<!-- omnicomment';
export const LEGACY_MARKCO_MARKER = '<!-- markco-comments';
export const LEGACY_MARKCO_SHORT_MARKER = '<!-- markco';
export const COMMENT_BLOCK_END = '-->';
export const CURRENT_SCHEMA_VERSION = 2;

export interface CommentBlockLocation {
  index: number;
  marker: string;
}

export class MarkdownStorageAdapter implements IStorageAdapter {
  public readonly name = 'markdown-in-file';

  /**
   * Replace --> with safe placeholder so it does not break the HTML comment
   */
  public static sanitizeForStorage(text: string): string {
    return text.replace(/-->/g, '--\u200B>');
  }

  /**
   * Restore safe placeholder back to -->
   */
  public static restoreFromStorage(text: string): string {
    return text.replace(/--\u200B>/g, '-->');
  }

  /**
   * Checks if an index in text is inside code fences (```) or inline code (`)
   */
  public static isInsideCodeContext(text: string, position: number): boolean {
    const beforeText = text.substring(0, position);
    const fenceMatches = beforeText.match(/```/g);
    if (fenceMatches !== null && fenceMatches.length % 2 === 1) {
      return true;
    }

    if (position > 0 && text[position - 1] === '`') {
      if (!(position >= 3 && text.substring(position - 3, position) === '```')) {
        return true;
      }
    }

    const lastBacktickIndex = beforeText.lastIndexOf('`');
    if (lastBacktickIndex !== -1) {
      const isCodeFenceBacktick = beforeText.substring(lastBacktickIndex).startsWith('```');
      if (!isCodeFenceBacktick) {
        const lineStart = beforeText.lastIndexOf('\n', lastBacktickIndex) + 1;
        const lineEnd = text.indexOf('\n', position);
        const line = text.substring(lineStart, lineEnd === -1 ? text.length : lineEnd);
        const positionInLine = position - lineStart;

        const beforeInLine = line.substring(0, positionInLine);
        const afterInLine = line.substring(positionInLine);
        const backticksBeforeInLine = (beforeInLine.match(/(?<!`)`(?!`)/g) || []).length;
        const backticksAfterInLine = (afterInLine.match(/(?<!`)`(?!`)/g) || []).length;

        if (backticksBeforeInLine % 2 === 1 && backticksAfterInLine > 0) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Finds the actual comment block position, searching backwards from the end of the text.
   * Recognizes modern `<!-- omnicomment` and legacy `<!-- markco-comments` / `<!-- markco`.
   */
  public static findCommentBlock(text: string): CommentBlockLocation | null {
    // Invariant: Comments may be stored using modern or legacy HTML comment delimiters.
    // Why: Preserves backwards compatibility for existing documents created by older extensions.
    // Example: <!-- omnicomment\n{...}\n--> or <!-- markco-comments\n{...}\n-->
    const markers = [OMNI_COMMENT_MARKER, LEGACY_MARKCO_MARKER, LEGACY_MARKCO_SHORT_MARKER];
    let latestIndex = -1;
    let latestMarker = '';

    for (const marker of markers) {
      let searchStart = text.length;
      while (searchStart > 0) {
        const index = text.lastIndexOf(marker, searchStart - 1);
        if (index === -1) {
          break;
        }
        if (!this.isInsideCodeContext(text, index)) {
          const endIndex = text.indexOf(COMMENT_BLOCK_END, index + marker.length);
          if (endIndex !== -1) {
            const jsonText = text.substring(index + marker.length, endIndex).trim();
            if (jsonText.startsWith('{') && index > latestIndex) {
              latestIndex = index;
              latestMarker = marker;
              break;
            }
          }
        }
        searchStart = index;
      }
    }

    if (latestIndex === -1) {
      return null;
    }
    return { index: latestIndex, marker: latestMarker };
  }

  /**
   * Parse comments from markdown raw text
   */
  public parseCommentsFromText(text: string): Comment[] {
    const loc = MarkdownStorageAdapter.findCommentBlock(text);
    if (!loc) {
      return [];
    }

    const endIndex = text.indexOf(COMMENT_BLOCK_END, loc.index);
    if (endIndex === -1) {
      return [];
    }

    const jsonStart = loc.index + loc.marker.length;
    const jsonText = text.substring(jsonStart, endIndex).trim();

    if (!jsonText.startsWith('{')) {
      return [];
    }

    try {
      const data: CommentData = JSON.parse(jsonText);
      return (data.comments || []).map(c => ({
        ...c,
        anchor: {
          ...c.anchor,
          text: MarkdownStorageAdapter.restoreFromStorage(c.anchor.text)
        },
        content: MarkdownStorageAdapter.restoreFromStorage(c.content),
        replies: c.replies?.map(r => ({
          ...r,
          content: MarkdownStorageAdapter.restoreFromStorage(r.content)
        }))
      }));
    } catch {
      return [];
    }
  }

  /**
   * Serializes comments into an HTML comment block and returns the updated document text
   */
  public formatUpdatedText(originalText: string, comments: Comment[]): string {
    const sanitizedComments = comments.map(c => ({
      ...c,
      anchor: {
        ...c.anchor,
        text: MarkdownStorageAdapter.sanitizeForStorage(c.anchor.text)
      },
      content: MarkdownStorageAdapter.sanitizeForStorage(c.content),
      replies: c.replies?.map(r => ({
        ...r,
        content: MarkdownStorageAdapter.sanitizeForStorage(r.content)
      }))
    }));

    const data: CommentData = {
      version: CURRENT_SCHEMA_VERSION,
      comments: sanitizedComments
    };

    const loc = MarkdownStorageAdapter.findCommentBlock(originalText);
    // If original already used a marker, preserve it; otherwise default to <!-- omnicomment
    const activeMarker = loc ? loc.marker : OMNI_COMMENT_MARKER;
    const jsonBlock = `${activeMarker}\n${JSON.stringify(data, null, 2)}\n${COMMENT_BLOCK_END}`;

    if (!loc) {
      // Append at end
      return originalText.trimEnd() + '\n\n' + jsonBlock + '\n';
    }

    const endIndex = originalText.indexOf(COMMENT_BLOCK_END, loc.index);
    if (endIndex === -1) {
      return originalText.trimEnd() + '\n\n' + jsonBlock + '\n';
    }

    const before = originalText.substring(0, loc.index);
    const after = originalText.substring(endIndex + COMMENT_BLOCK_END.length);
    return before + jsonBlock + after;
  }

  public async loadComments(uri: string, rawContent = ''): Promise<Comment[]> {
    return this.parseCommentsFromText(rawContent);
  }

  public async saveComments(
    uri: string,
    comments: Comment[],
    rawContent = ''
  ): Promise<{ success: boolean; updatedContent?: string }> {
    const updated = this.formatUpdatedText(rawContent, comments);
    return { success: true, updatedContent: updated };
  }
}
