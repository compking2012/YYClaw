import { isOfficeUserCheckpointFeatureEnabled } from '@/lib/office-user-checkpoint-feature';
import { isLangGraphWorkflowTask } from '@/lib/office-workflow-engine';
import type { OfficeTempProject, WorkflowReviewBatch } from '@/types/office';

export type WorkflowReviewAttentionEvent = {
  projectId: string;
  title: string;
  phase: Exclude<WorkflowReviewBatch['phase'], 'closed'>;
};

type WorkflowReviewAttentionListener = (event: WorkflowReviewAttentionEvent) => void;

const listeners = new Set<WorkflowReviewAttentionListener>();

export function subscribeWorkflowReviewAttention(
  listener: WorkflowReviewAttentionListener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emitWorkflowReviewAttention(event: WorkflowReviewAttentionEvent): void {
  for (const listener of listeners) {
    listener(event);
  }
}

function reviewBatchNeedsUserAttention(batch: WorkflowReviewBatch): boolean {
  if (batch.phase === 'closed') return false;
  if (batch.phase === 'ready_to_settle' || batch.phase === 'deferred') return true;
  if (batch.phase === 'collecting') {
    return batch.expectedNodeIds.some(
      (id) => batch.items[id]?.state === 'awaiting_decision',
    );
  }
  return false;
}

export function projectNeedsWorkflowReviewAttention(
  project: Pick<OfficeTempProject, 'workflowReviewBatch' | 'workflowEngine' | 'title'>,
): boolean {
  if (!isOfficeUserCheckpointFeatureEnabled()) return false;
  if (isLangGraphWorkflowTask(project)) return false;
  const batch = project.workflowReviewBatch;
  if (!batch) return false;
  return reviewBatchNeedsUserAttention(batch);
}

function reviewBatchSignature(
  batch: WorkflowReviewBatch | undefined,
): string | null {
  if (!batch || batch.phase === 'closed') return null;
  return `${batch.id}:${batch.phase}:${batch.settleGeneration}`;
}

export function notifyWorkflowReviewAttentionIfNeeded(
  prevProjects: OfficeTempProject[],
  nextProjects: OfficeTempProject[],
): void {
  const prevById = new Map(prevProjects.map((p) => [p.id, p]));

  for (const project of nextProjects) {
    if (!projectNeedsWorkflowReviewAttention(project)) continue;

    const prev = prevById.get(project.id);
    const prevSig = reviewBatchSignature(prev?.workflowReviewBatch);
    const nextSig = reviewBatchSignature(project.workflowReviewBatch);
    if (!nextSig) continue;
    if (prevSig === nextSig) continue;

    const batch = project.workflowReviewBatch!;
    if (batch.phase === 'closed') continue;

    emitWorkflowReviewAttention({
      projectId: project.id,
      title: project.title?.trim() || project.id,
      phase: batch.phase,
    });
  }
}
