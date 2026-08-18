/**
 * Runtime terminal failures must not enter format-retry; format-shaped bodies still may.
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
const startedAt = Date.now() - 60_000;

describe('fetchWorkflowAgentReplyWithRetry post-wait routing', () => {
  beforeEach(() => {
    vi.mocked(callAgentMessage).mockResolvedValue({ runId: 'run-test' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('does not format-retry on terminalErrorEnded with empty body (runtime → outputRetry)', async () => {
    vi.mocked(waitForSessionReply).mockResolvedValue({
      completed: true,
      assistantText: '',
      terminalErrorEnded: true,
      terminalError: 'LLM idle timeout (120s)',
      gatewayTerminalErrorKind: 'non_retryable',
    });

    const result = await fetchWorkflowAgentReplyWithRetry(gateway, {
      sessionKey: SESSION,
      agentId: 'agent-qa',
      roleName: '测试',
      agentBody: 'do task',
      idempotencyKey: 'idem-1',
      retryIdempotencyKey: 'idem-retry',
      nodeExecution: 'serial',
      timeoutMs: 30_000,
      startedAtMs: startedAt,
      teamRoles: [{ id: 'qa', name: '测试', agentId: 'agent-qa', emoji: '🧪' }],
      verifyDeliverableOnDisk: async () => ({ ok: true, detail: '' }),
    });

    expect(waitForSessionReply).toHaveBeenCalledTimes(1);
    expect(callAgentMessage).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.retried).toBe(false);
    expect(result.transportReason).toBe('empty');
    expect(result.issues).toContain('empty');
    expect(result.detail).toMatch(/LLM idle timeout/i);
  });

  it('still format-retries on terminalErrorEnded when body is invalid JSON (format)', async () => {
    vi.mocked(waitForSessionReply).mockResolvedValue({
      completed: true,
      assistantText: 'not-json',
      terminalErrorEnded: true,
      terminalError: 'stopReason=aborted',
      gatewayTerminalErrorKind: 'non_retryable',
    });

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
      teamRoles: [{ id: 'qa', name: '测试', agentId: 'agent-qa', emoji: '🧪' }],
      verifyDeliverableOnDisk: async () => ({ ok: true, detail: '' }),
    });

    expect(waitForSessionReply).toHaveBeenCalledTimes(3);
    expect(callAgentMessage).toHaveBeenCalledTimes(3);
    const secondBody = vi.mocked(callAgentMessage).mock.calls[1]?.[2];
    expect(String(secondBody)).toContain('格式纠正');
  });

  it('skips format-retry when project is user-aborted after first wait (abort branch)', async () => {
    const { markTaskUserAborted, resetTaskAbortRegistryForTests } = await import(
      '../../electron/services/office/task-run-abort-registry'
    );
    const { resetAbortQuiesceLocksForTests } = await import(
      '../../electron/services/office/project-abort-quiesce'
    );
    resetTaskAbortRegistryForTests();
    resetAbortQuiesceLocksForTests();

    vi.mocked(waitForSessionReply).mockImplementation(async () => {
      markTaskUserAborted('t1');
      return {
        completed: true,
        assistantText: 'not-json',
        terminalErrorEnded: false,
      };
    });

    const result = await fetchWorkflowAgentReplyWithRetry(gateway, {
      sessionKey: SESSION,
      agentId: 'agent-qa',
      roleName: '测试',
      agentBody: 'do task',
      idempotencyKey: 'idem-abort',
      retryIdempotencyKey: 'idem-abort-retry',
      nodeExecution: 'serial',
      timeoutMs: 30_000,
      startedAtMs: startedAt,
      projectId: 't1',
      teamRoles: [{ id: 'qa', name: '测试', agentId: 'agent-qa', emoji: '🧪' }],
      verifyDeliverableOnDisk: async () => ({ ok: true, detail: '' }),
    });

    expect(callAgentMessage).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.retried).toBe(false);
    expect(result.detail).toBe('aborted');

    resetTaskAbortRegistryForTests();
  });

  it('surfaces callAgentMessage transportError on transport_error detail (no bare 调用异常)', async () => {
    vi.mocked(callAgentMessage).mockRejectedValue(
      new Error('FailoverError: ⚠️ API rate limit reached. Please try again later.'),
    );

    const result = await fetchWorkflowAgentReplyWithRetry(gateway, {
      sessionKey: SESSION,
      agentId: 'agent-qa',
      roleName: '测试',
      agentBody: 'do task',
      idempotencyKey: 'idem-1',
      retryIdempotencyKey: 'idem-retry',
      nodeExecution: 'serial',
      timeoutMs: 30_000,
      startedAtMs: startedAt,
      teamRoles: [{ id: 'qa', name: '测试', agentId: 'agent-qa', emoji: '🧪' }],
      verifyDeliverableOnDisk: async () => ({ ok: true, detail: '' }),
    });

    expect(waitForSessionReply).not.toHaveBeenCalled();
    expect(callAgentMessage).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toContain('transport_error');
    expect(result.transportReason).toBe('error');
    expect(result.detail).toMatch(/API rate limit reached/i);
    expect(result.detail).toMatch(/模型会话调用异常/);
    // Room formatter should parenthesize the cause under「调用异常」.
    const { formatWorkflowAgentFailureDetail } = await import(
      '../../electron/services/office/workflow-agent-reply'
    );
    expect(
      formatWorkflowAgentFailureDetail({
        issues: result.issues,
        detail: result.detail,
      }),
    ).toBe('调用异常(API rate limit reached. Please try again later.)');
  });

  it('surfaces wait soft-error (completed:false + error, no terminal) on transport_error detail', async () => {
    vi.mocked(waitForSessionReply).mockResolvedValue({
      completed: false,
      error: 'FailoverError: ⚠️ API rate limit reached. Please try again later.',
    });

    const result = await fetchWorkflowAgentReplyWithRetry(gateway, {
      sessionKey: SESSION,
      agentId: 'agent-qa',
      roleName: '测试',
      agentBody: 'do task',
      idempotencyKey: 'idem-1',
      retryIdempotencyKey: 'idem-retry',
      nodeExecution: 'serial',
      timeoutMs: 30_000,
      startedAtMs: startedAt,
      teamRoles: [{ id: 'qa', name: '测试', agentId: 'agent-qa', emoji: '🧪' }],
      verifyDeliverableOnDisk: async () => ({ ok: true, detail: '' }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const { formatWorkflowAgentFailureDetail } = await import(
      '../../electron/services/office/workflow-agent-reply'
    );
    const formatted = formatWorkflowAgentFailureDetail({
      issues: result.issues,
      detail: result.detail,
    });
    expect(result.issues).toContain('transport_error');
    expect(formatted).toBe('调用异常(API rate limit reached. Please try again later.)');
  });

  it('surfaces wait-throw transportError on transport_error detail', async () => {
    vi.mocked(waitForSessionReply).mockRejectedValue(
      new Error('FailoverError: ⚠️ API rate limit reached. Please try again later.'),
    );

    const result = await fetchWorkflowAgentReplyWithRetry(gateway, {
      sessionKey: SESSION,
      agentId: 'agent-qa',
      roleName: '测试',
      agentBody: 'do task',
      idempotencyKey: 'idem-1',
      retryIdempotencyKey: 'idem-retry',
      nodeExecution: 'serial',
      timeoutMs: 30_000,
      startedAtMs: startedAt,
      teamRoles: [{ id: 'qa', name: '测试', agentId: 'agent-qa', emoji: '🧪' }],
      verifyDeliverableOnDisk: async () => ({ ok: true, detail: '' }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const { formatWorkflowAgentFailureDetail } = await import(
      '../../electron/services/office/workflow-agent-reply'
    );
    expect(
      formatWorkflowAgentFailureDetail({
        issues: result.issues,
        detail: result.detail,
      }),
    ).toBe('调用异常(API rate limit reached. Please try again later.)');
  });

  it('impact: soft wait aborted sentinel does not parenthesize Aborted in room copy', async () => {
    vi.mocked(waitForSessionReply).mockResolvedValue({
      completed: false,
      error: 'aborted',
    });

    const result = await fetchWorkflowAgentReplyWithRetry(gateway, {
      sessionKey: SESSION,
      agentId: 'agent-qa',
      roleName: '测试',
      agentBody: 'do task',
      idempotencyKey: 'idem-1',
      retryIdempotencyKey: 'idem-retry',
      nodeExecution: 'serial',
      timeoutMs: 30_000,
      startedAtMs: startedAt,
      teamRoles: [{ id: 'qa', name: '测试', agentId: 'agent-qa', emoji: '🧪' }],
      verifyDeliverableOnDisk: async () => ({ ok: true, detail: '' }),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    const { formatWorkflowAgentFailureDetail } = await import(
      '../../electron/services/office/workflow-agent-reply'
    );
    const formatted = formatWorkflowAgentFailureDetail({
      issues: result.issues,
      detail: result.detail,
    });
    expect(formatted.includes('Aborted')).toBe(false);
    expect(formatted.includes('aborted')).toBe(false);
    expect(formatted).toBe('调用异常');
  });

  it('impact: terminalErrorEnded empty body still enriches and skips format-retry', async () => {
    vi.mocked(waitForSessionReply).mockResolvedValue({
      completed: true,
      assistantText: '',
      terminalErrorEnded: true,
      terminalError: '⚠️ API rate limit reached. Please try again later.',
      gatewayTerminalErrorKind: 'non_retryable',
    });

    const result = await fetchWorkflowAgentReplyWithRetry(gateway, {
      sessionKey: SESSION,
      agentId: 'agent-qa',
      roleName: '测试',
      agentBody: 'do task',
      idempotencyKey: 'idem-1',
      retryIdempotencyKey: 'idem-retry',
      nodeExecution: 'serial',
      timeoutMs: 30_000,
      startedAtMs: startedAt,
      teamRoles: [{ id: 'qa', name: '测试', agentId: 'agent-qa', emoji: '🧪' }],
      verifyDeliverableOnDisk: async () => ({ ok: true, detail: '' }),
    });

    expect(waitForSessionReply).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toMatch(/API rate limit reached/i);
    const { formatWorkflowAgentFailureDetail } = await import(
      '../../electron/services/office/workflow-agent-reply'
    );
    expect(
      formatWorkflowAgentFailureDetail({
        issues: result.issues,
        detail: result.detail,
      }),
    ).toMatch(/API rate limit reached/);
  });
});
