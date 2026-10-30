import * as path from 'path';
import * as vscode from 'vscode';
import { AnchorEngine } from '../core/AnchorEngine';
import { Comment, isSupportedCommentDocument } from '../types';

/**
 * Manages text decorations for comment highlights in the editor
 */
export class CommentDecorator {
  private decorationType: vscode.TextEditorDecorationType;
  private focusedDecorationType: vscode.TextEditorDecorationType;
  private selectionGutterDecorationType: vscode.TextEditorDecorationType;
  private focusedCommentId: string | null = null;
  private gutterIconUri?: vscode.Uri;

  constructor(extensionUri?: vscode.Uri) {
    if (extensionUri) {
      this.gutterIconUri = vscode.Uri.joinPath(extensionUri, 'media', 'comment-gutter.svg');
    } else {
      this.gutterIconUri = vscode.Uri.file(
        path.join(__dirname, '..', '..', 'media', 'comment-gutter.svg')
      );
    }
    this.decorationType = this.createDecorationType(false);
    this.focusedDecorationType = this.createDecorationType(true);

    const iconPath =
      this.gutterIconUri?.scheme === 'file'
        ? this.gutterIconUri.fsPath
        : this.gutterIconUri;

    this.selectionGutterDecorationType = vscode.window.createTextEditorDecorationType({
      gutterIconPath: iconPath,
      gutterIconSize: 'contain',
      cursor: 'pointer',
      after: {
        contentText: ' 💬 Add Comment (Ctrl+Shift+M)',
        color: '#ffffff',
        backgroundColor: '#f59e0b',
        fontWeight: 'bold',
        margin: '0 0 0 8px'
      }
    });
  }

  // Invariant: Configures editor decoration styles including yellow background and gutter comment icon.
  // Why: Provides immediate visual indication on both the text range and the editor gutter line.
  // Example: creates decoration with rgba(255, 212, 0, 0.3) background and comment-gutter.svg icon.
  private createDecorationType(isFocused: boolean): vscode.TextEditorDecorationType {
    const omniConfig = vscode.workspace.getConfiguration('omnicomment');
    const baseColor = omniConfig.get<string>('highlightColor', 'rgba(255, 212, 0, 0.3)');
    const borderColor = omniConfig.get<string>('highlightBorderColor', 'rgba(255, 212, 0, 0.8)');

    return vscode.window.createTextEditorDecorationType({
      backgroundColor: isFocused ? 'rgba(255, 212, 0, 0.5)' : baseColor,
      borderRadius: '3px',
      border: `1px solid ${borderColor}`,
      gutterIconPath: this.gutterIconUri,
      gutterIconSize: 'contain',
      overviewRulerColor: borderColor,
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      cursor: 'pointer',
      ...(isFocused && {
        fontWeight: 'bold'
      })
    });
  }

  /**
   * Apply decorations for all comments in the editor
   */
  applyDecorations(editor: vscode.TextEditor, comments: Comment[]): void {
    const normalRanges: vscode.DecorationOptions[] = [];
    const focusedRanges: vscode.DecorationOptions[] = [];

    for (const comment of comments) {
      // Skip resolved or orphaned comments - they should not be highlighted
      if (comment.resolved || comment.orphaned) {
        continue;
      }

      const range = this.getCommentRange(editor.document, comment);
      if (!range) {
        continue;
      }

      const hoverMd = new vscode.MarkdownString(
        `💬 **@${comment.author}** · *${comment.createdAt.slice(0, 10)}*\n\n${comment.content}\n\n---\n[$(comment-discussion) Open Comment Thread](command:omnicomment.navigateToComment?${encodeURIComponent(JSON.stringify([comment.id]))})`,
        true
      );
      hoverMd.isTrusted = true;

      const decorationOptions: vscode.DecorationOptions = {
        range,
        hoverMessage: hoverMd
      };

      if (comment.id === this.focusedCommentId) {
        focusedRanges.push(decorationOptions);
      } else {
        normalRanges.push(decorationOptions);
      }
    }

    editor.setDecorations(this.decorationType, normalRanges);
    editor.setDecorations(this.focusedDecorationType, focusedRanges);
  }

  /**
   * Clear all decorations from the editor
   */
  clearDecorations(editor: vscode.TextEditor): void {
    editor.setDecorations(this.decorationType, []);
    editor.setDecorations(this.focusedDecorationType, []);
  }

  /**
   * Set the focused comment for highlighting
   */
  setFocusedComment(commentId: string | null): void {
    this.focusedCommentId = commentId;
  }

