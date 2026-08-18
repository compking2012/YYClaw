import type { WorkflowOrchestrationMode } from '@/lib/office-workflow-orchestration-mode';
import type { OrchestrationInputSnapshot } from '@/lib/office-workflow-preview-state';
import type { WorkflowStepDraftRow } from '@/types/office';

/** Build orchestration baseline snapshot for edit forms (form open state). */
export function orchestrationBaselineSnapshot(params: {
  orchestrationMode: WorkflowOrchestrationMode;
  heuristicDescription?: string;
  workflowDescription?: string;
  workflowStepDrafts?: WorkflowStepDraftRow[];
}): OrchestrationInputSnapshot {
  const heuristic =
    params.heuristicDescription?.trim()
    ?? params.workflowDescription?.trim()
    ?? '';
  return {
    orchestrationMode: params.orchestrationMode,
    workflowStepDrafts: params.workflowStepDrafts ?? [],
    heuristicDescription: heuristic,
  };
}
