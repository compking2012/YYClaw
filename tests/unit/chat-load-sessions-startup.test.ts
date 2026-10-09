import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeStatus = {
  state: 'running',
  port: 18789,
  connectedAt: 0,
};

const { gatewayRpcMock } = vi.hoisted(() => ({
  gatewayRpcMock: vi.fn(),
}));

const { agentsState } = vi.hoisted(() => ({
  agentsState: {
    current: { agents: [] as Array<{ id: string; name?: string }>, defaultAgentId: undefined as string | undefined },
  },
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: {
    getState: () => ({
      status: runtimeStatus,
      rpc: gatewayRpcMock,
    }),
  },
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: {
    getState: () => agentsState.current,
  },
}));

vi.mock('@/lib/host-api', () => ({
  hostApi: {
    sessions: {
      summaries: vi.fn().mockResolvedValue({ summaries: [] }),
    },
  },
  hostApiFetch: vi.fn().mockResolvedValue({ success: true, summaries: [] }),
}));

function deferredCatalog(): {
  promise: Promise<Record<string, unknown>>;
  resolve: (value: Record<string, unknown>) => void;
} {
  let resolve!: (value: Record<string, unknown>) => void;
  const promise = new Promise<Record<string, unknown>>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

describe('chat store loadSessions startup selection', () => {
  beforeEach(() => {
    vi.resetModules();
    gatewayRpcMock.mockReset();
    agentsState.current = { agents: [], defaultAgentId: undefined };
    runtimeStatus.connectedAt = Date.now();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('starts a fresh conversation instead of resurrecting the latest old session', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1711111111111);
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            {
              key: 'agent:main:cron:heartbeat',
              label: 'Main Agent heartbeat',
              updatedAt: 9_000,
            },
            {
              key: 'agent:main:session-a',
              displayName: 'PDF summary',
              updatedAt: 5_000,
            },
          ],
        };
      }
      if (method === 'chat.history') {
        return { messages: [] };
      }
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [],
      messages: [],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    await useChatStore.getState().loadSessions();

    // Boot lands on a brand-new empty conversation, not the latest old session,
    // while the old session stays available in the sidebar.
    expect(useChatStore.getState().currentSessionKey).toBe('agent:main:session-1711111111111');
    expect(useChatStore.getState().sessions.map((session) => session.key)).toContain('agent:main:session-a');
    expect(
      useChatStore.getState().sessions.find(
        (session) => session.key === 'agent:main:session-1711111111111',
      )?.createdLocally,
    ).toBe(true);
    nowSpy.mockRestore();
  });

  it('does not recreate a missing selected native child during catalog repair', async () => {
    const missingChildKey = 'agent:main:subagent:missing-child';
    const retainedChildKey = 'agent:main:subagent:retained-child';
    gatewayRpcMock.mockResolvedValue({
      ts: 1,
      sessions: [{ key: retainedChildKey, updatedAt: 9_000 }],
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: missingChildKey,
      currentAgentId: 'main',
      sessions: [{ key: missingChildKey }],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    await useChatStore.getState().loadSessions();

    const state = useChatStore.getState();
    expect(state.currentSessionKey).toMatch(/^agent:main:session-\d+$/);
    expect(state.currentSessionKey).not.toBe(missingChildKey);
    expect(state.currentSessionKey).not.toBe(retainedChildKey);
    expect(state.sessions).toContainEqual(expect.objectContaining({ key: retainedChildKey }));
    expect(state.sessions).not.toContainEqual(expect.objectContaining({ key: missingChildKey }));
  });

  it('rejects stale list rows and buffered events for a deleted agent until recreation', async () => {
    const deletedKey = 'agent:test1:session-delayed';
    const catalog = deferredCatalog();
    gatewayRpcMock
      .mockReturnValueOnce(catalog.promise)
      .mockResolvedValue({
        ts: 3,
        sessions: [
          { key: 'agent:main:main', derivedTitle: 'Main conversation' },
          { key: deletedKey, derivedTitle: 'Stale deleted-agent row' },
        ],
      });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: deletedKey,
      currentAgentId: 'test1',
      sessions: [{ key: deletedKey }],
      sessionLabels: { [deletedKey]: 'Deleted conversation' },
      sessionLastActivity: { [deletedKey]: 1 },
    });

    const loadPromise = useChatStore.getState().loadSessions({ force: true });
    await vi.waitFor(() => expect(gatewayRpcMock).toHaveBeenCalledTimes(1));
    useChatStore.getState().handleSessionsChanged({
      sessionKey: deletedKey,
      session: { key: deletedKey, derivedTitle: 'Buffered deleted-agent event' },
      ts: 2,
    });
    useChatStore.getState().removeAgentSessions('test1');
    catalog.resolve({
      ts: 1,
      sessions: [
        { key: 'agent:main:main', derivedTitle: 'Main conversation' },
        { key: deletedKey, derivedTitle: 'Stale deleted-agent row' },
      ],
    });
    await loadPromise;

    expect(gatewayRpcMock.mock.calls.filter(([method]) => method === 'sessions.list')).toHaveLength(2);
    expect(useChatStore.getState().sessions.some((session) => session.key === deletedKey)).toBe(false);

    useChatStore.getState().reconcileAgentSessionTombstones(['test1']);
    await useChatStore.getState().loadSessions({ force: true });

    expect(useChatStore.getState().sessions).toContainEqual(expect.objectContaining({
      key: deletedKey,
      derivedTitle: 'Stale deleted-agent row',
    }));
  });

  it('mints the fresh conversation under the configured default agent id (not the legacy main)', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1711111111111);
    agentsState.current = { agents: [{ id: 'acme', name: 'Acme' }], defaultAgentId: 'acme' };
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { key: 'agent:acme:session-a', displayName: 'PDF summary', updatedAt: 5_000 },
          ],
        };
      }
      if (method === 'chat.history') {
        return { messages: [] };
      }
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [],
      messages: [],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    await useChatStore.getState().loadSessions();

    // The boot-default ghost key hardcodes the legacy `main` id, but the fresh
    // conversation must belong to the real default agent (`acme`).
    expect(useChatStore.getState().currentSessionKey).toBe('agent:acme:session-1711111111111');
    expect(useChatStore.getState().sessions.map((session) => session.key)).toContain('agent:acme:session-a');
    nowSpy.mockRestore();
  });

  it('falls back to the existing sessions agent id when the agents snapshot has not hydrated yet', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1711111111111);
    // agentsState stays empty (default-agent resolution races the gateway-ready
    // loadSessions and loses); the mint must still target the agent that owns
    // the loaded history rather than the bogus `main` placeholder.
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { key: 'agent:acme:session-a', displayName: 'PDF summary', updatedAt: 5_000 },
          ],
        };
      }
      if (method === 'chat.history') {
        return { messages: [] };
      }
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [],
      messages: [],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    await useChatStore.getState().loadSessions();

    expect(useChatStore.getState().currentSessionKey).toBe('agent:acme:session-1711111111111');
    nowSpy.mockRestore();
  });

  it('hydrates session workspacePath from host session summaries', async () => {
    const summariesMock = vi.mocked((await import('@/lib/host-api')).hostApi.sessions.summaries);
    summariesMock.mockResolvedValueOnce({
      success: true,
      summaries: [{
        sessionKey: 'agent:main:session-a',
        firstUserText: null,
        lastTimestamp: null,
        workspacePath: '/Users/alex/workspace/ClawX',
      }],
    });
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return { sessions: [{ key: 'agent:main:session-a', displayName: 'Chat A', updatedAt: 5_000 }] };
      }
      if (method === 'chat.history') return { messages: [] };
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [],
      messages: [],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    await useChatStore.getState().loadSessions();
    await Promise.resolve();

    expect(useChatStore.getState().sessions.find((session) => session.key === 'agent:main:session-a')?.workspacePath)
      .toBe('/Users/alex/workspace/ClawX');
  });

  it('preserves a locally-created current session across session refreshes before first send', async () => {
    const pendingKey = 'agent:main:session-1711111111111';
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { key: pendingKey, displayName: 'ACP', updatedAt: 6_000 },
            { key: 'agent:main:session-a', displayName: 'Chat A', updatedAt: 5_000 },
          ],
        };
      }
      if (method === 'chat.history') return { messages: [] };
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: pendingKey,
      currentAgentId: 'main',
      sessions: [{ key: pendingKey, displayName: pendingKey, createdLocally: true }],
      messages: [],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    await useChatStore.getState().loadSessions();

    const pendingSession = useChatStore.getState().sessions.find((session) => session.key === pendingKey);
    expect(useChatStore.getState().currentSessionKey).toBe(pendingKey);
    expect(pendingSession?.createdLocally).toBe(true);
  });

  it('preserves mirrored workspacePath when backend returns the same session without cwd', async () => {
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return { sessions: [{ key: 'agent:main:session-a', displayName: 'Chat A', updatedAt: 5_000 }] };
      }
      if (method === 'chat.history') return { messages: [] };
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:session-a',
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:session-a', workspacePath: '/Users/alex/workspace/ClawX' }],
      messages: [],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    await useChatStore.getState().loadSessions();

    expect(useChatStore.getState().sessions.find((session) => session.key === 'agent:main:session-a')?.workspacePath)
      .toBe('/Users/alex/workspace/ClawX');
  });

  it('clears the prior conversation when loadSessions starts a fresh conversation', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1711111111111);
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            {
              key: 'agent:main:cron:heartbeat',
              label: 'Main Agent heartbeat',
              updatedAt: 9_000,
            },
            {
              key: 'agent:main:session-b',
              displayName: 'Other chat',
              updatedAt: 5_000,
            },
          ],
        };
      }
      if (method === 'chat.history') {
        return { messages: [] };
      }
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [],
      messages: [{ role: 'user', content: 'question from another chat' }],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    await useChatStore.getState().loadSessions();

    expect(useChatStore.getState().currentSessionKey).toBe('agent:main:session-1711111111111');
    expect(useChatStore.getState().sessions.map((session) => session.key)).toContain('agent:main:session-b');
    expect(useChatStore.getState().messages).toEqual([]);
    nowSpy.mockRestore();
  });

  it('hides placeholder feishu sessions but keeps real desktop history', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1711111111111);
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            {
              key: 'agent:main:feishu:ou_69c24802fa248625f7965a',
              updatedAt: 9_000,
            },
            {
              key: 'agent:main:session-a',
              displayName: 'Desktop chat',
              updatedAt: 5_000,
            },
          ],
        };
      }
      if (method === 'chat.history') {
        return { messages: [] };
      }
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [],
      messages: [],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    await useChatStore.getState().loadSessions();

    expect(useChatStore.getState().sessions.map((session) => session.key)).toEqual([
      'agent:main:session-a',
      'agent:main:session-1711111111111',
    ]);
    expect(useChatStore.getState().currentSessionKey).toBe('agent:main:session-1711111111111');
    nowSpy.mockRestore();
  });

  it('starts a fresh session when the current default is a hidden heartbeat even if visible history exists', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1711111111111);
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            {
              key: 'agent:main:main',
              displayName: 'ClawX',
              lastMessagePreview: '[OpenClaw heartbeat poll]',
              updatedAt: 9_000,
            },
            {
              key: 'agent:main:session-a',
              displayName: 'Visible desktop chat',
              lastMessagePreview: 'Summarize the repository structure',
              updatedAt: 5_000,
            },
          ],
        };
      }
      if (method === 'chat.history') {
        return { messages: [] };
      }
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [],
      messages: [{ role: 'assistant', content: 'stale visible content' }],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    await useChatStore.getState().loadSessions();

    expect(useChatStore.getState().currentSessionKey).toBe('agent:main:session-1711111111111');
    expect(useChatStore.getState().currentSessionKey).not.toBe('agent:main:session-a');
    expect(useChatStore.getState().sessions.map((session) => session.key)).toEqual([
      'agent:main:session-a',
      'agent:main:session-1711111111111',
    ]);
    expect(
      useChatStore.getState().sessions.find(
        (session) => session.key === 'agent:main:session-1711111111111',
      )?.createdLocally,
    ).toBe(true);
    nowSpy.mockRestore();
  });

  it('starts a fresh session when the default main session is a heartbeat poll acknowledgement', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1711111111111);
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            {
              key: 'agent:main:main',
              label: '[OpenClaw heartbeat poll]',
              displayName: '[OpenClaw heartbeat poll]',
              derivedTitle: '[OpenClaw heartbeat poll]',
              lastMessagePreview: 'HEARTBEAT_OK',
              updatedAt: 9_000,
            },
            {
              key: 'agent:main:session-a',
              displayName: 'Visible desktop chat',
              lastMessagePreview: 'Summarize the repository structure',
              updatedAt: 5_000,
            },
          ],
        };
      }
      if (method === 'chat.history') return { messages: [] };
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [],
      messages: [{ role: 'assistant', content: 'stale visible content' }],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    await useChatStore.getState().loadSessions();

    expect(useChatStore.getState().currentSessionKey).toBe('agent:main:session-1711111111111');
    expect(useChatStore.getState().sessions.map((session) => session.key)).toEqual([
      'agent:main:session-a',
      'agent:main:session-1711111111111',
    ]);
    expect(
      useChatStore.getState().sessions.find(
        (session) => session.key === 'agent:main:session-1711111111111',
      )?.createdLocally,
    ).toBe(true);
    nowSpy.mockRestore();
  });

  it('removes sessions revealed as heartbeat-only by transcript summaries', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1711111111111);
    const summariesMock = vi.mocked((await import('@/lib/host-api')).hostApi.sessions.summaries);
    summariesMock.mockResolvedValueOnce({
      success: true,
      summaries: [
        {
          sessionKey: 'agent:main:session-heartbeat',
          firstUserText: null,
          lastTimestamp: 9_000,
          workspacePath: null,
          heartbeatOnly: true,
        },
      ],
    });
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            {
              key: 'agent:main:session-heartbeat',
              displayName: 'ClawX',
              updatedAt: 9_000,
            },
            {
              key: 'agent:main:session-a',
              displayName: 'Visible desktop chat',
              lastMessagePreview: 'Summarize the repository structure',
              updatedAt: 5_000,
            },
          ],
        };
      }
      if (method === 'chat.history') {
        return { messages: [] };
      }
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [],
      messages: [{ role: 'assistant', content: 'stale visible content' }],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    await useChatStore.getState().loadSessions();
    await Promise.resolve();
    await Promise.resolve();

    expect(useChatStore.getState().currentSessionKey).toBe('agent:main:session-1711111111111');
    expect(useChatStore.getState().sessions.map((session) => session.key)).toEqual([
      'agent:main:session-a',
      'agent:main:session-1711111111111',
    ]);
    expect(useChatStore.getState().sessionLabels['agent:main:session-heartbeat']).toBeUndefined();
    nowSpy.mockRestore();
  });

  it('removes sessions revealed as heartbeat-only by a cached sidebar label', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1711111111111);
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            {
              key: 'agent:main:session-heartbeat',
              displayName: 'ClawX',
              updatedAt: 9_000,
            },
            {
              key: 'agent:main:session-a',
              displayName: 'Visible desktop chat',
              lastMessagePreview: 'Summarize the repository structure',
              updatedAt: 5_000,
            },
          ],
        };
      }
      if (method === 'chat.history') return { messages: [] };
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:session-heartbeat',
      currentAgentId: 'main',
      sessions: [],
      messages: [{ role: 'assistant', content: 'stale visible content' }],
      sessionLabels: { 'agent:main:session-heartbeat': '[OpenClaw heartbeat poll]' },
      sessionLastActivity: { 'agent:main:session-heartbeat': 9_000 },
    });

    await useChatStore.getState().loadSessions();

    expect(useChatStore.getState().currentSessionKey).toBe('agent:main:session-1711111111111');
    expect(useChatStore.getState().sessions.map((session) => session.key)).toEqual([
      'agent:main:session-a',
      'agent:main:session-1711111111111',
    ]);
    expect(useChatStore.getState().sessionLabels['agent:main:session-heartbeat']).toBeUndefined();
    expect(useChatStore.getState().sessionLastActivity['agent:main:session-heartbeat']).toBeUndefined();
    nowSpy.mockRestore();
  });

  it('clears stale heartbeat sidebar labels without hiding sessions that have real display names', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1711111111111);
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            {
              key: 'agent:main:session-real',
              displayName: 'Project kickoff notes',
              updatedAt: 8_000,
            },
          ],
        };
      }
      if (method === 'chat.history') return { messages: [] };
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [],
      messages: [],
      sessionLabels: { 'agent:main:session-real': '[OpenClaw heartbeat poll]' },
      sessionLastActivity: {},
    });

    await useChatStore.getState().loadSessions();

    expect(useChatStore.getState().sessions.map((session) => session.key)).toEqual([
      'agent:main:session-real',
      'agent:main:session-1711111111111',
    ]);
    expect(useChatStore.getState().currentSessionKey).toBe('agent:main:session-1711111111111');
    expect(useChatStore.getState().sessionLabels['agent:main:session-real']).toBeUndefined();
    nowSpy.mockRestore();
  });

  it('shows feishu sessions when they contain real channel messages', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1711111111111);
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            {
              key: 'agent:main:feishu:ou_69c24802fa248625f7965a',
              lastMessagePreview: '你好，来自飞书',
              updatedAt: 9_000,
            },
            {
              key: 'agent:main:session-a',
              displayName: 'Desktop chat',
              updatedAt: 5_000,
            },
          ],
        };
      }
      if (method === 'chat.history') {
        return { messages: [] };
      }
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [],
      messages: [],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    await useChatStore.getState().loadSessions();

    expect(useChatStore.getState().sessions.map((session) => session.key)).toEqual([
      'agent:main:feishu:ou_69c24802fa248625f7965a',
      'agent:main:session-a',
      'agent:main:session-1711111111111',
    ]);
    expect(useChatStore.getState().currentSessionKey).toBe('agent:main:session-1711111111111');
    nowSpy.mockRestore();
  });

  it('keeps the default main ghost session when only cron sessions exist', async () => {
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            {
              key: 'agent:main:cron:heartbeat',
              label: 'Main Agent heartbeat',
              updatedAt: 9_000,
            },
          ],
        };
      }
      if (method === 'chat.history') {
        return { messages: [] };
      }
      throw new Error(`Unexpected gateway RPC: ${method}`);
    });

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main',
      currentAgentId: 'main',
      sessions: [],
      messages: [],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    await useChatStore.getState().loadSessions();

    expect(useChatStore.getState().currentSessionKey).toBe('agent:main:main');
    expect(useChatStore.getState().sessions.some((session) => session.key === 'agent:main:main')).toBe(true);
  });
});
