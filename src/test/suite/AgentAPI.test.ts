import * as assert from 'assert';
import * as Mocha from 'mocha';
import { exportContextForLLM } from '../../core/AgentAPI';
import { getPresetConfig, getAllPresets } from '../../core/Presets';
import { Comment } from '../../core/types';

const suite = Mocha.suite;
const test = Mocha.test;

suite('AgentAPI and Presets Test Suite', () => {
  suite('exportContextForLLM', () => {
    test('should return placeholder for empty comments', () => {
      const output = exportContextForLLM([]);
      assert.ok(output.includes('No comments'));
    });

    test('should format comment threads with replies and status for LLM', () => {
      const comments: Comment[] = [
        {
          id: 'test-thread-1',
          anchor: { text: 'calculateTax()', startLine: 10, startChar: 0, endLine: 10, endChar: 14 },
          content: 'Should check for negative values.',
          author: 'AuditorAgent',
          createdAt: '2026-10-28T00:00:00.000Z',
          resolved: false,
          replies: [
            {
              id: 'rep-1',
              content: 'Added validation guard clause.',
              author: 'Developer',
              createdAt: '2026-10-28T01:00:00.000Z'
            }
          ]
        }
      ];

      const promptContext = exportContextForLLM(comments);
      assert.ok(promptContext.includes('[ID: test-thread-1] [OPEN]'));
      assert.ok(promptContext.includes('Anchored to: "calculateTax()"'));
      assert.ok(promptContext.includes('Author: @AuditorAgent'));
      assert.ok(promptContext.includes('Reply by @Developer'));
    });
  });

  suite('Presets', () => {
    test('should retrieve all 6 presets', () => {
      const all = getAllPresets();
      assert.strictEqual(all.length, 6);
      const ids = all.map(p => p.id);
      assert.ok(ids.includes('default'));
      assert.ok(ids.includes('documentation-site'));
      assert.ok(ids.includes('git-file-review'));
      assert.ok(ids.includes('browser-annotator'));
      assert.ok(ids.includes('team-collaboration'));
      assert.ok(ids.includes('ai-agent-reviewer'));
    });

    test('should fallback to default for unknown preset', () => {
      const preset = getPresetConfig('unknown-id');
      assert.strictEqual(preset.id, 'default');
    });

    test('should get specific preset config', () => {
      const preset = getPresetConfig('ai-agent-reviewer');
      assert.strictEqual(preset.id, 'ai-agent-reviewer');
      assert.strictEqual(preset.enableAgentHooks, true);
    });
  });
});
