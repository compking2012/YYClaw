/**
 * Renderer-side mirror of the workflow engine types (see
 * `electron/workflow/types.ts`). Kept structurally identical so the
 * `workflow:progress` payload and HTTP responses deserialize directly.
 */
export type StepKind = 'deterministic' | 'model' | 'agent';

export type RunStatus = 'running' | 'done' | 'failed';

export interface TraceEntry {
  state: string;
  stepKind?: StepKind;
  status: 'running' | 'completed' | 'failed';
  at: number;
}

export interface RunRecord {
  runId: string;
  defId: string;
  version: number;
  title: string;
  status: RunStatus;
  currentState: string;
  currentStepKind?: StepKind;
  trace: TraceEntry[];
  /**
   * Per-step outputs (stepId → result text), mirrored from the engine's XState
   * context so the inline workflow card can show each step's result. Populated
   * live via `workflow:progress` and reconstructed from the persisted snapshot
   * after a reload (see `getWorkflowStatus`).
   */
  results?: Record<string, string>;
  /** Final synthesized result text, set when the run reaches `done`. */
  result?: string;
  error?: string;
  startedAt: number;
  updatedAt: number;
}

export interface WorkflowDefinitionSummary {
  id: string;
  title: string;
  version: number;
}

/** Lightweight per-step metadata for rendering an auto-workflow's progress. */
export interface WorkflowStepMeta {
  id: string;
  title: string;
  kind: StepKind;
  /** Prior step ids this node consumes — drives parallel-group visuals. */
  inputsFrom?: string[];
}

/**
 * A persisted reference to a workflow run shown inline in a conversation. Lets
 * the workflow card + final synthesized reply survive reload, since the gateway
 * does not store them in the main session transcript.
 */
export interface WorkflowCardRef {
  runId: string;
  /** Stable id of the synthetic workflow message in the main session. */
  messageId: string;
  /** Stable id of the synthetic user message that triggered this workflow. */
  userMessageId: string;
  /** The user's original task text (the triggering message). */
  userText: string;
  title: string;
  steps: WorkflowStepMeta[];
  status: RunStatus;
  /** When the workflow card was first created (ms; orders it within the transcript). */
  createdAt: number;
  /**
   * Id of the last ACP timeline item present when this card was created. The
   * Chat page splices the card's render block AFTER the display group holding
   * this item, so the card lands at its trigger position in the conversation
   * instead of pinned at the end. `undefined` (older cards, or an engine turn
   * with no prior ACP history) sorts the card before all ACP groups.
   */
  acpAnchorItemId?: string;
  /** Final synthesized reply text, persisted once the run completes. */
  finalText?: string;
  /** Error summary when the run failed. */
  error?: string;
  /**
   * Execution model behind the card:
   *  - 'engine' (default): a real WorkflowEngine run (query-based orchestration),
   *    live-tracked via the workflow store + `workflow:progress`.
   *  - 'observed': the skill runs normally in the agent turn; this card only
   *    visualizes its declared steps + progress, sourced from the chat store's
   *    `observedWorkflowByRun` (no WorkflowEngine run exists).
   */
  source?: 'engine' | 'observed';
  /** For 'observed' cards, the workflow-shaped skill that was invoked. */
  skillName?: string;
  /**
   * Last known per-step statuses, persisted on finalize so reload can show
   * `k/N` without the in-memory `observedWorkflowByRun` (which does not survive
   * restart). Absent on mid-run cards until the first terminal write.
   */
  stepProgress?: Array<{
    id: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
  }>;
  /**
   * True while the card is a provisional placeholder created the instant an
   * engine turn routes to a workflow, BEFORE the server finishes decomposition
   * ("生成即分诊"). It carries only `userText` so the query bubble shows
   * immediately; its compact link is not rendered and it is never persisted.
   * Cleared when `promoteWorkflowCard` swaps in the real run.
   */
  pending?: boolean;
}
