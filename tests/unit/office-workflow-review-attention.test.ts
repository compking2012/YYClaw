import { describe, expect, it, vi } from 'vitest';
import {
  notifyWorkflowReviewAttentionIfNeeded,
  projectNeedsWorkflowReviewAttention,
  subscribeWorkflowReviewAttention,
} from '@/lib/office-workflow-review-attention';
import type { OfficeTempProject, WorkflowReviewBatch } from '@/types/office';

vi.mock('@/lib/office-user-checkpoint-feature', () => ({
  isOfficeUserCheckpointFeatureEnabled: () => true,
}));

vi.mock('@/lib/office-workflow-engine', () => ({
  isLangGraphWorkflowTask: () => false,
}));

function batch(partial: Partial<WorkflowReviewBatch>): WorkflowReviewBatch {
  return {
    phase: 'collecting',
    expectedNodeIds: ['n1'],
    items: { n1: { state: 'awaiting_decision' } },
    updatedAt: 100,
    settleGeneration: 1,
    ...partial,
  };
}

function project(
  partial: Partial<OfficeTempProject> & { id: string },
): OfficeTempProject {
  return {
    title: 'Demo',
    agentIds: [],
    coordinatorAgentId: 'coord',
    status: 'running',
    lifecycle: 'active',
    origin: 'standalone',
    nodeRuns: [],
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  } as OfficeTempProject;
}

describe('office-workflow-review-attention', () => {
  it('detects collecting batch with awaiting decision', () => {
    expect(
      projectNeedsWorkflowReviewAttention(
        project({ id: 'p1', workflowReviewBatch: batch({}) }),
      ),
    ).toBe(true);
  });

  it('emits attention when review batch newly appears', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWorkflowReviewAttention(listener);
    const prev = [project({ id: 'p1' })];
    const next = [project({ id: 'p1', workflowReviewBatch: batch({}) })];
    notifyWorkflowReviewAttentionIfNeeded(prev, next);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      projectId: 'p1',
      title: 'Demo',
      phase: 'collecting',
    });
    unsubscribe();
  });

  it('does not repeat attention for unchanged batch signature', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWorkflowReviewAttention(listener);
    const withBatch = project({ id: 'p1', workflowReviewBatch: batch({}) });
    notifyWorkflowReviewAttentionIfNeeded([withBatch], [withBatch]);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('emits again when batch advances to ready_to_settle', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeWorkflowReviewAttention(listener);
    const collecting = project({
      id: 'p1',
      workflowReviewBatch: batch({ id: 'b1', updatedAt: 100 }),
    });
    const ready = project({
      id: 'p1',
      workflowReviewBatch: batch({ id: 'b1', phase: 'ready_to_settle', updatedAt: 200 }),
    });
    notifyWorkflowReviewAttentionIfNeeded([collecting], [ready]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'ready_to_settle' }),
    );
    unsubscribe();
  });
});
