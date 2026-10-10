/**
 * OpenClawAdapter — the engine's DRIVER interface onto OpenClaw.
 *
 * IMPORTANT: this is NOT an OpenClaw plugin. The workflow engine rides ON TOP of
 * OpenClaw (control inverted), so the adapter is a consumer/driver that lives in
 * the YYClaw main process and calls down into OpenClaw — never the reverse.
 *
 * Three seams, three determinism levels:
 *  - `callTool`  : 100% deterministic. Dispatches a local pure-function tool by
 *                  name+args, bypassing the model and any agent hooks.
 *  - `runModel`  : one constrained model call. Non-determinism is boxed inside
 *                  this node and the output shape is locked by a zod schema.
 *  - `runAgent`  : escape hatch — a budget-capped agentic sub-task returning a
 *                  structured result. (v1: not implemented; Phase 2 wraps
 *                  `gateway.rpc('chat.send', …)`.)
 */
import type { ZodType } from 'zod';

export interface RunModelOptions<T> {
  system: string;
  input: string;
  schema: ZodType<T>;
  /** Defaults to 0 — determinism envelope around the model call. */
  temperature?: number;
  /** Schema-validation retries before giving up. Defaults to 2. */
  maxRetries?: number;
  /** Optional provider override; defaults to the configured default provider. */
  providerId?: string;
  /** Optional model override; defaults to the provider's first configured model. */
  model?: string;
  /** Abort the underlying request after this many ms. */
  timeoutMs?: number;
  /** Agent to run on (gateway-backed adapter); defaults to the gateway default. */
  agentId?: string;
  /**
   * Workflow node identity. When present, the gateway-backed adapter runs the
   * constrained call in the deterministic child session (`childSessionKey`) so
   * the run stays resumable/idempotent (mirrors `runAgent`).
   */
  runId?: string;
  stepId?: string;
}

export interface AgentBudget {
  maxSteps: number;
  maxTokens: number;
  timeoutMs: number;
}

export interface RunAgentOptions<T> {
  goal: string;
  allowedTools?: string[];
  budget: AgentBudget;
  resultSchema: ZodType<T>;
  /** Optional agent to execute on (single-agent scenario); defaults to gateway default. */
  agentId?: string;
  /**
   * Workflow node identity. When `runId`+`stepId` are present, the adapter runs
   * the sub-task in a deterministic child session (`childSessionKey`) instead of
   * a random `wf-agent:*` one — so the run is resumable/idempotent and the
   * renderer can rebuild the key to drill into this node's sub-conversation.
   */
  runId?: string;
  stepId?: string;
  /** The main conversation session this workflow belongs to (label / future native nesting). */
  parentSessionKey?: string;
}

export interface AgentTrace {
  steps: number;
  tokens: number;
  durationMs: number;
}

export interface OpenClawAdapter {
  /** Bare tool dispatch — validates args then runs the local tool implementation. */
  callTool<T>(name: string, args: unknown): Promise<T>;
  /** Single constrained model call; returns a schema-validated object. */
  runModel<T>(opts: RunModelOptions<T>): Promise<T>;
  /** Budget-capped agentic sub-task. v1 throws; Phase 2 wraps chat.send. */
  runAgent<T>(opts: RunAgentOptions<T>): Promise<{ result: T; trace: AgentTrace }>;
  /**
   * Best-effort discard of a run's gateway sub-sessions before a resume. Deletes
   * every `wf:<runId>:<step>` child session (history + any residual active run)
   * so the resumed steps re-run in fresh, empty sessions — otherwise the reused
   * child-session key carries the original run's stale messages (e.g. a dangling
   * tool_use with no timestamp) that pin the reply waiter's in-flight guard and
   * stall it to the 300s timeout. Optional: the headless/test adapter omits it.
   */
  discardRunSessions?(runId: string): Promise<void>;
}
