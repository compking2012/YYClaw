import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { GatewayManager } from '../../electron/gateway/manager';
import {
  ensureProjectAgentSessionNew,
  historyShowsNewCommandAfter,
  isOfficeP2PSessionKey,
  OFFICE_SESSION_NEW_COMMAND,
  parseProjectIdFromOfficeSessionKey,
  shouldSkipProjectSessionNewForMessage,
} from '../../electron/services/office/office-session-new';
import {
  clearProjectAgentNewLedger,
  getProjectAgentNewLedgerEpoch,
  hasProjectSessionNewSent,
  markProjectSessionNewSent,
  resetProjectAgentNewLedgerForTesting,
} from '../../electron/services/office/office-session-new-ledger';
import { callAgentMessage } from '../../electron/services/office/gateway-rpc';

const fetchHistoryMock = vi.fn();

vi.mock('../../electron/services/office/office-session-history-sync', () => ({
  fetchOfficeChatHistoryDirect: (...args: unknown[]) => fetchHistoryMock(...args),
}));

const SMART_SESSION = 'agent:dev:office:role:dev:dm:task-proj-1';
const WORKFLOW_SESSION_A = 'agent:pm:office:task:proj-2:role:dev:node:n1';
const WORKFLOW_SESSION_B = 'agent:pm:office:task:proj-2:role:dev:node:n2';

function mockGateway(): GatewayManager {
  return {
    rpc: vi.fn().mockResolvedValue({ runId: 'run-1' }),
  } as unknown as GatewayManager;
}

function mockHistoryWithNewAt(timestamp: number) {
  fetchHistoryMock.mockResolvedValue({
    messages: [{ role: 'user', content: OFFICE_SESSION_NEW_COMMAND, timestamp }],
  });
}

describe('parseProjectIdFromOfficeSessionKey', () => {
  it('extracts project id from smart dm, workflow task, and task-room keys', () => {
    expect(parseProjectIdFromOfficeSessionKey('agent:pm:office:role:dev:dm:task-proj-1')).toBe('proj-1');
    expect(parseProjectIdFromOfficeSessionKey('agent:pm:office:task:proj-2:role:dev:node:n1')).toBe('proj-2');
    expect(parseProjectIdFromOfficeSessionKey('agent:pm:office:task-room:proj-3')).toBe('proj-3');
  });

  it('returns undefined for p2p and workflow-gen keys', () => {
    expect(parseProjectIdFromOfficeSessionKey('agent:pm:office:p2p:dev:thread-1')).toBeUndefined();
    expect(parseProjectIdFromOfficeSessionKey('agent:pm:office:role:pm:dm:workflow-gen-123')).toBeUndefined();
  });
});

describe('shouldSkipProjectSessionNewForMessage', () => {
  it('skips room mirror and announce lines', () => {
    expect(shouldSkipProjectSessionNewForMessage('[Room] hello')).toBe(true);
    expect(shouldSkipProjectSessionNewForMessage('[Room]\ncontext\n\nmsg')).toBe(true);
    expect(shouldSkipProjectSessionNewForMessage('Office task prompt')).toBe(false);
  });

  it('skips bare /new business messages to avoid double dispatch', () => {
    expect(shouldSkipProjectSessionNewForMessage('/new')).toBe(true);
  });
});

describe('isOfficeP2PSessionKey', () => {
  it('detects p2p session keys', () => {
    expect(isOfficeP2PSessionKey('agent:a:office:p2p:b:default')).toBe(true);
    expect(isOfficeP2PSessionKey('agent:a:office:role:b:dm:task-proj')).toBe(false);
  });
});

