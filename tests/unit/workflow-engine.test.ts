import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setup, fromPromise, assign } from 'xstate';
import { z } from 'zod';
import { WorkflowEngine } from '@electron/workflow/engine';
import { SnapshotStore } from '@electron/workflow/snapshot-store';
import { stepRegistry } from '@electron/workflow/step-registry';
import { demoReportDefinition, registerDemoTools } from '@electron/workflow/definitions/demo-report';
import type {
  OpenClawAdapter,
  RunModelOptions,
} from '@electron/workflow/adapter/openclaw-adapter';
import type { RunRecord, WorkflowDefinition } from '@electron/workflow/types';

// A test adapter: callTool dispatches to the shared step registry (deterministic),
// runModel is injected per-test so we can drive the model node's behaviour.
class TestAdapter implements OpenClawAdapter {
  constructor(private readonly runModelImpl: (opts: RunModelOptions<unknown>) => Promise<unknown>) {}

  async callTool<T>(name: string, args: unknown): Promise<T> {
    const tool = stepRegistry.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return (await tool.run(tool.schema.parse(args))) as T;
  }

  runModel<T>(opts: RunModelOptions<T>): Promise<T> {
    return this.runModelImpl(opts as RunModelOptions<unknown>) as Promise<T>;
  }

  async runAgent<T>(): Promise<{ result: T; trace: { steps: number; tokens: number; durationMs: number } }> {
    throw new Error('not implemented in tests');
  }
}

