/**
 * Session idle reconcile: transient retry hint after authoritative terminal must not re-close gate.
 */
import { describe, expect, it } from 'vitest';
import {
  applyOfficeRunGatewayEvent,
  createOfficeRunTracker,
  isOfficeRunProtocolDischarged,
  reconcileOfficeRunSessionIdle,
  refreshOfficeRunPendingRetryFromSessionIdleRow,
} from '../../electron/services/office/session-run-settle';

const startedAt = 100_000;
const idleRow = { key: 's', hasActiveRun: false, status: 'done', updatedAt: startedAt + 5_000 };

describe('sessionIdleReconciled + transient error after gate open', () => {
  it('transient state=error after sessionIdleReconciled does not set pendingRetry or close gate', () => {
    const tracker = createOfficeRunTracker('run-idle-retry');
    expect(reconcileOfficeRunSessionIdle(tracker, idleRow, startedAt)).toBe(true);
    expect(tracker.sessionIdleReconciled).toBe(true);

    applyOfficeRunGatewayEvent(tracker, { runId: 'run-idle-retry', state: 'error' });
    expect(tracker.pendingRetry).toBe(false);
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(true);
  });

  it('reconcile early-return path keeps gate open after stray error (poll parity)', () => {
    const tracker = createOfficeRunTracker('run-idle-retry-2');
    reconcileOfficeRunSessionIdle(tracker, idleRow, startedAt);
    applyOfficeRunGatewayEvent(tracker, { runId: 'run-idle-retry-2', state: 'error' });

    expect(reconcileOfficeRunSessionIdle(tracker, idleRow, startedAt)).toBe(true);
    expect(tracker.pendingRetry).toBe(false);
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(true);
  });

  it('refresh still clears pendingRetry when set before terminal (legacy dirty state)', () => {
    const tracker = createOfficeRunTracker('run-idle-retry-legacy');
    tracker.pendingRetry = true;
    expect(reconcileOfficeRunSessionIdle(tracker, idleRow, startedAt)).toBe(true);
    expect(tracker.sessionIdleReconciled).toBe(true);

    refreshOfficeRunPendingRetryFromSessionIdleRow(tracker, idleRow, startedAt);
    expect(tracker.pendingRetry).toBe(false);
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(true);
  });
});
