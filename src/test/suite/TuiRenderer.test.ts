import * as assert from 'assert';
import * as Mocha from 'mocha';
import { formatTuiCommentCard, renderMarkdownWithTuiComments } from '../../cli/tuiRenderer';
import { Comment } from '../../core/types';

const suite = Mocha.suite;
const test = Mocha.test;

suite('TUI Renderer Test Suite', () => {
  test('should format comment card with box-drawing characters', () => {
    const comment: Comment = {
      id: 'tui-1',
      anchor: { text: 'myFunction()', startLine: 1, startChar: 0, endLine: 1, endChar: 12 },
      content: 'Consider adding error handling.',
      author: 'TerminalReviewer',
      createdAt: '2026-10-28T12:00:00.000Z',
      resolved: false,
      replies: [
        {
          id: 'rep-1',
          content: 'Good catch, will add try/catch.',
          author: 'Developer',
          createdAt: '2026-10-28T12:05:00.000Z'
        }
      ]
    };

    const cardLines = formatTuiCommentCard(comment, false);
    const cardText = cardLines.join('\n');

    assert.ok(cardText.includes('┌─'));
    assert.ok(cardText.includes('└─'));
    assert.ok(cardText.includes('@TerminalReviewer'));
    assert.ok(cardText.includes('Consider adding error handling.'));
    assert.ok(cardText.includes('@Developer'));
    assert.ok(cardText.includes('Good catch, will add try/catch.'));
  });

  test('should render markdown document with inline TUI comments', () => {
    const doc = [
      '# My Code',
      '',
      'function doWork() {',
      '  return 42;',
      '}',
      '',
      '<!-- omnicomment',
      JSON.stringify({
        version: 2,
        comments: [
          {
            id: 'comm-1',
            anchor: { text: 'return 42;', startLine: 3, startChar: 2, endLine: 3, endChar: 12 },
            content: 'Explain why 42 is returned.',
            author: 'CodeReviewer',
            createdAt: '2026-10-28T00:00:00.000Z'
          }
        ]
      }),
      '-->'
    ].join('\n');

    const output = renderMarkdownWithTuiComments(doc, { useColor: false });

    assert.ok(output.includes('function doWork() {'));
    assert.ok(output.includes('return 42;'));
    assert.ok(output.includes('┌─'));
    assert.ok(output.includes('Explain why 42 is returned.'));
    // Storage block should be hidden from rendered terminal view
    assert.ok(!output.includes('<!-- omnicomment'));
  });
});
