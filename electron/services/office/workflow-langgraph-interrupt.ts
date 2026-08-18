/**
 * LangGraph interrupt/resume session registry (v3 user intervention without abort+rerun).
 */
import { Command } from '@langchain/langgraph';
import type { RunnableConfig } from '@langchain/core/runnables';
import type { GatewayManager } from '../../gateway/manager';
import type { LangGraphOrchestrationPlan } from '../../../src/lib/office-langgraph-plan-types';
import { isLangGraphNativePlan } from '../../../src/lib/office-langgraph-plan-types';
import type { LangGraphUserInterventionRequest } from '../../../src/lib/office-langgraph-state-types';
import type { OfficeScenario, OfficeTask, WorkflowDefinition } from './types';
import { usesNativeLangGraphRuntimeV3 } from './workflow-langgraph-native-compile-v3';

type CompiledLangGraph = {
  invoke(input: unknown, config?: RunnableConfig): Promise<unknown>;
  getState(config: RunnableConfig): Promise<{ next: string[]; tasks?: Array<{ interrupts?: unknown[] }> }>;
};

export type LangGraphWorkflowSession = {
  taskId: string;
  graph: CompiledLangGraph;
  config: RunnableConfig;
  gateway: GatewayManager;
  scenario: OfficeScenario;
  workflow: WorkflowDefinition;
  onUpdate?: (task: OfficeTask) => void;
};

const activeSessions = new Map<string, LangGraphWorkflowSession>();

export function registerLangGraphWorkflowSession(session: LangGraphWorkflowSession): void {
  activeSessions.set(session.taskId, session);
}

export function clearLangGraphWorkflowSession(taskId: string): void {
  activeSessions.delete(taskId);
}

export function langGraphThreadIdForTask(taskId: string): string {
  return `office-task-${taskId}`;
}

/** Abort / 任务清理：移除内存 session，并删除 office_store checkpoint 线程。 */
export async function teardownLangGraphTaskResources(
  taskId: string,
  options?: { deleteCheckpoint?: boolean },
): Promise<void> {
  clearLangGraphWorkflowSession(taskId);
  if (options?.deleteCheckpoint === false) return;
  try {
    const { officeLangGraphFileCheckpointer } = await import('./office-langgraph-thread-store');
    await officeLangGraphFileCheckpointer.deleteThread(langGraphThreadIdForTask(taskId));
  } catch {
    // Best-effort cleanup; abort must not fail.
  }
}

export function getLangGraphWorkflowSession(taskId: string): LangGraphWorkflowSession | undefined {
  return activeSessions.get(taskId);
}

export function usesLangGraphInterruptResume(
  task: OfficeTask,
  workflow: WorkflowDefinition,
): boolean {
  const plan = workflow.orchestrationPlan;
  if (!isLangGraphNativePlan(plan)) return false;
  return usesNativeLangGraphRuntimeV3(plan) && task.workflowEngine === 'langgraph';
}

export function planUsesOfficeStoreCheckpointer(plan: LangGraphOrchestrationPlan): boolean {
  return plan.version >= 3
    || plan.checkpointer === 'office_store'
    || plan.nativeRuntime === 'subgraph_store';
}

export function planUsesLangGraphCheckpointer(plan: LangGraphOrchestrationPlan): boolean {
  return plan.version >= 2
    || plan.checkpointer === 'langgraph_memory'
    || plan.checkpointer === 'office_store'
    || plan.nativeRuntime === 'send_join'
    || plan.nativeRuntime === 'subgraph_store';
}

export async function resumeLangGraphWorkflowSession(params: {
  taskId: string;
  userIntervention?: LangGraphUserInterventionRequest;
  task?: OfficeTask;
}): Promise<{ resumed: boolean; result?: unknown }> {
  const session = activeSessions.get(params.taskId);
  if (!session) return { resumed: false };

  const update: Record<string, unknown> = {};
  if (params.task) update.task = params.task;
  if (params.userIntervention) {
    update.userInterventionRequest = params.userIntervention;
  }

  const command = new Command({
    resume: params.userIntervention?.request ?? true,
    ...(Object.keys(update).length > 0 ? { update } : {}),
  });

  const result = await session.graph.invoke(command, session.config);
  return { resumed: true, result };
}

export function graphResultHasInterrupt(result: unknown): boolean {
  return Boolean(
    result
    && typeof result === 'object'
    && '__interrupt__' in result
    && Array.isArray((result as { __interrupt__?: unknown[] }).__interrupt__)
    && ((result as { __interrupt__?: unknown[] }).__interrupt__?.length ?? 0) > 0,
  );
}
