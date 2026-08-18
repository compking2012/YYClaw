/**
 * Suspect reproduction: High findings from post-wait routing review.
 * Tests that FAIL document confirmed bugs; tests that PASS document overstated claims.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayManager } from '../../electron/gateway/manager';
import {
  callAgentMessage,
  fetchChatHistory,
  fetchGatewaySessionListRow,
} from '../../electron/services/office/gateway-rpc';
import { waitForSessionReply } from '../../electron/services/office/run-completion';
import { fetchWorkflowAgentReplyWithRetry } from '../../electron/services/office/workflow-agent-llm';
import {
  createOfficeRunTracker,
  tryReconcileOfficeRunSessionIdle,
} from '../../electron/services/office/session-run-settle';
import { classifyWorkflowPostWaitFailure } from '@/lib/office-workflow-post-wait-failure';
import { validateWorkflowAgentStructuredReply } from '../../electron/services/office/workflow-agent-reply';

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
const startedAt = 1_000_000;

const WF_JSON = JSON.stringify({
  role: '测试',
  step: { index: 1, total: 1, title: '验收' },
  inputValidation: { targets: [], lsResult: [] },
  execution: '完成',
  outputValidation: { targets: ['out.md'], lsResult: ['ok'] },
  deliverable: { path: 'out.md', summary: 'ok enough text', conclusion: '通过' },
  rollback: '无',
});

describe('High-suspect reproductions', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(startedAt);
    vi.mocked(callAgentMessage).mockResolvedValue({ runId: 'run-test' });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('High-1: attempt2 terminalErrorEnded+empty must not succeed via session recovery', async () => {
    // Attempt 1: format failure (no terminal) → enters format-retry
    // Attempt 2: runtime terminal + empty wait body; list still success-idle + transcript has JSON
    //            after retryStartedAt → recovery could falsely ok:true today.
    vi.mocked(waitForSessionReply)
      .mockResolvedValueOnce({
        completed: true,
        assistantText: 'not-json',
      })
      .mockResolvedValueOnce({
        completed: true,
        assistantText: '',
        terminalErrorEnded: true,
        terminalError: 'LLM idle timeout (120s)',
        gatewayTerminalErrorKind: 'non_retryable',
      });

    vi.mocked(fetchGatewaySessionListRow).mockResolvedValue({
      key: SESSION,
      status: 'done',
      hasActiveRun: false,
      updatedAt: startedAt + 120_000,
    });

    // History JSON stamped after format-retry starts (retryStartedAt ~= startedAt after setSystemTime advance)
    vi.mocked(fetchChatHistory).mockImplementation(async () => ({
      messages: [
        { role: 'user', content: 'retry', timestamp: Date.now() },
        { role: 'assistant', content: WF_JSON, timestamp: Date.now() + 1_000 },
      ],
    }));

    const resultPromise = fetchWorkflowAgentReplyWithRetry(gateway, {
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

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    // Intended (Q2): runtime terminal → fail for outputRetry, never false-success via recovery.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.retried).toBe(true);
    expect(result.transportReason).toBe('empty');
    expect(result.issues).toContain('empty');
    expect(waitForSessionReply).toHaveBeenCalledTimes(2);
    // Must not have started a 3rd format-retry either.
    expect(callAgentMessage).toHaveBeenCalledTimes(2);
  });

  it('High-2 (downgraded): non-JSON narration under terminal is format by Q1 policy (Workflow JSON-only)', () => {
    const v = validateWorkflowAgentStructuredReply({
      raw: '这次中断了，请稍后重试',
      transportReason: 'empty',
      actorRoleName: '测试',
    });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    const kind = classifyWorkflowPostWaitFailure({
      terminalErrorEnded: true,
      terminalError: 'stopReason=aborted',
      issues: v.issues,
      raw: '这次中断了，请稍后重试',
    });
    expect(kind).toBe('format');
  });

  it('High-3 (boundary): mixed format+deliverable issues under terminal are runtime today', () => {
    const kind = classifyWorkflowPostWaitFailure({
      terminalErrorEnded: true,
      issues: ['invalid_json_schema', 'deliverable_too_short'],
      raw: '{"role":"测试","deliverable":{"path":"a","summary":"x","conclusion":"通过"}}',
    });
    expect(kind).toBe('runtime');
  });

  it('High-4: failure row + completion JSON marks terminal (no ignore-and-wait)', async () => {
    const tracker = createOfficeRunTracker('run-x');
    const t0 = 200_000;
    vi.mocked(fetchChatHistory).mockResolvedValue({
      messages: [
        { role: 'user', content: 'go', timestamp: t0 },
        { role: 'assistant', content: WF_JSON, timestamp: t0 + 500 },
      ],
    });
    vi.mocked(fetchGatewaySessionListRow).mockResolvedValue({
      key: SESSION,
      status: 'timeout',
      hasActiveRun: false,
      updatedAt: t0 + 1_000,
    });

    const opened = await tryReconcileOfficeRunSessionIdle(gateway, SESSION, t0, tracker);
    expect(opened).toBe(false);
    expect(tracker.terminalErrorEnded).toBe(true);
    expect(tracker.sessionIdleReconciled).toBe(false);
  });
});
