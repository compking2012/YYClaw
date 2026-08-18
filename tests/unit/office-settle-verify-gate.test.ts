/**
 * Evidence-based settle gate tests — each case reproduces a concrete stall or recovery path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayManager } from '../../electron/gateway/manager';
import { fetchChatHistory, fetchGatewaySessionListRow } from '../../electron/services/office/gateway-rpc';
import {
  applyOfficeRunRuntimeEvent,
  captureOfficeSettleBaseline,
  createOfficeRunTracker,
  isOfficeRunProtocolDischarged,
  reconcileOfficeRunSessionIdle,
  sessionListRowAllowsSuccessSettle,
  sessionListRowAllowsWorkflowHistorySettle,
  tryReconcileOfficeRunFromWorkflowHistory,
  verifyOfficeSessionAllowsSuccessSettle,
} from '../../electron/services/office/session-run-settle';
import { buildWorkflowRoleStepFromValidationFailure } from '../../electron/services/office/workflow-role-step-outcome';
import { isRecoverableWorkflowOutputFailure } from '@/lib/office-workflow-agent-recovery';
import { waitForSessionReply } from '../../electron/services/office/run-completion';

vi.mock('../../electron/services/office/gateway-rpc', () => ({
  fetchChatHistory: vi.fn(),
  fetchGatewaySessionListRow: vi.fn(),
  invalidateGatewaySessionListRowCache: vi.fn(),
}));

const SESSION = 'agent:pm:office:task:t1:role:reviewer:node:n1';
const RUN_ID = 'run-verify-gate';
const startedAt = 10_000;

const WORKFLOW_JSON = `{
  "role": "稿件审查师",
  "step": { "index": 3, "total": 5, "title": "稿件审查" },
  "inputValidation": { "targets": ["a.md"], "lsResult": [] },
  "execution": "完成",
  "outputValidation": { "targets": ["out.md"], "lsResult": [] },
  "deliverable": { "path": "out.md", "summary": "摘要", "conclusion": "通过" },
  "rollback": "无"
}`;

function mockSessionRow(hasActiveRun: boolean, status = 'done') {
  vi.mocked(fetchGatewaySessionListRow).mockResolvedValue({
    key: SESSION,
    hasActiveRun,
    status,
    updatedAt: startedAt + 5_000,
  });
}

function historyWithAssistant(content: string) {
  return {
    messages: [
      { role: 'user', content: 'go', timestamp: startedAt },
      { role: 'assistant', content, stopReason: 'stop', timestamp: startedAt + 1_000 },
    ],
  };
}

describe('office settle verify gate (evidence-based)', () => {
  const gateway = {} as GatewayManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchChatHistory).mockResolvedValue(historyWithAssistant(WORKFLOW_JSON));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('strict sessions.list settle rejects hasActiveRun even when status is done', () => {
    const row = { key: SESSION, hasActiveRun: true, status: 'done', updatedAt: startedAt + 1_000 };
    expect(sessionListRowAllowsSuccessSettle(row, startedAt)).toBe(false);
    expect(sessionListRowAllowsWorkflowHistorySettle(row, startedAt)).toBe(true);
  });

  it('main-path session idle can open gate while hasActiveRun is still true (status done)', () => {
    const tracker = createOfficeRunTracker(RUN_ID);
    const row = { key: SESSION, hasActiveRun: true, status: 'done', updatedAt: startedAt + 1_000 };
    expect(reconcileOfficeRunSessionIdle(tracker, row, startedAt)).toBe(true);
    expect(tracker.sessionIdleReconciled).toBe(true);
    expect(tracker.workflowHistoryReconciled).toBe(false);
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(true);
  });

  it('idle-open + status=done + hasActiveRun does NOT churn in verify (open/verify consistency)', async () => {
    // Repro: reconcile opens the gate on status=done even with hasActiveRun=true; verify must
    // stay consistent (re-confirm success-idle), not reset the gate on the lagging flag.
    const tracker = createOfficeRunTracker(RUN_ID);
    const row = { key: SESSION, status: 'done', hasActiveRun: true, updatedAt: startedAt + 5_000 };
    expect(reconcileOfficeRunSessionIdle(tracker, row, startedAt)).toBe(true);
    expect(tracker.sessionIdleReconciled).toBe(true);

    vi.mocked(fetchGatewaySessionListRow).mockResolvedValue(row);
    const ok = await verifyOfficeSessionAllowsSuccessSettle(gateway, SESSION, startedAt, tracker);
    expect(ok).toBe(true);
    expect(tracker.sessionIdleReconciled).toBe(true);
  });

  it('idle-open then genuine re-activation (status=running) is rejected by verify (no intermediate settle)', async () => {
    const tracker = createOfficeRunTracker(RUN_ID);
    tracker.sessionIdleReconciled = true;
    // Session re-activated: status now running with an active run — must not settle.
    vi.mocked(fetchGatewaySessionListRow).mockResolvedValue({
      key: SESSION,
      status: 'running',
      hasActiveRun: true,
      updatedAt: startedAt + 6_000,
    });
    const ok = await verifyOfficeSessionAllowsSuccessSettle(gateway, SESSION, startedAt, tracker);
    expect(ok).toBe(false);
    expect(tracker.sessionIdleReconciled).toBe(false);
    expect(tracker.workflowHistoryReconciled).toBe(false);
  });

  it('history reconcile after main-path idle promotes workflowHistoryReconciled so verify accepts hasActiveRun', async () => {
    const tracker = createOfficeRunTracker(RUN_ID);
    tracker.sessionIdleReconciled = true;
    const messages = historyWithAssistant(WORKFLOW_JSON).messages;
    expect(tryReconcileOfficeRunFromWorkflowHistory(tracker, messages, startedAt, {
      replyText: WORKFLOW_JSON,
    })).toBe(true);
    expect(tracker.workflowHistoryReconciled).toBe(true);

    mockSessionRow(true, 'done');
    const ok = await verifyOfficeSessionAllowsSuccessSettle(gateway, SESSION, startedAt, tracker);
    expect(ok).toBe(true);
    expect(tracker.sessionIdleReconciled).toBe(true);
  });

  it('run.ended opens gate (runComplete); history-JSON then promotes workflowHistoryReconciled (Model B)', () => {
    const tracker = createOfficeRunTracker(RUN_ID);
    applyOfficeRunRuntimeEvent(tracker, {
      type: 'run.ended',
      runId: RUN_ID,
      status: 'completed',
      lifecyclePhase: 'completed',
    });
    expect(tracker.runComplete).toBe(true);
    expect(tracker.workflowHistoryReconciled).toBe(false);

    const messages = historyWithAssistant(WORKFLOW_JSON).messages;
    expect(tryReconcileOfficeRunFromWorkflowHistory(tracker, messages, startedAt, {
      replyText: WORKFLOW_JSON,
    })).toBe(true);
    // Gate was opened by run.ended → history-JSON promotes the relax flag.
    expect(tracker.workflowHistoryReconciled).toBe(true);
  });

  it('run.ended + hasActiveRun: relaxed verify allows captureOfficeSettleBaseline', async () => {
    const tracker = createOfficeRunTracker(RUN_ID);
    applyOfficeRunRuntimeEvent(tracker, {
      type: 'run.ended',
      runId: RUN_ID,
      status: 'completed',
      lifecyclePhase: 'completed',
    });
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(true);
    mockSessionRow(true, 'done');

    const verifyOk = await verifyOfficeSessionAllowsSuccessSettle(gateway, SESSION, startedAt, tracker);
    expect(verifyOk).toBe(true);
    expect(tracker.runComplete).toBe(true);

    const captured = await captureOfficeSettleBaseline(gateway, {
      sessionKey: SESSION,
      startedAtMs: startedAt,
      tracker,
      pollText: async () => WORKFLOW_JSON,
    });
    expect(captured).toBe(true);
    expect(tracker.settleBaselineText).toBe(WORKFLOW_JSON);
  });

  it('invalid_json_syntax is not recoverable at node output-retry layer (goes straight to failed)', () => {
    expect(isRecoverableWorkflowOutputFailure(['invalid_json_syntax'])).toBe(false);
    const step = buildWorkflowRoleStepFromValidationFailure({
      roleId: 'reviewer',
      issues: ['invalid_json_syntax'],
      detail: 'JSON 语法错误',
    });
    expect(step.status).toBe('failed');
    expect(step.outputRetry).toBeUndefined();
  });
});

describe('waitForSessionReply run.ended + hasActiveRun', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(fetchChatHistory).mockResolvedValue(historyWithAssistant(WORKFLOW_JSON));
    vi.mocked(fetchGatewaySessionListRow).mockResolvedValue({
      key: SESSION,
      hasActiveRun: true,
      status: 'done',
      updatedAt: startedAt + 5_000,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('completes wait when run.ended fired and sessions.list still shows hasActiveRun', async () => {
    type Listener = (data: unknown) => void;
    const listeners = new Map<string, Set<Listener>>();
    const emitterGateway = {
      on(event: string, fn: Listener) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(fn);
      },
      off(event: string, fn: Listener) {
        listeners.get(event)?.delete(fn);
      },
      emitRuntime(event: Record<string, unknown>) {
        for (const fn of listeners.get('chat:runtime-event') ?? []) {
          fn(event);
        }
      },
    } as GatewayManager & { emitRuntime: (event: Record<string, unknown>) => void };

    const promise = waitForSessionReply(emitterGateway, {
      sessionKey: SESSION,
      startedAtMs: startedAt,
      runId: RUN_ID,
      timeoutMs: 30_000,
      pollIntervalMs: 500,
      requireWorkflowStructuredReply: true,
      requireFreshUserTurn: true,
      minWaitBeforeAcceptMs: 0,
    });

    emitterGateway.emitRuntime({
      type: 'run.ended',
      runId: RUN_ID,
      sessionKey: SESSION,
      status: 'completed',
      lifecyclePhase: 'completed',
    });

    await vi.advanceTimersByTimeAsync(2_000);
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result.completed).toBe(true);
    expect(result.assistantText).toContain('"conclusion": "通过"');
  });
});
