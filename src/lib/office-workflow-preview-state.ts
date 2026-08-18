import {
  orchestrationContentChanged,
  orchestrationContentKey,
  type WorkflowOrchestrationMode,
} from '@/lib/office-workflow-orchestration-mode';
import { hasWorkflowStepDraftContent } from '@/lib/office-workflow-step-drafts';
import { spawnedWorkflowDirtyVsGroup } from '@/lib/office-spawned-workflow-ownership';
import type { OfficeFixedGroup, WorkflowDefinition, WorkflowStepDraftRow } from '@/types/office';

export type OrchestrationInputSnapshot = {
  orchestrationMode: WorkflowOrchestrationMode;
  workflowStepDrafts: WorkflowStepDraftRow[];
  heuristicDescription: string;
};

/** Stable key for orchestration inputs (mode + description or step drafts). */
export function buildOrchestrationInputKey(snapshot: OrchestrationInputSnapshot): string {
  return orchestrationContentKey({
    orchestrationMode: snapshot.orchestrationMode,
    workflowStepDrafts: snapshot.workflowStepDrafts,
    heuristicDescription: snapshot.heuristicDescription,
  });
}

export function orchestrationChangedFromBaseline(
  current: OrchestrationInputSnapshot,
  baseline: OrchestrationInputSnapshot,
): boolean {
  return orchestrationContentChanged({
    orchestrationMode: current.orchestrationMode,
    workflowStepDrafts: current.workflowStepDrafts,
    heuristicDescription: current.heuristicDescription,
    previousOrchestrationMode: baseline.orchestrationMode,
    previousDescription: baseline.heuristicDescription,
    previousWorkflowStepDrafts: baseline.workflowStepDrafts,
  });
}

/** Preview is stale when current inputs differ from the last successful preview key. */
export function isOrchestrationPreviewStale(
  previewSyncedKey: string | null,
  current: OrchestrationInputSnapshot,
): boolean {
  const currentKey = buildOrchestrationInputKey(current);
  if (previewSyncedKey === null) {
    return Boolean(currentKey.trim());
  }
  return previewSyncedKey !== currentKey;
}

/** @deprecated Prefer spawnedWorkflowDirtyVsGroup. */
export function spawnedProjectHasNoOwnOrchestration(snapshot: OrchestrationInputSnapshot): boolean {
  if (snapshot.orchestrationMode === 'rule') {
    return !hasWorkflowStepDraftContent(snapshot.workflowStepDrafts);
  }
  return !snapshot.heuristicDescription.trim();
}

/**
 * Spawn save may inherit group workflow when the form is not dirty vs the group
 * (prefilled drafts matching the group are NOT treated as custom).
 */
export function shouldReuseGroupWorkflowOnSave(params: {
  spawnFromGroup: boolean;
  orchestration: OrchestrationInputSnapshot;
  group?: Pick<
    OfficeFixedGroup,
    | 'workflow'
    | 'workflowDescription'
    | 'workflowStepDrafts'
    | 'workflowOrchestrationMode'
    | 'agentIds'
    | 'coordinatorAgentId'
  > | null;
  agentIds?: string[];
  coordinatorAgentId?: string;
  workflow?: WorkflowDefinition;
}): boolean {
  if (!params.spawnFromGroup || !params.group) return false;
  return !spawnedWorkflowDirtyVsGroup(params.group, {
    executionMode: 'workflow',
    workflow: params.workflow ?? { mode: 'dag', nodes: [], edges: [] },
    description: params.orchestration.heuristicDescription,
    heuristicWorkflowDescription: params.orchestration.heuristicDescription,
    workflowStepDrafts: params.orchestration.workflowStepDrafts,
    workflowOrchestrationMode: params.orchestration.orchestrationMode,
    agentIds: params.agentIds,
    coordinatorAgentId: params.coordinatorAgentId,
  });
}

/** Initial preview-sync key when opening a form with existing materialized workflow. */
export function initialPreviewSyncedKey(params: {
  orchestration: OrchestrationInputSnapshot;
  hasMaterializedWorkflow: boolean;
}): string | null {
  if (!params.hasMaterializedWorkflow) return null;
  return buildOrchestrationInputKey(params.orchestration);
}
