/**
 * P0: fetchWorkflowAgentReplyWithRetry 第 3 次 runOnce 未传 settleRunId / shouldAbortWait。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayManager } from '../../electron/gateway/manager';
import { callAgentMessage } from '../../electron/services/office/gateway-rpc';
import { waitForSessionReply } from '../../electron/services/office/run-completion';
import { fetchWorkflowAgentReplyWithRetry } from '../../electron/services/office/workflow-agent-llm';

vi.mock('../../electron/services/office/gateway-rpc', () => ({
  callAgentMessage: vi.fn(),
  fetchChatHistory: vi.fn(),
  fetchGatewaySessionListRow: vi.fn(),
  invalidateGatewaySessionListRowCache: vi.fn(),
}));

vi.mock('../../electron/services/office/run-completion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../electron/services/office/run-completion')>();
  return {
    ...actual,
    waitForSessionReply: vi.fn(),
  };
});

const gateway = {} as GatewayManager;
const SESSION = 'agent:pm:office:task:t1:role:qa:node:gen-2';
const NODE_SCOPED_RUN = 'run-test@gen-2';
const INVALID_JSON = 'not-json';
const startedAt = Date.now() - 60_000;

describe('fetchWorkflowAgentReplyWithRetry third attempt settle params', () => {
  beforeEach(() => {
    vi.mocked(callAgentMessage).mockResolvedValue({ runId: 'run-test' });
    vi.mocked(waitForSessionReply).mockResolvedValue({
      completed: true,
      assistantText: INVALID_JSON,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('passes settleRunId and shouldAbortWait on attempts 1–2 but omits them on attempt 3 (regression repro)', async () => {
    const shouldAbortWait = vi.fn(() => false);

    await fetchWorkflowAgentReplyWithRetry(gateway, {
      sessionKey: SESSION,
      agentId: 'agent-qa',
      roleName: '测试',
      agentBody: 'do task',
      idempotencyKey: 'idem-1',
      retryIdempotencyKey: 'idem-retry',
      nodeExecution: 'serial',
      timeoutMs: 30_000,
      startedAtMs: startedAt,
      settleRunId: NODE_SCOPED_RUN,
      shouldAbortWait,
      teamRoles: [{ id: 'qa', name: '测试', agentId: 'agent-qa', emoji: '🧪' }],
      verifyDeliverableOnDisk: async () => ({ ok: true, detail: '' }),
    });

    expect(waitForSessionReply).toHaveBeenCalledTimes(3);

    const firstCall = vi.mocked(waitForSessionReply).mock.calls[0]?.[1];
    const secondCall = vi.mocked(waitForSessionReply).mock.calls[1]?.[1];
    const thirdCall = vi.mocked(waitForSessionReply).mock.calls[2]?.[1];

    expect(firstCall?.runId).toBe(NODE_SCOPED_RUN);
    expect(firstCall?.shouldAbortWait).toBe(shouldAbortWait);
    expect(secondCall?.runId).toBe(NODE_SCOPED_RUN);
    expect(secondCall?.shouldAbortWait).toBe(shouldAbortWait);

    expect(thirdCall?.runId).toBe(NODE_SCOPED_RUN);
    expect(thirdCall?.shouldAbortWait).toBe(shouldAbortWait);
  });
});
