import * as assert from 'assert';
import * as Mocha from 'mocha';
import { MarkdownStorageAdapter } from '../../storage/MarkdownStorageAdapter';
import { MemoryStorageAdapter } from '../../storage/MemoryStorageAdapter';
import { Comment } from '../../core/types';

const suite = Mocha.suite;
const test = Mocha.test;

suite('StorageAdapter Test Suite', () => {
  suite('MarkdownStorageAdapter', () => {
    const adapter = new MarkdownStorageAdapter();

    test('should parse comments from modern <!-- omnicomment block', () => {
      const commentData = {
        version: 2,
        comments: [
          {
            id: 'omni-123',
            anchor: { text: 'Hello', startLine: 0, startChar: 0, endLine: 0, endChar: 5 },
            content: 'Modern omnicomment comment',
            author: 'OmniAgent',
            createdAt: '2026-10-28T00:00:00.000Z'
          }
        ]
      };
      const text = `# Title\n\n<!-- omnicomment\n${JSON.stringify(commentData)}\n-->`;
      const comments = adapter.parseCommentsFromText(text);

      assert.strictEqual(comments.length, 1);
      assert.strictEqual(comments[0].id, 'omni-123');
      assert.strictEqual(comments[0].content, 'Modern omnicomment comment');
      assert.strictEqual(comments[0].author, 'OmniAgent');
    });

    test('should parse comments from <!-- omnicomment block with different whitespace', () => {
      const commentData = {
        version: 2,
        comments: [
          {
            id: 'sample-123',
            anchor: { text: 'Hello', startLine: 0, startChar: 0, endLine: 0, endChar: 5 },
            content: 'Sample omnicomment comment',
            author: 'OldUser',
            createdAt: '2026-01-01T00:00:00.000Z'
          }
        ]
      };
      const text = `# Title\n\n<!-- omnicomment\n${JSON.stringify(commentData)}\n-->`;
      const comments = adapter.parseCommentsFromText(text);

      assert.strictEqual(comments.length, 1);
      assert.strictEqual(comments[0].id, 'sample-123');
      assert.strictEqual(comments[0].content, 'Sample omnicomment comment');
    });

    test('should append modern <!-- omnicomment block when no block exists', () => {
      const initial = '# My Document\n\nParagraph text.';
      const sampleComments: Comment[] = [
        {
          id: 'test-1',
          anchor: { text: 'Paragraph', startLine: 2, startChar: 0, endLine: 2, endChar: 9 },
          content: 'First comment',
          author: 'user',
          createdAt: '2026-10-28T00:00:00.000Z'
        }
      ];

      const updated = adapter.formatUpdatedText(initial, sampleComments);
      assert.ok(updated.includes('<!-- omnicomment'));
      assert.ok(updated.includes('"id": "test-1"'));
    });

    test('should preserve existing marker when updating an existing block', () => {
      const initial = `# Doc\n\n<!-- omnicomment\n{"version": 2, "comments": []}\n-->`;
      const sampleComments: Comment[] = [
        {
          id: 'test-2',
          anchor: { text: 'Doc', startLine: 0, startChar: 2, endLine: 0, endChar: 5 },
          content: 'Updated comment',
          author: 'user',
          createdAt: '2026-10-28T00:00:00.000Z'
        }
      ];

      const updated = adapter.formatUpdatedText(initial, sampleComments);
      assert.ok(updated.includes('<!-- omnicomment'));
      assert.ok(updated.includes('"id": "test-2"'));
    });

    test('should parse comments from legacy <!-- markco-comments block and ignore occurrences in code blocks', () => {
      // Topology: # Doc -> ```mermaid\nSave to <!-- omnicomment\n``` -> <!-- markco-comments\n{"comments":[...]}\n-->
      // Expected: Parses legacy block at end while ignoring the delimiter inside the mermaid code block.
      const legacyCommentData = {
        version: 2,
        comments: [
          {
            id: 'legacy-1',
            anchor: { text: 'Heading', startLine: 0, startChar: 2, endLine: 0, endChar: 9 },
            content: 'Legacy comment content',
            author: 'LegacyUser',
            createdAt: '2026-01-01T00:00:00.000Z'
          }
        ]
      };
      const text = [
        '# Heading',
        '',
        '```mermaid',
        'sequenceDiagram',
        '  A->>B: Save to <!-- omnicomment Block',
        '```',
        '',
        `<!-- markco-comments\n${JSON.stringify(legacyCommentData)}\n-->`
      ].join('\n');

      const comments = adapter.parseCommentsFromText(text);
      assert.strictEqual(comments.length, 1);
      assert.strictEqual(comments[0].id, 'legacy-1');
      assert.strictEqual(comments[0].content, 'Legacy comment content');
    });
  });

  suite('MemoryStorageAdapter', () => {
    test('should store and retrieve comments in memory', async () => {
      const memory = new MemoryStorageAdapter();
      const testComments: Comment[] = [
        {
          id: 'mem-1',
          anchor: { text: 'Test', startLine: 0, startChar: 0, endLine: 0, endChar: 4 },
          content: 'In memory',
          author: 'agent',
          createdAt: '2026-10-28T00:00:00.000Z'
        }
      ];

      await memory.saveComments('doc1', testComments);
      const loaded = await memory.loadComments('doc1');
      assert.strictEqual(loaded.length, 1);
      assert.strictEqual(loaded[0].id, 'mem-1');

      await memory.deleteComments('doc1');
      const afterDelete = await memory.loadComments('doc1');
      assert.strictEqual(afterDelete.length, 0);
    });
  });
});
