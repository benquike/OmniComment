import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import * as Mocha from 'mocha';
import {
  getActiveMarkdownContext,
  getCommentServiceForTesting,
  getInlineCommentControllerForTesting,
  resolveAnchorSelectionForThread
} from '../../extension';
import { CommentCodeActionProvider } from '../../providers/CommentCodeActionProvider';

const suite = Mocha.suite;
const test = Mocha.test;
const suiteSetup = Mocha.suiteSetup;
const teardown = Mocha.teardown;

async function waitForCondition(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 8000,
  intervalMs = 50
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
}

suite('Plain Text (.txt) Mode End-to-End Test Suite', () => {
  let tempDir: string;

  suiteSetup(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnicomment-txt-test-'));
    const initDoc = await vscode.workspace.openTextDocument({
      language: 'plaintext',
      content: 'Initializing Plain Text Mode Tests\n'
    });
    await vscode.window.showTextDocument(initDoc);
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  // Topology: .txt file -> openTextDocument -> verify plaintext languageId -> getActiveMarkdownContext
  // Expected: Document opens with languageId 'plaintext' and resolves successfully in getActiveMarkdownContext.
  test('Txt 1: Plain text document resolution and language verification', async () => {
    const filePath = path.join(tempDir, 'project-spec.txt');
    fs.writeFileSync(
      filePath,
      'Project Specification Notes\n\nSection 1: Architecture Overview and System Goals.\n',
      'utf-8'
    );
    const fileUri = vscode.Uri.file(filePath);
    const document = await vscode.workspace.openTextDocument(fileUri);
    const editor = await vscode.window.showTextDocument(document);

    assert.strictEqual(document.languageId, 'plaintext');
    const ctx = await getActiveMarkdownContext(fileUri);
    assert.ok(ctx, 'Plain text (.txt) document must resolve in getActiveMarkdownContext');
    assert.strictEqual(ctx?.document.uri.fsPath, fileUri.fsPath);
    assert.ok(ctx?.editor, 'Standard text editor instance should be attached');
  });

  // Topology: Text selection in .txt editor -> omnicomment.editorCommentAction(addComment) -> verify storage block
  // Expected: Comment persists in comment block appended at the end of the .txt file with valid JSON.
  test('Txt 2: Add comment on selected phrase in .txt document and verify file storage', async () => {
    const filePath = path.join(tempDir, 'requirements.txt');
    fs.writeFileSync(
      filePath,
      'System Requirements\n\nHigh throughput and low latency are critical requirements.\n',
      'utf-8'
    );
    const fileUri = vscode.Uri.file(filePath);
    const document = await vscode.workspace.openTextDocument(fileUri);
    const editor = await vscode.window.showTextDocument(document);

    const targetPhrase = 'critical requirements';
    const lineIndex = 2;
    const startChar = document.lineAt(lineIndex).text.indexOf(targetPhrase);
    assert.ok(startChar !== -1);
    editor.selection = new vscode.Selection(
      new vscode.Position(lineIndex, startChar),
      new vscode.Position(lineIndex, startChar + targetPhrase.length)
    );

    const commentBody = 'Need quantified SLA targets here (p99 latency < 10ms)';
    await vscode.commands.executeCommand('omnicomment.editorCommentAction', {
      type: 'addComment',
      uri: fileUri,
      anchorText: targetPhrase,
      content: commentBody
    });

    const commentService = getCommentServiceForTesting();
    await waitForCondition(() => {
      const comments = commentService.parseComments(document);
      return comments.length === 1;
    });

    const comments = commentService.parseComments(document);
    assert.strictEqual(comments.length, 1);
    assert.strictEqual(comments[0].anchor.text, targetPhrase);
    assert.strictEqual(comments[0].content, commentBody);

    // Verify comment block format in the actual text document
    const rawFileContent = document.getText();
    assert.ok(rawFileContent.includes('<!-- omnicomment'), 'Comment block must be stored in .txt file');
    assert.ok(rawFileContent.includes('quantified SLA targets'), 'Comment content must be serialized');
  });

  // Topology: Active comment on .txt -> omnicomment.editorCommentAction(reply) -> omnicomment.editorCommentAction(resolve)
  // Expected: Reply appended to comment thread; thread status transitions to resolved.
  test('Txt 3: Reply to comment and resolve thread in .txt document', async () => {
    const filePath = path.join(tempDir, 'action-items.txt');
    fs.writeFileSync(
      filePath,
      'Weekly Action Items\n\nReview pull requests by Friday afternoon.\n',
      'utf-8'
    );
    const fileUri = vscode.Uri.file(filePath);
    const document = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(document);

    const anchorPhrase = 'Friday afternoon';
    await vscode.commands.executeCommand('omnicomment.editorCommentAction', {
      type: 'addComment',
      uri: fileUri,
      anchorText: anchorPhrase,
      content: 'Can we move deadline to Thursday noon?'
    });

    const commentService = getCommentServiceForTesting();
    await waitForCondition(() => commentService.parseComments(document).length === 1);
    let comments = commentService.parseComments(document);
    const commentId = comments[0].id;

    // Add reply
    await vscode.commands.executeCommand('omnicomment.editorCommentAction', {
      type: 'addReply',
      uri: fileUri,
      commentId,
      content: 'Agreed, updating team schedule.'
    });

    await waitForCondition(() => {
      const updated = commentService.getComments(document);
      return Boolean(updated[0]?.replies && updated[0].replies.length === 1);
    });

    comments = commentService.getComments(document);
    assert.strictEqual(comments[0].replies?.length, 1);
    assert.strictEqual(comments[0].replies[0].content, 'Agreed, updating team schedule.');

    // Toggle resolve
    await vscode.commands.executeCommand('omnicomment.editorCommentAction', {
      type: 'resolveComment',
      uri: fileUri,
      commentId
    });

    await waitForCondition(() => {
      const resolvedList = commentService.getComments(document);
      return resolvedList[0]?.resolved === true;
    });

    comments = commentService.getComments(document);
    assert.strictEqual(comments[0].resolved, true);
  });

  // Topology: Document selection in .txt editor -> CommentCodeActionProvider.provideCodeActions -> Quick Action
  // Expected: CodeActionProvider produces Refactor action titled '💬 Add OmniComment on "..."'.
  test('Txt 4: Code Action Provider supplies quick fix action on .txt text selection', async () => {
    const filePath = path.join(tempDir, 'plain-notes.txt');
    fs.writeFileSync(filePath, 'Important configuration setting: MAX_RETRIES=5\n', 'utf-8');
    const fileUri = vscode.Uri.file(filePath);
    const document = await vscode.workspace.openTextDocument(fileUri);

    const provider = new CommentCodeActionProvider();
    const selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 31));
    const actions = provider.provideCodeActions(
      document,
      selection,
      { diagnostics: [], triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined },
      new vscode.CancellationTokenSource().token
    );

    assert.ok(actions.length > 0, 'Must provide code action on plain text selection');
    const action = actions[0] as vscode.CodeAction;
    assert.ok(action.title.includes('Add OmniComment'), 'Action title must mention OmniComment');
    assert.strictEqual(action.command?.command, 'omnicomment.addComment');
  });

  // Topology: Inline comment controller on .txt -> verify thread count -> delete comment -> verify thread disposed
  // Expected: Inline controller thread is created for .txt document and cleaned up upon deletion.
  test('Txt 5: Inline thread lifecycle and comment deletion in .txt document', async () => {
    const filePath = path.join(tempDir, 'delete-test.txt');
    fs.writeFileSync(filePath, 'Draft document subject to immediate removal.\n', 'utf-8');
    const fileUri = vscode.Uri.file(filePath);
    const document = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(document);

    const phrase = 'immediate removal';
    await vscode.commands.executeCommand('omnicomment.editorCommentAction', {
      type: 'addComment',
      uri: fileUri,
      anchorText: phrase,
      content: 'Flagged for deprecation'
    });

    const commentService = getCommentServiceForTesting();
    await waitForCondition(() => commentService.parseComments(document).length === 1);

    const inlineController = getInlineCommentControllerForTesting();
    assert.strictEqual(inlineController.getThreadCount(fileUri), 1);

    const commentId = commentService.parseComments(document)[0].id;
    await vscode.commands.executeCommand('omnicomment.editorCommentAction', {
      type: 'deleteComment',
      uri: fileUri,
      commentId
    });

    await waitForCondition(() => commentService.parseComments(document).length === 0);
    assert.strictEqual(inlineController.getThreadCount(fileUri), 0);
  });

  // Topology: xxx.log file -> openTextDocument -> text selection -> addComment -> reply -> resolve
  // Expected: xxx.log document resolves in getActiveMarkdownContext, comment persists in comment block, inline thread created.
  test('Log 1: Log file (xxx.log) full commenting lifecycle, action provider, and thread verification', async () => {
    const filePath = path.join(tempDir, 'xxx.log');
    fs.writeFileSync(
      filePath,
      '2026-10-29 15:48:00 [INFO] Starting telemetry service on port 9090\n' +
      '2026-10-29 15:48:01 [WARN] Slow database query detected: duration=450ms\n' +
      '2026-10-29 15:48:02 [ERROR] Fatal database connection error: connection pool exhausted\n',
      'utf-8'
    );
    const fileUri = vscode.Uri.file(filePath);
    const document = await vscode.workspace.openTextDocument(fileUri);
    const editor = await vscode.window.showTextDocument(document);

    const ctx = await getActiveMarkdownContext(fileUri);
    assert.ok(ctx, 'Log file (xxx.log) must resolve in getActiveMarkdownContext');
    assert.strictEqual(ctx?.document.uri.fsPath, fileUri.fsPath);

    // CodeAction verification on xxx.log
    const provider = new CommentCodeActionProvider();
    const targetPhrase = 'connection pool exhausted';
    const lineIndex = 2;
    const startChar = document.lineAt(lineIndex).text.indexOf(targetPhrase);
    assert.ok(startChar !== -1);
    const selection = new vscode.Selection(
      new vscode.Position(lineIndex, startChar),
      new vscode.Position(lineIndex, startChar + targetPhrase.length)
    );
    editor.selection = selection;

    const actions = provider.provideCodeActions(
      document,
      selection,
      { diagnostics: [], triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined },
      new vscode.CancellationTokenSource().token
    );
    assert.ok(actions.length > 0, 'CodeActionProvider must provide action for xxx.log selection');
    const firstAction = actions[0] as vscode.CodeAction;
    assert.ok(firstAction.title.includes('Add OmniComment'));

    // Submit comment on log line
    const commentBody = 'Root cause: Max connections set too low (size: 10). Increase to 50.';
    await vscode.commands.executeCommand('omnicomment.editorCommentAction', {
      type: 'addComment',
      uri: fileUri,
      anchorText: targetPhrase,
      content: commentBody
    });

    const commentService = getCommentServiceForTesting();
    await waitForCondition(() => commentService.parseComments(document).length === 1);

    const comments = commentService.parseComments(document);
    assert.strictEqual(comments.length, 1);
    assert.strictEqual(comments[0].anchor.text, targetPhrase);
    assert.strictEqual(comments[0].content, commentBody);

    // Verify inline controller thread
    const inlineController = getInlineCommentControllerForTesting();
    assert.strictEqual(inlineController.getThreadCount(fileUri), 1);

    // Reply to log comment
    const commentId = comments[0].id;
    await vscode.commands.executeCommand('omnicomment.editorCommentAction', {
      type: 'addReply',
      uri: fileUri,
      commentId,
      content: 'Config patch applied in staging.'
    });

    await waitForCondition(() => {
      const updated = commentService.getComments(document);
      return Boolean(updated[0]?.replies && updated[0].replies.length === 1);
    });

    // Resolve log comment
    await vscode.commands.executeCommand('omnicomment.editorCommentAction', {
      type: 'resolveComment',
      uri: fileUri,
      commentId
    });

    await waitForCondition(() => {
      const resolvedList = commentService.getComments(document);
      return resolvedList[0]?.resolved === true;
    });

    assert.strictEqual(commentService.getComments(document)[0].resolved, true);

    // Verify file content contains comment block
    const rawLog = document.getText();
    assert.ok(rawLog.includes('<!-- omnicomment'), 'Comment block must be stored in xxx.log');
    assert.ok(rawLog.includes('connection pool exhausted'), 'Anchor must be present');
  });
});
