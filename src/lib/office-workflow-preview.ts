import { requestWorkflowGeneration } from '@/lib/office-workflow-generate-client';
import { syncWorkflowEdges } from '@/lib/office-workflow-edges';
import type { ProjectAgentRef } from '@/lib/office-workflow-node';
import {
  ensureRuleWorkflowFromStepDrafts,
  type WorkflowOrchestrationMode,
} from '@/lib/office-workflow-orchestration-mode';
import {
  buildOrchestrationInputKey,
  orchestrationChangedFromBaseline,
  shouldReuseGroupWorkflowOnSave,
  isOrchestrationPreviewStale,
  type OrchestrationInputSnapshot,
} from '@/lib/office-workflow-preview-state';
import type { OfficeTaskExecutionMode, WorkflowDefinition, WorkflowStepDraftRow } from '@/types/office';

export type DagWorkflowPreviewSource = 'structured_rule' | 'ai';

export type DagWorkflowPreviewResult =
  | { ok: true; workflow: WorkflowDefinition; source: DagWorkflowPreviewSource }
  | { ok: false; errorKey: string };

function validateWorkflowNodeTitles(workflow: WorkflowDefinition): string | null {
  if (workflow.nodes.some((n) => !n.title?.trim())) {
    return 'workflow.validationNeedTaskNames';
  }
  return null;
}

/** Generate DAG workflow preview from orchestration inputs (rule = local, heuristic = LLM). */
export async function previewDagWorkflow(params: {
  orchestrationMode: WorkflowOrchestrationMode;
  workflowStepDrafts: WorkflowStepDraftRow[];
  heuristicDescription: string;
  workflow: WorkflowDefinition;
  members: ProjectAgentRef[];
  agentIds: string[];
  coordinatorAgentId?: string;
  taskTitle?: string;
  featureDescription?: string;
}): Promise<DagWorkflowPreviewResult> {
  if (params.orchestrationMode === 'rule') {
    const ensured = ensureRuleWorkflowFromStepDrafts({
      workflowStepDrafts: params.workflowStepDrafts,
      members: params.members,
      workflow: params.workflow,
    });
    if (!ensured.ok) return ensured;
    const workflow = syncWorkflowEdges({ ...ensured.workflow, mode: 'dag' });
    const titleError = validateWorkflowNodeTitles(workflow);
    if (titleError) return { ok: false, errorKey: titleError };
    return { ok: true, workflow, source: 'structured_rule' };
  }

  const description = params.heuristicDescription.trim();
  if (!description) {
    return { ok: false, errorKey: 'taskForm.descriptionRequired' };
  }

  const gen = await requestWorkflowGeneration({
    description,
    featureDescription: params.featureDescription?.trim() || undefined,
    agentIds: params.agentIds,
    coordinatorAgentId: params.coordinatorAgentId,
    taskTitle: params.taskTitle?.trim() || undefined,
    strategy: 'gateway-then-direct',
    workflowEngine: 'dag',
  });
  if (!gen.ok) return gen;
  const workflow = syncWorkflowEdges({ ...gen.workflow, mode: 'dag' });
  const titleError = validateWorkflowNodeTitles(workflow);
  if (titleError) return { ok: false, errorKey: titleError };
  return { ok: true, workflow, source: 'ai' };
}

export async function resolveDagWorkflowForSave(params: {
  executionMode: OfficeTaskExecutionMode;
  spawnFromGroup: boolean;
  groupWorkflow?: WorkflowDefinition;
  group?: Parameters<typeof shouldReuseGroupWorkflowOnSave>[0]['group'];
  orchestration: OrchestrationInputSnapshot;
  orchestrationBaseline: OrchestrationInputSnapshot;
  previewSyncedKey: string | null;
  workflow: WorkflowDefinition;
  members: ProjectAgentRef[];
  agentIds: string[];
  coordinatorAgentId?: string;
  taskTitle?: string;
  featureDescription?: string;
}): Promise<DagWorkflowPreviewResult> {
  if (params.executionMode !== 'workflow') {
    return { ok: true, workflow: params.workflow, source: 'structured_rule' };
  }

  const emptyWorkflow: WorkflowDefinition = { mode: 'dag', nodes: [], edges: [] };

  // Spawn inherit path: do NOT materialize group DAG into the save payload.
  if (
    shouldReuseGroupWorkflowOnSave({
      spawnFromGroup: params.spawnFromGroup,
      orchestration: params.orchestration,
      group: params.group ?? (
        params.groupWorkflow
          ? {
              workflow: params.groupWorkflow,
              workflowDescription: '',
              workflowStepDrafts: params.orchestration.workflowStepDrafts,
              workflowOrchestrationMode: params.orchestration.orchestrationMode,
              agentIds: params.agentIds,
              coordinatorAgentId: params.coordinatorAgentId ?? '',
            }
          : null
      ),
      agentIds: params.agentIds,
      coordinatorAgentId: params.coordinatorAgentId,
      workflow: params.workflow,
    })
  ) {
    return { ok: true, workflow: emptyWorkflow, source: 'structured_rule' };
  }

  const currentKey = buildOrchestrationInputKey(params.orchestration);
  const baselineChanged = orchestrationChangedFromBaseline(
    params.orchestration,
    params.orchestrationBaseline,
  );

  // Spawn + untouched orchestration: keep empty DAG so inherit stays true
  // (group DAG is resolved at preview/run time, not persisted on create).
  if (
    params.spawnFromGroup
    && !baselineChanged
    && params.workflow.nodes.length === 0
    && (params.groupWorkflow?.nodes.length ?? 0) > 0
  ) {
    return { ok: true, workflow: emptyWorkflow, source: 'structured_rule' };
  }

  if (!baselineChanged && params.workflow.nodes.length > 0) {
    return {
      ok: true,
      workflow: syncWorkflowEdges({ ...params.workflow, mode: 'dag' }),
      source: 'structured_rule',
    };
  }

  if (
    params.previewSyncedKey !== null
    && params.previewSyncedKey === currentKey
    && params.workflow.nodes.length > 0
  ) {
    return {
      ok: true,
      workflow: syncWorkflowEdges({ ...params.workflow, mode: 'dag' }),
      source: 'structured_rule',
    };
  }

  if (!isOrchestrationPreviewStale(params.previewSyncedKey, params.orchestration)) {
    if (params.workflow.nodes.length > 0) {
      return {
        ok: true,
        workflow: syncWorkflowEdges({ ...params.workflow, mode: 'dag' }),
        source: 'structured_rule',
      };
    }
  }

  return previewDagWorkflow({
    orchestrationMode: params.orchestration.orchestrationMode,
    workflowStepDrafts: params.orchestration.workflowStepDrafts,
    heuristicDescription: params.orchestration.heuristicDescription,
    workflow: params.workflow,
    members: params.members,
    agentIds: params.agentIds,
    coordinatorAgentId: params.coordinatorAgentId,
    taskTitle: params.taskTitle,
    featureDescription: params.featureDescription,
  });
}
