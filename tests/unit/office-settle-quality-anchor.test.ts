import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayManager } from '../../electron/gateway/manager';
import { fetchChatHistory, fetchGatewaySessionListRow } from '../../electron/services/office/gateway-rpc';
import {
  captureOfficeSettleBaseline,
  confirmMeetsSettleQualityAnchor,
  createOfficeRunTracker,
  fetchStableSessionReplyText,
  hashSessionReplyText,
} from '../../electron/services/office/session-run-settle';
import { waitForSessionReply } from '../../electron/services/office/run-completion';

vi.mock('../../electron/services/office/gateway-rpc', () => ({
  fetchChatHistory: vi.fn(),
  fetchGatewaySessionListRow: vi.fn(),
  invalidateGatewaySessionListRowCache: vi.fn(),
}));

const SESSION = 'agent:pm:office:task:t1:role:product:node:n1';
const RUN_ID = 'run-anchor-test';
const startedAt = Date.now() - 60_000;

const STRONG_JSON = JSON.stringify({
  role: '产品',
  step: { index: 1, total: 3, title: '需求' },
  inputValidation: { targets: [], lsResult: [] },
  execution: 'done',
  outputValidation: { targets: ['需求说明书-产品.md'], lsResult: ['ok'] },
  deliverable: { path: '需求说明书-产品.md', summary: 'ok', conclusion: 'ok' },
  rollback: '无',
});

const WEAK_JSON = JSON.stringify({
  role: '产品',
  step: { index: 1, total: 1, title: 'x' },
  inputValidation: { targets: [], lsResult: [] },
  execution: 'x',
  outputValidation: { targets: [], lsResult: [] },
  deliverable: { path: 'x.md', summary: 'x', conclusion: 'x' },
  rollback: '无',
});

/** 比 WEAK 完整、比 STRONG 弱 — 可骗过 baseline 级 HASH_MISMATCH_ACCEPT */
const MEDIUM_JSON = JSON.stringify({
  role: '产品',
  step: { index: 1, total: 2, title: '需求' },
  inputValidation: { targets: [], lsResult: [] },
  execution: 'x',
  outputValidation: { targets: ['a.md'], lsResult: [] },
  deliverable: { path: 'a.md', summary: 'x', conclusion: 'x' },
  rollback: '无',
});

function mockIdleSession(): void {
  vi.mocked(fetchGatewaySessionListRow).mockResolvedValue({
    key: SESSION,
    hasActiveRun: false,
    updatedAt: startedAt + 5_000,
  });
}

function historyWithAssistant(content: string) {
  return {
    messages: [
      { role: 'user', content: 'go', timestamp: startedAt + 1 },
      { role: 'assistant', content, timestamp: startedAt + 2_000 },
    ],
  };
}

describe('office settle quality anchor', () => {
  const gateway = {} as GatewayManager;

  beforeEach(() => {
    vi.useFakeTimers();
    mockIdleSession();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('confirmMeetsSettleQualityAnchor rejects text below first-capture anchor', () => {
    const tracker = createOfficeRunTracker(RUN_ID);
    tracker.settleQualityAnchorText = STRONG_JSON;
    expect(confirmMeetsSettleQualityAnchor(tracker, STRONG_JSON)).toBe(true);
    expect(confirmMeetsSettleQualityAnchor(tracker, WEAK_JSON)).toBe(false);
    expect(confirmMeetsSettleQualityAnchor(tracker, MEDIUM_JSON)).toBe(false);
  });

  it('fetchStableSessionReplyText rejects hash-matched confirm below anchor (degraded retry)', async () => {
    const tracker = createOfficeRunTracker(RUN_ID);
    tracker.runComplete = true;
    tracker.settleQualityAnchorText = STRONG_JSON;
    tracker.settleBaselineHash = hashSessionReplyText(WEAK_JSON);
    tracker.settleBaselineText = WEAK_JSON;

    vi.mocked(fetchChatHistory).mockResolvedValue(historyWithAssistant(WEAK_JSON));

    const promise = fetchStableSessionReplyText(gateway, {
      sessionKey: SESSION,
      startedAtMs: startedAt,
      tracker,
      pollText: async () => WEAK_JSON,
      consistencyDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    const settled = await promise;

    expect(settled?.text).toBeNull();
    expect(settled?.hashMismatchRejected).toBe(true);
    expect(tracker.settleBaselineHash).toBeUndefined();
  });

  it('fetchStableSessionReplyText rejects HASH_MISMATCH_ACCEPT when confirm beats weak baseline but is below anchor', async () => {
    const tracker = createOfficeRunTracker(RUN_ID);
    tracker.runComplete = true;
    tracker.settleQualityAnchorText = STRONG_JSON;
    tracker.settleBaselineHash = hashSessionReplyText(WEAK_JSON);
    tracker.settleBaselineText = WEAK_JSON;

    vi.mocked(fetchChatHistory).mockResolvedValue(historyWithAssistant(MEDIUM_JSON));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const promise = fetchStableSessionReplyText(gateway, {
      sessionKey: SESSION,
      startedAtMs: startedAt,
      tracker,
      pollText: async () => MEDIUM_JSON,
      consistencyDelayMs: 0,
    });
    await vi.runAllTimersAsync();
    const settled = await promise;

    expect(settled?.text).toBeNull();
    expect(settled?.hashMismatchRejected).toBe(true);
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('HASH_MISMATCH_ACCEPT'),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it('captureOfficeSettleBaseline records first capture as quality anchor', async () => {
    const tracker = createOfficeRunTracker(RUN_ID);
    tracker.runComplete = true;

    vi.mocked(fetchChatHistory).mockResolvedValue(historyWithAssistant(STRONG_JSON));

    const ok = await captureOfficeSettleBaseline(gateway, {
      sessionKey: SESSION,
      startedAtMs: startedAt,
      tracker,
      pollText: async () => STRONG_JSON,
    });

    expect(ok).toBe(true);
    expect(tracker.settleQualityAnchorText).toBe(STRONG_JSON);
  });

  it('waitForSessionReply does not accept permanently degraded session text after mismatch reject', async () => {
    let historyCalls = 0;
    vi.mocked(fetchChatHistory).mockImplementation(async () => {
      historyCalls += 1;
      const content = historyCalls <= 2 ? STRONG_JSON : WEAK_JSON;
      return historyWithAssistant(content);
    });

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
      emitAgentNotification(params: Record<string, unknown>) {
        for (const fn of listeners.get('notification') ?? []) {
          fn({ method: 'agent', params });
        }
      },
    } as GatewayManager & { emitAgentNotification: (params: Record<string, unknown>) => void };

    const promise = waitForSessionReply(emitterGateway, {
      sessionKey: SESSION,
      startedAtMs: startedAt,
      runId: RUN_ID,
      timeoutMs: 12_000,
      pollIntervalMs: 1_000,
      requireWorkflowStructuredReply: true,
      requireFreshUserTurn: true,
      minWaitBeforeAcceptMs: 0,
    });

    emitterGateway.emitAgentNotification({
      runId: RUN_ID,
      sessionKey: SESSION,
      stream: 'lifecycle',
      data: { phase: 'completed' },
    });

    await vi.advanceTimersByTimeAsync(12_500);
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result.completed).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.assistantText ?? '').not.toContain('"summary":"x"');
  });
});
