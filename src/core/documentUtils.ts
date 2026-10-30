import * as vscode from 'vscode';

export const SUPPORTED_COMMENT_EXTENSIONS = [
  '.md',
  '.markdown',
  '.mdown',
  '.mkdn',
  '.mkd',
  '.skill',
  '.txt',
  '.text',
  '.log'
];

// Invariant: Checks whether the given language ID is supported by OmniComment.
// Why: Enables universal commenting across Markdown, plain text (.txt), SKILL, and log files.
// Example: isSupportedCommentLanguage('plaintext') => true, isSupportedCommentLanguage('python') => false.
export function isSupportedCommentLanguage(languageId?: string): boolean {
  if (!languageId) {
    return false;
  }
  return (
    languageId === 'markdown' ||
    languageId === 'skill' ||
    languageId === 'plaintext' ||
    languageId === 'text' ||
    languageId === 'log'
  );
}

// Invariant: Checks whether the given URI has an extension supported by OmniComment.
// Why: Fallback matching for files opened without an explicit language association (e.g. ad-hoc .log or .txt).
// Example: isSupportedCommentUri(vscode.Uri.file('/tmp/app.log')) => true.
export function isSupportedCommentUri(uri?: vscode.Uri): boolean {
  if (!uri) {
    return false;
  }
  if (uri.scheme !== 'file' && uri.scheme !== 'untitled' && uri.scheme !== 'vscode-vfs') {
    return false;
  }
  const lowerPath = uri.path.toLowerCase();
  return SUPPORTED_COMMENT_EXTENSIONS.some(ext => lowerPath.endsWith(ext));
}

// Invariant: Returns true if the document is supported either by languageId or by file extension.
// Why: Unifies document eligibility checks across decorators, providers, status bar, and commands.
// Example: isSupportedCommentDocument(textDocument) => true for notes.txt or report.md.
export function isSupportedCommentDocument(document?: vscode.TextDocument): boolean {
  if (!document) {
    return false;
  }
  return isSupportedCommentLanguage(document.languageId) || isSupportedCommentUri(document.uri);
}
