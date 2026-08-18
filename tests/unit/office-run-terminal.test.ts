import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayManager } from '../../electron/gateway/manager';
import { fetchChatHistory, fetchGatewaySessionListRow } from '../../electron/services/office/gateway-rpc';
import {
  applyOfficeRunTerminalAssistantMessage,
  agentNotificationMatchesOfficeSession,
  parseGatewayAgentNotificationEvent,
  waitForSessionReply,
} from '../../electron/services/office/run-completion';
import {
  OFFICE_SETTLE_CONSISTENCY_DELAY_MS,
  applyOfficeRunGatewayEvent,
  applyOfficeRunRuntimeEvent,
  createOfficeRunTracker,
  isGatewayRunPhaseSettleSignal,
} from '../../electron/services/office/session-run-settle';
import { logger } from '../../electron/utils/logger';

vi.mock('../../electron/services/office/gateway-rpc', () => ({
  fetchChatHistory: vi.fn(),
  fetchGatewaySessionListRow: vi.fn(),
  invalidateGatewaySessionListRowCache: vi.fn(),
}));

const SESSION = 'agent:pm:office:task:t1:role:product:node:n1';
const RUN_ID = 'run-terminal-test';
const startedAt = Date.now() - 60_000;

const WF_JSON = JSON.stringify({
  role: '产品',
  step: { index: 1, total: 3, title: '需求' },
  inputValidation: { targets: [], lsResult: [] },
  execution: 'done',
  outputValidation: { targets: ['需求说明书-产品.md'], lsResult: ['ok'] },
  deliverable: { path: '需求说明书-产品.md', summary: 'ok', conclusion: 'ok' },
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

function lifecycleErrorParams(error = 'provider unavailable'): Record<string, unknown> {
  return {
    runId: RUN_ID,
    sessionKey: SESSION,
    stream: 'lifecycle',
    data: { phase: 'error', error },
  };
}

describe('parseGatewayAgentNotificationEvent', () => {
  it('reads lifecycle phase and error from nested data', () => {
    const parsed = parseGatewayAgentNotificationEvent(lifecycleErrorParams('quota exceeded'), SESSION);
    expect(parsed.phase).toBe('error');
    expect(parsed.runError).toBe('quota exceeded');
    expect(parsed.terminalError).toBe('quota exceeded');
    expect(parsed.runId).toBe(RUN_ID);
  });

  it('reads completed+error status fields', () => {
    const parsed = parseGatewayAgentNotificationEvent(
      {
        runId: RUN_ID,
        sessionKey: SESSION,
        phase: 'completed',
        finalStatus: 'error',
        terminalError: 'non_deliverable_terminal_turn',
        assistantTexts: ['partial body'],
      },
      SESSION,
    );
    expect(parsed.phase).toBe('completed');
    expect(parsed.finalStatus).toBe('error');
    expect(parsed.terminalError).toBe('non_deliverable_terminal_turn');
    expect(parsed.assistantTexts).toEqual(['partial body']);
  });
});

describe('applyOfficeRunGatewayEvent sequences', () => {
  it('does not set runComplete on state=final alone (lifecycle authoritative)', () => {
    const tracker = createOfficeRunTracker(RUN_ID);
    applyOfficeRunGatewayEvent(tracker, {
      runId: RUN_ID,
      state: 'final',
      message: { role: 'assistant', content: WF_JSON },
    });
    expect(tracker.runComplete).toBe(false);
    expect(tracker.sessionIdleReconciled).toBe(false);
    expect(isGatewayRunPhaseSettleSignal({ state: 'final' })).toBe(false);
    expect(isGatewayRunPhaseSettleSignal({ phase: 'completed' })).toBe(true);
  });

  it('clears transient pendingRetry when run.ended status=error arrives', () => {
    const tracker = createOfficeRunTracker(RUN_ID);
    applyOfficeRunGatewayEvent(tracker, { runId: RUN_ID, state: 'error' });
    expect(tracker.pendingRetry).toBe(true);
    expect(tracker.terminalErrorEnded).toBe(false);

    applyOfficeRunRuntimeEvent(tracker, {
      type: 'run.ended',
      runId: RUN_ID,
      status: 'error',
      error: 'final fail',
    });
    expect(tracker.pendingRetry).toBe(false);
    expect(tracker.terminalErrorEnded).toBe(true);
    expect(tracker.terminalError).toBe('final fail');
  });

  it('restarts after terminal error when same run sends run.started', () => {
    const tracker = createOfficeRunTracker(RUN_ID);
    applyOfficeRunRuntimeEvent(tracker, {
      type: 'run.ended',
      runId: RUN_ID,
      status: 'error',
      error: 'fail',
    });
    expect(tracker.terminalErrorEnded).toBe(true);

    applyOfficeRunRuntimeEvent(tracker, { type: 'run.started', runId: RUN_ID });
    expect(tracker.terminalErrorEnded).toBe(false);
    expect(tracker.runComplete).toBe(false);
    expect(tracker.pendingRetry).toBe(true);
  });
});

describe('waitForSessionReply terminal gating (workflow)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(fetchChatHistory).mockResolvedValue({
      messages: [{ role: 'user', content: 'go', timestamp: startedAt + 1 }],
    });
    vi.mocked(fetchGatewaySessionListRow).mockResolvedValue({
      key: SESSION,
      hasActiveRun: false,
      updatedAt: startedAt + 5_000,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  function startWorkflowWait(timeoutMs = 5_000) {
    const gateway = createEmitterGateway();
    const promise = waitForSessionReply(gateway, {
      sessionKey: SESSION,
      startedAtMs: startedAt,
      runId: RUN_ID,
      timeoutMs,
      pollIntervalMs: 1_000,
      requireWorkflowStructuredReply: true,
      requireFreshUserTurn: true,
      minWaitBeforeAcceptMs: 0,
    });
    return { gateway, promise };
  }

  it('does not finish on transient state=error without terminal assistant', async () => {
    const { gateway, promise } = startWorkflowWait();
    gateway.emitAgentNotification({ runId: RUN_ID, sessionKey: SESSION, state: 'error' });

    await vi.advanceTimersByTimeAsync(5_500);
    const result = await promise;
    expect(result.timedOut).toBe(true);
    expect(result.terminalErrorEnded).toBeFalsy();
    expect(result.completed).toBe(false);
  });

  it('finishes terminal error on lifecycle phase=error', async () => {
    const { gateway, promise } = startWorkflowWait();
    gateway.emitAgentNotification(lifecycleErrorParams('model unavailable'));

    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.completed).toBe(true);
    expect(result.terminalErrorEnded).toBe(true);
    expect(result.terminalError).toBe('model unavailable');
    expect(result.gatewayTerminalErrorKind).toBe('non_retryable');
  });

  it('finishes terminal error on state=error envelope with stop_reason=error assistant', async () => {
    const { gateway, promise } = startWorkflowWait();
    gateway.emitAgentNotification({
      runId: RUN_ID,
      sessionKey: SESSION,
      state: 'error',
      message: {
        role: 'assistant',
        stopReason: 'error',
        errorMessage: 'Connection reset.',
        content: 'provider failed',
      },
    });

    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.terminalErrorEnded).toBe(true);
    expect(result.terminalError).toBe('Connection reset.');
    expect(result.assistantText).toContain('provider failed');
  });

  it('ignores agent notifications for a different runId', async () => {
    const { gateway, promise } = startWorkflowWait();
    gateway.emitAgentNotification({
      ...lifecycleErrorParams('wrong run'),
      runId: 'other-run',
    });
    gateway.emitAgentNotification({
      runId: 'other-run',
      sessionKey: SESSION,
      state: 'error',
      message: {
        role: 'assistant',
        stopReason: 'error',
        errorMessage: 'should ignore',
        content: 'ignored',
      },
    });

    await vi.advanceTimersByTimeAsync(5_500);
    const result = await promise;
    expect(result.timedOut).toBe(true);
    expect(result.terminalErrorEnded).toBeFalsy();
  });

  it('aborts early when shouldAbortWait reports peer claimed', async () => {
    const gateway = createEmitterGateway();
    let peerClaimed = false;
    const promise = waitForSessionReply(gateway, {
      sessionKey: SESSION,
      startedAtMs: startedAt,
      runId: RUN_ID,
      timeoutMs: 60_000,
      pollIntervalMs: 1_000,
      requireWorkflowStructuredReply: true,
      shouldAbortWait: () => peerClaimed,
    });
    peerClaimed = true;
    await vi.advanceTimersByTimeAsync(1_500);
    const result = await promise;
    expect(result.peerClaimed).toBe(true);
    expect(result.completed).toBe(false);
    expect(result.timedOut).toBeFalsy();
  });

  it('promotes AbortSignal abort to peer_claimed when shouldAbortWait is true (room_heal)', async () => {
    const gateway = createEmitterGateway();
    const ac = new AbortController();
    let peerClaimed = false;
    const promise = waitForSessionReply(gateway, {
      sessionKey: SESSION,
      startedAtMs: startedAt,
      runId: RUN_ID,
      timeoutMs: 60_000,
      pollIntervalMs: 1_000,
      requireWorkflowStructuredReply: true,
      signal: ac.signal,
      shouldAbortWait: () => peerClaimed,
    });
    // Simulate room_heal: claim first, then abortWorkflowNodeRun().
    peerClaimed = true;
    ac.abort();
    const result = await promise;
    expect(result.peerClaimed).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.completed).toBe(false);
  });

  it('keeps AbortSignal abort as aborted when peer has not claimed', async () => {
    const gateway = createEmitterGateway();
    const ac = new AbortController();
    const promise = waitForSessionReply(gateway, {
      sessionKey: SESSION,
      startedAtMs: startedAt,
      runId: RUN_ID,
      timeoutMs: 60_000,
      pollIntervalMs: 1_000,
      requireWorkflowStructuredReply: true,
      signal: ac.signal,
      shouldAbortWait: () => false,
    });
    ac.abort();
    const result = await promise;
    expect(result.peerClaimed).toBeFalsy();
    expect(result.error).toBe('aborted');
  });

  it('falls back to session history when lifecycle error has no assistantTexts', async () => {
    vi.mocked(fetchChatHistory).mockResolvedValue({
      messages: [
        { role: 'user', content: 'go', timestamp: startedAt + 1 },
        { role: 'assistant', content: WF_JSON, timestamp: startedAt + 2_000 },
      ],
    });

    const { gateway, promise } = startWorkflowWait();
    gateway.emitAgentNotification(lifecycleErrorParams('non_deliverable_terminal_turn'));

    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.terminalErrorEnded).toBe(true);
    expect(result.gatewayTerminalErrorKind).toBe('retryable');
    expect(result.assistantText).toContain('"role"');
  });

  it('does not accept workflow JSON with no gateway terminal (Model B: JSON alone never settles)', async () => {
    vi.mocked(fetchChatHistory).mockResolvedValue({
      messages: [
        { role: 'user', content: 'go', timestamp: startedAt + 1 },
        { role: 'assistant', content: WF_JSON, timestamp: startedAt + 2_000 },
      ],
    });
    // No gateway terminal at all: sessions.list still reports an active run.
    vi.mocked(fetchGatewaySessionListRow).mockResolvedValue({
      key: SESSION,
      hasActiveRun: true,
      updatedAt: startedAt + 5_000,
    });

    const { promise } = startWorkflowWait(3_000);
    // No lifecycle terminal; history has JSON but that must not open the gate.
    await vi.advanceTimersByTimeAsync(3_500);
    const result = await promise;
    expect(result.completed).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.assistantText).toBeUndefined();
  });

  it('accepts success only after lifecycle completed and stable session text', async () => {
    vi.mocked(fetchChatHistory).mockResolvedValue({
      messages: [
        { role: 'user', content: 'go', timestamp: startedAt + 1 },
        { role: 'assistant', content: WF_JSON, timestamp: startedAt + 2_000 },
      ],
    });

    const { gateway, promise } = startWorkflowWait(30_000);
    gateway.emitAgentNotification({
      runId: RUN_ID,
      sessionKey: SESSION,
      stream: 'lifecycle',
      data: { phase: 'completed' },
    });

    await vi.advanceTimersByTimeAsync(OFFICE_SETTLE_CONSISTENCY_DELAY_MS);
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result.completed).toBe(true);
    expect(result.terminalErrorEnded).toBeFalsy();
    expect(result.assistantText).toContain('"deliverable"');
  });

  it('accepts lifecycle phase=end when payload omits sessionKey but runId matches', async () => {
    vi.mocked(fetchChatHistory).mockResolvedValue({
      messages: [
        { role: 'user', content: 'go', timestamp: startedAt + 1 },
        { role: 'assistant', content: WF_JSON, timestamp: startedAt + 2_000 },
      ],
    });

    const { gateway, promise } = startWorkflowWait(30_000);
    gateway.emitAgentNotification({
      runId: RUN_ID,
      stream: 'lifecycle',
      data: { phase: 'completed' },
    });

    await vi.advanceTimersByTimeAsync(OFFICE_SETTLE_CONSISTENCY_DELAY_MS);
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result.completed).toBe(true);
    expect(result.timedOut).toBeFalsy();
  });

  it('agentNotificationMatchesOfficeSession accepts runId without sessionKey on payload', () => {
    expect(
      agentNotificationMatchesOfficeSession(
        { runId: RUN_ID, stream: 'lifecycle', data: { phase: 'end' } },
        SESSION,
        RUN_ID,
      ),
    ).toBe(true);
    expect(
      agentNotificationMatchesOfficeSession(
        { runId: 'other-run', stream: 'lifecycle', data: { phase: 'end' } },
        SESSION,
        RUN_ID,
      ),
    ).toBe(false);
  });

  it('does not settle on chat state=final without lifecycle or sessions.list idle', async () => {
    vi.mocked(fetchChatHistory).mockResolvedValue({
      messages: [
        { role: 'user', content: 'go', timestamp: startedAt + 1 },
        { role: 'assistant', content: WF_JSON, timestamp: startedAt + 2_000 },
      ],
    });
    vi.mocked(fetchGatewaySessionListRow).mockResolvedValue({
      key: SESSION,
      hasActiveRun: true,
      updatedAt: startedAt + 500,
    });

    const { gateway, promise } = startWorkflowWait(3_000);
    gateway.emitAgentNotification({
      runId: RUN_ID,
      sessionKey: SESSION,
      state: 'final',
      message: { role: 'assistant', content: WF_JSON },
    });

    await vi.advanceTimersByTimeAsync(3_500);
    const result = await promise;
    expect(result.completed).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  it('settles via sessions.list idle reconcile when lifecycle phase never arrives', async () => {
    vi.mocked(fetchChatHistory).mockResolvedValue({
      messages: [
        { role: 'user', content: 'go', timestamp: startedAt + 1 },
        { role: 'assistant', content: WF_JSON, timestamp: startedAt + 2_000 },
      ],
    });
    vi.mocked(fetchGatewaySessionListRow).mockResolvedValue({
      key: SESSION,
      hasActiveRun: false,
      updatedAt: startedAt + 5_000,
    });

    const { gateway, promise } = startWorkflowWait(30_000);
    gateway.emitAgentNotification({
      runId: RUN_ID,
      sessionKey: SESSION,
      state: 'final',
      message: { role: 'assistant', content: WF_JSON },
    });

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(OFFICE_SETTLE_CONSISTENCY_DELAY_MS);
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result.completed).toBe(true);
    expect(result.timedOut).toBeFalsy();
    expect(result.assistantText).toContain('"deliverable"');
  });

  it('terminal + narration-only (no JSON) hands off raw for format-retry instead of spinning to timeout', async () => {
    vi.mocked(fetchChatHistory).mockResolvedValue({
      messages: [
        { role: 'user', content: 'go', timestamp: startedAt + 1 },
        { role: 'assistant', content: '已完成，交付物已写入目录，请查收。', stopReason: 'stop', timestamp: startedAt + 2_000 },
      ],
    });
    vi.mocked(fetchGatewaySessionListRow).mockResolvedValue({
      key: SESSION,
      hasActiveRun: false,
      updatedAt: startedAt + 5_000,
    });

    const { gateway, promise } = startWorkflowWait(30_000);
    gateway.emitAgentNotification({
      runId: RUN_ID,
      sessionKey: SESSION,
      stream: 'lifecycle',
      data: { phase: 'completed' },
    });

    await vi.advanceTimersByTimeAsync(OFFICE_SETTLE_CONSISTENCY_DELAY_MS);
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result.completed).toBe(true);
    expect(result.timedOut).toBeFalsy();
    expect(result.assistantText).toContain('已完成');
  });

  it('terminal + JSON followed by trailing narration hands off raw (does not spin)', async () => {
    vi.mocked(fetchChatHistory).mockResolvedValue({
      messages: [
        { role: 'user', content: 'go', timestamp: startedAt + 1 },
        { role: 'assistant', content: WF_JSON, timestamp: startedAt + 2_000 },
        { role: 'assistant', content: '以上为最终结果，已完成。', stopReason: 'stop', timestamp: startedAt + 2_500 },
      ],
    });
    vi.mocked(fetchGatewaySessionListRow).mockResolvedValue({
      key: SESSION,
      hasActiveRun: false,
      updatedAt: startedAt + 5_000,
    });

    const { gateway, promise } = startWorkflowWait(30_000);
    gateway.emitAgentNotification({
      runId: RUN_ID,
      sessionKey: SESSION,
      stream: 'lifecycle',
      data: { phase: 'completed' },
    });

    await vi.advanceTimersByTimeAsync(OFFICE_SETTLE_CONSISTENCY_DELAY_MS);
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result.completed).toBe(true);
    expect(result.timedOut).toBeFalsy();
  });

  it('does not settle on lifecycle phase=end alone (tool round boundary)', async () => {
    vi.mocked(fetchChatHistory).mockResolvedValue({
      messages: [
        { role: 'user', content: 'go', timestamp: startedAt + 1 },
        { role: 'assistant', content: WF_JSON, timestamp: startedAt + 2_000 },
      ],
    });
    // phase=end is a tool-round boundary, not a run terminal; sessions.list must
    // also stay active so there is genuinely no gateway terminal to settle on.
    vi.mocked(fetchGatewaySessionListRow).mockResolvedValue({
      key: SESSION,
      hasActiveRun: true,
      updatedAt: startedAt + 5_000,
    });

    const { gateway, promise } = startWorkflowWait(3_000);
    gateway.emitAgentNotification({
      runId: RUN_ID,
      sessionKey: SESSION,
      stream: 'lifecycle',
      data: { phase: 'end', stopReason: 'tool_use' },
    });

    await vi.advanceTimersByTimeAsync(3_500);
    const result = await promise;
    expect(result.completed).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  it('accepts success after lifecycle phase=completed and stable session text', async () => {
    vi.mocked(fetchChatHistory).mockResolvedValue({
      messages: [
        { role: 'user', content: 'go', timestamp: startedAt + 1 },
        { role: 'assistant', content: WF_JSON, timestamp: startedAt + 2_000 },
      ],
    });

    const { gateway, promise } = startWorkflowWait(30_000);
    gateway.emitAgentNotification({
      runId: RUN_ID,
      sessionKey: SESSION,
      stream: 'lifecycle',
      data: { phase: 'completed' },
    });

    await vi.advanceTimersByTimeAsync(OFFICE_SETTLE_CONSISTENCY_DELAY_MS);
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result.completed).toBe(true);
    expect(result.terminalErrorEnded).toBeFalsy();
    expect(result.assistantText).toContain('"deliverable"');
  });

  it('does not finish success while tool work is still in-flight after state=final', async () => {
    vi.mocked(fetchChatHistory).mockImplementation(async () => ({
      messages: [
        { role: 'user', content: 'go', timestamp: startedAt + 1 },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tool-1', name: 'read' }],
          timestamp: startedAt + 2_000,
        },
      ],
    }));

    const { gateway, promise } = startWorkflowWait(30_000);
    gateway.emitAgentNotification({
      runId: RUN_ID,
      sessionKey: SESSION,
      state: 'final',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'tool-1', name: 'read' }],
      },
    });

    // state=final alone does not open settle gate; lifecycle end triggers stable accept.
    await vi.advanceTimersByTimeAsync(OFFICE_SETTLE_CONSISTENCY_DELAY_MS);
    let settled = false;
    void promise.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false);

    // Tool completes and final JSON lands.
    vi.mocked(fetchChatHistory).mockResolvedValue({
      messages: [
        { role: 'user', content: 'go', timestamp: startedAt + 1 },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'tool-1', name: 'read' }],
          timestamp: startedAt + 2_000,
        },
        { role: 'tool_result', toolCallId: 'tool-1', content: 'ok', timestamp: startedAt + 3_000 },
        { role: 'assistant', content: WF_JSON, timestamp: startedAt + 4_000 },
      ],
    });
    gateway.emitAgentNotification({
      runId: RUN_ID,
      sessionKey: SESSION,
      stream: 'lifecycle',
      data: { phase: 'completed' },
    });

    await vi.runAllTimersAsync();
    const result = await promise;
    expect(result.completed).toBe(true);
    expect(result.terminalErrorEnded).toBeFalsy();
    expect(result.assistantText).toContain('"role"');
  });

  it('uses confirm (2nd) fetch when hash diverges from baseline and logs mismatch', async () => {
    const confirmJson = JSON.stringify({
      role: '产品',
      step: { index: 1, total: 3, title: '需求-修订版' },
      inputValidation: { targets: [], lsResult: [] },
      execution: 'done',
      outputValidation: { targets: ['需求说明书-产品.md'], lsResult: ['ok'] },
      deliverable: { path: '需求说明书-产品.md', summary: 'revised', conclusion: 'ok' },
      rollback: '无',
    });
    let historyCalls = 0;
    vi.mocked(fetchChatHistory).mockImplementation(async () => {
      historyCalls += 1;
      const content = historyCalls < 3 ? WF_JSON : confirmJson;
      return {
        messages: [
          { role: 'user', content: 'go', timestamp: startedAt + 1 },
          { role: 'assistant', content, timestamp: startedAt + 2_000 },
        ],
      };
    });

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const { gateway, promise } = startWorkflowWait(30_000);
    gateway.emitAgentNotification({
      runId: RUN_ID,
      sessionKey: SESSION,
      stream: 'lifecycle',
      data: { phase: 'completed' },
    });

    await vi.advanceTimersByTimeAsync(OFFICE_SETTLE_CONSISTENCY_DELAY_MS);
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result.completed).toBe(true);
    expect(result.assistantText).toContain('revised');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('HASH_MISMATCH_ACCEPT'),
    );
    warnSpy.mockRestore();
  });

  it('rejects when confirm text is shorter/weaker than baseline after 5s wait', async () => {
    const weakerConfirm = JSON.stringify({
      role: '产品',
      step: { index: 1, total: 1, title: 'x' },
      inputValidation: { targets: [], lsResult: [] },
      execution: 'x',
      outputValidation: { targets: [], lsResult: [] },
      deliverable: { path: 'x.md', summary: 'x', conclusion: 'x' },
      rollback: '无',
    });
    let historyCalls = 0;
    vi.mocked(fetchChatHistory).mockImplementation(async () => {
      historyCalls += 1;
      const content = historyCalls <= 2 ? WF_JSON : weakerConfirm;
      return {
        messages: [
          { role: 'user', content: 'go', timestamp: startedAt + 1 },
          { role: 'assistant', content, timestamp: startedAt + 2_000 },
        ],
      };
    });

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const { gateway, promise } = startWorkflowWait(30_000);
    gateway.emitAgentNotification({
      runId: RUN_ID,
      sessionKey: SESSION,
      stream: 'lifecycle',
      data: { phase: 'completed' },
    });

    await vi.advanceTimersByTimeAsync(OFFICE_SETTLE_CONSISTENCY_DELAY_MS);
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result.completed).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[office\]\[settle-consistency\] HASH_MISMATCH_REJECT|\[office\]\[settle-consistency\] ANCHOR_QUALITY_REJECT/),
    );
    warnSpy.mockRestore();
  });

  it('re-activation via run.started after completed resets the gate and blocks settle (Model B)', async () => {
    vi.mocked(fetchChatHistory).mockResolvedValue({
      messages: [
        { role: 'user', content: 'go', timestamp: startedAt + 1 },
        { role: 'assistant', content: WF_JSON, timestamp: startedAt + 2_000 },
      ],
    });
    // sessions.list stays active for the re-run so no idle terminal can settle it.
    vi.mocked(fetchGatewaySessionListRow).mockResolvedValue({
      key: SESSION,
      hasActiveRun: true,
      updatedAt: startedAt + 6_000,
    });

    const { gateway, promise } = startWorkflowWait(3_000);
    gateway.emitAgentNotification({
      runId: RUN_ID,
      sessionKey: SESSION,
      stream: 'lifecycle',
      data: { phase: 'completed' },
    });
    // Gateway immediately re-runs the same session: run.started is the authoritative
    // re-activation signal — it must reopen the run and prevent settling stale content.
    gateway.emitAgentNotification({
      runId: RUN_ID,
      sessionKey: SESSION,
      stream: 'lifecycle',
      data: { phase: 'start' },
    });

    await vi.advanceTimersByTimeAsync(3_500);
    const result = await promise;
    expect(result.completed).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  it('transient hasActiveRun flap after completed does NOT block settle (Model B relax)', async () => {
    vi.mocked(fetchChatHistory).mockResolvedValue({
      messages: [
        { role: 'user', content: 'go', timestamp: startedAt + 1 },
        { role: 'assistant', content: WF_JSON, timestamp: startedAt + 2_000 },
      ],
    });
    // After lifecycle completed, sessions.list briefly flaps hasActiveRun=true with no
    // run.started event. This is the P0-B transient; relaxed verify tolerates it and the
    // stable final JSON still settles (re-activation is signalled by run.started, not this).
    let sessionListCalls = 0;
    vi.mocked(fetchGatewaySessionListRow).mockImplementation(async () => {
      sessionListCalls += 1;
      if (sessionListCalls <= 2) {
        return {
          key: SESSION,
          hasActiveRun: false,
          updatedAt: startedAt + 5_000,
        };
      }
      return {
        key: SESSION,
        hasActiveRun: true,
        updatedAt: startedAt + 6_000,
      };
    });

    const { gateway, promise } = startWorkflowWait(30_000);
    gateway.emitAgentNotification({
      runId: RUN_ID,
      sessionKey: SESSION,
      stream: 'lifecycle',
      data: { phase: 'completed' },
    });

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(OFFICE_SETTLE_CONSISTENCY_DELAY_MS);
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result.completed).toBe(true);
    expect(result.assistantText).toContain('"deliverable"');
  });
});


describe('applyOfficeRunTerminalAssistantMessage edge cases', () => {
  it('does not treat success final assistant as terminal error', () => {
    const tracker = createOfficeRunTracker(RUN_ID);
    applyOfficeRunTerminalAssistantMessage(tracker, {
      role: 'assistant',
      stopReason: 'end_turn',
      content: WF_JSON,
    });
    expect(tracker.terminalErrorEnded).toBe(false);
  });
});
