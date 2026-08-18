import { describe, expect, it } from 'vitest';
import {
  applyOfficeRunRuntimeEvent,
  createOfficeRunTracker,
  isOfficeRunProtocolDischarged,
  reconcileOfficeRunSessionIdle,
  tryReconcileOfficeRunFromWorkflowHistory,
} from '../../electron/services/office/session-run-settle';
import { gatewayEventMatchesRun } from '../../electron/services/office/run-completion';
import {
  officeWorkflowBareRunTail,
  officeWorkflowNodeDispatchRunId,
  resolveWorkflowSettleRunId,
} from '@/lib/office-workflow-dispatch-run';

const WORKFLOW_JSON = `{
  "role": "PPT美化师",
  "step": { "index": 3, "total": 4, "title": "PPT制作" },
  "inputValidation": { "targets": [], "lsResult": [] },
  "execution": "完成",
  "outputValidation": { "targets": ["out.pptx"], "lsResult": ["-rw out.pptx"] },
  "deliverable": { "path": "out.pptx", "summary": "ok", "conclusion": "已交付" },
  "rollback": "无"
}`;

describe('office workflow dispatch run id (PPT beautifier stall repro)', () => {
  const sharedWorkflowRun = 'run-1783345495879';
  const taskId = 'project-1783334065252-zgya8y';

  it('officeWorkflowNodeDispatchRunId scopes each workflow node', () => {
    expect(officeWorkflowNodeDispatchRunId(sharedWorkflowRun, 'gen-0', taskId)).toBe(
      'run-1783345495879@gen-0',
    );
    expect(officeWorkflowNodeDispatchRunId(sharedWorkflowRun, 'gen-2', taskId)).toBe(
      'run-1783345495879@gen-2',
    );
  });

  it('resolveWorkflowSettleRunId keeps scoped dispatch when gateway bare tail aligns', () => {
    expect(resolveWorkflowSettleRunId('run-1783345495879', 'run-1783345495879@gen-2')).toBe(
      'run-1783345495879@gen-2',
    );
    expect(resolveWorkflowSettleRunId(undefined, 'run-1783345495879@gen-2')).toBe(
      'run-1783345495879@gen-2',
    );
    expect(resolveWorkflowSettleRunId('run-abc', undefined)).toBe('run-abc');
  });

  it('officeWorkflowBareRunTail strips node scope and idempotency prefix', () => {
    expect(officeWorkflowBareRunTail('run-1783345495879@gen-2')).toBe('run-1783345495879');
    expect(
      officeWorkflowBareRunTail(
        'office-task-project-t1-gen-2-ppt-run-1783345495879@gen-2',
      ),
    ).toBe('run-1783345495879');
  });

  it('gatewayEventMatchesRun: scoped settle accepts bare and scoped gateway lifecycle', () => {
    const scopedSettle = 'run-1783345495879@gen-2';
    expect(gatewayEventMatchesRun(scopedSettle, 'run-1783345495879')).toBe(true);
    expect(gatewayEventMatchesRun(scopedSettle, 'run-1783345495879@gen-2')).toBe(true);
    expect(
      gatewayEventMatchesRun(
        scopedSettle,
        'office-task-project-t1-gen-2-ppt-run-1783345495879@gen-2',
      ),
    ).toBe(true);
    expect(gatewayEventMatchesRun(scopedSettle, 'run-1783345495879@gen-0')).toBe(false);
  });

  it('gatewayEventMatchesRun rejects cross-node scoped lifecycle on shared bare tail', () => {
    const scopedGen2 = `${sharedWorkflowRun}@gen-2`;
    expect(gatewayEventMatchesRun(scopedGen2, sharedWorkflowRun)).toBe(true);
    expect(gatewayEventMatchesRun(scopedGen2, 'run-1783345495879@gen-0')).toBe(false);

    const gen0RunId =
      'office-task-project-1783334065252-zgya8y-gen-0-shu-ju-wa-jue-shi-run-1783345495879@gen-0';
    const gen2RunId =
      'office-task-project-1783334065252-zgya8y-gen-2-ppt-mei-hua-shi-run-1783345495879@gen-2';
    expect(gatewayEventMatchesRun(gen2RunId, gen0RunId)).toBe(false);

    const legacyGen2 =
      'office-task-project-1783334065252-zgya8y-gen-2-ppt-mei-hua-shi-run-1783345495879';
    expect(gatewayEventMatchesRun(legacyGen2, sharedWorkflowRun)).toBe(true);
  });

  it('gen-2 settle gate opens from bare run.ended after resolveWorkflowSettleRunId', () => {
    const scopedSettle = resolveWorkflowSettleRunId(sharedWorkflowRun, `${sharedWorkflowRun}@gen-2`);
    expect(scopedSettle).toBe(`${sharedWorkflowRun}@gen-2`);
    const tracker = createOfficeRunTracker(scopedSettle!);

    applyOfficeRunRuntimeEvent(tracker, {
      type: 'run.ended',
      runId: sharedWorkflowRun,
      status: 'completed',
      lifecyclePhase: 'end',
      stopReason: 'stop',
    });
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(true);
  });

  it('software test: scoped idempotency lifecycle matches scoped gen-2 settle', () => {
    const softwareBareRun = 'run-1783485289141';
    const scopedSettle = `${softwareBareRun}@gen-2`;
    const lifecycleRunId =
      'office-task-project-1783334715836-rprmqz-gen-2-ruan-jian-ce-shi-run-1783485289141@gen-2';
    expect(gatewayEventMatchesRun(scopedSettle, lifecycleRunId)).toBe(true);

    const tracker = createOfficeRunTracker(scopedSettle);
    applyOfficeRunRuntimeEvent(tracker, {
      type: 'run.ended',
      runId: lifecycleRunId,
      status: 'completed',
      lifecyclePhase: 'end',
      stopReason: 'stop',
    });
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(true);
    expect(tracker.runComplete).toBe(true);
  });

  it('gen-2 settle gate opens from sessions.list idle + workflow JSON after PPT completes', () => {
    const startedAtMs = 10_000;
    const runId = resolveWorkflowSettleRunId(sharedWorkflowRun, `${sharedWorkflowRun}@gen-2`)!;
    const tracker = createOfficeRunTracker(runId);

    const opened = reconcileOfficeRunSessionIdle(
      tracker,
      { key: 'sk', status: 'done', hasActiveRun: false, updatedAt: startedAtMs + 420_000 },
      startedAtMs,
    );
    expect(opened).toBe(true);
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(true);

    const messages = [
      { role: 'user', content: 'go', timestamp: startedAtMs },
      { role: 'assistant', content: WORKFLOW_JSON, stopReason: 'stop', timestamp: startedAtMs + 400_000 },
    ];
    expect(
      tryReconcileOfficeRunFromWorkflowHistory(tracker, messages, startedAtMs, {
        replyText: WORKFLOW_JSON,
      }),
    ).toBe(true);
    expect(tracker.workflowHistoryReconciled).toBe(true);
  });

  it('stale gen-0 scoped run.ended does not discharge gen-2 settle tracker', () => {
    const scopedSettle = resolveWorkflowSettleRunId(sharedWorkflowRun, `${sharedWorkflowRun}@gen-2`)!;
    const tracker = createOfficeRunTracker(scopedSettle);

    applyOfficeRunRuntimeEvent(tracker, {
      type: 'run.ended',
      runId: 'run-1783345495879@gen-0',
      status: 'completed',
      lifecyclePhase: 'end',
      stopReason: 'stop',
    });
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(false);

    applyOfficeRunRuntimeEvent(tracker, {
      type: 'run.ended',
      runId: scopedSettle,
      status: 'completed',
      lifecyclePhase: 'end',
      stopReason: 'stop',
    });
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(true);
  });
});
