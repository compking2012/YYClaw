import { describe, expect, it } from 'vitest';
import type { NodeRunRecord, WorkflowEdge, WorkflowNode } from '@/types/office';
import { reopenWorkflowUpstreamForRework } from '@/lib/office-workflow-upstream-rework';
import {
  markWorkflowPendingClaim,
  markWorkflowRoomHealPendingClaim,
  sessionRoleResultsIndicateSoftPendingOnly,
  claimLiveRunAfterUpstreamReworkOpen,
  sessionWorkflowOutcomesShouldYieldToPeerClaim,
} from '@/lib/office-workflow-node-run-settled';

const nodes: WorkflowNode[] = [
  { id: 'gen-5', agentId: 'dev', title: '软件功能开发', execution: 'serial' },
  { id: 'gen-6', agentId: 'qa', title: '功能测试', execution: 'serial' },
];
const edges: WorkflowEdge[] = [{ from: 'gen-5', to: 'gen-6', when: 'on_success' }];

describe('office-workflow-rework-bugs (suspect → reproduce → fix)', () => {
  it('stale local claim after reopen loses reworkGeneration; live claim preserves it', () => {
    const runs = new Map<string, NodeRunRecord>([
      [
        'gen-5',
        {
          nodeId: 'gen-5',
          agentId: 'dev',
          status: 'completed',
          reworkGeneration: 0,
          completionSource: 'session',
        },
      ],
      [
        'gen-6',
        {
          nodeId: 'gen-6',
          agentId: 'qa',
          status: 'running',
          reworkGeneration: 3,
          completionSource: 'room_heal',
        },
      ],
    ]);
    const staleLocal = runs.get('gen-6')!;

    reopenWorkflowUpstreamForRework({
      runs,
      nodes,
      edges,
      currentNodeId: 'gen-6',
      predecessorNodeIds: ['gen-5'],
      reworkReason: '【回滚】缺陷',
    });
    expect(runs.get('gen-6')?.reworkGeneration).toBe(4);

    // Anti-pattern (pre-fix): claim from stale local then runs.set
    const buggyClaimed = markWorkflowPendingClaim(staleLocal, 'room_heal', {
      error: '【回滚说明】已触发工作流回滚',
    });
    expect(buggyClaimed.reworkGeneration).toBe(3);

    const fixed = claimLiveRunAfterUpstreamReworkOpen({
      runs,
      nodeId: 'gen-6',
      source: 'room_heal',
      reason: '【回滚说明】已触发工作流回滚',
    });
    expect(fixed.reworkGeneration).toBe(4);
    expect(fixed.completionSource).toBe('room_heal');
    expect(fixed.status).toBe('pending');
    expect(runs.get('gen-6')?.reworkGeneration).toBe(4);
    expect(runs.get('gen-5')?.status).toBe('pending');
  });

  it('soft-pending peer role results must not be treated as completed promotion', () => {
    expect(
      sessionRoleResultsIndicateSoftPendingOnly([{ status: 'pending', agentId: 'qa' }]),
    ).toBe(true);
    expect(
      sessionRoleResultsIndicateSoftPendingOnly([{ status: 'completed', agentId: 'qa' }]),
    ).toBe(false);
    expect(
      sessionRoleResultsIndicateSoftPendingOnly([
        {
          status: 'pending',
          agentId: 'qa',
          upstreamRework: { predecessorNodeIds: ['gen-5'], mentionedAgentIds: [], reason: 'x' },
        },
      ]),
    ).toBe(false);
    expect(
      sessionRoleResultsIndicateSoftPendingOnly([
        { status: 'pending', agentId: 'qa', outputRetry: true },
      ]),
    ).toBe(false);
    expect(
      sessionRoleResultsIndicateSoftPendingOnly([{ status: 'failed', agentId: 'qa' }]),
    ).toBe(false);
  });

  it('atomic reopen+live-claim enables session yield without leaving upstream completed', () => {
    const runs = new Map<string, NodeRunRecord>([
      ['gen-5', { nodeId: 'gen-5', agentId: 'dev', status: 'completed', reworkGeneration: 0 }],
      ['gen-6', { nodeId: 'gen-6', agentId: 'qa', status: 'running', reworkGeneration: 1 }],
    ]);
    reopenWorkflowUpstreamForRework({
      runs,
      nodes,
      edges,
      currentNodeId: 'gen-6',
      predecessorNodeIds: ['gen-5'],
      reworkReason: '【回滚】缺陷',
    });
    claimLiveRunAfterUpstreamReworkOpen({
      runs,
      nodeId: 'gen-6',
      source: 'room_heal',
      reason: '【回滚说明】已触发工作流回滚',
    });
    expect(sessionWorkflowOutcomesShouldYieldToPeerClaim(runs.get('gen-6'), 'session')).toBe(true);
    expect(runs.get('gen-5')?.status).toBe('pending');
  });

  it('merge-only claim before reopen leaves upstream completed (forbidden race window)', () => {
    const runs = new Map<string, NodeRunRecord>([
      ['gen-5', { nodeId: 'gen-5', agentId: 'dev', status: 'completed', reworkGeneration: 0 }],
      ['gen-6', { nodeId: 'gen-6', agentId: 'qa', status: 'running', reworkGeneration: 1 }],
    ]);
    runs.set(
      'gen-6',
      markWorkflowRoomHealPendingClaim(runs.get('gen-6')!, {
        error: '【回滚说明】已触发工作流回滚',
      }),
    );
    expect(runs.get('gen-6')?.completionSource).toBe('room_heal');
    expect(runs.get('gen-5')?.status).toBe('completed');
  });

  it('session outputRetry pending claim is visible to room_heal peer checks', () => {
    const claimed = markWorkflowPendingClaim(
      { nodeId: 'gen-6', agentId: 'qa', status: 'running' },
      'session',
      { outputRetryAttempts: 2, error: '【输出补全】未收到模型正文（自动重试 2/3）' },
    );
    expect(claimed.status).toBe('pending');
    expect(claimed.completionSource).toBe('session');
    expect(claimed.outputRetryAttempts).toBe(2);
    expect(sessionWorkflowOutcomesShouldYieldToPeerClaim(claimed, 'room_heal')).toBe(true);
  });
});
