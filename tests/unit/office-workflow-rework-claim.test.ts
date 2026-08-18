import { describe, expect, it } from 'vitest';
import type { NodeRunRecord } from '@/types/office';
import {
  WORKFLOW_UPSTREAM_REWORK_PROGRESS_TEXT,
  isLegacyMisleadingGatewayAbortProgressText,
  isWorkflowNodeRunClaimedByOtherPath,
  isWorkflowUpstreamReworkProgressText,
  mapPeerClaimedRunToRoleStepStatus,
  markWorkflowPendingClaim,
  markWorkflowRoomHealPendingClaim,
  sessionWorkflowApplyMayMutateRun,
  sessionWorkflowOutcomesShouldYieldToPeerClaim,
} from '@/lib/office-workflow-node-run-settled';

describe('office-workflow-rework-claim (B1–B3 helpers)', () => {
  it('markWorkflowRoomHealPendingClaim sets pending + room_heal completionSource', () => {
    const run: NodeRunRecord = { nodeId: 'gen-6', agentId: 'xy', status: 'running' };
    const claimed = markWorkflowRoomHealPendingClaim(run, {
      error: '【回滚说明】已触发工作流回滚',
      edgeOutcome: undefined,
      completedAt: undefined,
      startedAt: undefined,
    });
    expect(claimed.status).toBe('pending');
    expect(claimed.completionSource).toBe('room_heal');
    expect(claimed.error).toContain('回滚');
    expect(isWorkflowNodeRunClaimedByOtherPath(claimed, 'session')).toBe(true);
    expect(sessionWorkflowApplyMayMutateRun(claimed)).toBe(false);
  });

  it('markWorkflowPendingClaim can attribute session-path rework', () => {
    const run: NodeRunRecord = { nodeId: 'gen-6', agentId: 'xy', status: 'running' };
    const claimed = markWorkflowPendingClaim(run, 'session', {
      error: '【回滚说明】已触发工作流回滚',
    });
    expect(claimed.completionSource).toBe('session');
    expect(isWorkflowNodeRunClaimedByOtherPath(claimed, 'room_heal')).toBe(true);
    expect(isWorkflowNodeRunClaimedByOtherPath(claimed, 'session')).toBe(false);
  });

  it('mapPeerClaimedRunToRoleStepStatus keeps pending (does not coerce to completed)', () => {
    expect(mapPeerClaimedRunToRoleStepStatus({ status: 'pending' })).toBe('pending');
    expect(mapPeerClaimedRunToRoleStepStatus({ status: 'failed' })).toBe('failed');
    expect(mapPeerClaimedRunToRoleStepStatus({ status: 'completed' })).toBe('completed');
    expect(mapPeerClaimedRunToRoleStepStatus({ status: 'skipped' })).toBe('completed');
    expect(mapPeerClaimedRunToRoleStepStatus({ status: 'running' })).toBe('pending');
  });

  it('sessionWorkflowOutcomesShouldYieldToPeerClaim is true for room_heal pending rework', () => {
    const live = markWorkflowRoomHealPendingClaim({
      nodeId: 'gen-6',
      agentId: 'xy',
      status: 'running',
    });
    expect(sessionWorkflowOutcomesShouldYieldToPeerClaim(live, 'session')).toBe(true);
    expect(
      sessionWorkflowOutcomesShouldYieldToPeerClaim(
        { nodeId: 'gen-6', status: 'running' },
        'session',
      ),
    ).toBe(false);
    expect(
      sessionWorkflowOutcomesShouldYieldToPeerClaim(
        { nodeId: 'gen-6', status: 'completed', completionSource: 'room_heal' },
        'session',
      ),
    ).toBe(true);
  });

  it('race simulation: heal claim → peer map pending → outcomes yield (no completed/failed)', () => {
    const runs = new Map<string, NodeRunRecord>();
    runs.set('gen-6', { nodeId: 'gen-6', agentId: 'xy', status: 'running' });

    const claimed = markWorkflowRoomHealPendingClaim(runs.get('gen-6')!, {
      error: '【回滚】软件开发交付物存在阻断性缺陷',
    });
    runs.set('gen-6', claimed);

    expect(isWorkflowNodeRunClaimedByOtherPath(runs.get('gen-6'), 'session')).toBe(true);
    const roleStatus = mapPeerClaimedRunToRoleStepStatus(runs.get('gen-6')!);
    expect(roleStatus).toBe('pending');
    expect(roleStatus).not.toBe('completed');
    expect(roleStatus).not.toBe('failed');

    expect(sessionWorkflowOutcomesShouldYieldToPeerClaim(runs.get('gen-6'), 'session')).toBe(true);
    const staleLocal: NodeRunRecord = { nodeId: 'gen-6', agentId: 'xy', status: 'running' };
    expect(sessionWorkflowOutcomesShouldYieldToPeerClaim(staleLocal, 'session')).toBe(false);
    expect(sessionWorkflowOutcomesShouldYieldToPeerClaim(runs.get('gen-6'), 'session')).toBe(true);
  });

  it('rework progress text helpers', () => {
    expect(isWorkflowUpstreamReworkProgressText(WORKFLOW_UPSTREAM_REWORK_PROGRESS_TEXT)).toBe(true);
    expect(isWorkflowUpstreamReworkProgressText('已回流上游，等待重做')).toBe(true);
    expect(isWorkflowUpstreamReworkProgressText('执行失败：任务执行被中断')).toBe(false);
    expect(
      isLegacyMisleadingGatewayAbortProgressText(
        '执行失败：任务执行被中断（可能因网关重启或重新执行覆盖，请稍后点击续跑）',
      ),
    ).toBe(true);
    expect(isLegacyMisleadingGatewayAbortProgressText('执行失败：模型运行时错误')).toBe(false);
  });
});
