import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as Mocha from 'mocha';

const suite = Mocha.suite;
const test = Mocha.test;

// Require the generator script
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  PAGES,
  preprocessMarkdown,
  extractTocAndInjectIds,
  buildDocumentation
} = require('../../../scripts/render-docs');

suite('DocRenderer Test Suite', () => {
  test('PAGES manifest contains required documentation routes', () => {
    assert.ok(Array.isArray(PAGES));
    const ids = PAGES.map((p: { id: string }) => p.id);
    assert.ok(ids.includes('home'));
    assert.ok(ids.includes('tutorial'));
    assert.ok(ids.includes('api-reference'));
    assert.ok(ids.includes('agent-api'));
    assert.ok(ids.includes('integration'));
    assert.ok(ids.includes('firebase-server-guide'));
    assert.ok(ids.includes('server-frameworks-guide'));
    assert.ok(ids.includes('presets'));
    assert.ok(ids.includes('architecture'));
    assert.ok(ids.includes('readme'));
  });

  test('preprocessMarkdown transforms GitHub callouts to alert divs', () => {
    const raw = `
> [!NOTE]
> This is a critical background explanation.

> [!TIP]
> Use keyboard shortcuts for fast workflows.
`;
    const processed = preprocessMarkdown(raw, 'test.html');
    assert.ok(processed.includes('class="omni-alert alert-note"'));
    assert.ok(processed.includes('class="omni-alert alert-tip"'));
    assert.ok(processed.includes('This is a critical background explanation.'));
  });

  test('preprocessMarkdown converts carousel syntax to carousel container', () => {
    const raw = `
\`\`\`\`carousel
Slide 1 content
<!-- slide -->
Slide 2 content
\`\`\`\`
`;
    const processed = preprocessMarkdown(raw, 'test.html');
    assert.ok(processed.includes('class="omni-carousel"'));
    assert.ok(processed.includes('class="omni-carousel-tab'));
    assert.ok(processed.includes('class="omni-carousel-slide'));
    assert.ok(processed.includes('Slide 1 content'));
  });

  test('preprocessMarkdown rewrites relative and absolute .md links to .html', () => {
    const raw = `
Check out the [Tutorial](docs/TUTORIAL.md) and [API](file:///usr/local/path/docs/API_REFERENCE.md#part-1).
`;
    const processed = preprocessMarkdown(raw, 'test.html');
    assert.ok(processed.includes('tutorial.html'));
    assert.ok(processed.includes('api-reference.html#part-1'));
  });

  test('extractTocAndInjectIds generates anchor IDs and populates TOC list', () => {
    const rawHtml = '<h2>Overview</h2><p>text</p><h3>Key Features</h3>';
    const { html, toc } = extractTocAndInjectIds(rawHtml);

    assert.strictEqual(toc.length, 2);
    assert.strictEqual(toc[0].id, 'overview');
    assert.strictEqual(toc[0].text, 'Overview');
    assert.strictEqual(toc[1].id, 'key-features');
    assert.strictEqual(toc[1].text, 'Key Features');

    assert.ok(html.includes('id="overview"'));
    assert.ok(html.includes('id="key-features"'));
    assert.ok(html.includes('class="omni-heading-anchor"'));
  });

  test('buildDocumentation compiles complete site to a temporary directory', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omni-docs-test-'));
    try {
      const result = buildDocumentation(tempDir);
      assert.ok(result.successCount >= 7);

      assert.ok(fs.existsSync(path.join(tempDir, 'index.html')));
      assert.ok(fs.existsSync(path.join(tempDir, 'tutorial.html')));
      assert.ok(fs.existsSync(path.join(tempDir, 'api-reference.html')));
      assert.ok(fs.existsSync(path.join(tempDir, 'agent-api.html')));
      assert.ok(fs.existsSync(path.join(tempDir, 'integration.html')));
      assert.ok(fs.existsSync(path.join(tempDir, 'firebase-server-guide.html')));
      assert.ok(fs.existsSync(path.join(tempDir, 'server-frameworks-guide.html')));
      assert.ok(fs.existsSync(path.join(tempDir, 'presets.html')));
      assert.ok(fs.existsSync(path.join(tempDir, 'architecture.html')));

      const indexHtml = fs.readFileSync(path.join(tempDir, 'index.html'), 'utf-8');
      assert.ok(indexHtml.includes('OmniComment'));
      assert.ok(indexHtml.includes('<nav class="sidebar"'));
      assert.ok(indexHtml.includes('<omni-comment'));
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
