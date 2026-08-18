import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkflowEngine } from '@electron/workflow/engine';
import { SnapshotStore } from '@electron/workflow/snapshot-store';
import type { DynamicWorkflowDefinition } from '@electron/workflow/dynamic/types';
import type {
  OpenClawAdapter,
  RunAgentOptions,
  RunModelOptions,
} from '@electron/workflow/adapter/openclaw-adapter';
import type { RunRecord } from '@electron/workflow/types';

/**
 * Agent adapter that counts calls per stepId and can be told to fail (throw) or
 * hang (never resolve) on a given step, so we can drive a run to a failed/aborted
 * state and then continue it.
 */
class ControllableAdapter implements OpenClawAdapter {
  public readonly calls: Record<string, number> = {};
  public readonly goals: Record<string, string[]> = {};
  /** runIds passed to discardRunSessions (pre-resume child-session cleanup). */
  public readonly discardedRuns: string[] = [];
  /** stepId to throw on (simulates a step erroring). */
  public failStep: string | null = null;
  /** stepId to hang on (never resolves — simulates a long-running step to abort). */
  public hangStep: string | null = null;

  async callTool<T>(): Promise<T> {
    return undefined as T;
  }

  async discardRunSessions(runId: string): Promise<void> {
    this.discardedRuns.push(runId);
  }

  runModel<T>(opts: RunModelOptions<T>): Promise<T> {
    return Promise.resolve(opts.schema.parse({ output: 'x' }));
  }

  runAgent<T>(
    opts: RunAgentOptions<T>,
  ): Promise<{ result: T; trace: { steps: number; tokens: number; durationMs: number } }> {
    const id = opts.stepId ?? '?';
    this.calls[id] = (this.calls[id] ?? 0) + 1;
    (this.goals[id] ??= []).push(opts.goal);
    if (id === this.hangStep) return new Promise(() => {});
    if (id === this.failStep) return Promise.reject(new Error(`boom at ${id}`));
    return Promise.resolve({
      result: opts.resultSchema.parse(`done(${opts.goal})`),
      trace: { steps: 1, tokens: 10, durationMs: 1 },
    });
  }
}

const threeSteps: DynamicWorkflowDefinition = {
  id: 'dyn-retry',
  version: 1,
  title: '三步任务',
  goal: '抓取→汇总→校验',
  entry: 'fetch',
  steps: [
    { id: 'fetch', title: '抓取', kind: 'agent', goalTemplate: '抓取：{{goal}}', next: 'summarize' },
    { id: 'summarize', title: '汇总', kind: 'agent', goalTemplate: '汇总：{{fetch}}', inputsFrom: ['fetch'], next: 'verify' },
    { id: 'verify', title: '校验', kind: 'agent', goalTemplate: '校验：{{summarize}}', inputsFrom: ['summarize'], next: null },
  ],
};

const tempDirs: string[] = [];
function newStore(): SnapshotStore {
  const dir = mkdtempSync(join(tmpdir(), 'wf-retry-'));
  tempDirs.push(dir);
  return new SnapshotStore(dir);
}

function runToCompletion(engine: WorkflowEngine, runId: string): Promise<RunRecord> {
  return new Promise((resolve) => {
    const existing = engine.getStatus(runId);
    if (existing && existing.status !== 'running') return resolve(existing);
    const onProgress = (rec: RunRecord) => {
      if (rec.runId === runId && rec.status !== 'running') {
        engine.off('workflow:progress', onProgress);
        resolve(rec);
      }
    };
    engine.on('workflow:progress', onProgress);
  });
}

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('dynamic workflow — retry after failure', () => {
  it('continues from the failed step, keeping completed steps (they are not re-run)', async () => {
    const adapter = new ControllableAdapter();
    adapter.failStep = 'summarize';
    const engine = new WorkflowEngine({ adapter, store: newStore() });
    engine.registerDynamic(threeSteps);

    // First attempt: fetch completes, summarize throws → run fails at summarize.
    const runId = engine.start('dyn-retry', { goal: '抓取→汇总→校验' });
    const failed = await runToCompletion(engine, runId);
    expect(failed.status).toBe('failed');
    expect(failed.error).toContain('boom at summarize');
    expect(adapter.calls).toEqual({ fetch: 1, summarize: 1 });
    expect(failed.results?.fetch).toContain('done(抓取：');

    // Fix the world and continue: fetch must be SKIPPED, summarize + verify run.
    adapter.failStep = null;
    expect(await engine.retry(runId)).toBe(true);
    const done = await runToCompletion(engine, runId);

    expect(done.status).toBe('done');
    expect(adapter.calls.fetch).toBe(1); // never re-ran the completed step
    expect(adapter.calls.summarize).toBe(2); // the failed step re-ran
    expect(adapter.calls.verify).toBe(1);
    // Result chaining survived: summarize's retry goal embedded fetch's stored output.
    expect(adapter.goals.summarize.at(-1)).toContain('done(抓取：');
    expect(done.result).toContain('done(校验：');

    // Residual gateway sub-sessions were discarded before re-running, so the
    // reused child-session keys start clean (no stale original-run messages).
    expect(adapter.discardedRuns).toContain(runId);
  });

  it('rejects retry unless the run is failed', async () => {
    const adapter = new ControllableAdapter();
    const engine = new WorkflowEngine({ adapter, store: newStore() });
    engine.registerDynamic(threeSteps);

    const runId = engine.start('dyn-retry', { goal: 'g' });
    const done = await runToCompletion(engine, runId);
    expect(done.status).toBe('done');
    expect(await engine.retry(runId)).toBe(false); // a completed run is not resumable
    expect(await engine.retry('no-such-run')).toBe(false);
  });
});

