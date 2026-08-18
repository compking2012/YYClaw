/**
 * Reproduces serious Office session 收稿 (Model B settle gate) vulnerabilities:
 * gateway terminal vs office non-collection, and agent-done / workflow-stuck paths.
 */
import { describe, expect, it, vi } from 'vitest';
import type { GatewayManager } from '../../electron/gateway/manager';
import { fetchChatHistory, fetchGatewaySessionListRow } from '../../electron/services/office/gateway-rpc';
import { waitForSessionReply } from '../../electron/services/office/run-completion';
import {
  applyOfficeRunRuntimeEvent,
  createOfficeRunTracker,
  isOfficeRunProtocolDischarged,
  reconcileOfficeRunSessionIdle,
  tryReconcileOfficeRunSessionIdle,
} from '../../electron/services/office/session-run-settle';
import { resolveWorkflowSettleRunId } from '@/lib/office-workflow-dispatch-run';

vi.mock('../../electron/services/office/gateway-rpc', () => ({
  fetchChatHistory: vi.fn(),
  fetchGatewaySessionListRow: vi.fn(),
  invalidateGatewaySessionListRowCache: vi.fn(),
}));

const SESSION = 'agent:pm:office:task:t-stall:role:qa:node:gen-2';
const startedAt = 100_000;
const SHARED_BARE_RUN = 'run-1783345495879';
const SCOPED_GEN2 = `${SHARED_BARE_RUN}@gen-2`;
const SETTLE_GEN2 = resolveWorkflowSettleRunId(SHARED_BARE_RUN, SCOPED_GEN2)!;

const WF_JSON = JSON.stringify({
  role: '测试',
  step: { index: 3, total: 3, title: '验收' },
  inputValidation: { targets: [], lsResult: [] },
  execution: '完成',
  outputValidation: { targets: ['out.md'], lsResult: ['ok'] },
  deliverable: { path: 'out.md', summary: 'ok', conclusion: '通过' },
  rollback: '无',
});

type Listener = (data: unknown) => void;

function createEmitterGateway(): GatewayManager & {
  emitAgentNotification: (params: Record<string, unknown>) => void;
} {
  const listeners = new Map<string, Set<Listener>>();
  return {
    on(event: string, fn: Listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
    },
    off(event: string, fn: Listener) {
      listeners.get(event)?.delete(fn);
    },
    emitAgentNotification(params: Record<string, unknown>) {
      const payload = { method: 'agent', params };
      for (const fn of listeners.get('notification') ?? []) fn(payload);
    },
  } as GatewayManager & { emitAgentNotification: (params: Record<string, unknown>) => void };
}

const completedLifecycle = (runId: string) => ({
  runId,
  sessionKey: SESSION,
  stream: 'lifecycle',
  data: { phase: 'end', stopReason: 'stop' },
});

describe('P0: node-scoped dispatch vs gateway lifecycle run.ended', () => {
  it('scoped dispatch resolves to scoped settle id; bare run.ended opens gate', () => {
    expect(SETTLE_GEN2).toBe(SCOPED_GEN2);
    const tracker = createOfficeRunTracker(SETTLE_GEN2);
    applyOfficeRunRuntimeEvent(tracker, {
      type: 'run.ended',
      runId: SHARED_BARE_RUN,
      status: 'completed',
      lifecyclePhase: 'end',
      stopReason: 'stop',
    });
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(true);
    expect(tracker.runComplete).toBe(true);
  });

  it('scoped settle accepts bare run.ended (PPT-style gateway lifecycle)', () => {
    const tracker = createOfficeRunTracker(SCOPED_GEN2);
    applyOfficeRunRuntimeEvent(tracker, {
      type: 'run.ended',
      runId: SHARED_BARE_RUN,
      status: 'completed',
      lifecyclePhase: 'end',
      stopReason: 'stop',
    });
    expect(isOfficeRunProtocolDischarged(tracker)).toBe(true);
    expect(tracker.runComplete).toBe(true);
  });

  it('bare tracker accepts same bare run.ended — third retry without settleRunId widens match surface', () => {
    const bareTracker = createOfficeRunTracker(SHARED_BARE_RUN);
    applyOfficeRunRuntimeEvent(bareTracker, {
      type: 'run.ended',
      runId: SHARED_BARE_RUN,
      status: 'completed',
      lifecyclePhase: 'end',
      stopReason: 'stop',
    });
    expect(isOfficeRunProtocolDischarged(bareTracker)).toBe(true);
  });

  it('waitForSessionReply opens gate from bare run.ended even when hasActiveRun stays true', async () => {
    vi.useFakeTimers();
    vi.mocked(fetchChatHistory).mockResolvedValue({
      messages: [
        { role: 'user', content: 'go', timestamp: startedAt + 1 },
        { role: 'assistant', content: WF_JSON, timestamp: startedAt + 5_000 },
      ],
    });
    vi.mocked(fetchGatewaySessionListRow).mockResolvedValue({
      key: SESSION,
      hasActiveRun: true,
      status: 'running',
      updatedAt: startedAt + 5_000,
    });

    const gateway = createEmitterGateway();
    const promise = waitForSessionReply(gateway, {
      sessionKey: SESSION,
      startedAtMs: startedAt,
      runId: SETTLE_GEN2,
      timeoutMs: 15_000,
      pollIntervalMs: 1_000,
      requireWorkflowStructuredReply: true,
      requireFreshUserTurn: true,
      minWaitBeforeAcceptMs: 0,
    });

    gateway.emitAgentNotification(completedLifecycle(SHARED_BARE_RUN));

    await vi.advanceTimersByTimeAsync(12_000);
    const result = await promise;

    expect(result.completed).toBe(true);
    expect(result.assistantText).toContain('"conclusion"');
    vi.useRealTimers();
  });
});

describe('P1: sessions.list error row on fresh dispatch', () => {
  it('marks terminalErrorEnded when status=error and transcript has no completion JSON', () => {
    const retryStartedAt = 200_000;
    const tracker = createOfficeRunTracker(SCOPED_GEN2);

    const rowAfterNewMessage = {
      key: SESSION,
      status: 'error',
      hasActiveRun: false,
      updatedAt: retryStartedAt + 1_000,
    };

    expect(reconcileOfficeRunSessionIdle(tracker, rowAfterNewMessage, retryStartedAt)).toBe(false);
    expect(tracker.terminalErrorEnded).toBe(true);
    expect(tracker.sessionIdleReconciled).toBe(false);
  });

  it('marks terminalErrorEnded on failure row even when transcript has completion workflow JSON', async () => {
    const retryStartedAt = 200_000;
    const tracker = createOfficeRunTracker(SCOPED_GEN2);
    const gateway = {} as GatewayManager;

    vi.mocked(fetchChatHistory).mockResolvedValue({
      messages: [
        { role: 'user', content: 'retry', timestamp: retryStartedAt },
        { role: 'assistant', content: WF_JSON, timestamp: retryStartedAt + 500 },
      ],
    });
    vi.mocked(fetchGatewaySessionListRow).mockResolvedValue({
      key: SESSION,
      status: 'error',
      hasActiveRun: false,
      updatedAt: retryStartedAt + 1_000,
    });

    const opened = await tryReconcileOfficeRunSessionIdle(gateway, SESSION, retryStartedAt, tracker);
    // Failure row is authoritative even when completion JSON exists — wait finish can
    // still poll JSON and validate ok; ignore-and-wait is forbidden.
    expect(opened).toBe(false);
    expect(tracker.terminalErrorEnded).toBe(true);
    expect(tracker.sessionIdleReconciled).toBe(false);
  });
});
