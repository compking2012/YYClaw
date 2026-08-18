import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const merge = require('../../electron/gateway/prompt-optimization-merge.cjs') as typeof import('../../electron/gateway/prompt-optimization-merge.cjs');

const sidecarPath = path.join(
  os.homedir(),
  '.openclaw',
  'logs',
  'prompt_optimization',
  merge.SIDECAR_FILENAME,
);

describe('prompt-optimization-merge', () => {
  afterEach(() => {
    try {
      fs.unlinkSync(sidecarPath);
    } catch {
      // ignore
    }
  });

  it('tracks request_body savings in by_source and total', () => {
    const stats = merge.createOptimizationStats(true, 'openai_chat');
    merge.addRoleStats(stats, 'user', 100, 80);
    const finalized = merge.finalizeOptimizationStats(stats);

    expect(finalized.total.saved_chars).toBe(20);
    expect(finalized.by_source.request_body.saved_chars).toBe(20);
    expect(finalized.by_source.tool_result.saved_chars).toBe(0);
    expect(finalized.estimated_saved_tokens).toBe(5);
  });

  it('merges tool_result sidecar into unified optimization stats', () => {
    fs.mkdirSync(path.dirname(sidecarPath), { recursive: true });
    const lineA = JSON.stringify({
      id: 'evt-a',
      source: 'tool_result',
      toolName: 'exec',
      before_chars: 500,
      after_chars: 100,
      saved_chars: 400,
      changed: true,
    });
    const lineB = JSON.stringify({
      id: 'evt-b',
      source: 'tool_result',
      toolName: 'bash',
      before_chars: 300,
      after_chars: 50,
      saved_chars: 250,
      changed: true,
    });
    fs.writeFileSync(sidecarPath, `${lineA}\n${lineB}\n`, 'utf8');

    const stats = merge.createOptimizationStats(true, 'openai_chat');
    merge.addRoleStats(stats, 'tool', 200, 150);
    const consumed = new Set<string>();
    const merged = merge.mergeToolResultSidecar(stats, { consumedIds: consumed });

    expect(merged.by_source.request_body.saved_chars).toBe(50);
    expect(merged.by_source.tool_result.saved_chars).toBe(650);
    expect(merged.by_source.tool_result.events_count).toBe(2);
    expect(merged.total.saved_chars).toBe(700);
    expect(merged.estimated_saved_tokens).toBe(175);
    expect(consumed.has('evt-a')).toBe(true);
    expect(consumed.has('evt-b')).toBe(true);

    const mergedAgain = merge.mergeToolResultSidecar(
      merge.createOptimizationStats(true, 'openai_chat'),
      { consumedIds: consumed },
    );
    expect(mergedAgain.by_source.tool_result.events_count).toBe(0);
    expect(mergedAgain.total.saved_chars).toBe(0);
  });

  it('does not expose plugin names in merged output keys', () => {
    const stats = merge.createOptimizationStats(true, 'openai_chat');
    const serialized = JSON.stringify(stats).toLowerCase();
    expect(serialized).not.toContain('tokenjuice');
    expect(serialized).toContain('request_body');
    expect(serialized).toContain('tool_result');
  });
});
