import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import * as Mocha from 'mocha';
import {
  getActiveMarkdownContext,
  getCommentDecoratorForTesting,
  getCommentServiceForTesting,
  getInlineCommentControllerForTesting,
  getCommentBoxConfig,
  saveCommentBoxConfigHandler,
  resolveAnchorSelectionForThread
} from '../../extension';
import { CommentCodeActionProvider } from '../../providers/CommentCodeActionProvider';
import { OmniCommentInlineItem } from '../../providers/InlineCommentController';
import { resolveCommentBoxDimensions } from '../../core/types';

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

  // Topology: Text selection in .txt editor -> updateSelectionDecoration -> line gutter active
  // Expected: Calling updateSelectionDecoration on .txt editor with active text selection sets gutter decorations properly.
  test('Txt 6: Dynamic selection gutter icon updates on plain text selection', async () => {
    const filePath = path.join(tempDir, 'selection-gutter.txt');
    fs.writeFileSync(
      filePath,
      'Line 1: Header\nLine 2: Highlighted line for gutter bubble test\nLine 3: Footer\n',
      'utf-8'
    );
    const fileUri = vscode.Uri.file(filePath);
    const document = await vscode.workspace.openTextDocument(fileUri);
    const editor = await vscode.window.showTextDocument(document);

    // Initial empty selection -> should clear decorations without error
    editor.selection = new vscode.Selection(new vscode.Position(0, 0), new vscode.Position(0, 0));
    const decorator = getCommentDecoratorForTesting();
    decorator.updateSelectionDecoration(editor);

    // Non-empty selection on Line 2
    editor.selection = new vscode.Selection(new vscode.Position(1, 0), new vscode.Position(1, 15));
    assert.doesNotThrow(() => {
      decorator.updateSelectionDecoration(editor);
    });

    // Invariant: Verify code action provider supplies gutter/margin lightbulb action on selection
    const codeActions = await vscode.commands.executeCommand<vscode.CodeAction[]>(
      'vscode.executeCodeActionProvider',
      document.uri,
      editor.selection
    );
    assert.ok(codeActions && codeActions.length >= 1, 'CodeAction must be available on text selection in .txt editor');
    const commentAction = codeActions.find(a => a.title.includes('Add OmniComment'));
    assert.ok(commentAction, 'Must supply Add OmniComment code action on text selection');

    // Invariant: Verify configurationDefaults enable glyph margin for text modes so gutter icons are visible
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf-8')
    );
    assert.strictEqual(pkg.contributes.configurationDefaults['[plaintext]']['editor.glyphMargin'], true);
    assert.strictEqual(pkg.contributes.configurationDefaults['[markdown]']['editor.glyphMargin'], true);
    assert.strictEqual(pkg.contributes.configurationDefaults['[log]']['editor.glyphMargin'], true);
    assert.ok(
      pkg.contributes.menus['editor/lineNumber/context'].some(
        (m: { command: string }) => m.command === 'omnicomment.addComment'
      ),
      'Must contribute editor/lineNumber/context menu for gutter right-click'
    );

    // Clear selection
    editor.selection = new vscode.Selection(new vscode.Position(1, 0), new vscode.Position(1, 0));
    assert.doesNotThrow(() => {
      decorator.updateSelectionDecoration(editor);
    });
  });

  // Topology: Markdown text -> OmniCommentInlineItem -> verify body is MarkdownString with rich markdown
  // Expected: OmniCommentInlineItem body is an instance of vscode.MarkdownString containing formatted text.
  test('Txt 7: OmniCommentInlineItem formats markdown strings properly for root and reply comments', () => {
    const rootItem = new OmniCommentInlineItem(
      'c-1',
      undefined,
      'Reviewing **critical** section with `test()` code',
      'Alice',
      new Date().toISOString(),
      'anchor phrase',
      'Line 10'
    );
    assert.strictEqual(rootItem.body.isTrusted, true);
    assert.ok(rootItem.body.value.includes('**critical**'));
    assert.ok(rootItem.body.value.includes('`test()`'));
    assert.ok(rootItem.body.value.includes('> **Line 10:** `anchor phrase`'));

    const replyItem = new OmniCommentInlineItem(
      'c-1',
      'r-1',
      'Reply with [documentation link](https://example.com)',
      'Bob',
      new Date().toISOString()
    );
    assert.ok(replyItem.body.value.includes('[documentation link](https://example.com)'));
  });

  // Topology: Read index.css & omniAnnotations.js -> verify redesigned compact sizing and thread connector
  // Expected: Card width is min 300px, max 440px, replies list has border-left indent guide, avatar is styled.
  test('Txt 8: Inline comment card redesign verifies compact dimensions, thread guide, and markdown styling', () => {
    const cssPath = path.join(__dirname, '../../../media/markdown-editor/index.css');
    const cssContent = fs.readFileSync(cssPath, 'utf-8');
    assert.ok(cssContent.includes('300px') && cssContent.includes('min-width'), 'Must enforce compact min-width 300px');
    assert.ok(cssContent.includes('440px') && cssContent.includes('max-width'), 'Must enforce compact max-width 440px');
    assert.ok(cssContent.includes('border-left: 2px solid'), 'Must include thread connector guide');
    assert.ok(cssContent.includes('.omni-inline-avatar'), 'Must include avatar style');
    assert.ok(cssContent.includes('.omni-comment-inline-code'), 'Must include inline code styling');
    assert.ok(cssContent.includes('.omni-comment-code-block'), 'Must include code block styling');
  });

  // Topology: resolveCommentBoxDimensions({ widthMode: ... }) -> verify minWidth, maxWidth, fontSize
  // Expected: Compact = 280-360px/11px, Standard = 320-460px/12px, Wide = 420-640px/13px, Custom = user values.
  test('Txt 9: resolveCommentBoxDimensions correctly calculates bounds across compact, standard, wide, and custom modes', () => {
    const compactDims = resolveCommentBoxDimensions({ widthMode: 'compact' });
    assert.strictEqual(compactDims.minWidth, 280);
    assert.strictEqual(compactDims.maxWidth, 360);
    assert.strictEqual(compactDims.fontSize, 11);

    const standardDims = resolveCommentBoxDimensions({ widthMode: 'standard' });
    assert.strictEqual(standardDims.minWidth, 320);
    assert.strictEqual(standardDims.maxWidth, 460);
    assert.strictEqual(standardDims.fontSize, 12);

    const wideDims = resolveCommentBoxDimensions({ widthMode: 'wide' });
    assert.strictEqual(wideDims.minWidth, 420);
    assert.strictEqual(wideDims.maxWidth, 640);
    assert.strictEqual(wideDims.fontSize, 13);

    const customDims = resolveCommentBoxDimensions({
      widthMode: 'custom',
      minWidth: 500,
      maxWidth: 750,
      fontSize: 15
    });
    assert.strictEqual(customDims.minWidth, 500);
    assert.strictEqual(customDims.maxWidth, 750);
    assert.strictEqual(customDims.fontSize, 15);
  });

  // Topology: omniAnnotations.js & package.json -> verify configuration popover, commands, and settings schema
  // Expected: package.json contributes commentBox configuration; omniAnnotations includes gear button and popover HTML.
  test('Txt 10: Configurable comment box features (settings gear, popover controls, default author fallback, and commands) are present and operational', async () => {
    const pkgPath = path.join(__dirname, '../../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const configProps = pkg.contributes.configuration.properties;

    assert.ok(configProps['omnicomment.commentBox.widthMode'], 'Must declare widthMode setting');
    assert.ok(configProps['omnicomment.commentBox.minWidth'], 'Must declare minWidth setting');
    assert.ok(configProps['omnicomment.commentBox.maxWidth'], 'Must declare maxWidth setting');
    assert.ok(configProps['omnicomment.commentBox.fontSize'], 'Must declare fontSize setting');
    assert.ok(configProps['omnicomment.commentBox.enableMarkdown'], 'Must declare enableMarkdown setting');
    assert.ok(configProps['omnicomment.commentBox.showAvatars'], 'Must declare showAvatars setting');
    assert.ok(configProps['omnicomment.commentBox.showThreadGuide'], 'Must declare showThreadGuide setting');
    assert.ok(configProps['omnicomment.commentBox.defaultAuthor'], 'Must declare defaultAuthor setting');

    const jsPath = path.join(__dirname, '../../../media/markdown-editor/omniAnnotations.js');
    const jsContent = fs.readFileSync(jsPath, 'utf-8');
    assert.ok(jsContent.includes('data-action="configure-comment-box"'), 'Must have gear button trigger');
    assert.ok(jsContent.includes('omni-config-popover'), 'Must render configuration popover');
    assert.ok(jsContent.includes('data-config-set="widthMode"'), 'Must allow setting width mode');
    assert.ok(jsContent.includes('data-config-toggle="enableMarkdown"'), 'Must allow toggling markdown');

    // Test getCommentBoxConfig and saveCommentBoxConfigHandler
    const currentConfig = getCommentBoxConfig();
    assert.ok(typeof currentConfig.widthMode === 'string');
    assert.ok(typeof currentConfig.fontSize === 'number');

    await saveCommentBoxConfigHandler({ fontSize: 13 });
    const updated = getCommentBoxConfig();
    assert.strictEqual(updated.fontSize, 13);
  });
});
