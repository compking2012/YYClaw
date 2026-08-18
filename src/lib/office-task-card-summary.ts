import type { TFunction } from 'i18next';
import { runningWorkflowStepIndex } from '@/lib/office-task-run';
import type { deriveTaskProgressSync } from '@/lib/office-task-progress-sync';
import type { OfficeTempProject, WorkflowNode } from '@/types/office';

export function formatOfficeTempProjectCardStatusSummary(
  t: TFunction<'office'>,
  project: OfficeTempProject,
  workflowNodes: WorkflowNode[],
  progressSync: ReturnType<typeof deriveTaskProgressSync>,
): string {
  const statusLabel = t(`taskStatus.${project.status}`);
  if (project.status !== 'running') {
    return statusLabel;
  }
  const total = progressSync.totalSteps || workflowNodes.length || project.nodeRuns.length;
  const current = progressSync.currentStep ?? runningWorkflowStepIndex(project, workflowNodes);
  if (current != null && total > 0) {
    return t('taskStepsRunning', { current, total });
  }
  return statusLabel;
}

/** @deprecated Use formatOfficeTempProjectCardStatusSummary */
export function formatOfficeTaskCardStatusSummary(
  t: TFunction<'office'>,
  project: OfficeTempProject,
  workflowNodes: WorkflowNode[],
  progressSync: ReturnType<typeof deriveTaskProgressSync>,
): string {
  return formatOfficeTempProjectCardStatusSummary(t, project, workflowNodes, progressSync);
}
