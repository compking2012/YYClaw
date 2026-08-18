import { hostApiFetch } from '@/lib/host-api';
import type {
  OfficeTempProject,
  WorkflowReviewAction,
  WorkflowReviewBatch,
} from '@/types/office';

export type WorkflowReviewStatus = {
  enabled: boolean;
  phase: string;
  batch?: WorkflowReviewBatch;
};

export type WorkflowReviewSubmitResult = {
  success: boolean;
  project?: OfficeTempProject;
  settled?: boolean;
  error?: string;
};

export async function fetchWorkflowReviewStatus(
  projectId: string,
): Promise<WorkflowReviewStatus | null> {
  const res = await hostApiFetch<{
    success: boolean;
    review?: WorkflowReviewStatus;
    error?: string;
  }>(`/api/office/projects/${encodeURIComponent(projectId)}/review/status`);
  if (!res.success || !res.review) return null;
  return res.review;
}

export async function submitWorkflowReviewDecision(
  projectId: string,
  body: {
    nodeId: string;
    decision: WorkflowReviewAction;
    batchUpdatedAt: number;
  },
): Promise<WorkflowReviewSubmitResult> {
  const res = await hostApiFetch<{
    success: boolean;
    project?: OfficeTempProject;
    settled?: boolean;
    error?: string;
  }>(`/api/office/projects/${encodeURIComponent(projectId)}/review/submit`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return {
    success: res.success !== false && !res.error,
    project: res.project,
    settled: res.settled,
    error: res.error,
  };
}

export async function settleWorkflowReviewBatch(
  projectId: string,
  settleGeneration: number,
): Promise<WorkflowReviewSubmitResult> {
  const res = await hostApiFetch<{
    success: boolean;
    project?: OfficeTempProject;
    error?: string;
  }>(`/api/office/projects/${encodeURIComponent(projectId)}/review/settle`, {
    method: 'POST',
    body: JSON.stringify({ settleGeneration }),
  });
  return {
    success: res.success !== false && !res.error,
    project: res.project,
    error: res.error,
  };
}
