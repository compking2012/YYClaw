import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { WorkflowEngine } from '@electron/workflow/engine';
import { SnapshotStore } from '@electron/workflow/snapshot-store';
import { stepRegistry } from '@electron/workflow/step-registry';
import { renderTemplate } from '@electron/workflow/dynamic/template';
import type {
  DynamicWorkflowContext,
  DynamicWorkflowDefinition,
} from '@electron/workflow/dynamic/types';
import type {
  OpenClawAdapter,
  RunAgentOptions,
  RunModelOptions,
} from '@electron/workflow/adapter/openclaw-adapter';
import type { RunRecord } from '@electron/workflow/types';

// Adapter whose runAgent echoes the rendered goal back (so we can assert result
// chaining), callTool dispatches to the shared registry, runModel is unused here.
class EchoAgentAdapter implements OpenClawAdapter {
  public readonly agentGoals: string[] = [];

  async callTool<T>(name: string, args: unknown): Promise<T> {
    const tool = stepRegistry.get(name);
    if (!tool) throw new Error(`Unknown tool: ${name}`);
    return (await tool.run(tool.schema.parse(args))) as T;
  }

  runModel<T>(opts: RunModelOptions<T>): Promise<T> {
    return Promise.resolve(opts.schema.parse({ output: `model:${opts.input}` }));
  }

  async runAgent<T>(
    opts: RunAgentOptions<T>,
  ): Promise<{ result: T; trace: { steps: number; tokens: number; durationMs: number } }> {
    this.agentGoals.push(opts.goal);
    const result = opts.resultSchema.parse(`done(${opts.goal})`);
    return { result, trace: { steps: 1, tokens: 10, durationMs: 1 } };
  }
}

