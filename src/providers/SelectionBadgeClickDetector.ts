import * as vscode from 'vscode';
import { isSupportedCommentDocument } from '../types';

interface BadgeAnchor {
  documentUri: string;
  selection: vscode.Range;
}

// Invariant: A mouse event that collapses the previous selection to exactly its end is a badge click.
// Why: The "💬 Comment" badge is an `after` decoration; VS Code gives no click event for it, but
//      clicking it places the caret at the decoration's anchor (= the previous selection end).
// Example: select (2,0)-(2,5) -> click badge -> Mouse event, caret (2,5) => badge click.
export function isSelectionBadgeClick(
  anchor: BadgeAnchor | undefined,
  documentUri: string,
  kind: vscode.TextEditorSelectionChangeKind | undefined,
  selections: readonly vscode.Selection[]
): boolean {
  if (!anchor || anchor.documentUri !== documentUri) {
    return false;
  }
  if (kind !== vscode.TextEditorSelectionChangeKind.Mouse || selections.length !== 1) {
    return false;
  }
  const caret = selections[0];
  return caret.isEmpty && caret.active.isEqual(anchor.selection.end);
}

// Invariant: Remembers the last commentable selection so a following badge click can recover it.
// Why: The click itself collapses the selection, so the range must be captured beforehand.
// Example: handle(select "bravo") -> undefined; handle(click badge) -> Range of "bravo".
export class SelectionBadgeClickDetector {
  private anchor: BadgeAnchor | undefined;

  handle(
    document: vscode.TextDocument,
    kind: vscode.TextEditorSelectionChangeKind | undefined,
    selections: readonly vscode.Selection[]
  ): vscode.Range | undefined {
    const documentUri = document.uri.toString();
    if (isSelectionBadgeClick(this.anchor, documentUri, kind, selections)) {
      const clicked = this.anchor!.selection;
      this.anchor = undefined;
      return clicked;
    }
    this.anchor = this.toAnchor(document, selections);
    return undefined;
  }

  private toAnchor(
    document: vscode.TextDocument,
    selections: readonly vscode.Selection[]
  ): BadgeAnchor | undefined {
    if (selections.length !== 1 || selections[0].isEmpty || !isSupportedCommentDocument(document)) {
      return undefined;
    }
    if (!document.getText(selections[0]).trim()) {
      return undefined;
    }
    return {
      documentUri: document.uri.toString(),
      selection: new vscode.Range(selections[0].start, selections[0].end)
    };
  }
}
