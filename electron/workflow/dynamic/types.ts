// @ts-nocheck
/**
 * Dynamic workflow — data-driven definition.
 *
 * Unlike the hand-written XState definitions (e.g. demo-report), a dynamic
 * workflow is a plain-data `steps[]` description that an Agent can GENERATE at
 * runtime. `compileToMachine` (see ./compile) turns it into a real XState
 * machine so it becomes a first-class citizen of the existing WorkflowEngine —
 * reusing its snapshot/resume/`workflow:progress` machinery unchanged.
 *
 * This module is electron-free (unit-testable).
 */

/** Determinism class of a step — mirrors the engine's StepKind. */
export type DynamicStepKind = 'agent' | 'model' | 'deterministic';

/** One step of a dynamic workflow. */
export interface DynamicStep {
  /** Unique within the definition; used as the XState state value / trace name. */
  id: string;
  /** Human-readable Chinese stage label (2–8 chars), shown in the chat floater. */
  title: string;
  /** Default 'agent' — the step runs a full agent loop (tools allowed). */
  kind: DynamicStepKind;
  /**
   * The instruction for this step. Supports `{{stepId}}` placeholders that are
   * substituted with prior steps' outputs, and `{{goal}}` for the overall task.
   * For `agent` it becomes the agent goal; for `model` the user input.
   */
  goalTemplate: string;
  /** `model` steps only: the system prompt for the constrained model call. */
  systemPrompt?: string;
  /** Which prior step outputs to surface into this step's template (for clarity/validation). */
  inputsFrom?: string[];
  /** Phase 1 supports only 'text'; structured output is a future extension. */
  outputSchema?: 'text';
  /** `deterministic` steps only: name of a registered StepRegistry tool. */
  tool?: string;
  /** Next step id to transition to on success; `null` marks the final step. */
  next: string | null;
}

/** A complete data-driven workflow that can be compiled into an XState machine. */
export interface DynamicWorkflowDefinition {
  id: string;
  /** Bumped whenever the shape changes; persisted into snapshots. */
  version: number;
  title: string;
  /** The original user task this workflow was generated for. */
  goal: string;
  /** Entry step id. */
  entry: string;
  steps: DynamicStep[];
}

/** Runtime context carried by a compiled dynamic machine (pure JSON → snapshotable). */
export interface DynamicWorkflowContext {
  /** Overall task; available as `{{goal}}` in templates. */
  goal: string;
  /** Optional agent to execute `agent` steps on (single-agent scenario). */
  agentId?: string;
  /** The engine run id — used to derive each node's deterministic child session key. */
  runId?: string;
  /** The main conversation session this workflow belongs to. */
  parentSessionKey?: string;
  /** Accumulated per-step outputs, keyed by step id; drives result chaining. */
  results: Record<string, unknown>;
  /** The terminal step's output, surfaced to the engine as the run's final result. */
  finalResult?: string;
  /** Populated when a step errors; read by the engine's extractError. */
  errorMessage: string | null;
}

/** Input accepted by `engine.start` for a dynamic workflow. */
export interface DynamicWorkflowInput {
  goal?: string;
  agentId?: string;
  /** Injected by the engine at start time so the context (and child keys) can use it. */
  runId?: string;
  /** The main conversation session this workflow belongs to. */
  parentSessionKey?: string;
  /**
   * Pre-filled per-step outputs to resume a failed/aborted run from where it
   * stopped: the compiled machine seeds `context.results` with these, and each
   * step whose id already has a result is skipped (see compile's `always` guard),
   * so completed steps never re-run.
   */
  resumeResults?: Record<string, string>;
}