const tempDirs: string[] = [];
function newStore(): SnapshotStore {
  const dir = mkdtempSync(join(tmpdir(), 'wf-test-'));
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

function waitForState(engine: WorkflowEngine, runId: string, state: string): Promise<void> {
  return new Promise((resolve) => {
    const cur = engine.getStatus(runId);
    if (cur?.currentState === state) return resolve();
    const onProgress = (rec: RunRecord) => {
      if (rec.runId === runId && rec.currentState === state) {
        engine.off('workflow:progress', onProgress);
        resolve();
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

describe('WorkflowEngine — demo workflow', () => {
  it('runs the model branch deterministically end to end', async () => {
    registerDemoTools();
    const adapter = new TestAdapter(async (o) =>
      o.schema.parse({ headline: 'h', bullets: ['b'], rowCount: 8 }),
    );
    const engine = new WorkflowEngine({ adapter, store: newStore() });
    engine.register(demoReportDefinition);

    const runId = engine.start('demo-report', {});
    const rec = await runToCompletion(engine, runId);

    expect(rec.status).toBe('done');
    expect(rec.trace.map((t) => t.state)).toEqual(['loading', 'summarizing', 'checking', 'done']);
    expect(rec.trace.find((t) => t.state === 'summarizing')?.stepKind).toBe('model');
    expect(rec.trace.find((t) => t.state === 'loading')?.stepKind).toBe('deterministic');
  });

  it('falls back to a deterministic summary when the model step fails', async () => {
    registerDemoTools();
    const adapter = new TestAdapter(async () => {
      throw new Error('no provider configured');
    });
    const engine = new WorkflowEngine({ adapter, store: newStore() });
    engine.register(demoReportDefinition);

    const rec = await runToCompletion(engine, engine.start('demo-report', {}));

    expect(rec.status).toBe('done');
    expect(rec.trace.map((t) => t.state)).toContain('fallbackSummarizing');
  });

  it('produces an identical control-flow trace on repeated runs', async () => {
    registerDemoTools();
    const adapter = new TestAdapter(async (o) =>
      o.schema.parse({ headline: 'h', bullets: ['b'], rowCount: 8 }),
    );
    const engine = new WorkflowEngine({ adapter, store: newStore() });
    engine.register(demoReportDefinition);

    const a = await runToCompletion(engine, engine.start('demo-report', {}));
    const b = await runToCompletion(engine, engine.start('demo-report', {}));
    expect(a.trace.map((t) => t.state)).toEqual(b.trace.map((t) => t.state));
  });
});

describe('WorkflowEngine — discardRun', () => {
  it('aborts a running run, forgets its record, and deletes its snapshot so it never rehydrates', async () => {
    registerDemoTools();
    const store = newStore();
    // The model step never resolves, so the run parks mid-flight with a
    // persisted `running` snapshot — exactly the state that would rehydrate
    // on the next startup.
    const engine = new WorkflowEngine({
      adapter: new TestAdapter(() => new Promise<unknown>(() => {})),
      store,
    });
    engine.register(demoReportDefinition);
    const runId = engine.start('demo-report', {});
    await waitForState(engine, runId, 'summarizing');
    expect(store.load(runId)?.status).toBe('running');

    engine.discardRun(runId);

    expect(engine.getStatus(runId)).toBeNull();
    expect(store.load(runId)).toBeNull();
    // A fresh engine (≈ app restart) must not find anything to resume.
    const engine2 = new WorkflowEngine({
      adapter: new TestAdapter(async (o) => o.schema.parse({ headline: 'h', bullets: ['b'], rowCount: 1 })),
      store,
    });
    engine2.register(demoReportDefinition);
    expect(engine2.resume(runId)).toBe(false);
    expect(store.listActive()).toEqual([]);
  });

  it('is a safe no-op for unknown run ids', () => {
    const engine = new WorkflowEngine({
      adapter: new TestAdapter(async (o) => o.schema.parse({})),
      store: newStore(),
    });
    expect(() => engine.discardRun('no-such-run')).not.toThrow();
  });
});

describe('WorkflowEngine — versioning & durability', () => {
  it('quarantines a run whose snapshot version no longer matches the definition', async () => {
    registerDemoTools();
    const store = newStore();
    store.save({
      runId: 'stale-run',
      defId: 'demo-report',
      version: 999,
      status: 'running',
      snapshot: {},
      input: {},
      updatedAt: 1,
    });
    const adapter = new TestAdapter(async (o) => o.schema.parse({ headline: 'h', bullets: ['b'], rowCount: 1 }));
    const engine = new WorkflowEngine({ adapter, store });
    engine.register(demoReportDefinition);

    expect(engine.resume('stale-run')).toBe(false);
    expect(engine.getStatus('stale-run')?.status).toBe('failed');
  });

  it('resumes from a snapshot without re-running completed deterministic steps', async () => {
    let counter = 0;
    stepRegistry.register({
      name: 'test.count',
      schema: z.object({}).passthrough(),
      run: () => {
        counter += 1;
        return counter;
      },
    });

    const TestSchema = z.object({ ok: z.boolean() });
    const countingDef: WorkflowDefinition = {
      id: 'test-count',
      version: 1,
      title: 'Counting',
      stepKinds: { stepA: 'deterministic', waiting: 'model' },
      createMachine: (adapter) =>
        setup({
          types: {} as { context: { n: number | null }; input: Record<string, never> },
          actors: {
            count: fromPromise(() => adapter.callTool<number>('test.count', {})),
            wait: fromPromise(() =>
              adapter.runModel<{ ok: boolean }>({ system: '', input: '', schema: TestSchema })),
          },
        }).createMachine({
          id: 'tc',
          initial: 'stepA',
          context: { n: null },
          states: {
            stepA: {
              invoke: {
                src: 'count',
                onDone: { target: 'waiting', actions: assign({ n: ({ event }) => event.output }) },
                onError: 'failed',
              },
            },
            waiting: { invoke: { src: 'wait', onDone: 'done', onError: 'failed' } },
            done: { type: 'final' },
            failed: { type: 'final' },
          },
        }),
    };

    const store = newStore();

    // Engine 1: the model step never resolves, so the run parks at `waiting`
    // with a persisted snapshot AFTER stepA has already run once.
    const engine1 = new WorkflowEngine({
      adapter: new TestAdapter(() => new Promise<unknown>(() => {})),
      store,
    });
    engine1.register(countingDef);
    const runId = engine1.start('test-count', {});
    await waitForState(engine1, runId, 'waiting');
    expect(counter).toBe(1);
    expect(store.load(runId)?.status).toBe('running');

    // Engine 2: resume from the persisted snapshot with a model step that now
    // resolves. stepA must NOT run again (its result lives in the snapshot).
    const engine2 = new WorkflowEngine({
      adapter: new TestAdapter(async (o) => o.schema.parse({ ok: true })),
      store,
    });
    engine2.register(countingDef);
    expect(engine2.resume(runId)).toBe(true);

    const rec = await runToCompletion(engine2, runId);
    expect(rec.status).toBe('done');
    expect(counter).toBe(1);
  });
});
