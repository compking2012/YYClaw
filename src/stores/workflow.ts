/**
 * Workflow store — holds registered definitions and live run records, kept fresh
 * by the `workflow:progress` event stream pushed from the main process.
 */
import { create } from 'zustand';
import { subscribeHostEvent } from '@/lib/host-events';
import {
  listWorkflows,
  startWorkflow as startWorkflowApi,
  resumeWorkflow as resumeWorkflowApi,
  retryWorkflow as retryWorkflowApi,
  abortWorkflow as abortWorkflowApi,
} from '@/lib/workflow-api';
import type { RunRecord, WorkflowDefinitionSummary } from '@/types/workflow';

interface WorkflowState {
  definitions: WorkflowDefinitionSummary[];
  runs: Record<string, RunRecord>;
  initialized: boolean;
  init: () => Promise<void>;
  refresh: () => Promise<void>;
  start: (defId: string) => Promise<string | null>;
  resume: (runId: string) => Promise<void>;
  /** Continue a failed/aborted run from where it stopped (completed steps not re-run). */
  retry: (runId: string) => Promise<void>;
  abort: (runId: string) => Promise<void>;
  /** Merge an externally-obtained run (e.g. the start-dynamic response) into the store. */
  ingestRun: (run: RunRecord) => void;
}

let unsubscribe: (() => void) | null = null;

// Monotonic merge: a run only moves forward in time. This prevents the async
// `start()` POST response (which carries the run's INITIAL snapshot) from
// clobbering a fresher `workflow:progress` event that may have already arrived
// — the run can complete server-side before the POST round-trip resolves.
function upsertRun(runs: Record<string, RunRecord>, run: RunRecord): Record<string, RunRecord> {
  const existing = runs[run.runId];
  if (existing) {
    // A terminal run must never regress to `running` — EXCEPT a genuine restart
    // (retry), which reactivates a failed run in place with a bumped startedAt.
    // The stale `start()`/`resume()` POST response carries the SAME startedAt, so
    // it's still rejected; only a newer startedAt reopens a terminal run.
    if (
      existing.status !== 'running' &&
      run.status === 'running' &&
      !(run.startedAt > existing.startedAt)
    ) {
      return runs;
    }
    // Never move backwards in time.
    if (existing.updatedAt > run.updatedAt) return runs;
  }
  return { ...runs, [run.runId]: run };
}

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  definitions: [],
  runs: {},
  initialized: false,

  init: async () => {
    if (get().initialized) return;
    set({ initialized: true });

    unsubscribe?.();
    unsubscribe = subscribeHostEvent<RunRecord>('workflow:progress', (record) => {
      set((state) => ({ runs: upsertRun(state.runs, record) }));
    });

    await get().refresh();
  },

  refresh: async () => {
    try {
      const { definitions, runs } = await listWorkflows();
      set((state) => {
        let merged = state.runs;
        for (const run of runs) merged = upsertRun(merged, run);
        return { definitions, runs: merged };
      });
    } catch {
      // Engine may not be ready yet; the next refresh/event will reconcile.
    }
  },

  start: async (defId) => {
    const run = await startWorkflowApi(defId);
    if (run) {
      set((state) => ({ runs: upsertRun(state.runs, run) }));
      return run.runId;
    }
    return null;
  },

  resume: async (runId) => {
    const run = await resumeWorkflowApi(runId);
    if (run) {
      set((state) => ({ runs: upsertRun(state.runs, run) }));
    }
  },

  retry: async (runId) => {
    const run = await retryWorkflowApi(runId);
    if (run) {
      set((state) => ({ runs: upsertRun(state.runs, run) }));
    }
  },

  abort: async (runId) => {
    const run = await abortWorkflowApi(runId);
    if (run) {
      set((state) => ({ runs: upsertRun(state.runs, run) }));
    }
  },

  ingestRun: (run) => {
    set((state) => ({ runs: upsertRun(state.runs, run) }));
  },
}));
