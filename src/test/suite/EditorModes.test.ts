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
  queryMarkdownEditorInlineStateForTesting,
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

  // Topology: text selection in TextEditor -> omnicomment.addComment({ content }) -> CommentService.addComment
  // Expected: comment persisted to document storage block, inline thread created, selection decorated.
  test('Mode 1D: Standard TextEditor omnicomment.addComment with direct content', async () => {
    const filePath = path.join(tempDir, 'mode1-direct-add.md');
    fs.writeFileSync(
      filePath,
      '# Direct Comment Test\n\nVerifying direct comment submission in TextEditor.\n',
      'utf-8'
    );
    const fileUri = vscode.Uri.file(filePath);
    const document = await vscode.workspace.openTextDocument(fileUri);
    const editor = await vscode.window.showTextDocument(document);

    const term = 'Verifying';
    const startIdx = document.lineAt(2).text.indexOf(term);
    editor.selection = new vscode.Selection(
      new vscode.Position(2, startIdx),
      new vscode.Position(2, startIdx + term.length)
    );

    const commentText = 'Direct text editor comment via command';
    await vscode.commands.executeCommand('omnicomment.addComment', {
      uri: fileUri,
      content: commentText
    });

    const commentService = getCommentServiceForTesting();
    await waitForCondition(() => {
      const comments = commentService.parseComments(document);
      return comments.length === 1;
    });

    const comments = commentService.parseComments(document);
    assert.strictEqual(comments.length, 1);
    assert.strictEqual(comments[0].anchor.text, term);
    assert.strictEqual(comments[0].content, commentText);

    // Verify inline controller thread
    const inlineController = getInlineCommentControllerForTesting();
    assert.strictEqual(inlineController.getThreadCount(fileUri), 1);
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

  // Topology: MarkdownIt with null map tokens -> omniCommentPreviewPlugin -> HTML highlight tags
  // Expected: Inline tokens without map (tables/lists) are decorated with .omni-highlight.
  test('Mode 3B: Markdown Preview plugin highlights inline tokens without map', () => {
    const ext = vscode.extensions.getExtension('benquike.omnicomment');
    assert.ok(ext);
    const exports = ext.exports;

    let registeredPlugin: any = null;
    const fakeMd = {
      core: {
        ruler: {
          push(_name: string, fn: any) {
            registeredPlugin = fn;
          }
        }
      },
      use(plugin: any) {
        plugin(this);
        return this;
      }
    };

    exports.extendMarkdownIt(fakeMd);
    assert.ok(registeredPlugin, 'Plugin rule should be registered');

    // Mock state with inline token without map matching a comment anchor
    class MockToken {
      constructor(public type: string, public tag: string, public nesting: number) {}
      content = '';
      map: [number, number] | null = null;
      children: MockToken[] | null = null;
    }

    const textChild = new MockToken('text', '', 0);
    textChild.content = 'Table cell architecture text';

    const inlineToken = new MockToken('inline', '', 0);
    inlineToken.map = null;
    inlineToken.children = [textChild];

    const state = {
      src: '# Table Test\n\n| Col |\n| --- |\n| architecture |\n\n<!-- omnicomment\n{"version":2,"comments":[{"id":"c1","anchor":{"text":"architecture","startLine":4,"startChar":2,"endLine":4,"endChar":14},"content":"Cell review","author":"user","createdAt":"2026-10-29T00:00:00.000Z"}]}\n-->',
      tokens: [inlineToken],
      Token: MockToken
    };

    registeredPlugin(state);

    const hasHighlight = inlineToken.children.some(
      ch => ch.type === 'html_inline' && ch.content.includes('omni-highlight')
    );
    assert.strictEqual(hasHighlight, true, 'Inline token without map should receive omni-highlight');
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

  // Topology: Markdown with table -> open in cweijan.markdownViewer -> add comment in table cell -> collapse -> verify gutter chip
  // Expected: Comment placed in table cell, when collapsed, displays .omni-gutter-chip with 💬 bubble icon.
  test('Mode 4B: Table cell comment displays gutter bubble icon when collapsed', async () => {
    const officeExt = vscode.extensions.getExtension('cweijan.vscode-office');
    if (!officeExt) {
      return;
    }

    const filePath = path.join(tempDir, 'mode4-table.md');
    fs.writeFileSync(
      filePath,
      '# Table Testing Document\n\n| Column A | Column B |\n| --- | --- |\n| Header Row | Header Data |\n| Cell Row 2 | Data 2 |\n| Target Cell | Target Data |\n',
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

    const tableCommentText = 'Reviewing target table cell';
    await vscode.commands.executeCommand('omnicomment.editorCommentAction', {
      type: 'addComment',
      uri: fileUri,
      anchorText: 'Target Cell',
      content: tableCommentText
    });

    const commentService = getCommentServiceForTesting();
    await waitForCondition(() => {
      const comments = commentService.parseComments(ctx!.document);
      return comments.length === 1;
    });

    // Query state while expanded
    let expandedState: any = null;
    await waitForCondition(async () => {
      expandedState = await queryMarkdownEditorInlineStateForTesting(undefined, 800);
      return Boolean(expandedState && expandedState.threadCount === 1);
    }, 10000);
    console.log('EXPANDED STATE:', JSON.stringify(expandedState, null, 2));

    // Collapse via header chevron
    let collapsedState: any = null;
    await waitForCondition(async () => {
      collapsedState = await queryMarkdownEditorInlineStateForTesting(
        '.omni-collapse-chevron',
        800
      );
      return Boolean(collapsedState && collapsedState.threads?.[0]?.isCollapsed);
    }, 10000);
    assert.ok(collapsedState, 'Collapsed inline state must be retrieved');
    assert.ok(collapsedState.gutterChipCount >= 1, 'Gutter chip must be present when collapsed');
    assert.strictEqual(
      collapsedState.gutterChips[0].isCollapsed,
      true,
      'Gutter chip must have is-collapsed class'
    );
    assert.ok(
      collapsedState.gutterChips[0].text.includes('💬'),
      'Gutter chip must display comment bubble icon'
    );

    // Invariant: Gutter chip must be aligned with the table row (~260px) rather than table top header (~148px)
    const chipTop = parseFloat(collapsedState.gutterChips[0].top);
    assert.ok(
      chipTop > 200,
      `Gutter chip top (${chipTop}px) must align with table row 3 (>200px), not table top (~148px)`
    );

    // Invariant: Adding a second comment in a different table row creates an independent gutter target
    await vscode.commands.executeCommand('omnicomment.editorCommentAction', {
      type: 'addComment',
      uri: fileUri,
      anchorText: 'Cell Row 2',
      content: 'Second comment in Row 2'
    });

    await waitForCondition(() => {
      const comments = commentService.parseComments(ctx!.document);
      return comments.length === 2;
    });

    let multiRowState: any = null;
    await waitForCondition(async () => {
      multiRowState = await queryMarkdownEditorInlineStateForTesting(undefined, 800);
      return Boolean(multiRowState && multiRowState.gutterChipCount === 2);
    }, 10000);
    assert.ok(multiRowState, 'Multi-row state must be retrieved');
    assert.strictEqual(multiRowState.gutterChipCount, 2, 'Must have 2 distinct gutter chips for 2 table rows');
    assert.strictEqual(multiRowState.activeGutterTargetsSize, 2, 'Must track 2 distinct TR targets');
    const chipTops = multiRowState.gutterChips.map((c: any) => parseFloat(c.top));
    assert.notStrictEqual(chipTops[0], chipTops[1], 'Gutter chips on different table rows must have distinct vertical tops');
  });

  // Topology: .txt file -> openTextDocument -> omnicomment.editorCommentAction -> parseComments
  // Expected: .txt document resolves in getActiveMarkdownContext, comment persists in comment block, inline thread created.
  test('Mode 1E: Plain text (.txt) document support in standard text editor', async () => {
    const filePath = path.join(tempDir, 'notes.txt');
    fs.writeFileSync(
      filePath,
      'Meeting Notes\n\nDiscussion about release milestones and deadlines.\n',
      'utf-8'
    );
    const fileUri = vscode.Uri.file(filePath);
    const document = await vscode.workspace.openTextDocument(fileUri);
    await vscode.window.showTextDocument(document);

    const ctx = await getActiveMarkdownContext(fileUri);
    assert.ok(ctx, 'Plain text (.txt) file should resolve in getActiveMarkdownContext');
    assert.strictEqual(ctx?.document.uri.fsPath, fileUri.fsPath);

    const anchorPhrase = 'release milestones';
    const commentText = 'Clarify deadlines for v1.0';
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

    const inlineController = getInlineCommentControllerForTesting();
    assert.strictEqual(inlineController.getThreadCount(fileUri), 1);
  });

  // Topology: Text selection in document -> CommentCodeActionProvider.provideCodeActions -> CodeAction array
  // Expected: Returns Refactor action with title containing selected text and command 'omnicomment.addComment'.
  test('Mode 1F: CommentCodeActionProvider provides lightbulb action on selection', async () => {
    const filePath = path.join(tempDir, 'codeaction-test.txt');
    fs.writeFileSync(filePath, 'Important paragraph to highlight in plain text.\n', 'utf-8');
    const fileUri = vscode.Uri.file(filePath);
    const document = await vscode.workspace.openTextDocument(fileUri);

    const provider = new CommentCodeActionProvider();
    const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 9));
    const actions = provider.provideCodeActions(
      document,
      range,
      { diagnostics: [], triggerKind: vscode.CodeActionTriggerKind.Invoke, only: undefined },
      new vscode.CancellationTokenSource().token
    );

    assert.ok(actions.length > 0, 'CodeActionProvider should produce an action for non-empty selection');
    const firstAction = actions[0] as vscode.CodeAction;
    assert.ok(firstAction.title.includes('Add OmniComment'));
    assert.strictEqual(firstAction.command?.command, 'omnicomment.addComment');
  });

  // Topology: Blank line Range -> resolveAnchorSelectionForThread -> nearest non-empty line Selection
  // Expected: Finds nearest non-empty line downward or upward instead of failing on empty selection.
  test('Mode 1G: resolveAnchorSelectionForThread recovers from blank line ranges', async () => {
    const filePath = path.join(tempDir, 'blank-lines.txt');
    fs.writeFileSync(filePath, '\n\nTarget content line.\n\n', 'utf-8');
    const fileUri = vscode.Uri.file(filePath);
    const document = await vscode.workspace.openTextDocument(fileUri);

    // Range on blank line 0
    const blankRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 0));
    const resolved = resolveAnchorSelectionForThread(document, blankRange);
    const resolvedText = document.getText(resolved).trim();
    assert.strictEqual(resolvedText, 'Target content line.');
  });
});