  /**
   * Get the focused comment ID
   */
  getFocusedCommentId(): string | null {
    return this.focusedCommentId;
  }

  /**
   * Get the range for a comment in the document
   */
  private getCommentRange(document: vscode.TextDocument, comment: Comment): vscode.Range | null {
    const anchor = comment.anchor;

    // Handle both old format (line) and new format (startLine/endLine)
    const startLine = 'startLine' in anchor ? anchor.startLine : (anchor as any).line;
    const endLine = 'endLine' in anchor ? anchor.endLine : (anchor as any).line;

    // Validate line numbers
    if (startLine < 0 || startLine >= document.lineCount) {
      return null;
    }
    if (endLine < 0 || endLine >= document.lineCount) {
      return null;
    }

    // Create the range
    const startPos = new vscode.Position(startLine, anchor.startChar);
    const endPos = new vscode.Position(endLine, anchor.endChar);
    const range = new vscode.Range(startPos, endPos);

    // Verify the text still matches
    const textAtPosition = document.getText(range);
    if (textAtPosition === anchor.text) {
      return range;
    }

    // Text doesn't match, try to find it in the document using exact index first
    const fullText = document.getText();
    const index = fullText.indexOf(anchor.text);
    if (index !== -1) {
      const foundStart = document.positionAt(index);
      const foundEnd = document.positionAt(index + anchor.text.length);
      return new vscode.Range(foundStart, foundEnd);
    }

    // Invariant: Locates anchor range using AnchorEngine multi-tier matching when cached line coordinates drift.
    // Why: Recovers highlighting after file edits, formatting changes, or cross-editor round-trips.
    // Example: locateAnchor(fullText, "return amount * 0.15;") => Range(line 4:2 - line 4:23)
    const match = AnchorEngine.locateAnchor(fullText, anchor.text);
    if (match) {
      const foundStart = new vscode.Position(match.startLine, match.startChar);
      const foundEnd = new vscode.Position(match.endLine, match.endChar);
      return new vscode.Range(foundStart, foundEnd);
    }

    return null;
  }

  /**
   * Find which comment is at a given position (for click handling)
   */
  findCommentAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
    comments: Comment[]
  ): Comment | undefined {
    for (const comment of comments) {
      const range = this.getCommentRange(document, comment);
      if (range && range.contains(position)) {
        return comment;
      }
    }
    return undefined;
  }

  /**
   * Navigate to a comment in the editor
   */
  navigateToComment(editor: vscode.TextEditor, comment: Comment): void {
    const range = this.getCommentRange(editor.document, comment);
    if (range) {
      editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
      editor.selection = new vscode.Selection(range.start, range.end);
      this.setFocusedComment(comment.id);
    }
  }

  // Invariant: Displays the comment bubble gutter icon and inline badge on the active selection.
  // Why: Gives an immediate visual indicator in the line gutter and at cursor when text is selected.
  // Example: User highlights text on line 12 -> line 12 gutter shows comment bubble and inline 💬.
  updateSelectionDecoration(editor?: vscode.TextEditor): void {
    if (!editor) {
      return;
    }
    if (editor.document && (editor.document.languageId || editor.document.uri)) {
      if (!isSupportedCommentDocument(editor.document)) {
        editor.setDecorations(this.selectionGutterDecorationType, []);
        return;
      }
    }
    if (editor.selection.isEmpty) {
      editor.setDecorations(this.selectionGutterDecorationType, []);
      return;
    }

    const selectedText = editor.document.getText(editor.selection).trim();
    if (!selectedText) {
      editor.setDecorations(this.selectionGutterDecorationType, []);
      return;
    }

    const preview = selectedText.length > 30 ? `${selectedText.slice(0, 27)}...` : selectedText;
    const hoverMd = new vscode.MarkdownString(
      `💬 **OmniComment**: Add comment on "${preview}"\n\n[$(comment) **Click to Add Comment**](command:omnicomment.addComment) *(Ctrl+Shift+M)*`,
      true
    );
    hoverMd.isTrusted = true;

    editor.setDecorations(this.selectionGutterDecorationType, [
      {
        range: editor.selection,
        hoverMessage: hoverMd
      }
    ]);
  }

  /**
   * Dispose of decoration types
   */
  dispose(): void {
    this.decorationType.dispose();
    this.focusedDecorationType.dispose();
    this.selectionGutterDecorationType.dispose();
  }
}
