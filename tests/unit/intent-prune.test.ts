import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const prune = require('../../electron/gateway/intent-prune.cjs') as typeof import('../../electron/gateway/intent-prune.cjs');

const CODING = { intent: 'coding', keepGroups: ['fs', 'exec'], confidence: 0.7 };
const QUICK = { intent: 'quick_qa', keepGroups: [] as string[], confidence: 0.65 };

const TOOLS = ['read', 'write', 'exec', 'web_search', 'browser', 'pdf', 'nano-banana-image-gen', 'memory_search'];

describe('resolveToolPruning', () => {
  it('keeps core + kept-group tools and drops the rest for a confident intent', () => {
    const { keep, drop, pruned } = prune.resolveToolPruning(CODING, TOOLS);
    expect(pruned).toBe(true);
    // fs+exec+core kept
    expect(keep).toEqual(expect.arrayContaining(['read', 'write', 'exec', 'memory_search']));
    // unrelated tools dropped
    expect(drop).toEqual(expect.arrayContaining(['web_search', 'browser', 'pdf', 'nano-banana-image-gen']));
  });

  it('never prunes below the confidence threshold', () => {
    const { drop, pruned } = prune.resolveToolPruning({ ...CODING, confidence: 0.4 }, TOOLS);
    expect(pruned).toBe(false);
    expect(drop).toEqual([]);
  });

  it('keeps only core tools for quick_qa', () => {
    const { keep, pruned } = prune.resolveToolPruning(QUICK, TOOLS);
    expect(pruned).toBe(true);
    expect(keep).toEqual(expect.arrayContaining(['read', 'write', 'memory_search']));
    expect(keep).not.toEqual(expect.arrayContaining(['web_search', 'browser', 'pdf']));
  });

  it('never drops the entire toolset (fail-safe)', () => {
    const onlyNonCore = ['web_search', 'browser'];
    const { drop, pruned } = prune.resolveToolPruning(QUICK, onlyNonCore);
    // dropping all -> fail-safe keeps all
    expect(pruned).toBe(false);
    expect(drop).toEqual([]);
  });

  it('keeps all when profile is malformed', () => {
    expect(prune.resolveToolPruning(null, TOOLS).pruned).toBe(false);
    expect(prune.resolveToolPruning({}, TOOLS).pruned).toBe(false);
  });

  it('protects core tools by substring regardless of intent', () => {
    expect(prune.isCoreTool('apply_patch')).toBe(true);
    expect(prune.isCoreTool('memory_search')).toBe(true);
    expect(prune.isCoreTool('some_browser_tool')).toBe(false);
  });
});

describe('pruneToolsArray', () => {
  const toolObjs = [
    { type: 'function', function: { name: 'read', description: 'read a file' } },
    { type: 'function', function: { name: 'web_search', description: 'search the web with a long schema '.repeat(20) } },
    { type: 'function', function: { name: 'browser', description: 'drive a browser '.repeat(20) } },
  ];

  it('removes dropped tool objects and reports before/after char sizes', () => {
    const res = prune.pruneToolsArray(toolObjs, CODING);
    const keptNames = res.tools.map((t: { function: { name: string } }) => t.function.name);
    expect(keptNames).toEqual(['read']);
    expect(res.beforeChars).toBeGreaterThan(res.afterChars);
    expect(res.droppedIds).toEqual(expect.arrayContaining(['web_search', 'browser']));
  });

  it('returns the array unchanged with equal sizes when not pruning', () => {
    const res = prune.pruneToolsArray(toolObjs, { ...CODING, confidence: 0.1 });
    expect(res.tools).toBe(toolObjs);
    expect(res.beforeChars).toBe(res.afterChars);
    expect(res.droppedIds).toEqual([]);
  });

  it('handles an empty tools array', () => {
    const res = prune.pruneToolsArray([], CODING);
    expect(res.beforeChars).toBe(0);
    expect(res.afterChars).toBe(0);
  });
});