describe('historyShowsNewCommandAfter', () => {
  it('matches /new user turns after send start', () => {
    const startedAt = 1_000;
    expect(historyShowsNewCommandAfter(
      [{ role: 'user', content: '/new', timestamp: startedAt + 10 }],
      startedAt,
    )).toBe(true);
    expect(historyShowsNewCommandAfter(
      [{ role: 'user', content: '/new', timestamp: startedAt - 10_000 }],
      startedAt,
    )).toBe(false);
  });

  it('does not treat embedded /new mentions as reset confirmation', () => {
    const startedAt = 1_000;
    expect(historyShowsNewCommandAfter(
      [{ role: 'user', content: 'see /new chapter', timestamp: startedAt + 10 }],
      startedAt,
    )).toBe(false);
  });

  it('ignores legacy /new rows without a timestamp', () => {
    const startedAt = 1_000;
    expect(historyShowsNewCommandAfter(
      [{ role: 'user', content: '/new' }],
      startedAt,
    )).toBe(false);
  });
});

describe('ensureProjectAgentSessionNew', () => {
  beforeEach(() => {
    resetProjectAgentNewLedgerForTesting();
    fetchHistoryMock.mockReset();
  });

  it('sends /new once per project session and marks ledger on reset confirmation', async () => {
    const gateway = mockGateway();
    const callDirect = vi.fn().mockResolvedValue({ runId: 'new-run' });
    mockHistoryWithNewAt(Date.now());

    const params = {
      sessionKey: SMART_SESSION,
      agentId: 'dev',
      message: 'Do the task',
    };

    await ensureProjectAgentSessionNew(gateway, params, callDirect);
    await ensureProjectAgentSessionNew(gateway, params, callDirect);

    expect(callDirect).toHaveBeenCalledTimes(1);
    expect(callDirect.mock.calls[0]?.[2]).toBe(OFFICE_SESSION_NEW_COMMAND);
    expect(hasProjectSessionNewSent('proj-1', SMART_SESSION)).toBe(true);
  });

  it('sends /new independently for each workflow session key in the same project', async () => {
    const gateway = mockGateway();
    const callDirect = vi.fn().mockResolvedValue({ runId: 'new-run' });
    mockHistoryWithNewAt(Date.now());

    await ensureProjectAgentSessionNew(
      gateway,
      { sessionKey: WORKFLOW_SESSION_A, agentId: 'dev', message: 'node-a' },
      callDirect,
    );
    await ensureProjectAgentSessionNew(
      gateway,
      { sessionKey: WORKFLOW_SESSION_B, agentId: 'dev', message: 'node-b' },
      callDirect,
    );

    expect(callDirect).toHaveBeenCalledTimes(2);
    expect(hasProjectSessionNewSent('proj-2', WORKFLOW_SESSION_A)).toBe(true);
    expect(hasProjectSessionNewSent('proj-2', WORKFLOW_SESSION_B)).toBe(true);
  });

  it('does not mark ledger when /new send fails', async () => {
    const gateway = mockGateway();
    const callDirect = vi.fn().mockRejectedValue(new Error('rpc down'));

    await ensureProjectAgentSessionNew(
      gateway,
      {
        sessionKey: SMART_SESSION,
        agentId: 'dev',
        message: 'Do the task',
      },
      callDirect,
    );

    expect(hasProjectSessionNewSent('proj-1', SMART_SESSION)).toBe(false);
  });

  it('documents current fail-open behavior: business prompt is still sent when /new fails', async () => {
    const gateway = {
      rpc: vi.fn(async (method: string, params: Record<string, unknown>) => {
        if (params.message === OFFICE_SESSION_NEW_COMMAND) {
          throw new Error('new failed');
        }
        return { runId: 'business-run' };
      }),
    } as unknown as GatewayManager;

    await expect(callAgentMessage(
      gateway,
      SMART_SESSION,
      'business prompt',
      'business-key',
      { agentId: 'dev' },
    )).resolves.toEqual({ runId: 'business-run' });

    const sentMessages = vi.mocked(gateway.rpc).mock.calls.map(([, params]) =>
      (params as { message?: string }).message,
    );
    expect(sentMessages).toContain(OFFICE_SESSION_NEW_COMMAND);
    expect(sentMessages.some((message) => message?.includes('business prompt'))).toBe(true);
    expect(hasProjectSessionNewSent('proj-1', SMART_SESSION)).toBe(false);
  });

  it('does not inject Office runtime policy prompt into chat.send messages', async () => {
    const gateway = {
      rpc: vi.fn(async () => ({ runId: 'run-1' })),
    } as unknown as GatewayManager;
    mockHistoryWithNewAt(Date.now());

    await callAgentMessage(
      gateway,
      SMART_SESSION,
      'business prompt',
      'business-key',
      { agentId: 'dev', projectId: 'proj-1' },
    );

    const sendCall = vi.mocked(gateway.rpc).mock.calls.find(([method, params]) =>
      method === 'chat.send'
      && (params as { message?: string }).message?.includes('business prompt'),
    );
    const params = sendCall?.[1] as {
      message?: string;
      officeContext?: unknown;
      runtimeToolPolicy?: unknown;
      toolPolicy?: unknown;
    };
    expect(params.message).not.toContain('[Office Runtime Policy]');
    expect(params.message).toBe('business prompt');
    expect(params.officeContext).toBeUndefined();
    expect(params.runtimeToolPolicy).toBeUndefined();
    expect(params.toolPolicy).toBeUndefined();
  });

  it('does not mark ledger when reset confirmation times out', async () => {
    vi.useFakeTimers();
    const gateway = mockGateway();
    const callDirect = vi.fn().mockResolvedValue({ runId: 'new-run' });
    fetchHistoryMock.mockResolvedValue({ messages: [] });

    const promise = ensureProjectAgentSessionNew(
      gateway,
      {
        sessionKey: SMART_SESSION,
        agentId: 'dev',
        message: 'Do the task',
      },
      callDirect,
    );
    await vi.runAllTimersAsync();
    await promise;
    vi.useRealTimers();

    expect(callDirect).toHaveBeenCalledTimes(1);
    expect(hasProjectSessionNewSent('proj-1', SMART_SESSION)).toBe(false);
  });

  it('does not mark ledger when the project ledger is cleared during confirmation', async () => {
    const gateway = mockGateway();
    const callDirect = vi.fn().mockResolvedValue({ runId: 'new-run' });
    fetchHistoryMock.mockImplementation(async () => {
      clearProjectAgentNewLedger('proj-1');
      return {
        messages: [{ role: 'user', content: OFFICE_SESSION_NEW_COMMAND, timestamp: Date.now() }],
      };
    });

    await ensureProjectAgentSessionNew(
      gateway,
      {
        sessionKey: SMART_SESSION,
        agentId: 'dev',
        message: 'Do the task',
      },
      callDirect,
    );

    expect(hasProjectSessionNewSent('proj-1', SMART_SESSION)).toBe(false);
    expect(getProjectAgentNewLedgerEpoch('proj-1')).toBe(1);
  });

  it('skips p2p sessions', async () => {
    const callDirect = vi.fn().mockResolvedValue({});
    await ensureProjectAgentSessionNew(
      mockGateway(),
      {
        sessionKey: 'agent:a:office:p2p:b:default',
        agentId: 'a',
        message: 'hello',
        projectId: 'proj-1',
      },
      callDirect,
    );
    expect(callDirect).not.toHaveBeenCalled();
  });

  it('skips room mirror messages', async () => {
    const callDirect = vi.fn().mockResolvedValue({});
    await ensureProjectAgentSessionNew(
      mockGateway(),
      {
        sessionKey: 'agent:pm:office:task-room:proj-1',
        agentId: 'pm',
        message: '[Room] announcement',
      },
      callDirect,
    );
    expect(callDirect).not.toHaveBeenCalled();
  });

  it('dedupes concurrent ensure calls for the same project session', async () => {
    const gateway = mockGateway();
    const callDirect = vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 30));
      return { runId: 'new-run' };
    });
    mockHistoryWithNewAt(Date.now());

    await Promise.all([
      ensureProjectAgentSessionNew(
        gateway,
        {
          sessionKey: SMART_SESSION,
          agentId: 'dev',
          message: 'task-a',
        },
        callDirect,
      ),
      ensureProjectAgentSessionNew(
        gateway,
        {
          sessionKey: SMART_SESSION,
          agentId: 'dev',
          message: 'task-b',
        },
        callDirect,
      ),
    ]);

    expect(callDirect).toHaveBeenCalledTimes(1);
    expect(hasProjectSessionNewSent('proj-1', SMART_SESSION)).toBe(true);
  }, 10_000);
});

