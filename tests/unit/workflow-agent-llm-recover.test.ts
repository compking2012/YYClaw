import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayManager } from '../../electron/gateway/manager';
import { fetchChatHistory, fetchGatewaySessionListRow } from '../../electron/services/office/gateway-rpc';
import { tryRecoverWorkflowSessionStructuredReply } from '../../electron/services/office/workflow-agent-llm';
import { OFFICE_SETTLE_CONSISTENCY_DELAY_MS } from '../../electron/services/office/session-run-settle';
import type { ParsedAgentTaskReply } from '../../electron/services/office/workflow-agent-reply';

vi.mock('../../electron/services/office/gateway-rpc', () => ({
  fetchChatHistory: vi.fn(),
  fetchGatewaySessionListRow: vi.fn(),
  invalidateGatewaySessionListRowCache: vi.fn(),
}));

const SESSION = 'agent:pm:office:task:t1:role:product:node:n1';
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

const parsedReply = {
  role: '产品',
  step: { index: 1, total: 3, title: '需求' },
  inputValidation: { targets: [], lsResult: [] },
  execution: 'done',
  outputValidation: { targets: ['需求说明书-产品.md'], lsResult: ['ok'] },
  deliverable: { path: '需求说明书-产品.md', summary: 'ok', conclusion: 'ok' },
  rollback: '无',
  raw: WF_JSON,
} satisfies ParsedAgentTaskReply;

describe('tryRecoverWorkflowSessionStructuredReply', () => {
  const gateway = {} as GatewayManager;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(fetchGatewaySessionListRow).mockResolvedValue({
      key: SESSION,
      hasActiveRun: false,
      updatedAt: startedAt + 5_000,
    });
    vi.mocked(fetchChatHistory).mockResolvedValue({
      messages: [
        { role: 'user', content: 'go', timestamp: startedAt + 1 },
        { role: 'assistant', content: WF_JSON, timestamp: startedAt + 5_000 },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('rejects recovery when sessions.list reports active run', async () => {
    vi.mocked(fetchGatewaySessionListRow).mockResolvedValue({
      key: SESSION,
      hasActiveRun: true,
      status: 'running',
      updatedAt: startedAt + 5_000,
    });

    const result = await tryRecoverWorkflowSessionStructuredReply(gateway, {
      sessionKey: SESSION,
      startedAtMs: startedAt,
      validateWithDisk: async () => ({ ok: true, parsed: parsedReply }),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.validation.detail).toContain('idle');
    }
    expect(fetchChatHistory).not.toHaveBeenCalled();
  });

  it('runs baseline, 5s delay, and hash confirm before accepting recovery text', async () => {
    const promise = tryRecoverWorkflowSessionStructuredReply(gateway, {
      sessionKey: SESSION,
      startedAtMs: startedAt,
      validateWithDisk: async (raw) => ({ ok: true, parsed: { ...parsedReply, raw } }),
    });

    await vi.advanceTimersByTimeAsync(OFFICE_SETTLE_CONSISTENCY_DELAY_MS);
    const result = await promise;

    expect(result.ok).toBe(true);
    expect(fetchGatewaySessionListRow).toHaveBeenCalled();
    expect(fetchChatHistory).toHaveBeenCalled();
  });

  it('accepts recovery when confirm is longer/more complete than baseline', async () => {
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
      const content = historyCalls < 4 ? WF_JSON : confirmJson;
      return {
        messages: [
          { role: 'user', content: 'go', timestamp: startedAt + 1 },
          { role: 'assistant', content, timestamp: startedAt + 5_000 },
        ],
      };
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const promise = tryRecoverWorkflowSessionStructuredReply(gateway, {
      sessionKey: SESSION,
      startedAtMs: startedAt,
      validateWithDisk: async (raw) => ({ ok: true, parsed: { ...parsedReply, raw } }),
    });

    await vi.advanceTimersByTimeAsync(OFFICE_SETTLE_CONSISTENCY_DELAY_MS);
    const result = await promise;

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.raw).toContain('revised');
    }
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('HASH_MISMATCH_ACCEPT'),
    );
    warnSpy.mockRestore();
  });

  it('rejects recovery when confirm is weaker than baseline', async () => {
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
      const content = historyCalls < 4 ? WF_JSON : weakerConfirm;
      return {
        messages: [
          { role: 'user', content: 'go', timestamp: startedAt + 1 },
          { role: 'assistant', content, timestamp: startedAt + 5_000 },
        ],
      };
    });

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const promise = tryRecoverWorkflowSessionStructuredReply(gateway, {
      sessionKey: SESSION,
      startedAtMs: startedAt,
      validateWithDisk: async (raw) => ({ ok: true, parsed: { ...parsedReply, raw } }),
    });

    await vi.advanceTimersByTimeAsync(OFFICE_SETTLE_CONSISTENCY_DELAY_MS);
    const result = await promise;

    expect(result.ok).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('HASH_MISMATCH_REJECT'),
    );
    warnSpy.mockRestore();
  });
});
