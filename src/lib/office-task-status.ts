import { isWorkflowReviewActive } from '@/lib/office-workflow-user-checkpoint';
import type { NodeRunRecord, OfficeTempProject, TaskStatus, WorkflowNode } from '@/types/office';

export type ResolveTaskStatusOptions = {
  runnerActive?: boolean;
  workflowStalled?: boolean;
};

function nodeRunStatus(
  runs: Map<string, NodeRunRecord> | NodeRunRecord[],
  nodeId: string,
): NodeRunRecord['status'] {
  if (runs instanceof Map) {
    return runs.get(nodeId)?.status ?? 'pending';
  }
  return runs.find((r) => r.nodeId === nodeId)?.status ?? 'pending';
}

/** Derive task status from node runs only (no review-batch guard). */
export function resolveTaskStatusFromRuns(
  runs: Map<string, NodeRunRecord> | NodeRunRecord[],
  nodes: WorkflowNode[],
  options?: ResolveTaskStatusOptions,
): TaskStatus {
  const statuses = nodes.map((n) => nodeRunStatus(runs, n.id));
  if (statuses.some((s) => s === 'running')) return 'running';
  if (
    options?.runnerActive
    && statuses.some((s) => s === 'pending')
    && !statuses.some((s) => s === 'failed')
  ) {
    return 'running';
  }
  if (statuses.every((s) => s === 'completed' || s === 'skipped')) return 'completed';
  if (statuses.some((s) => s === 'failed')) return 'failed';
  if (
    options?.workflowStalled
    && statuses.some((s) => s === 'pending')
    && !statuses.some((s) => s === 'running')
  ) {
    return 'blocked';
  }
  return 'pending';
}

/**
 * Task status for persistence/UI: active user-checkpoint review keeps the project running
 * even when every node run is already completed/skipped.
 */
export function resolveEffectiveTaskStatus(
  project: Pick<OfficeTempProject, 'workflowReviewBatch'>,
  runs: Map<string, NodeRunRecord> | NodeRunRecord[],
  nodes: WorkflowNode[],
  options?: ResolveTaskStatusOptions,
): TaskStatus {
  if (isWorkflowReviewActive(project)) return 'running';
  return resolveTaskStatusFromRuns(runs, nodes, options);
}

export function isWorkflowRunFullyCompleted(
  runs: Map<string, NodeRunRecord>,
  nodes: WorkflowNode[],
): boolean {
  return nodes.every((n) => {
    const s = runs.get(n.id)?.status;
    return s === 'completed' || s === 'skipped';
  });
}

export function shouldAnnounceWorkflowTaskFinished(
  project: Pick<OfficeTempProject, 'workflowReviewBatch' | 'status'>,
): boolean {
  if (isWorkflowReviewActive(project)) return false;
  // Aborted runs (gateway restart / user stop) do not get a coordinator summary in the room.
  return project.status === 'completed' || project.status === 'failed';
}

export function shouldAnnounceWorkflowProjectClosure(
  project: Pick<OfficeTempProject, 'workflowReviewBatch'>,
  runs: Map<string, NodeRunRecord>,
  nodes: WorkflowNode[],
): boolean {
  if (isWorkflowReviewActive(project)) return false;
  return isWorkflowRunFullyCompleted(runs, nodes);
}
