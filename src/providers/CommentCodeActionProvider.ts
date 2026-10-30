import * as vscode from 'vscode';
import { isSupportedCommentDocument, isSupportedCommentLanguage } from '../types';

// Invariant: Checks whether the given document language is supported for in-editor comments.
// Why: Allows OmniComment quick actions across all editable text and code files.
// Example: isSupportedDocumentLanguage('plaintext') => true, isSupportedDocumentLanguage('python') => true.
export function isSupportedDocumentLanguage(languageId: string): boolean {
  return isSupportedCommentLanguage(languageId);
}

// Invariant: Provides lightbulb quick actions when text is selected in standard text editors.
// Why: Provides a visual, interactive entry point for commenting equivalent to the WYSIWYG selection chip.
// Example: User highlights "architecture" in text editor -> lightbulb appears with "💬 Add OmniComment".
export class CommentCodeActionProvider implements vscode.CodeActionProvider {
  public static readonly providedCodeActionKinds = [
    vscode.CodeActionKind.QuickFix,
    vscode.CodeActionKind.Refactor
  ];

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
    context: vscode.CodeActionContext,
    token: vscode.CancellationToken
  ): vscode.CodeAction[] {
    if (!isSupportedCommentDocument(document)) {
      return [];
    }

    const selectedText = document.getText(range).trim();
    if (!selectedText) {
      return [];
    }

    let kind = vscode.CodeActionKind.QuickFix;
    if (context.only) {
      if (context.only.contains(vscode.CodeActionKind.QuickFix)) {
        kind = vscode.CodeActionKind.QuickFix;
      } else if (context.only.contains(vscode.CodeActionKind.Refactor)) {
        kind = vscode.CodeActionKind.Refactor;
      } else {
        return [];
      }
    }

    const preview =
      selectedText.length > 25 ? `${selectedText.slice(0, 22)}...` : selectedText;

    const action = new vscode.CodeAction(
      `💬 Add OmniComment on "${preview}"`,
      kind
    );
    action.command = {
      command: 'omnicomment.addComment',
      title: 'Add OmniComment',
      arguments: [{ uri: document.uri, selectedText }]
    };
    action.isPreferred = true;

    return [action];
  }
}