describe('dynamic workflow — retry after abort', () => {
  it('preserves the snapshot on abort and continues from the aborted step', async () => {
    const adapter = new ControllableAdapter();
    adapter.hangStep = 'summarize';
    const store = newStore();
    const engine = new WorkflowEngine({ adapter, store });
    engine.registerDynamic(threeSteps);

    const runId = engine.start('dyn-retry', { goal: 'g' });
    await new Promise((r) => setTimeout(r, 40));
    expect(engine.getStatus(runId)?.status).toBe('running'); // parked on summarize

    expect(engine.abort(runId)).toBe(true);
    // Abort now persists a snapshot carrying the completed step's output (so a
    // later retry can skip it) instead of nulling it out.
    const saved = store.load(runId);
    expect(saved?.status).toBe('failed');
    expect(saved?.snapshot).not.toBeNull();
    const savedResults = (saved?.snapshot as { context?: { results?: Record<string, unknown> } } | null)
      ?.context?.results;
    expect(savedResults?.fetch).toContain('done(抓取：');
    // A failed/aborted run is never auto-rehydrated on restart.
    expect(store.listActive().some((r) => r.runId === runId)).toBe(false);

    // Let summarize resolve, then continue: fetch stays skipped.
    adapter.hangStep = null;
    expect(await engine.retry(runId)).toBe(true);
    const done = await runToCompletion(engine, runId);
    expect(done.status).toBe('done');
    expect(adapter.calls.fetch).toBe(1);
    expect(adapter.calls.summarize).toBeGreaterThanOrEqual(1);
    expect(adapter.calls.verify).toBe(1);
  });
});

describe('dynamic workflow — resume after a restart (def rebuilt from persisted record)', () => {
  it('a fresh engine (def NOT registered) rebuilds the dynamic def from the snapshot and continues', async () => {
    const store = newStore();

    // Engine A: register + run, fail at summarize, persist a failed record.
    const adapterA = new ControllableAdapter();
    adapterA.failStep = 'summarize';
    const engineA = new WorkflowEngine({ adapter: adapterA, store });
    engineA.registerDynamic(threeSteps);
    const runId = engineA.start('dyn-retry', { goal: '抓取→汇总→校验' });
    const failed = await runToCompletion(engineA, runId);
    expect(failed.status).toBe('failed');

    // Engine B simulates a process restart: brand-new instance, SAME store, and
    // it never called registerDynamic — the only source of the def is the
    // persisted SnapshotRecord.definition.
    const adapterB = new ControllableAdapter();
    const engineB = new WorkflowEngine({ adapter: adapterB, store });

    // Before resuming, a reopened card must show the real title, not the defId.
    const reconstructed = engineB.getStatus(runId);
    expect(reconstructed?.title).toBe('三步任务');
    expect(reconstructed?.title).not.toBe('dyn-retry');

    // Retry rebuilds the def from the record and continues to completion.
    expect(await engineB.retry(runId)).toBe(true);
    const done = await runToCompletion(engineB, runId);
    expect(done.status).toBe('done');
    // fetch already had a result in the persisted snapshot → not re-run on B.
    expect(adapterB.calls.fetch).toBeUndefined();
    expect(adapterB.calls.summarize).toBeGreaterThanOrEqual(1);
    expect(adapterB.calls.verify).toBe(1);
    expect(adapterB.discardedRuns).toContain(runId);
  });
});
