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

suite('End-to-End (E2E) Commenting Test Suite', () => {
  let tempDir: string;

  suiteSetup(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omnicomment-e2e-files-'));
    // Ensure extension is activated by opening a markdown document
    const initDoc = await vscode.workspace.openTextDocument({
      language: 'markdown',
      content: '# Init'
    });
    await vscode.window.showTextDocument(initDoc);
  });

  teardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('E2E: Should add and collapse/expand an inline comment in standard VS Code Markdown TextEditor', async () => {
    const filePath = path.join(tempDir, 'e2e-standard.md');
    fs.writeFileSync(
      filePath,
      '# Standard Editor Test\n\nOmniComment provides interactive commenting for Markdown files.\n',
      'utf-8'
    );

    const fileUri = vscode.Uri.file(filePath);
    const document = await vscode.workspace.openTextDocument(fileUri);
    const editor = await vscode.window.showTextDocument(document);

    // Select "interactive commenting" on line 2
    const lineText = document.lineAt(2).text;
    const targetPhrase = 'interactive commenting';
    const startChar = lineText.indexOf(targetPhrase);
    assert.ok(startChar !== -1, 'Target phrase should exist in line 2');
    const selectionRange = new vscode.Range(
      new vscode.Position(2, startChar),
      new vscode.Position(2, startChar + targetPhrase.length)
    );
    editor.selection = new vscode.Selection(selectionRange.start, selectionRange.end);

    // Submit a new inline comment via omnicomment.editorCommentAction
    const commentText = 'E2E inline comment added in standard editor';
    await vscode.commands.executeCommand('omnicomment.editorCommentAction', {
      type: 'addComment',
      uri: fileUri,
      anchorText: targetPhrase,
      content: commentText
    });

    const commentService = getCommentServiceForTesting();
    await waitForCondition(() => {
      const comments = commentService.parseComments(document);
      return comments.length === 1;
    });

    const comments = commentService.parseComments(document);
    assert.strictEqual(comments.length, 1);
    assert.strictEqual(comments[0].content, commentText);
    assert.strictEqual(comments[0].anchor.text, targetPhrase);
    assert.strictEqual(comments[0].anchor.startLine, 2);

    // Verify the InlineCommentController created an inline thread and supports collapsing/expanding
    const inlineController = getInlineCommentControllerForTesting();
    assert.strictEqual(inlineController.getThreadCount(fileUri), 1);
    const docThreads = (inlineController as any)._threadsByDoc.get(fileUri.toString());
    const thread = docThreads?.get(comments[0].id);
    assert.ok(thread);
    const initialState = thread.collapsibleState;
    inlineController.toggleThreadCollapsibleState(thread);
    assert.notStrictEqual(thread.collapsibleState, initialState);
    inlineController.toggleThreadCollapsibleState(thread);
    assert.strictEqual(thread.collapsibleState, initialState);

    assert.strictEqual(inlineController.toggleAllThreads(fileUri), true);
    assert.strictEqual(inlineController.toggleAllThreads(fileUri), false);
  });

  test('E2E: Should render inlined comments directly in the Markdown view when opened in "Markdown Editor" (Custom Editor)', async () => {
    const filePath = path.join(tempDir, 'e2e-custom-editor.md');
    fs.writeFileSync(
      filePath,
      '# Custom Editor Title\n\nThis paragraph has **bold text** and `inline code` inside Markdown Editor.\n\nNext paragraph below the comment.\n',
      'utf-8'
    );
    const fileUri = vscode.Uri.file(filePath);

    // Check if cweijan.vscode-office ("Markdown Editor") is available in the test host
    const officeExt = vscode.extensions.getExtension('cweijan.vscode-office');
    if (officeExt) {
      await vscode.commands.executeCommand('vscode.openWith', fileUri, 'cweijan.markdownViewer');
      await waitForCondition(() => {
        const activeTab = vscode.window.tabGroups?.activeTabGroup?.activeTab;
        return Boolean(activeTab && activeTab.input && 'viewType' in (activeTab.input as object));
      });
      assert.strictEqual(
        vscode.window.activeTextEditor,
        undefined,
        'activeTextEditor should be undefined when custom editor is active'
      );
    } else {
      await vscode.workspace.openTextDocument(fileUri);
    }

    const ctx = await getActiveMarkdownContext(fileUri);
    assert.ok(ctx, 'getActiveMarkdownContext should resolve the markdown document');
    assert.strictEqual(ctx?.document.uri.fsPath, fileUri.fsPath);
    if (officeExt) {
      assert.strictEqual(ctx?.editor, undefined, 'ctx.editor should be undefined in custom editor mode');
    }

    // Add comment and response directly in "Markdown Editor"
    const vditorCopiedSelection = 'This\u00A0paragraph has \u200Bbold text\u200B and inline code';
    const customCommentText = 'E2E comment inlined directly inside Markdown Editor view!';
    await vscode.commands.executeCommand('omnicomment.editorCommentAction', {
      type: 'addComment',
      uri: fileUri,
      anchorText: vditorCopiedSelection,
      content: customCommentText
    });

    const commentService = getCommentServiceForTesting();
    await waitForCondition(() => {
      const comments = commentService.parseComments(ctx!.document);
      return comments.length === 1;
    });

    let comments = commentService.parseComments(ctx!.document);
    assert.strictEqual(comments.length, 1);
    assert.strictEqual(comments[0].content, customCommentText);
    assert.strictEqual(
      comments[0].anchor.text,
      'This paragraph has **bold text** and `inline code`'
    );
    assert.strictEqual(comments[0].anchor.startLine, 2);

    // Add a response (reply) directly via in-editor action
    const replyText = 'E2E response inlined inside the comment box!';
    await vscode.commands.executeCommand('omnicomment.editorCommentAction', {
      type: 'addReply',
      uri: fileUri,
      commentId: comments[0].id,
      content: replyText
    });

    comments = commentService.parseComments(ctx!.document);
    assert.strictEqual(comments[0].replies?.length, 1);
    assert.strictEqual(comments[0].replies?.[0].content, replyText);

    // If Markdown Editor webview is active, verify the live DOM rendered the inline comment widget below the paragraph
    if (officeExt) {
      await waitForCondition(async () => {
        const state = await queryMarkdownEditorInlineStateForTesting(undefined, 800);
        return Boolean(
          state &&
            state.threadCount === 1 &&
            state.threads[0].replyCount === 1 &&
            state.threads[0].isBelowBlock &&
            state.threads[0].hasReplyBox &&
            state.threads[0].text.includes(customCommentText) &&
            state.threads[0].text.includes(replyText)
        );
      }, 8000);

      // Verify collapsing responses inside the inline comment widget
      const afterCollapseReplies = await queryMarkdownEditorInlineStateForTesting(
        '[data-action="toggle-collapse-replies"]'
      );
      assert.ok(afterCollapseReplies);
      assert.strictEqual(afterCollapseReplies!.threads[0].replyCount, 0);

      // Verify re-expanding responses inside the inline comment widget
      const afterExpandReplies = await queryMarkdownEditorInlineStateForTesting(
        '[data-action="toggle-collapse-replies"]'
      );
      assert.ok(afterExpandReplies);
      assert.strictEqual(afterExpandReplies!.threads[0].replyCount, 1);

      // Verify collapsing the entire inline comment widget via the header chevron (completely hides comment box)
      const afterCollapseThread = await queryMarkdownEditorInlineStateForTesting(
        '.omni-collapse-chevron'
      );
      assert.ok(afterCollapseThread);
      assert.strictEqual(afterCollapseThread!.threads[0].isCollapsed, true);
      assert.strictEqual(afterCollapseThread!.threads[0].isHidden, true);
      assert.strictEqual(afterCollapseThread!.visibleThreadCount, 0);
      assert.strictEqual(afterCollapseThread!.zoneCount, 0);

      // Verify re-expanding the inline comment widget by clicking the gutter icon
      const afterExpandThread = await queryMarkdownEditorInlineStateForTesting(
        '[data-omni-comments]'
      );
      assert.ok(afterExpandThread);
      assert.strictEqual(afterExpandThread!.threads[0].isCollapsed, false);
      assert.strictEqual(afterExpandThread!.threads[0].isHidden, false);
      assert.strictEqual(afterExpandThread!.visibleThreadCount, 1);
      assert.strictEqual(afterExpandThread!.zoneCount, 1);

      // Verify resolving comment in custom editor clears text highlighting
      const afterResolve = await queryMarkdownEditorInlineStateForTesting(
        '[data-action="toggle-resolve"]'
      );
      assert.ok(afterResolve);
      assert.strictEqual(afterResolve!.threads[0].isResolved, true);
      assert.strictEqual(afterResolve!.highlightCount, 0);

      // Verify reopening comment restores text highlighting
      const afterReopen = await queryMarkdownEditorInlineStateForTesting(
        '[data-action="toggle-resolve"]'
      );
      assert.ok(afterReopen);
      assert.strictEqual(afterReopen!.threads[0].isResolved, false);
      assert.strictEqual(afterReopen!.highlightCount, 1);

      // Re-collapse via header chevron to verify the comment box is completely hidden again
      const afterReCollapse = await queryMarkdownEditorInlineStateForTesting(
        '.omni-collapse-chevron'
      );
      assert.ok(afterReCollapse);
      assert.strictEqual(afterReCollapse!.threads[0].isCollapsed, true);
      assert.strictEqual(afterReCollapse!.threads[0].isHidden, true);
      assert.strictEqual(afterReCollapse!.visibleThreadCount, 0);
      assert.strictEqual(afterReCollapse!.zoneCount, 0);

      // Verify adding a comment by clicking the "Comment" button inside the Markdown Editor webview
      await vscode.commands.executeCommand(
        'office.markdown.openAddCommentInEditor',
        'Next paragraph below the comment.'
      );
      const secondCommentText = 'Comment saved directly by clicking the Comment button!';
      const afterWebviewCommentClick = await queryMarkdownEditorInlineStateForTesting(
        '[data-action="submit-new-comment"]',
        2000,
        '#omni-inline-new-comment-input',
        secondCommentText
      );
      assert.ok(afterWebviewCommentClick);
      assert.strictEqual(afterWebviewCommentClick!.threadCount, 2);

      await waitForCondition(() => {
        const diskContent = fs.readFileSync(filePath, 'utf-8');
        return diskContent.includes(secondCommentText);
      }, 8000);
    }

    // Verify the file on disk was saved with both the comment and response
    await waitForCondition(() => {
      const diskContent = fs.readFileSync(filePath, 'utf-8');
      return (
        diskContent.includes('<!-- omnicomment') &&
        diskContent.includes(customCommentText) &&
        diskContent.includes(replyText)
      );
    });
  });
});
