import type {
  NodeRunRecord,
  OfficeTempProject,
  TaskStatus,
  WorkflowReviewBatch,
  WorkflowStallRecord,
} from '@/types/office';

/** Lightweight project slice for execution polling and Main → Renderer push. */
export type OfficeProjectProgress = Pick<
  OfficeTempProject,
  | 'id'
  | 'status'
  | 'nodeRuns'
  | 'workflowReviewBatch'
  | 'workflowStall'
  | 'workflowUserIntervention'
  | 'abortQuiescing'
  | 'abortGeneration'
  | 'abortQuiesceStartedAt'
  | 'updatedAt'
>;

export function projectProgressFromTempProject(project: OfficeTempProject): OfficeProjectProgress {
  return {
    id: project.id,
    status: project.status,
    nodeRuns: project.nodeRuns,
    workflowReviewBatch: project.workflowReviewBatch,
    workflowStall: project.workflowStall,
    workflowUserIntervention: project.workflowUserIntervention,
    abortQuiescing: project.abortQuiescing,
    abortGeneration: project.abortGeneration,
    abortQuiesceStartedAt: project.abortQuiesceStartedAt,
    updatedAt: project.updatedAt,
  };
}

export function mergeProjectProgressIntoProject(
  project: OfficeTempProject,
  progress: OfficeProjectProgress,
): OfficeTempProject {
  if (project.id !== progress.id) return project;
  return {
    ...project,
    status: progress.status as TaskStatus,
    nodeRuns: progress.nodeRuns as NodeRunRecord[],
    workflowReviewBatch: progress.workflowReviewBatch as WorkflowReviewBatch | undefined,
    workflowStall: progress.workflowStall as WorkflowStallRecord | undefined,
    workflowUserIntervention: progress.workflowUserIntervention,
    abortQuiescing: progress.abortQuiescing,
    abortGeneration: progress.abortGeneration,
    abortQuiesceStartedAt: progress.abortQuiesceStartedAt,
    updatedAt: progress.updatedAt,
  };
}
