/**
 * Root-cause fixes for the "node completed but never advanced" stall (GPGPU/稿件审查师):
 *  - Fix 2: an authoritative gateway terminal (workflowHistoryReconciled, runComplete, or
 *    sessionIdleReconciled) must NOT be re-closed by a transient retry hint (`state=error` /
 *    retry-phase). Otherwise `runComplete|sessionIdleReconciled + pendingRetry` deadlock the
 *    settle gate before workflowHistory promote (software-test delayed lifecycle error leak).
 *  - Fix 1: continue-reopen (`nodeRunsForWorkflowContinue`) must clear stale `edgeOutcome`
 *    (e.g. a `failure` left by a prior manual abort) so the on_success edge is not poisoned.
 */
import { describe, it, expect } from 'vitest';
import {
  applyOfficeRunGatewayEvent,
  applyOfficeRunRuntimeEvent,
  createOfficeRunTracker,
  isOfficeRunProtocolDischarged,
  reconcileOfficeRunSessionIdle,
  tryReconcileOfficeRunFromWorkflowHistory,
} from '../../electron/services/office/session-run-settle';
import { nodeRunsForWorkflowContinue } from '../../src/lib/office-workflow-schedule';
import type { NodeRunRecord, WorkflowNode } from '../../src/types/office';

const startedAt = 100_000;
const RUN = 'run-resume-recovery';
const WORKFLOW_JSON = `{
  "role": "稿件审查师",
  "step": { "index": 3, "total": 5, "title": "稿件审查" },
  "inputValidation": { "targets": ["a.md"], "lsResult": [] },
  "execution": "完成",
  "outputValidation": { "targets": ["out.md"], "lsResult": [] },
  "deliverable": { "path": "out.md", "summary": "摘要", "conclusion": "通过" },
  "rollback": "无"
}`;

function historyMessages(content: string) {
  return [
    { role: 'user', content: 'go', timestamp: startedAt },
    { role: 'assistant', content, stopReason: 'stop', timestamp: startedAt + 1_000 },
  ];
}

function openGateAndPromote(runId: string) {
  const tracker = createOfficeRunTracker(runId);
  // Authoritative gateway terminal: sessions.list idle opens the gate.
  expect(
    reconcileOfficeRunSessionIdle(
      tracker,
      { key: 's', hasActiveRun: false, status: 'done', updatedAt: startedAt + 5_000 },
      startedAt,
    ),
  ).toBe(true);
  // Settled transcript promotes workflowHistoryReconciled.
  expect(
    tryReconcileOfficeRunFromWorkflowHistory(tracker, historyMessages(WORKFLOW_JSON), startedAt, {
      replyText: WORKFLOW_JSON,
    }),
  ).toBe(true);
  expect(tracker.workflowHistoryReconciled).toBe(true);
  expect(isOfficeRunProtocolDischarged(tracker)).toBe(true);
  return tracker;
}

