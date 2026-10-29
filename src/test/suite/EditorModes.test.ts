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
  queryMarkdownEditorInlineStateForTesting
} from '../../extension';

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

suite('Multi-Editor Modes Comprehensive Test Suite', () => {
  let tempDir: string;

  suiteSetup(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnicomment-modes-test-'));
    const initDoc = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: '# Init Modes Test'
    });
    await vscode.window.showTextDocument(initDoc);
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  // MODE 1A: Standard VS Code TextEditor with text selection
  test('Mode 1A: Standard TextEditor with highlighted selection', async () => {
    const filePath = path.join(tempDir, 'mode1-selected.md');
    fs.writeFileSync(
      filePath,
      '# Standard Mode With Selection\n\nText selection allows commenting specific terms like architecture.\n',
      'utf-8'
    );
    const fileUri = vscode.Uri.file(filePath);
    const document = await vscode.workspace.openTextDocument(fileUri);
    const editor = await vscode.window.showTextDocument(document);

    const lineText = document.lineAt(2).text;
    const term = 'architecture';
    const startIdx = lineText.indexOf(term);
    assert.ok(startIdx !== -1);
    editor.selection = new vscode.Selection(
      new vscode.Position(2, startIdx),
      new vscode.Position(2, startIdx + term.length)
    );

    const commentContent = 'Comment on selected architecture term';
    await vscode.commands.executeCommand('omnicomment.editorCommentAction', {
      type: 'addComment',
      uri: fileUri,
      anchorText: term,
      content: commentContent
    });

    const commentService = getCommentServiceForTesting();
    await waitForCondition(() => {
      const comments = commentService.parseComments(document);
      return comments.length === 1;
    });

    const comments = commentService.parseComments(document);
    assert.strictEqual(comments.length, 1);
    assert.strictEqual(comments[0].anchor.text, term);
    assert.strictEqual(comments[0].content, commentContent);

    // Verify inline controller thread
    const inlineController = getInlineCommentControllerForTesting();
    assert.strictEqual(inlineController.getThreadCount(fileUri), 1);
  });

  // MODE 1B: Standard TextEditor without selection (cursor auto-expansion)
  test('Mode 1B: Standard TextEditor without selection expands cursor to word', async () => {
    const filePath = path.join(tempDir, 'mode1-cursor.md');
    fs.writeFileSync(
      filePath,
      '# Cursor Word Expansion\n\nTesting auto expansion at word cursor.\n',
      'utf-8'
    );
    const fileUri = vscode.Uri.file(filePath);
    const document = await vscode.workspace.openTextDocument(fileUri);
    const editor = await vscode.window.showTextDocument(document);

    // Place cursor in middle of "expansion" on line 2 (offset around index 15)
    const lineText = document.lineAt(2).text;
    const wordIdx = lineText.indexOf('expansion') + 3;
    editor.selection = new vscode.Selection(
      new vscode.Position(2, wordIdx),
      new vscode.Position(2, wordIdx)
    );
    assert.strictEqual(editor.selection.isEmpty, true);

    // Execute omnicomment.addComment - it should expand selection to "expansion"
    await vscode.commands.executeCommand('omnicomment.addComment');

    // Verify selection expanded to "expansion"
    const expandedSelection = editor.selection;
    assert.strictEqual(expandedSelection.isEmpty, false);
    const selectedText = document.getText(expandedSelection);
    assert.strictEqual(selectedText, 'expansion');
  });

  // MODE 1C: SKILL file mode (.skill language/extension)
  test('Mode 1C: Skill document (.skill) support in standard editor', async () => {
    const filePath = path.join(tempDir, 'agent-rules.skill');
    fs.writeFileSync(
      filePath,
      '---\nname: my-skill\n---\n# Skill Instructions\n\nFollow these guidelines carefully.\n',
      'utf-8'
    );
    const fileUri = vscode.Uri.file(filePath);
    const document = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(document);

    const ctx = await getActiveMarkdownContext(fileUri);
    assert.ok(ctx, 'SKILL file should resolve in getActiveMarkdownContext');
    assert.strictEqual(ctx?.document.uri.fsPath, fileUri.fsPath);

    const anchorPhrase = 'guidelines carefully';
    const commentText = 'Review rule for agent';
    await vscode.commands.executeCommand('omnicomment.editorCommentAction', {
      type: 'addComment',
      uri: fileUri,
      anchorText: anchorPhrase,
      content: commentText
    });

    const commentService = getCommentServiceForTesting();
    await waitForCondition(() => {
      const comments = commentService.parseComments(document);
      return comments.length === 1;
    });

    const comments = commentService.parseComments(document);
    assert.strictEqual(comments.length, 1);
    assert.strictEqual(comments[0].anchor.text, anchorPhrase);
    assert.strictEqual(comments[0].content, commentText);
  });

  // MODE 2: Diff Editor Mode (vscode.diff)
  test('Mode 2: Diff Editor (side-by-side comparison) resolves modified document', async () => {
    const fileOrigPath = path.join(tempDir, 'diff-original.md');
    const fileModPath = path.join(tempDir, 'diff-modified.md');

    fs.writeFileSync(fileOrigPath, '# Version 1\n\nOriginal draft paragraph.\n', 'utf-8');
    fs.writeFileSync(fileModPath, '# Version 2\n\nRevised draft paragraph with changes.\n', 'utf-8');

    const origUri = vscode.Uri.file(fileOrigPath);
    const modUri = vscode.Uri.file(fileModPath);

    // Open side-by-side diff editor
    await vscode.commands.executeCommand('vscode.diff', origUri, modUri, 'Review: Orig vs Mod');

    await waitForCondition(() => {
      const activeTab = vscode.window.tabGroups?.activeTabGroup?.activeTab;
      return Boolean(activeTab && activeTab.input && 'modified' in (activeTab.input as object));
    });

    // Verify getActiveMarkdownContext resolves the modified document
    const ctx = await getActiveMarkdownContext();
    assert.ok(ctx, 'getActiveMarkdownContext should resolve modified side of diff editor');
    assert.strictEqual(ctx?.document.uri.fsPath, modUri.fsPath);

    // Add comment on modified document in diff editor
    const diffComment = 'Comment added while in Diff Editor mode';
    await vscode.commands.executeCommand('omnicomment.editorCommentAction', {
      type: 'addComment',
      uri: modUri,
      anchorText: 'Revised draft paragraph',
      content: diffComment
    });

    const commentService = getCommentServiceForTesting();
    await waitForCondition(() => {
      const comments = commentService.parseComments(ctx!.document);
      return comments.length === 1;
    });

    const comments = commentService.parseComments(ctx!.document);
    assert.strictEqual(comments.length, 1);
    assert.strictEqual(comments[0].content, diffComment);
  });

  // MODE 3: Markdown Preview Plugin Mode
  test('Mode 3: Markdown Preview plugin integration', async () => {
    const ext = vscode.extensions.getExtension('benquike.omnicomment');
    assert.ok(ext, 'OmniComment extension should be registered');
    if (!ext.isActive) {
      await ext.activate();
    }

    const exports = ext.exports;
    assert.ok(exports, 'Extension should export API');
    assert.strictEqual(
      typeof exports.extendMarkdownIt,
      'function',
      'Extension should export extendMarkdownIt function for VS Code preview'
    );

    // Verify plugin decorates markdown preview tokens
    const fakeMd = {
      usedPlugin: false,
      use(plugin: any) {
        this.usedPlugin = true;
        return this;
      }
    };
    exports.extendMarkdownIt(fakeMd);
    assert.strictEqual(fakeMd.usedPlugin, true, 'extendMarkdownIt should register the preview plugin');
  });

  // MODE 4: Custom Editor Mode ("Markdown Editor" / cweijan.markdownViewer)
  test('Mode 4: Custom Editor Mode renders comments and responds to actions', async () => {
    const officeExt = vscode.extensions.getExtension('cweijan.vscode-office');
    if (!officeExt) {
      // If officeExt not installed in this environment, skip custom editor test
      return;
    }

    const filePath = path.join(tempDir, 'mode4-custom.md');
    fs.writeFileSync(
      filePath,
      '# Custom Editor Mode Verification\n\nVerifying universal comments in custom editor mode.\n',
      'utf-8'
    );
    const fileUri = vscode.Uri.file(filePath);

    await vscode.commands.executeCommand('vscode.openWith', fileUri, 'cweijan.markdownViewer');
    await waitForCondition(() => {
      const activeTab = vscode.window.tabGroups?.activeTabGroup?.activeTab;
      return Boolean(activeTab && activeTab.input && 'viewType' in (activeTab.input as object));
    });

    const ctx = await getActiveMarkdownContext(fileUri);
    assert.ok(ctx);
    assert.strictEqual(ctx?.document.uri.fsPath, fileUri.fsPath);

    const customText = 'Comment in custom editor mode';
    await vscode.commands.executeCommand('omnicomment.editorCommentAction', {
      type: 'addComment',
      uri: fileUri,
      anchorText: 'Verifying universal comments',
      content: customText
    });

    const commentService = getCommentServiceForTesting();
    await waitForCondition(() => {
      const comments = commentService.parseComments(ctx!.document);
      return comments.length === 1;
    });

    const comments = commentService.parseComments(ctx!.document);
    assert.strictEqual(comments.length, 1);
    assert.strictEqual(comments[0].content, customText);

    // Verify inline state in custom editor webview
    const state = await queryMarkdownEditorInlineStateForTesting(undefined, 800);
    if (state) {
      assert.strictEqual(state.threadCount, 1);
      assert.ok(state.threads[0].text.includes(customText));
    }
  });
});
