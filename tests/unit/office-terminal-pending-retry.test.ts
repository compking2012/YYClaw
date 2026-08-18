/**
 * Terminal-judgment parity with Chat: a transient retry hint (`state=error`) must not
 * permanently block office from recognizing a later gateway terminal that only surfaces
 * via `sessions.list` idle or a settled workflow-history transcript (dropped lifecycle frame).
 *
 * Chat reference: `reconcileCurrentSessionIdleFromBackend` clears `sending` on a fresh idle
 * `sessions.list` row regardless of prior retry state (src/stores/chat/session-actions.ts).
 */
import { describe, expect, it } from 'vitest';
import {
  applyOfficeRunGatewayEvent,
  createOfficeRunTracker,
  isOfficeRunProtocolDischarged,
  reconcileOfficeRunSessionIdle,
  tryReconcileOfficeRunFromWorkflowHistory,
} from '../../electron/services/office/session-run-settle';

const startedAt = 100_000;

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

describe('office terminal judgment: transient retry must not block real terminal', () => {
  it('fresh idle sessions.list row reconciles terminal even after transient state=error (dropped lifecycle)', () => {
    const tracker = createOfficeRunTracker('run-retry-idle');
    applyOfficeRunGatewayEvent(tracker, { runId: 'run-retry-idle', state: 'error' });
    expect(tracker.pendingRetry).toBe(true);

    // Retry succeeded, final lifecycle frame dropped; only sessions.list shows idle.
    const idleRow = { key: 's', hasActiveRun: false, status: 'done', updatedAt: startedAt + 5_000 };
    expect(reconcileOfficeRunSessionIdle(tracker, idleRow, startedAt)).toBe(true);
    expect(tracker.sessionIdleReconciled).toBe(true);
    expect(tracker.pendingRetry).toBe(false);
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(true);
  });

  it('does NOT reconcile while gateway still reports an active run (no false positive)', () => {
    const tracker = createOfficeRunTracker('run-retry-active');
    applyOfficeRunGatewayEvent(tracker, { runId: 'run-retry-active', state: 'error' });
    expect(tracker.pendingRetry).toBe(true);

    const runningRow = { key: 's', hasActiveRun: true, status: 'running', updatedAt: startedAt + 5_000 };
    expect(reconcileOfficeRunSessionIdle(tracker, runningRow, startedAt)).toBe(false);
    expect(tracker.sessionIdleReconciled).toBe(false);
    expect(tracker.pendingRetry).toBe(true);
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(false);
  });

  it('maps a failure-terminal sessions.list row to terminal error, not success idle, during retry', () => {
    const tracker = createOfficeRunTracker('run-retry-fail');
    applyOfficeRunGatewayEvent(tracker, { runId: 'run-retry-fail', state: 'error' });
    const failRow = { key: 's', status: 'error', hasActiveRun: false, updatedAt: startedAt + 5_000 };
    expect(reconcileOfficeRunSessionIdle(tracker, failRow, startedAt)).toBe(false);
    expect(tracker.sessionIdleReconciled).toBe(false);
    expect(tracker.terminalErrorEnded).toBe(true);
  });

  it('Model B: transcript workflow-JSON alone does NOT open gate during retry; gateway idle does + clears pendingRetry', () => {
    const tracker = createOfficeRunTracker('run-retry-history');
    applyOfficeRunGatewayEvent(tracker, { runId: 'run-retry-history', state: 'error' });
    expect(tracker.pendingRetry).toBe(true);

    // No gateway terminal yet → history-JSON must NOT open the gate.
    expect(
      tryReconcileOfficeRunFromWorkflowHistory(tracker, historyMessages(WORKFLOW_JSON), startedAt, {
        replyText: WORKFLOW_JSON,
      }),
    ).toBe(false);
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(false);
    expect(tracker.pendingRetry).toBe(true);

    // Fresh idle sessions.list row (dropped lifecycle) opens the gate + clears retry hint.
    const idleRow = { key: 's', hasActiveRun: false, status: 'done', updatedAt: startedAt + 5_000 };
    expect(reconcileOfficeRunSessionIdle(tracker, idleRow, startedAt)).toBe(true);
    expect(tracker.pendingRetry).toBe(false);

    // Now history-JSON promotes the relax flag.
    expect(
      tryReconcileOfficeRunFromWorkflowHistory(tracker, historyMessages(WORKFLOW_JSON), startedAt, {
        replyText: WORKFLOW_JSON,
      }),
    ).toBe(true);
    expect(tracker.workflowHistoryReconciled).toBe(true);
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(true);
  });

  it('history reconcile stays pending while a tool is still in flight during retry (no false positive)', () => {
    const tracker = createOfficeRunTracker('run-retry-history-tool');
    applyOfficeRunGatewayEvent(tracker, { runId: 'run-retry-history-tool', state: 'error' });

    const messages = [
      { role: 'user', content: 'go', timestamp: startedAt },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 't1', name: 'read' }],
        stopReason: 'tool_use',
        timestamp: startedAt + 500,
      },
    ];
    expect(tryReconcileOfficeRunFromWorkflowHistory(tracker, messages, startedAt)).toBe(false);
    expect(tracker.pendingRetry).toBe(true);
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(false);
  });
});