describe('settle gate: settled terminal not reverted by transient retry hint (deadlock fix)', () => {
  function openGateViaRunEnded(runId: string) {
    const tracker = createOfficeRunTracker(runId);
    applyOfficeRunRuntimeEvent(tracker, {
      type: 'run.ended',
      runId,
      status: 'completed',
      lifecyclePhase: 'end',
      stopReason: 'stop',
    });
    expect(tracker.runComplete).toBe(true);
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(true);
    return tracker;
  }

  it('transient state=error after runComplete keeps gate open (delayed lifecycle error leak)', () => {
    const tracker = openGateViaRunEnded(RUN);
    applyOfficeRunGatewayEvent(tracker, { runId: RUN, state: 'error' });
    expect(tracker.pendingRetry).toBe(false);
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(true);
  });

  it('runComplete + stray error still promotes workflowHistoryReconciled', () => {
    const tracker = openGateViaRunEnded(RUN);
    applyOfficeRunGatewayEvent(tracker, { runId: RUN, state: 'error' });
    expect(
      tryReconcileOfficeRunFromWorkflowHistory(tracker, historyMessages(WORKFLOW_JSON), startedAt, {
        replyText: WORKFLOW_JSON,
      }),
    ).toBe(true);
    expect(tracker.workflowHistoryReconciled).toBe(true);
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(true);
  });

  it('transient state=error after settled transcript keeps the gate open', () => {
    const tracker = openGateAndPromote(RUN);
    applyOfficeRunGatewayEvent(tracker, { runId: RUN, state: 'error' });
    // The hint is recorded but must NOT deadlock a confirmed-settled terminal.
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(true);
  });

  it('transient retry-phase hint after settled transcript keeps the gate open', () => {
    const tracker = openGateAndPromote(RUN);
    applyOfficeRunGatewayEvent(tracker, { runId: RUN, phase: 'retrying same model' });
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(true);
  });

  it('genuine re-activation via runtime run.started reopens (clears settled marker)', () => {
    const tracker = openGateAndPromote(RUN);
    applyOfficeRunRuntimeEvent(tracker, { type: 'run.started', runId: RUN });
    expect(tracker.workflowHistoryReconciled).toBe(false);
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(false);
  });

  it('genuine re-activation via gateway state=started reopens (clears settled marker)', () => {
    const tracker = openGateAndPromote(RUN);
    applyOfficeRunGatewayEvent(tracker, { runId: RUN, state: 'started' });
    expect(tracker.workflowHistoryReconciled).toBe(false);
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(false);
  });
});

describe('edgeOutcome hygiene on continue-reopen (Fix 1)', () => {
  it('nodeRunsForWorkflowContinue clears stale edgeOutcome/reworkReason when reopening a running node', () => {
    const nodes: WorkflowNode[] = [
      { id: 'gen-2', roleId: 'reviewer', title: '稿件审查', execution: 'serial' },
    ];
    const prior = [
      {
        nodeId: 'gen-2',
        roleId: 'reviewer',
        status: 'running',
        edgeOutcome: 'failure',
        reworkReason: '用户已手动中止本项目',
        startedAt: 1,
        runId: 'run-old',
      } as NodeRunRecord,
    ];
    const out = nodeRunsForWorkflowContinue(prior, nodes);
    const g2 = out.find((r) => r.nodeId === 'gen-2')!;
    expect(g2.status).toBe('pending');
    expect(g2.edgeOutcome).toBeUndefined();
    expect(g2.reworkReason).toBeUndefined();
  });

  it('nodeRunsForWorkflowContinue preserves tagged human-review reworkReason across crash-continue', () => {
    const nodes: WorkflowNode[] = [
      { id: 'gen-2', roleId: 'reviewer', title: '稿件审查', execution: 'serial' },
    ];
    const prior = [
      {
        nodeId: 'gen-2',
        roleId: 'reviewer',
        status: 'running',
        edgeOutcome: 'failure',
        reworkReason: '【人工审查意见】\n请修正交付物',
        startedAt: 1,
        runId: 'run-old',
      } as NodeRunRecord,
    ];
    const g2 = nodeRunsForWorkflowContinue(prior, nodes).find((r) => r.nodeId === 'gen-2')!;
    expect(g2.status).toBe('pending');
    expect(g2.edgeOutcome).toBeUndefined();
    expect(g2.reworkReason).toContain('【人工审查意见】');
  });

  it('nodeRunsForWorkflowContinue clears stale edgeOutcome when reopening a failed node', () => {
    const nodes: WorkflowNode[] = [
      { id: 'gen-2', roleId: 'reviewer', title: '稿件审查', execution: 'serial' },
    ];
    const prior = [
      { nodeId: 'gen-2', roleId: 'reviewer', status: 'failed', edgeOutcome: 'failure' } as NodeRunRecord,
    ];
    const g2 = nodeRunsForWorkflowContinue(prior, nodes).find((r) => r.nodeId === 'gen-2')!;
    expect(g2.status).toBe('pending');
    expect(g2.edgeOutcome).toBeUndefined();
  });
});
