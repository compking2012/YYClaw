/**
 * Workflow engine API — the single renderer entry point for driving the
 * deterministic workflow engine. Routes through `hostApiFetch` (the Main-owned
 * proxy), per the Renderer/Main boundary rules. Live progress arrives separately
 * via `subscribeHostEvent('workflow:progress', …)`.
 */
import { hostApi } from '@/lib/host-api';
import type { RunRecord, WorkflowDefinitionSummary, WorkflowStepMeta } from '@/types/workflow';
import { childSessionKey } from '../../shared/workflow-session';

/** A workflow node's sub-conversation message (minimal shape for drill-down). */
export interface WorkflowNodeMessage {
  role?: string;
  content?: unknown;
  timestamp?: number;
}

/**
 * Fetch a workflow node's sub-conversation. The node runs in a deterministic
 * child session (`childSessionKey`) with `deliver:false`, so this reads it via
 * the normal chat.history proxy — available during/shortly after the run.
 */
export async function fetchWorkflowNodeMessages(
  runId: string,
  stepId: string,
): Promise<WorkflowNodeMessage[]> {
  const sessionKey = childSessionKey(runId, stepId);
  try {
    const res = await hostApi.sessions.history({ sessionKey, limit: 50 }) as {
      messages?: WorkflowNodeMessage[];
      result?: { messages?: WorkflowNodeMessage[] };
    };
    return res.result?.messages ?? res.messages ?? [];
  } catch {
    return [];
  }
}

export async function listWorkflows(): Promise<{
  definitions: WorkflowDefinitionSummary[];
  runs: RunRecord[];
}> {
  const res = await hostApi.workflow.list() as unknown as {
    success: boolean;
    definitions: WorkflowDefinitionSummary[];
    runs: RunRecord[];
  };
  return { definitions: res.definitions ?? [], runs: res.runs ?? [] };
}

export async function startWorkflow(defId: string, input?: unknown): Promise<RunRecord | null> {
  const res = await hostApi.workflow.start({ defId, input: input ?? {} }) as { success: boolean; runId?: string; run: RunRecord | null };
  return res.run ?? null;
}

export async function resumeWorkflow(runId: string): Promise<RunRecord | null> {
  const res = await hostApi.workflow.resume({ runId }) as { success: boolean; resumed?: boolean; run: RunRecord | null };
  return res.run ?? null;
}

/**
 * Continue a failed/aborted run from where it stopped (completed steps are not
 * re-run). Unlike `resumeWorkflow` (which only rehydrates still-`running` runs
 * after a restart), this drives the engine's `retry` and reactivates a `failed`
 * run in place, reusing the same runId.
 */
export async function retryWorkflow(runId: string): Promise<RunRecord | null> {
  const res = await hostApi.workflow.retry({ runId }) as { success: boolean; retried?: boolean; run: RunRecord | null };
  return res.run ?? null;
}

export async function abortWorkflow(runId: string): Promise<RunRecord | null> {
  const res = await hostApi.workflow.abort({ runId }) as { success: boolean; aborted?: boolean; run: RunRecord | null };
  return res.run ?? null;
}

export async function getWorkflowStatus(runId: string): Promise<RunRecord | null> {
  const res = await hostApi.workflow.status({ runId }) as { success: boolean; run: RunRecord | null };
  return res.run ?? null;
}

/** Result of attempting to route a chat task into an auto-generated workflow. */
export interface StartDynamicResult {
  /** True when the task was deemed workflow-suitable and a run was started. */
  routed: boolean;
  runId?: string;
  title?: string;
  steps?: WorkflowStepMeta[];
  run?: RunRecord | null;
  /** Set when the server deferred to an installed skill instead of decomposing. */
  matchedSkill?: string;
  /** Set when a `resumable` run was passed and the model judged the turn a resume request. */
  resume?: boolean;
}

/** Compact unfinished-run context for the merged resume-vs-new server triage. */
export interface ResumableRunContext {
  runId: string;
  title?: string;
  steps?: Array<{ title: string; status?: 'done' | 'failed' | 'pending' }>;
  error?: string;
}

/**
 * Ask Main to generate + start a dynamic workflow for a free-form task. Returns
 * `{ routed:false }` when the task isn't workflow-suitable (caller should fall
 * back to a normal chat reply). `agentId` lets `agent` steps run on the same
 * agent the user is talking to; `parentSessionKey` records the main conversation
 * the workflow belongs to (used to derive node child sessions). `skills` lets the
 * server-side generator defer to an installed workflow-shaped skill instead of
 * inventing its own steps when the task clearly matches one. `resumable` supplies
 * an unfinished run's context so the SAME generation call can decide whether the
 * message means "continue that run" (returns `resume:true`, no new steps).
 */
export async function startDynamicWorkflow(
  task: string,
  agentId?: string,
  parentSessionKey?: string,
  skills?: Array<{ name: string; description?: string }>,
  resumable?: ResumableRunContext,
): Promise<StartDynamicResult> {
  const res = await hostApi.workflow.startDynamic({
    task,
    input: { goal: task, agentId, parentSessionKey },
    skills,
    ...(resumable ? { resumable } : {}),
  }) as {
    success: boolean;
    routed?: boolean;
    runId?: string;
    title?: string;
    steps?: WorkflowStepMeta[];
    run?: RunRecord | null;
    matchedSkill?: string;
    resume?: boolean;
  };
  return {
    routed: Boolean(res.routed),
    runId: res.runId,
    title: res.title,
    steps: res.steps,
    run: res.run ?? null,
    matchedSkill: res.matchedSkill,
    resume: Boolean(res.resume),
  };
}
