import * as assert from 'assert';
import * as Mocha from 'mocha';
import { AnchorEngine } from '../../core/AnchorEngine';

const suite = Mocha.suite;
const test = Mocha.test;

suite('AnchorEngine Test Suite', () => {
  test('should convert offset to line and character correctly', () => {
    const text = 'Line 0\nLine 1\nLine 2';
    // Line 0 is 6 chars + \n = 7 chars
    const pos0 = AnchorEngine.offsetToPosition(text, 0);
    assert.strictEqual(pos0.line, 0);
    assert.strictEqual(pos0.character, 0);

    const pos1 = AnchorEngine.offsetToPosition(text, 7);
    assert.strictEqual(pos1.line, 1);
    assert.strictEqual(pos1.character, 0);

    const pos2 = AnchorEngine.offsetToPosition(text, 10);
    assert.strictEqual(pos2.line, 1);
    assert.strictEqual(pos2.character, 3);
  });

  test('should convert position to offset correctly', () => {
    const text = 'Line 0\nLine 1\nLine 2';
    const offset = AnchorEngine.positionToOffset(text, 1, 3);
    assert.strictEqual(offset, 10);
  });

  test('should perform Tier 1 exact substring matching', () => {
    const doc = '# Header\n\nThis is a sample document for testing.\n';
    const match = AnchorEngine.locateAnchor(doc, 'sample document');
    assert.ok(match);
    assert.strictEqual(match.matchedText, 'sample document');
    assert.strictEqual(match.startLine, 2);
    assert.strictEqual(match.startChar, 10);
  });

  test('should perform Tier 2 normalized markdown matching across formatting tags', () => {
    const doc = '# Header\n\nThis is a **bold text** with [a link](https://example.com) here.\n';
    // User or WYSIWYG selection may not include raw asterisks
    const match = AnchorEngine.locateAnchor(doc, 'bold text');
    assert.ok(match);
    assert.ok(match.matchedText.includes('bold text'));
  });

  test('should strip zero-width characters in query', () => {
    const doc = 'Clean paragraph text.';
    const dirtyQuery = 'Clean\u200B paragraph\uFEFF text.';
    const match = AnchorEngine.locateAnchor(doc, dirtyQuery);
    assert.ok(match);
    assert.strictEqual(match.matchedText, 'Clean paragraph text.');
  });
});