describe('callAgentMessage integration', () => {
  beforeEach(() => {
    resetProjectAgentNewLedgerForTesting();
    fetchHistoryMock.mockReset();
  });

  it('clears ledger for one project without affecting others', () => {
    markProjectSessionNewSent('proj-1', SMART_SESSION);
    markProjectSessionNewSent('proj-2', SMART_SESSION);
    clearProjectAgentNewLedger('proj-1');
    expect(hasProjectSessionNewSent('proj-1', SMART_SESSION)).toBe(false);
    expect(hasProjectSessionNewSent('proj-2', SMART_SESSION)).toBe(true);
  });

  it('sends /new again after project ledger is cleared', async () => {
    const gateway = mockGateway();
    const callDirect = vi.fn().mockResolvedValue({ runId: 'new-run' });
    mockHistoryWithNewAt(Date.now());

    const params = {
      sessionKey: SMART_SESSION,
      agentId: 'dev',
      message: 'Do the task',
    };

    await ensureProjectAgentSessionNew(gateway, params, callDirect);
    expect(callDirect).toHaveBeenCalledTimes(1);

    clearProjectAgentNewLedger('proj-1');
    await ensureProjectAgentSessionNew(gateway, params, callDirect);
    expect(callDirect).toHaveBeenCalledTimes(2);
  });

  it('sends /new before the first business prompt and not before the second', async () => {
    const rpc = vi.fn(async () => ({ runId: 'run-1' }));
    const gateway = { rpc } as unknown as GatewayManager;
    mockHistoryWithNewAt(Date.now());

    await callAgentMessage(gateway, SMART_SESSION, 'first prompt', 'id-1');
    await callAgentMessage(gateway, SMART_SESSION, 'second prompt', 'id-2');

    const payloads = rpc.mock.calls
      .filter(([method]) => method === 'chat.send' || method === 'agent')
      .map((call) => (call[1] as { message?: string }).message);
    expect(payloads.filter((m) => m === OFFICE_SESSION_NEW_COMMAND)).toHaveLength(1);
    expect(payloads.filter((m) => m?.includes('first prompt'))).toHaveLength(1);
    expect(payloads.filter((m) => m?.includes('second prompt'))).toHaveLength(1);
    expect(hasProjectSessionNewSent('proj-1', SMART_SESSION)).toBe(true);
  });

  it('does not pre-dispatch /new when the business message is /new', async () => {
    const rpc = vi.fn(async () => ({ runId: 'run-1' }));
    const gateway = { rpc } as unknown as GatewayManager;

    await callAgentMessage(gateway, SMART_SESSION, OFFICE_SESSION_NEW_COMMAND, 'id-new');

    const payloads = rpc.mock.calls
      .filter(([method]) => method === 'chat.send' || method === 'agent')
      .map((call) => (call[1] as { message?: string }).message);
    expect(payloads).toEqual([OFFICE_SESSION_NEW_COMMAND]);
  });

  it('does not /new for pre-marked project sessions', async () => {
    markProjectSessionNewSent('proj-9', 'agent:dev:office:role:dev:dm:task-proj-9');
    const rpc = vi.fn(async () => ({ runId: 'run-1' }));
    const gateway = { rpc } as unknown as GatewayManager;

    await callAgentMessage(
      gateway,
      'agent:dev:office:role:dev:dm:task-proj-9',
      'only prompt',
      'id-1',
    );

    const payloads = rpc.mock.calls
      .filter(([method]) => method === 'chat.send' || method === 'agent')
      .map((call) => (call[1] as { message?: string }).message);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toContain('only prompt');
  });
});
