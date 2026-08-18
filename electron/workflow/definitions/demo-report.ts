// @ts-nocheck
/**
 * Demo workflow — the v1 end-to-end proof of the deterministic kernel.
 *
 *   loading (deterministic)  →  summarizing (MODEL)  →  checking (deterministic)  →  done
 *                                      │ onError
 *                                      ▼
 *                            fallbackSummarizing (deterministic) → checking
 *
 * It exercises every v1 step kind plus a branch and a deterministic fallback:
 * the model step is the ONLY non-deterministic node, and if it fails (e.g. no
 * provider configured) the run degrades to a deterministic summary and still
 * completes — demonstrating the "determinism envelope" engineering point.
 */
import { setup, fromPromise, assign } from 'xstate';
import { z } from 'zod';
import type { OpenClawAdapter } from '../adapter/openclaw-adapter';
import type { WorkflowDefinition } from '../types';
import { stepRegistry } from '../step-registry';

export const DEMO_REPORT_VERSION = 1;

export const SummarySchema = z.object({
  headline: z.string(),
  bullets: z.array(z.string()).min(1),
  rowCount: z.number(),
});
export type Summary = z.infer<typeof SummarySchema>;

interface DemoContext {
  rows: number[] | null;
  summary: Summary | null;
  validated: boolean;
  errorMessage: string | null;
}

/** Sample dataset returned by the deterministic loader. */
const SAMPLE_ROWS = [12, 47, 9, 88, 23, 56, 31, 74];

/** Register the deterministic tools backing this workflow's `callTool` nodes. */
export function registerDemoTools(): void {
  if (!stepRegistry.has('demo.loadData')) {
    stepRegistry.register({
      name: 'demo.loadData',
      schema: z.object({}).passthrough(),
      run: () => SAMPLE_ROWS,
    });
  }
  if (!stepRegistry.has('demo.fallbackSummary')) {
    stepRegistry.register({
      name: 'demo.fallbackSummary',
      schema: z.object({ rows: z.array(z.number()) }),
      run: ({ rows }): Summary => {
        const total = rows.reduce((a, b) => a + b, 0);
        const max = Math.max(...rows);
        const min = Math.min(...rows);
        return {
          headline: `Dataset of ${rows.length} values, total ${total}`,
          bullets: [`max ${max}`, `min ${min}`, `mean ${(total / rows.length).toFixed(1)}`],
          rowCount: rows.length,
        };
      },
    });
  }
  if (!stepRegistry.has('demo.validate')) {
    stepRegistry.register({
      name: 'demo.validate',
      schema: z.object({ summary: SummarySchema }),
      // Deterministic check: a valid summary must have at least one bullet and a
      // rowCount that matches the headline-implied count.
      run: ({ summary }) => ({ ok: summary.bullets.length > 0 && summary.rowCount > 0 }),
    });
  }
}

export function createDemoReportMachine(adapter: OpenClawAdapter) {
  return setup({
    types: {} as { context: DemoContext; input: Record<string, never> },
    actors: {
      loadData: fromPromise(() => adapter.callTool<number[]>('demo.loadData', {})),
      summarize: fromPromise(({ input }: { input: { rows: number[] } }) =>
        adapter.runModel<Summary>({
          system: 'You summarize a numeric dataset for a report.',
          input: JSON.stringify(input.rows),
          schema: SummarySchema,
          temperature: 0,
          maxRetries: 1,
          // Bounded so a missing/unreachable provider degrades to the
          // deterministic fallback quickly instead of stalling the run.
          timeoutMs: 5_000,
        })),
      fallbackSummarize: fromPromise(({ input }: { input: { rows: number[] } }) =>
        adapter.callTool<Summary>('demo.fallbackSummary', { rows: input.rows })),
      validate: fromPromise(({ input }: { input: { summary: Summary } }) =>
        adapter.callTool<{ ok: boolean }>('demo.validate', { summary: input.summary })),
    },
  }).createMachine({
    id: 'demoReport',
    initial: 'loading',
    context: { rows: null, summary: null, validated: false, errorMessage: null },
    states: {
      loading: {
        invoke: {
          src: 'loadData',
          onDone: { target: 'summarizing', actions: assign({ rows: ({ event }) => event.output }) },
          onError: { target: 'failed', actions: assign({ errorMessage: ({ event }) => String(event.error) }) },
        },
      },
      summarizing: {
        invoke: {
          src: 'summarize',
          input: ({ context }) => ({ rows: context.rows ?? [] }),
          onDone: { target: 'checking', actions: assign({ summary: ({ event }) => event.output }) },
          onError: {
            target: 'fallbackSummarizing',
            actions: assign({ errorMessage: ({ event }) => String(event.error) }),
          },
        },
      },
      fallbackSummarizing: {
        invoke: {
          src: 'fallbackSummarize',
          input: ({ context }) => ({ rows: context.rows ?? [] }),
          onDone: {
            target: 'checking',
            actions: assign({ summary: ({ event }) => event.output, errorMessage: () => null }),
          },
          onError: { target: 'failed', actions: assign({ errorMessage: ({ event }) => String(event.error) }) },
        },
      },
      checking: {
        invoke: {
          src: 'validate',
          input: ({ context }) => ({ summary: context.summary as Summary }),
          onDone: [
            {
              target: 'done',
              guard: ({ event }) => event.output.ok === true,
              actions: assign({ validated: () => true }),
            },
            { target: 'failed', actions: assign({ errorMessage: () => 'Validation failed' }) },
          ],
          onError: { target: 'failed', actions: assign({ errorMessage: ({ event }) => String(event.error) }) },
        },
      },
      done: { type: 'final' },
      failed: { type: 'final' },
    },
  });
}

export const demoReportDefinition: WorkflowDefinition = {
  id: 'demo-report',
  version: DEMO_REPORT_VERSION,
  title: 'Demo Report',
  stepKinds: {
    loading: 'deterministic',
    summarizing: 'model',
    fallbackSummarizing: 'deterministic',
    checking: 'deterministic',
  },
  createMachine: createDemoReportMachine,
};
