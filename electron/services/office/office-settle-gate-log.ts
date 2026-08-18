import type { GatewaySessionListRow } from './gateway-rpc';
import { officeWorkflowLog } from './office-workflow-log';
import type { OfficeRunTracker } from './session-run-settle';

type GateLogDetail = Record<string, string | number | boolean | null | undefined>;

/** grep: `[office][gateway-settle]` */
export function logOfficeGatewaySettle(
  level: 'debug' | 'info' | 'warn',
  event: string,
  detail?: GateLogDetail,
): void {
  officeWorkflowLog(level, `[office][gateway-settle] ${event}`, detail);
}

export function officeSettleGateStateDetail(tracker: OfficeRunTracker): GateLogDetail {
  const gateOpen =
    Boolean(tracker.workflowHistoryReconciled)
    || (!tracker.pendingRetry && (tracker.runComplete || tracker.sessionIdleReconciled));
  return {
    runId: tracker.runId,
    runComplete: tracker.runComplete,
    sessionIdleReconciled: tracker.sessionIdleReconciled,
    workflowHistoryReconciled: tracker.workflowHistoryReconciled,
    pendingRetry: tracker.pendingRetry,
    terminalErrorEnded: tracker.terminalErrorEnded,
    gateOpen,
    settleConsistencyAttempted: tracker.settleConsistencyAttempted,
    hashMismatchCount: tracker.settleHashMismatchCount,
  };
}

export function officeSessionListRowDetail(
  row: GatewaySessionListRow | null | undefined,
): GateLogDetail {
  if (!row) return { listRow: 'null' };
  return {
    listStatus: row.status,
    listHasActiveRun: row.hasActiveRun,
    listUpdatedAt: row.updatedAt,
  };
}

export function logOfficeGatewayLifecycleRunIdMismatch(
  expectedRunId: string | undefined,
  eventRunId: unknown,
  eventType: string,
  sessionKey?: string,
): void {
  logOfficeGatewaySettle('debug', 'lifecycle runId mismatch — event ignored', {
    sessionKey,
    expectedRunId,
    eventRunId: eventRunId == null ? undefined : String(eventRunId),
    eventType,
  });
}
