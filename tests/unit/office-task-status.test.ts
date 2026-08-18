import { describe, expect, it } from 'vitest';
import { isOfficeProjectExecuting } from '@/lib/office-room-sidebar';
import { isCompletionFollowUpPending } from '@/lib/office-project-completion-follow-up';
import {
  isOfficeFixedGroupProjectAutoArchive,
  isOfficeStandaloneAwaitingArchivePrompt,
} from '@/lib/office-project-lifecycle';
import {
  resolveEffectiveTaskStatus,
  resolveTaskStatusFromRuns,
  shouldAnnounceWorkflowProjectClosure,
  shouldAnnounceWorkflowTaskFinished,
} from '@/lib/office-task-status';
import type { NodeRunRecord, OfficeTempProject, WorkflowNode } from '@/types/office';

function node(id: string): WorkflowNode {
  return { id, title: id, roleId: 'pm', action: 'work' };
}

function run(nodeId: string, status: NodeRunRecord['status']): NodeRunRecord {
  return { nodeId, agentId: 'pm', status };
}

function collectingBatch(nodeId: string): OfficeTempProject['workflowReviewBatch'] {
  return {
    id: 'b',
    settleGeneration: 0,
    parallelGroup: `serial:${nodeId}`,
    expectedNodeIds: [nodeId],
    phase: 'collecting',
    items: { [nodeId]: { nodeId, state: 'awaiting_decision' } },
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('office-task-status', () => {
  it('resolveTaskStatusFromRuns returns completed when all nodes are terminal', () => {
    const nodes = [node('n1'), node('n2')];
    const runs = [run('n1', 'completed'), run('n2', 'skipped')];
    expect(resolveTaskStatusFromRuns(runs, nodes)).toBe('completed');
  });

  it('resolveEffectiveTaskStatus stays running while review batch is collecting', () => {
    const nodes = [node('n1')];
    const runs = new Map([['n1', run('n1', 'completed')]]);
    const project = { workflowReviewBatch: collectingBatch('n1') };
    expect(resolveEffectiveTaskStatus(project, runs, nodes)).toBe('running');
  });

  it('resolveEffectiveTaskStatus stays running while review batch is ready_to_settle', () => {
    const nodes = [node('n1')];
    const runs = new Map([['n1', run('n1', 'completed')]]);
    const project = {
      workflowReviewBatch: {
        ...collectingBatch('n1')!,
        phase: 'ready_to_settle' as const,
        items: { n1: { nodeId: 'n1', state: 'submitted' as const } },
      },
    };
    expect(resolveEffectiveTaskStatus(project, runs, nodes)).toBe('running');
  });

  it('resolveEffectiveTaskStatus returns completed after review batch is cleared', () => {
    const nodes = [node('n1')];
    const runs = new Map([['n1', run('n1', 'completed')]]);
    expect(resolveEffectiveTaskStatus({}, runs, nodes)).toBe('completed');
  });

  it('shouldAnnounceWorkflowTaskFinished is false while review is active', () => {
    expect(
      shouldAnnounceWorkflowTaskFinished({
        status: 'completed',
        workflowReviewBatch: collectingBatch('n1'),
      }),
    ).toBe(false);
    expect(
      shouldAnnounceWorkflowTaskFinished({ status: 'completed' }),
    ).toBe(true);
  });

  it('shouldAnnounceWorkflowTaskFinished is false for aborted (no coordinator summary)', () => {
    expect(shouldAnnounceWorkflowTaskFinished({ status: 'aborted' })).toBe(false);
    expect(shouldAnnounceWorkflowTaskFinished({ status: 'failed' })).toBe(true);
  });

  it('shouldAnnounceWorkflowProjectClosure is false while review is active', () => {
    const nodes = [node('n1')];
    const runs = new Map([['n1', run('n1', 'completed')]]);
    expect(
      shouldAnnounceWorkflowProjectClosure(
        { workflowReviewBatch: collectingBatch('n1') },
        runs,
        nodes,
      ),
    ).toBe(false);
    expect(shouldAnnounceWorkflowProjectClosure({}, runs, nodes)).toBe(true);
  });

  it('blocks completion follow-up and auto-archive while review is active', () => {
    const project = {
      origin: 'fixed_group' as const,
      status: 'completed' as const,
      lifecycle: 'active' as const,
      lastRunCompletedAt: 1_000,
      completionFollowUpHandledAt: undefined,
      workflowReviewBatch: collectingBatch('n1'),
      nodeRuns: [run('n1', 'completed')],
    };
    expect(isCompletionFollowUpPending(project)).toBe(false);
    expect(isOfficeFixedGroupProjectAutoArchive(project)).toBe(false);
    expect(isOfficeStandaloneAwaitingArchivePrompt({ ...project, origin: 'standalone' })).toBe(
      false,
    );
    expect(isOfficeProjectExecuting(project)).toBe(true);
  });
});
