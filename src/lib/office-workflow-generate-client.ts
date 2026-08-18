import { hostApiFetch } from '@/lib/host-api';
import {
  trimWorkflowStepDraftRows,
  workflowDescriptionOrDraftsKey,
} from '@/lib/office-workflow-step-drafts';
import { applyWorkflowChange } from '@/lib/office-workflow-edges';
import { resolveWorkflowEngineInput } from '@/lib/feature-langgraph';
import type { OfficeWorkflowEngine, WorkflowDefinition, WorkflowStepDraftRow } from '@/types/office';

export type WorkflowGenerateClientResult =
  | {
      ok: true;
      workflow: WorkflowDefinition;
      mode: 'simple' | 'dag';
      summary?: string;
      source?: string;
      orchestrationEngine?: OfficeWorkflowEngine;
    }
  | { ok: false; errorKey: string };

export async function requestWorkflowGeneration(params: {
  description: string;
  featureDescription?: string;
  workflowStepDrafts?: WorkflowStepDraftRow[];
  agentIds: string[];
  coordinatorAgentId?: string;
  taskTitle?: string;
  strategy?: 'auto' | 'heuristic' | 'gateway-first' | 'gateway-then-direct';
  workflowEngine?: OfficeWorkflowEngine;
}): Promise<WorkflowGenerateClientResult> {
  const description = params.description.trim();
  const featureDescription = params.featureDescription?.trim() ?? '';
  const hasDrafts = trimWorkflowStepDraftRows(params.workflowStepDrafts ?? []).length > 0;
  if (!description && !featureDescription && !hasDrafts) {
    return { ok: false, errorKey: 'workflow.generateNeedDescription' };
  }
  if (params.agentIds.length === 0) {
    return { ok: false, errorKey: 'workflow.generateNeedAgents' };
  }

  const workflowEngine = resolveWorkflowEngineInput('workflow', params.workflowEngine);

  const res = await hostApiFetch<{
    success: boolean;
    error?: string;
    workflow?: WorkflowDefinition;
    mode?: 'simple' | 'dag';
    summary?: string;
    source?: string;
    orchestrationEngine?: OfficeWorkflowEngine;
  }>('/api/office/workflows/generate', {
    method: 'POST',
    body: JSON.stringify({
      description: description || featureDescription,
      featureDescription: featureDescription || undefined,
      workflowStepDrafts: hasDrafts ? trimWorkflowStepDraftRows(params.workflowStepDrafts ?? []) : undefined,
      agentIds: params.agentIds,
      coordinatorAgentId: params.coordinatorAgentId,
      taskTitle: params.taskTitle?.trim() || undefined,
      strategy: params.strategy ?? 'auto',
      workflowEngine,
    }),
  });

  if (!res.success || !res.workflow) {
    return { ok: false, errorKey: res.error ?? 'workflow.generateFailed' };
  }

  const workflow =
    workflowEngine === 'langgraph'
      ? { ...res.workflow, mode: 'dag' as const, orchestrationEngine: 'langgraph' as const }
      : applyWorkflowChange(
          { ...res.workflow, mode: 'dag' },
          Boolean(res.workflow.edgesCustomized),
        );
  return {
    ok: true,
    workflow,
    mode: 'dag',
    summary: res.summary,
    source: res.source,
    orchestrationEngine: workflowEngine,
  };
}

/** Generate workflow on save when the user has description but no steps yet. */
export async function ensureWorkflowForTaskSave(params: {
  title: string;
  featureDescription: string;
  description: string;
  workflowStepDrafts?: WorkflowStepDraftRow[];
  workflow: WorkflowDefinition;
  agentIds: string[];
  coordinatorAgentId?: string;
  workflowEngine?: OfficeWorkflowEngine;
  previousDescription?: string;
  previousWorkflowStepDrafts?: WorkflowStepDraftRow[];
}): Promise<
  | { ok: true; workflow: WorkflowDefinition }
  | { ok: false; errorKey: string }
> {
  const description = params.description.trim();
  const featureDescription = params.featureDescription.trim();
  const inputKey = workflowDescriptionOrDraftsKey(description, params.workflowStepDrafts);
  const previousKey = workflowDescriptionOrDraftsKey(
    params.previousDescription ?? '',
    params.previousWorkflowStepDrafts,
  );
  const descriptionChanged = previousKey !== inputKey;

  if (params.workflow.nodes.length > 0 && !descriptionChanged) {
    return {
      ok: true,
      workflow: { ...params.workflow, mode: 'dag' },
    };
  }

  const hasDrafts = trimWorkflowStepDraftRows(params.workflowStepDrafts ?? []).length > 0;
  if (!description && !featureDescription && !hasDrafts) {
    return { ok: false, errorKey: 'workflow.validationNeedTasks' };
  }

  const gen = await requestWorkflowGeneration({
    description: description || featureDescription,
    featureDescription: featureDescription || undefined,
    workflowStepDrafts: params.workflowStepDrafts,
    agentIds: params.agentIds,
    coordinatorAgentId: params.coordinatorAgentId,
    taskTitle: params.title.trim() || undefined,
    strategy: 'auto',
    workflowEngine: resolveWorkflowEngineInput('workflow', params.workflowEngine),
  });
  if (!gen.ok) return gen;
  return { ok: true, workflow: gen.workflow };
}
