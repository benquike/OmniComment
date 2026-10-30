import * as vscode from 'vscode';
import { isSupportedCommentDocument } from '../types';

const SELECTION_SETTLE_DELAY_MS = 250;
const PREVIEW_MAX_LENGTH = 30;

interface ActiveSelectionTarget {
  documentUri: string;
  range: vscode.Range;
  selectedText: string;
}

// Invariant: A selection is commentable only when it is non-empty, non-whitespace, in a supported document.
// Why: Prevents showing a clickable "Add Comment" lens for caret moves or unsupported files (e.g. .ts).
// Example: selecting "Line 2" in notes.txt => true; caret at (1,0) => false.
export function isCommentableSelection(editor: vscode.TextEditor | undefined): editor is vscode.TextEditor {
  if (!editor || editor.selection.isEmpty) {
    return false;
  }
  if (!isSupportedCommentDocument(editor.document)) {
    return false;
  }
  return editor.document.getText(editor.selection).trim().length > 0;
}

// Invariant: Renders a clickable "💬 Add Comment" CodeLens above the active text selection.
// Why: VS Code never delivers click events for decoration gutter icons, so the gutter bubble
//      alone is not clickable in TextEditor modes (.txt/.log/.md source); a CodeLens is.
// Example: select "connection pool" on line 4 -> lens "💬 Add Comment on "connection pool"" above line 4.
export class SelectionCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses = this._onDidChange.event;
  private _target: ActiveSelectionTarget | undefined;
  private _settleTimer: ReturnType<typeof setTimeout> | undefined;

  // Invariant: Lens appears only after the selection settles; it disappears immediately on deselect.
  // Why: Inserting a lens view-zone during a mouse drag would shift lines under the cursor.
  // Example: drag-select (events every ~16ms) -> one lens 250ms after mouse-up.
  public onSelectionChanged(editor: vscode.TextEditor | undefined): void {
    if (this._settleTimer) {
      clearTimeout(this._settleTimer);
      this._settleTimer = undefined;
    }
    if (!isCommentableSelection(editor)) {
      this.setTarget(undefined);
      return;
    }
    this._settleTimer = setTimeout(() => {
      this._settleTimer = undefined;
      this.setTarget({
        documentUri: editor.document.uri.toString(),
        range: new vscode.Range(editor.selection.start, editor.selection.end),
        selectedText: editor.document.getText(editor.selection)
      });
    }, SELECTION_SETTLE_DELAY_MS);
  }

  // Invariant: Exposes the current lens target for tests without waiting on timers.
  // Why: Lets e2e tests assert the lens is produced for a .txt selection deterministically.
  // Example: provider.setTargetForTesting(editor) -> provideCodeLenses returns 1 lens.
  public setTargetForTesting(editor: vscode.TextEditor): void {
    if (!isCommentableSelection(editor)) {
      this.setTarget(undefined);
      return;
    }
    this.setTarget({
      documentUri: editor.document.uri.toString(),
      range: new vscode.Range(editor.selection.start, editor.selection.end),
      selectedText: editor.document.getText(editor.selection)
    });
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const target = this._target;
    if (!target || target.documentUri !== document.uri.toString()) {
      return [];
    }
    if (!vscode.workspace.getConfiguration('omnicomment').get<boolean>('selectionCodeLens', true)) {
      return [];
    }
    const trimmed = target.selectedText.trim().replace(/\s+/g, ' ');
    const preview =
      trimmed.length > PREVIEW_MAX_LENGTH ? `${trimmed.slice(0, PREVIEW_MAX_LENGTH - 3)}...` : trimmed;
    const lensRange = new vscode.Range(target.range.start.line, 0, target.range.start.line, 0);
    return [
      new vscode.CodeLens(lensRange, {
        title: `💬 Add Comment on "${preview}"  (Ctrl+Shift+M)`,
        tooltip: 'Add an OmniComment on the selected text',
        command: 'omnicomment.addComment',
        arguments: [
          { uri: document.uri, selectedText: target.selectedText, range: target.range }
        ]
      })
    ];
  }

  private setTarget(target: ActiveSelectionTarget | undefined): void {
    if (!target && !this._target) {
      return;
    }
    this._target = target;
    this._onDidChange.fire();
  }

  dispose(): void {
    if (this._settleTimer) {
      clearTimeout(this._settleTimer);
    }
    this._onDidChange.dispose();
  }
}
