// @ts-nocheck
/**
 * Workflow engine — shared types.
 *
 * The engine is a deterministic orchestration layer (XState v5) that sits ON TOP
 * of OpenClaw. Control flow (which node, which branch, which loop) is 100%
 * deterministic; only nodes explicitly marked `model` / `agent` carry
 * non-determinism, and that non-determinism is constrained (schema + retries).
 *
 * This module is intentionally electron-free so it can be unit-tested in the
 * jsdom Vitest environment and (later) reused by a CloudClaw sidecar.
 */
import type { AnyStateMachine } from 'xstate';
import type { OpenClawAdapter } from './adapter/openclaw-adapter';
import type { DynamicWorkflowDefinition } from './dynamic/types';

/** Which kind of work a workflow state performs — drives the audit trace. */
export type StepKind = 'deterministic' | 'model' | 'agent';

/** Lifecycle status of a single run. */
export type RunStatus = 'running' | 'done' | 'failed';

/** One node visited during a run, with its determinism classification. */
export interface TraceEntry {
  /** Stringified XState state value. */
  state: string;
  /** Determinism classification for this node (undefined for terminal states). */
  stepKind?: StepKind;
  status: 'running' | 'completed' | 'failed';
  /** Wall-clock ms when this entry was last updated. */
  at: number;
}

/** Full status of a workflow run — also the payload of `workflow:progress`. */
export interface RunRecord {
  runId: string;
  defId: string;
  version: number;
  title: string;
  status: RunStatus;
  /** Current XState state value (stringified). */
  currentState: string;
  /** Determinism classification of the current node. */
  currentStepKind?: StepKind;
  /** Ordered list of nodes visited, with per-node status. */
  trace: TraceEntry[];
  /**
   * Per-step outputs (stepId → result text), mirrored from the XState context
   * `results` map so the UI can show each step's result inline. Persisted in the
   * run snapshot, so it survives restart (reconstructed by `getStatus`).
   */
  results?: Record<string, string>;
  /** Final synthesized result text, set when the run reaches `done`. */
  result?: string;
  error?: string;
  startedAt: number;
  updatedAt: number;
}

/**
 * A registered workflow. `createMachine` receives the adapter so its actors can
 * call `callTool` / `runModel` / `runAgent`. `stepKinds` maps each non-terminal
 * state value to its determinism classification (for the audit trace).
 */
export interface WorkflowDefinition {
  id: string;
  /** Bumped whenever the machine shape changes; persisted into snapshots. */
  version: number;
  title: string;
  stepKinds: Record<string, StepKind>;
  createMachine: (adapter: OpenClawAdapter) => AnyStateMachine;
}

/** Persisted snapshot record (one JSON file per run). */
export interface SnapshotRecord {
  runId: string;
  defId: string;
  version: number;
  status: RunStatus;
  /** Output of `actor.getPersistedSnapshot()` — pure JSON. */
  snapshot: unknown;
  /** Original `start()` input, replayed verbatim on resume. */
  input: unknown;
  /**
   * The data-driven definition for a dynamic (Agent-generated) run, persisted so
   * the run can be resumed after a process restart — the compiled `defs` map is
   * in-memory only, so without this a restarted engine has no way to rebuild the
   * machine (retry/resume would fail and the card title would fall back to the
   * defId). Undefined for built-in workflows (they re-register at boot).
   */
  definition?: DynamicWorkflowDefinition;
  updatedAt: number;
}