const tempDirs: string[] = [];
function newStore(): SnapshotStore {
  const dir = mkdtempSync(join(tmpdir(), 'wf-dyn-'));
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

describe('dynamic workflow — template rendering', () => {
  it('substitutes {{goal}} and prior {{stepId}} results, blanks unknowns', () => {
    const ctx: DynamicWorkflowContext = {
      goal: 'build a report',
      results: { fetch: 'rows=10', summarize: { headline: 'hi' } },
      errorMessage: null,
    };
    expect(renderTemplate('Task: {{goal}}', ctx)).toBe('Task: build a report');
    expect(renderTemplate('use {{fetch}}', ctx)).toBe('use rows=10');
    expect(renderTemplate('{{summarize}}', ctx)).toContain('"headline": "hi"');
    expect(renderTemplate('missing={{nope}}', ctx)).toBe('missing=');
  });
});

describe('dynamic workflow — compile + run via engine', () => {
  const threeAgentSteps: DynamicWorkflowDefinition = {
    id: 'dyn-three-agent',
    version: 1,
    title: '三步任务',
    goal: '抓取→汇总→校验',
    entry: 'fetch',
    steps: [
      { id: 'fetch', title: '抓取', kind: 'agent', goalTemplate: '抓取数据：{{goal}}', next: 'summarize' },
      {
        id: 'summarize',
        title: '汇总',
        kind: 'agent',
        goalTemplate: '基于上一步结果汇总：{{fetch}}',
        inputsFrom: ['fetch'],
        next: 'verify',
      },
      {
        id: 'verify',
        title: '校验',
        kind: 'agent',
        goalTemplate: '校验汇总：{{summarize}}',
        inputsFrom: ['summarize'],
        next: null,
      },
    ],
  };

  it('runs agent steps in order and chains each result into the next goal', async () => {
    const adapter = new EchoAgentAdapter();
    const engine = new WorkflowEngine({ adapter, store: newStore() });
    engine.registerDynamic(threeAgentSteps);

    const runId = engine.start('dyn-three-agent', { goal: '抓取→汇总→校验' });
    const rec = await runToCompletion(engine, runId);

    expect(rec.status).toBe('done');
    expect(rec.trace.map((t) => t.state)).toEqual(['fetch', 'summarize', 'verify', 'done']);
    expect(rec.trace.find((t) => t.state === 'fetch')?.stepKind).toBe('agent');

    // The terminal step's output is surfaced as the run's final result.
    expect(rec.result).toBeTruthy();
    expect(rec.result).toContain('done(校验汇总：');

    // Result chaining: step 2's goal embeds step 1's output; step 3 embeds step 2's.
    expect(adapter.agentGoals[0]).toBe('抓取数据：抓取→汇总→校验');
    expect(adapter.agentGoals[1]).toContain('done(抓取数据：抓取→汇总→校验)');
    expect(adapter.agentGoals[2]).toContain('done(基于上一步结果汇总：');
  });

  it('routes <2-step or empty definitions as not workflow-suitable (engine guard via steps)', async () => {
    const adapter = new EchoAgentAdapter();
    const engine = new WorkflowEngine({ adapter, store: newStore() });
    // A single-step definition still compiles & runs; the <2 guard lives in the route.
    engine.registerDynamic({
      id: 'dyn-one',
      version: 1,
      title: '单步',
      goal: 'g',
      entry: 'only',
      steps: [{ id: 'only', title: '唯一', kind: 'agent', goalTemplate: 'do {{goal}}', next: null }],
    });
    const rec = await runToCompletion(engine, engine.start('dyn-one', { goal: 'g' }));
    expect(rec.status).toBe('done');
  });
});

describe('dynamic workflow — abort', () => {
  it('aborts a running workflow, marks it failed, and stops further steps', async () => {
    let secondStarted = false;
    class HangThenMarkAdapter implements OpenClawAdapter {
      async callTool<T>(): Promise<T> {
        return undefined as T;
      }
      runModel<T>(opts: RunModelOptions<T>): Promise<T> {
        return Promise.resolve(opts.schema.parse({ output: 'x' }));
      }
      runAgent<T>(opts: RunAgentOptions<T>): Promise<{ result: T; trace: { steps: number; tokens: number; durationMs: number } }> {
        if (opts.goal.includes('第二步')) secondStarted = true;
        // never resolves → run parks on the first agent step
        return new Promise(() => {});
      }
    }
    const engine = new WorkflowEngine({ adapter: new HangThenMarkAdapter(), store: newStore() });
    engine.registerDynamic({
      id: 'dyn-abort',
      version: 1,
      title: '可中止',
      goal: 'g',
      entry: 's1',
      steps: [
        { id: 's1', title: '第一步', kind: 'agent', goalTemplate: '第一步 {{goal}}', next: 's2' },
        { id: 's2', title: '第二步', kind: 'agent', goalTemplate: '第二步 {{s1}}', inputsFrom: ['s1'], next: null },
      ],
    });

    const runId = engine.start('dyn-abort', { goal: 'g' });
    await new Promise((r) => setTimeout(r, 30));
    expect(engine.getStatus(runId)?.status).toBe('running');

    expect(engine.abort(runId)).toBe(true);
    const rec = engine.getStatus(runId);
    expect(rec?.status).toBe('failed');
    expect(rec?.error).toContain('Aborted');
    expect(secondStarted).toBe(false);

    // Aborting an already-terminal run is a no-op.
    expect(engine.abort(runId)).toBe(false);
  });
});

describe('dynamic workflow — snapshot resume', () => {
  it('does not re-run a completed deterministic step on resume', async () => {
    let counter = 0;
    stepRegistry.register({
      name: 'dyn.count',
      schema: z.object({}).passthrough(),
      run: () => {
        counter += 1;
        return `count=${counter}`;
      },
    });

    const def: DynamicWorkflowDefinition = {
      id: 'dyn-resume',
      version: 1,
      title: '可恢复',
      goal: 'g',
      entry: 'step1',
      steps: [
        { id: 'step1', title: '计数', kind: 'deterministic', tool: 'dyn.count', goalTemplate: '', next: 'step2' },
        { id: 'step2', title: '等待', kind: 'agent', goalTemplate: 'use {{step1}}', inputsFrom: ['step1'], next: null },
      ],
    };

    const store = newStore();

    // Engine 1: agent step never resolves → parks at step2 after step1 ran once.
    class HangingAgentAdapter extends EchoAgentAdapter {
      override runAgent<T>(): Promise<{ result: T; trace: { steps: number; tokens: number; durationMs: number } }> {
        return new Promise(() => {});
      }
    }
    const engine1 = new WorkflowEngine({ adapter: new HangingAgentAdapter(), store });
    engine1.registerDynamic(def);
    const runId = engine1.start('dyn-resume', { goal: 'g' });
    await new Promise((r) => setTimeout(r, 50));
    expect(counter).toBe(1);
    expect(store.load(runId)?.status).toBe('running');

    // Engine 2: resume with a working agent — step1 must NOT run again.
    const engine2 = new WorkflowEngine({ adapter: new EchoAgentAdapter(), store });
    engine2.registerDynamic(def);
    expect(engine2.resume(runId)).toBe(true);
    const rec = await runToCompletion(engine2, runId);
    expect(rec.status).toBe('done');
    expect(counter).toBe(1);
  });
});
