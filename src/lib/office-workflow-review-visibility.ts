import { isOfficeUserCheckpointFeatureEnabled } from '@/lib/office-user-checkpoint-feature';
import { isLangGraphWorkflowTask } from '@/lib/office-workflow-engine';
import { isWorkflowReviewActive } from '@/lib/office-workflow-user-checkpoint';
import type { OfficeTempProject } from '@/types/office';

export function shouldShowWorkflowReviewPanel(project: OfficeTempProject): boolean {
  if (!isOfficeUserCheckpointFeatureEnabled()) return false;
  if (isLangGraphWorkflowTask(project)) return false;
  return isWorkflowReviewActive(project);
}
