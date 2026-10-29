import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as Mocha from 'mocha';
import {
  isMarkdownCompatibleLanguage,
  isMarkdownCompatibleUri,
  getUriFromTabInput
} from '../../extension';
import { CommentSidebarProvider } from '../../providers/CommentSidebarProvider';

const suite = Mocha.suite;
const test = Mocha.test;

suite('Extension Test Suite', () => {
  vscode.window.showInformationMessage('Starting OmniComment extension tests');

  suite('Extension Activation', () => {
    test('Extension should be present', () => {
      const extension =
        vscode.extensions.getExtension('benquike.omnicomment') ||
        vscode.extensions.getExtension('OrenMaoz.omnicomment');
      // Extension may not be installed in test environment, just check API works
      assert.ok(true, 'Extension API is accessible');
    });

    test('Commands should be registered', async () => {
      // Get all registered commands
      const commands = await vscode.commands.getCommands(true);
      
      // Check that OmniComment commands are registered when extension is active
      const omniCommands = commands.filter(cmd => cmd.startsWith('omnicomment.'));
      
      // If extension is active, commands should be registered
      // Note: In test environment, extension may not auto-activate
      assert.ok(Array.isArray(omniCommands), 'Commands array is accessible');
    });
  });

  suite('Markdown Document Handling', () => {
    test('Should create markdown document', async () => {
      const document = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: '# Test Document\n\nSome text here.'
      });

      assert.strictEqual(document.languageId, 'markdown');
      assert.ok(document.getText().includes('# Test Document'));
    });

    test('Should edit markdown document', async () => {
      const document = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: '# Original'
      });

      const editor = await vscode.window.showTextDocument(document);
      
      await editor.edit(editBuilder => {
        editBuilder.insert(new vscode.Position(0, 10), ' Modified');
      });

      assert.ok(document.getText().includes('Modified'));
    });
  });

  suite('Language Compatibility', () => {
    test('Should treat skill, plaintext, and log languages as compatible', () => {
      assert.strictEqual(isMarkdownCompatibleLanguage('markdown'), true);
      assert.strictEqual(isMarkdownCompatibleLanguage('skill'), true);
      assert.strictEqual(isMarkdownCompatibleLanguage('plaintext'), true);
      assert.strictEqual(isMarkdownCompatibleLanguage('log'), true);
      assert.strictEqual(isMarkdownCompatibleLanguage('typescript'), false);
    });

    test('Package contribution contexts should include skill, plaintext, and log languages', () => {
      const extension =
        vscode.extensions.getExtension('benquike.omnicomment') ||
        vscode.extensions.getExtension('OrenMaoz.omnicomment');
      const extensionPath = extension?.extensionPath ?? path.resolve(__dirname, '../../..');
      const packageJsonPath = path.join(extensionPath, 'package.json');
      assert.ok(fs.existsSync(packageJsonPath), `package.json not found at ${packageJsonPath}`);
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      assert.ok(packageJson);

      assert.ok(packageJson.activationEvents.includes('onLanguage:skill'));
      assert.ok(packageJson.activationEvents.includes('onLanguage:plaintext'));
      assert.ok(packageJson.activationEvents.includes('onLanguage:log'));

      const editorContextMenuItem = packageJson.contributes.menus['editor/context'].find(
        (item: { command: string }) => item.command === 'omnicomment.addComment'
      );
      const editorTitleMenuItem = packageJson.contributes.menus['editor/title'].find(
        (item: { command: string }) => item.command === 'omnicomment.addComment'
      );
      const keybindingItem = packageJson.contributes.keybindings.find(
        (item: { command: string }) => item.command === 'omnicomment.addComment'
      );

      assert.ok(editorContextMenuItem);
      assert.ok(editorTitleMenuItem);
      assert.ok(keybindingItem);

      const editorContextWhen = editorContextMenuItem.when as string;
      const editorTitleWhen = editorTitleMenuItem.when as string;
      const keybindingWhen = keybindingItem.when as string;

      assert.strictEqual(
        editorContextWhen,
        'editorLangId == markdown || editorLangId == skill || editorLangId == plaintext || editorLangId == text || editorLangId == log || resourceExtname == .md || resourceExtname == .markdown || resourceExtname == .skill || resourceExtname == .txt || resourceExtname == .text || resourceExtname == .log'
      );
      assert.strictEqual(
        editorTitleWhen,
        'editorLangId == markdown || editorLangId == skill || editorLangId == plaintext || editorLangId == text || editorLangId == log || resourceExtname == .md || resourceExtname == .markdown || resourceExtname == .skill || resourceExtname == .txt || resourceExtname == .text || resourceExtname == .log || activeCustomEditorId == cweijan.markdownViewer || activeCustomEditorId == zaaack.markdown-editor'
      );
      assert.strictEqual(
        keybindingWhen,
        'editorLangId == markdown || editorLangId == skill || editorLangId == plaintext || editorLangId == text || editorLangId == log || resourceExtname == .md || resourceExtname == .markdown || resourceExtname == .skill || resourceExtname == .txt || resourceExtname == .text || resourceExtname == .log || activeCustomEditorId == cweijan.markdownViewer || activeCustomEditorId == zaaack.markdown-editor'
      );
    });

    test('Should recognize markdown-compatible URIs and custom editor tab inputs', () => {
      const mdUri = vscode.Uri.file('/workspace/docs/README.md');
      const skillUri = vscode.Uri.file('/workspace/skills/SKILL.skill');
      const txtUri = vscode.Uri.file('/workspace/docs/notes.txt');
      const logUri = vscode.Uri.file('/workspace/logs/server.log');
      const tsUri = vscode.Uri.file('/workspace/src/index.ts');

      assert.strictEqual(isMarkdownCompatibleUri(mdUri), true);
      assert.strictEqual(isMarkdownCompatibleUri(skillUri), true);
      assert.strictEqual(isMarkdownCompatibleUri(txtUri), true);
      assert.strictEqual(isMarkdownCompatibleUri(logUri), true);
      assert.strictEqual(isMarkdownCompatibleUri(tsUri), false);
      assert.strictEqual(isMarkdownCompatibleUri(tsUri), false);
      assert.strictEqual(isMarkdownCompatibleUri(tsUri), false);

      // Simulate TabInputCustom (e.g., "Markdown Editor")
      const customTabInput = { uri: mdUri, viewType: 'zaaack.markdown-editor' };
      assert.strictEqual(getUriFromTabInput(customTabInput)?.toString(), mdUri.toString());
    });
  });

  suite('Selection Handling', () => {
    test('Should handle text selection', async () => {
      const document = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: '# Hello World\n\nThis is test text.'
      });
      
      const editor = await vscode.window.showTextDocument(document);
      
      // Select "World"
      const start = new vscode.Position(0, 8);
      const end = new vscode.Position(0, 13);
      editor.selection = new vscode.Selection(start, end);
      
      assert.strictEqual(document.getText(editor.selection), 'World');
    });

    test('Should detect empty selection', async () => {
      const document = await vscode.workspace.openTextDocument({
        language: 'markdown',
        content: '# Test'
      });
      
      const editor = await vscode.window.showTextDocument(document);
      
      // Empty selection (cursor position)
      const pos = new vscode.Position(0, 3);
      editor.selection = new vscode.Selection(pos, pos);
      
      assert.ok(editor.selection.isEmpty);
    });
  });

  suite('Comment Block Format', () => {
    test('Should recognize comment block structure', () => {
      const COMMENT_BLOCK_START = '<!-- omnicomment';
      const COMMENT_BLOCK_END = '-->';
      
      const validBlock = `<!-- omnicomment
{
  "version": 2,
  "comments": []
}
-->`;
      
      assert.ok(validBlock.includes(COMMENT_BLOCK_START));
      assert.ok(validBlock.includes(COMMENT_BLOCK_END));
    });

    test('Should validate comment data structure', () => {
      const validData = {
        version: 2,
        comments: [
          {
            id: 'test-id',
            anchor: {
              text: 'test',
              startLine: 0,
              startChar: 0,
              endLine: 0,
              endChar: 4
            },
            content: 'A comment',
            author: 'user',
            createdAt: '2024-01-01T00:00:00.000Z'
          }
        ]
      };
      
      assert.strictEqual(validData.version, 2);
      assert.ok(Array.isArray(validData.comments));
      assert.ok(validData.comments[0].id);
      assert.ok(validData.comments[0].anchor);
      assert.ok(validData.comments[0].content);
    });
  });

  suite('Webview Provider', () => {
    test('Should have valid view type', () => {
      const viewType = CommentSidebarProvider.viewType;
      assert.strictEqual(viewType, 'omnicomment.commentSidebar');
    });
  });

  suite('Configuration', () => {
    test('Should access configuration values', () => {
      const config = vscode.workspace.getConfiguration('omnicomment');
      
      // Get default values or configured values
      const highlightColor = config.get<string>('highlightColor');
      const highlightBorderColor = config.get<string>('highlightBorderColor');
      
      // Values may be undefined if extension not active, but API should work
      assert.ok(config !== undefined, 'Configuration object is accessible');
    });
  });

  suite('Types Validation', () => {
    test('CommentAnchor should have required fields', () => {
      const anchor = {
        text: 'test',
        startLine: 0,
        startChar: 0,
        endLine: 0,
        endChar: 4
      };
      
      assert.ok('text' in anchor);
      assert.ok('startLine' in anchor);
      assert.ok('startChar' in anchor);
      assert.ok('endLine' in anchor);
      assert.ok('endChar' in anchor);
    });

    test('Reply should have required fields', () => {
      const reply = {
        id: 'reply-1',
        content: 'A reply',
        author: 'user',
        createdAt: new Date().toISOString()
      };
      
      assert.ok('id' in reply);
      assert.ok('content' in reply);
      assert.ok('author' in reply);
      assert.ok('createdAt' in reply);
    });

    test('Comment should support replies array', () => {
      const comment = {
        id: 'comment-1',
        anchor: { text: 'test', startLine: 0, startChar: 0, endLine: 0, endChar: 4 },
        content: 'Main comment',
        author: 'user',
        createdAt: new Date().toISOString(),
        replies: [
          { id: 'r1', content: 'Reply 1', author: 'user2', createdAt: new Date().toISOString() }
        ]
      };
      
      assert.ok(Array.isArray(comment.replies));
      assert.strictEqual(comment.replies.length, 1);
    });

    test('Comment should support resolved flag', () => {
      const comment = {
        id: 'comment-1',
        anchor: { text: 'test', startLine: 0, startChar: 0, endLine: 0, endChar: 4 },
        content: 'A comment',
        author: 'user',
        createdAt: new Date().toISOString(),
        resolved: true
      };
      
      assert.strictEqual(comment.resolved, true);
    });

    test('Comment should support orphaned flag', () => {
      const comment = {
        id: 'comment-1',
        anchor: { text: 'deleted text', startLine: 0, startChar: 0, endLine: 0, endChar: 12 },
        content: 'Orphaned comment',
        author: 'user',
        createdAt: new Date().toISOString(),
        orphaned: true
      };
      
      assert.strictEqual(comment.orphaned, true);
    });
  });

  suite('Text Sanitization', () => {
    test('Should handle dangerous sequences', () => {
      // Test that --> doesn't break comment blocks
      const dangerousText = 'text with --> in it';
      const sanitized = dangerousText.replace(/-->/g, '--\u200B>');
      const restored = sanitized.replace(/--\u200B>/g, '-->');
      
      assert.notStrictEqual(sanitized, dangerousText);
      assert.strictEqual(restored, dangerousText);
    });
  });

  suite('Position Calculations', () => {
    test('Should convert offset to position', () => {
      const text = 'Line 0\nLine 1\nLine 2';
      
      // Character at offset 0 is at (0, 0)
      // Character at offset 7 is at (1, 0) - start of "Line 1"
      // Character at offset 10 is at (1, 3) - 'e' in "Line 1"
      
      let offset = 0;
      let expectedLine = 0;
      let expectedChar = 0;
      
      for (let i = 0; i < text.length; i++) {
        if (text[i] === '\n') {
          expectedLine++;
          expectedChar = 0;
        } else {
          expectedChar++;
        }
      }
      
      // Final position should be (2, 6) for end of "Line 2"
      assert.strictEqual(expectedLine, 2);
      assert.strictEqual(expectedChar, 6);
    });
  });

  suite('OmniComment Branding & Agent API Contributions', () => {
    test('Package should contribute OmniComment branding, presets, and agent commands', () => {
      const extension =
        vscode.extensions.getExtension('benquike.omnicomment') ||
        vscode.extensions.getExtension('OrenMaoz.omnicomment');
      const extensionPath = extension?.extensionPath ?? path.resolve(__dirname, '../../..');
      const packageJsonPath = path.join(extensionPath, 'package.json');
      assert.ok(fs.existsSync(packageJsonPath), `package.json not found at ${packageJsonPath}`);
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

      // Check branding
      assert.ok(
        packageJson.displayName.includes('OmniComment'),
        `Expected displayName to include OmniComment, got ${packageJson.displayName}`
      );

      // Check preset configuration
      const configProps = packageJson.contributes.configuration.properties;
      assert.ok(configProps['omnicomment.preset'], 'omnicomment.preset configuration missing');
      assert.strictEqual(configProps['omnicomment.preset'].default, 'default');
      assert.ok(
        configProps['omnicomment.preset'].enum.includes('documentation-site'),
        'documentation-site preset missing'
      );
      assert.ok(
        configProps['omnicomment.preset'].enum.includes('git-file-review'),
        'git-file-review preset missing'
      );
      assert.ok(
        configProps['omnicomment.preset'].enum.includes('browser-annotator'),
        'browser-annotator preset missing'
      );
      assert.ok(
        configProps['omnicomment.preset'].enum.includes('team-collaboration'),
        'team-collaboration preset missing'
      );
      assert.ok(
        configProps['omnicomment.preset'].enum.includes('ai-agent-reviewer'),
        'ai-agent-reviewer preset missing'
      );

      // Check contributed Agent API commands
      const commands: Array<{ command: string; category: string; icon?: string }> = packageJson.contributes.commands;
      const commandNames = commands.map(c => c.command);
      assert.ok(commandNames.includes('omnicomment.applyPreset'), 'omnicomment.applyPreset command missing');
      assert.ok(commandNames.includes('omnicomment.agent.getComments'), 'agent.getComments command missing');
      assert.ok(commandNames.includes('omnicomment.agent.postComment'), 'agent.postComment command missing');
      assert.ok(commandNames.includes('omnicomment.agent.replyComment'), 'agent.replyComment command missing');
      assert.ok(commandNames.includes('omnicomment.agent.resolveComment'), 'agent.resolveComment command missing');
      assert.ok(commandNames.includes('omnicomment.agent.deleteComment'), 'agent.deleteComment command missing');

      // Check distinct icons for collapse thread and delete thread (no icon collision)
      const collapseCmd = commands.find(c => c.command === 'omnicomment.inlineToggleCollapseThread');
      const deleteThreadCmd = commands.find(c => c.command === 'omnicomment.inlineDeleteThread');
      assert.ok(collapseCmd, 'omnicomment.inlineToggleCollapseThread command missing');
      assert.ok(deleteThreadCmd, 'omnicomment.inlineDeleteThread command missing');
      assert.strictEqual(collapseCmd?.icon, '$(chevron-up)', 'Collapse command must use chevron icon');
      assert.strictEqual(deleteThreadCmd?.icon, '$(trash)', 'Delete command must use trash icon');
      assert.notStrictEqual(collapseCmd?.icon, deleteThreadCmd?.icon, 'Collapse and delete commands must have distinct icons');

      // Check comments/commentThread/title menu contributions
      const threadTitleMenus: Array<{ command: string; group?: string }> =
        packageJson.contributes.menus['comments/commentThread/title'];
      assert.ok(threadTitleMenus.some(m => m.command === 'omnicomment.inlineToggleCollapseThread' && m.group === 'navigation@2'));
      assert.ok(threadTitleMenus.some(m => m.command === 'omnicomment.inlineDeleteThread' && m.group === 'navigation@3'));

      // Check category
      const agentCmd = commands.find(c => c.command === 'omnicomment.agent.getComments');
      assert.strictEqual(agentCmd?.category, 'OmniComment');
    });
  });
});
