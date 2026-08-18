import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Regression coverage for the "new/initial session defaults to the non-existent
// `main` agent" bug. The legacy `main` agent id is an upstream artifact; when
// YYClaw configures real agents (default agent is not `main`), session
// resolution must fall back to the configured default agent, never `main`.

const runtimeStatus = {
  state: 'running',
  port: 18789,
  connectedAt: 0,
};

const { gatewayRpcMock, agentsState } = vi.hoisted(() => ({
  gatewayRpcMock: vi.fn(),
  agentsState: { agents: [] as Array<{ id: string }>, defaultAgentId: '' },
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
    getState: () => agentsState,
  },
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: vi.fn().mockResolvedValue({ success: true, summaries: [] }),
}));

describe('chat store default-agent resolution', () => {
  beforeEach(() => {
    vi.resetModules();
    gatewayRpcMock.mockReset();
    runtimeStatus.connectedAt = Date.now();
    agentsState.agents = [];
    agentsState.defaultAgentId = '';
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('newSession falls back to the configured default agent when the current session names a non-existent agent', async () => {
    agentsState.agents = [{ id: 'assistant' }, { id: 'writer' }];
    agentsState.defaultAgentId = 'assistant';
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1700000000000);

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:main:main', // legacy placeholder, `main` is not a real agent
      currentAgentId: 'main',
      sessions: [{ key: 'agent:main:main' }],
      messages: [],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    useChatStore.getState().newSession();

    expect(useChatStore.getState().currentSessionKey).toBe('agent:assistant:session-1700000000000');
    expect(useChatStore.getState().currentAgentId).toBe('assistant');
    nowSpy.mockRestore();
  });

  it('newSession always uses the configured default agent even when the current agent is real', async () => {
    agentsState.agents = [{ id: 'assistant' }, { id: 'writer' }];
    agentsState.defaultAgentId = 'assistant';
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1700000000001);

    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: 'agent:writer:main',
      currentAgentId: 'writer',
      sessions: [{ key: 'agent:writer:main' }],
      messages: [],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    useChatStore.getState().newSession();

    expect(useChatStore.getState().currentSessionKey).toBe('agent:assistant:session-1700000000001');
    expect(useChatStore.getState().currentAgentId).toBe('assistant');
    nowSpy.mockRestore();
  });

  it('loadSessions retargets the default agent main session when there is no history and no real "main" agent', async () => {
    agentsState.agents = [{ id: 'assistant' }];
    agentsState.defaultAgentId = 'assistant';
    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return { sessions: [] };
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

    expect(useChatStore.getState().currentSessionKey).toBe('agent:assistant:main');
    expect(useChatStore.getState().currentAgentId).toBe('assistant');
  });
});
