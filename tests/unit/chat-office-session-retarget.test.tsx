import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

const OFFICE_KEY = 'agent:main:office:task:proj-1:role:dev:node:gen-0';

const { gatewayRpcMock, gatewayStore } = vi.hoisted(() => {
  const runtimeStatus = {
    state: 'running',
    port: 18789,
    connectedAt: 0,
  };
  const gatewayRpcMock = vi.fn();
  const gatewayStore = {
    status: runtimeStatus,
    rpc: gatewayRpcMock,
  };
  return { gatewayRpcMock, gatewayStore };
});

const runtimeStatus = gatewayStore.status;

const { agentsState } = vi.hoisted(() => ({
  agentsState: {
    agents: [{ id: 'dev', name: 'Dev', isDefault: true }] as Array<Record<string, unknown>>,
    defaultAgentId: 'dev',
    fetchAgents: vi.fn(),
  },
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: Object.assign(
    (selector: (state: typeof gatewayStore) => unknown) => selector(gatewayStore),
    { getState: () => gatewayStore },
  ),
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: (selector: (state: typeof agentsState) => unknown) => selector(agentsState),
}));

vi.mock('@/lib/host-api', () => ({
  hostApiFetch: vi.fn().mockResolvedValue({ success: true, summaries: [] }),
  hostApi: {
    sessions: {
      history: vi.fn().mockResolvedValue({ success: true, messages: [] }),
    },
    files: {
      resolveWorkspaceContext: vi.fn().mockResolvedValue({ ok: false }),
    },
    chat: {
      loadAcpSession: vi.fn().mockResolvedValue({ success: false }),
    },
  },
}));

vi.mock('@/lib/host-events', () => ({
  subscribeHostEvent: () => () => {},
  hostEvents: {
    onAcpSessionUpdate: () => () => {},
    onAcpPermissionRequest: () => () => {},
    onGatewayChatMessage: () => () => {},
    onChatRuntimeEvent: () => () => {},
  },
}));

vi.mock('@/stores/settings', () => ({
  useSettingsStore: (selector: (state: { devModeUnlocked: boolean; promptOptimizationEnabled: boolean }) => unknown) =>
    selector({ devModeUnlocked: false, promptOptimizationEnabled: false }),
}));

vi.mock('@/stores/artifact-panel', () => {
  const state = {
    open: false,
    widthPct: 45,
    openChanges: vi.fn(),
    openPreview: vi.fn(),
    close: vi.fn(),
  };
  return {
    useArtifactPanel: (selector: (value: typeof state) => unknown) => selector(state),
  };
});

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/hooks/use-stick-to-bottom-instant', () => ({
  useStickToBottomInstant: vi.fn(() => ({
    contentRef: { current: null },
    scrollRef: { current: null },
  })),
}));

vi.mock('@/hooks/use-min-loading', () => ({
  useMinLoading: () => false,
}));

vi.mock('@/pages/Chat/ChatToolbar', () => ({
  ChatToolbar: () => null,
}));

vi.mock('@/pages/Chat/ChatInput', () => ({
  ChatInput: () => null,
}));

vi.mock('@/pages/Chat/ChatMessage', () => ({
  ChatMessage: () => null,
}));

describe('office session default-agent retarget guard', () => {
  beforeEach(() => {
    vi.resetModules();
    gatewayRpcMock.mockReset();
    runtimeStatus.connectedAt = Date.now();
    agentsState.agents = [{ id: 'dev', name: 'Dev', isDefault: true }];
    agentsState.defaultAgentId = 'dev';
    agentsState.fetchAgents.mockReset();
    agentsState.fetchAgents.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('loadSessions keeps a legacy-main office session key when real agents are loaded', async () => {
    const { configureSidebarOfficeSessionVisibility } = await import('../../shared/internal-session');
    configureSidebarOfficeSessionVisibility(true);

    gatewayRpcMock.mockImplementation(async (method: string) => {
      if (method === 'sessions.list') {
        return {
          sessions: [
            { key: 'agent:dev:main', updatedAt: 1000 },
            { key: OFFICE_KEY, updatedAt: 5000 },
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
      currentSessionKey: OFFICE_KEY,
      currentAgentId: 'main',
      sessions: [{ key: OFFICE_KEY }],
      messages: [],
      sessionLabels: {},
      sessionLastActivity: {},
    });

    await useChatStore.getState().loadSessions();

    expect(useChatStore.getState().currentSessionKey).toBe(OFFICE_KEY);
  });

  it('Chat page does not retarget an empty office session to the default agent main session', async () => {
    const { useChatStore } = await import('@/stores/chat');
    useChatStore.setState({
      currentSessionKey: OFFICE_KEY,
      currentAgentId: 'main',
      sessions: [{ key: OFFICE_KEY }],
      messages: [],
      sending: false,
      loading: false,
      sessionLabels: {},
      sessionLastActivity: {},
      loadHistory: vi.fn(async () => {}),
    });

    const switchSessionSpy = vi.spyOn(useChatStore.getState(), 'switchSession');

    const { Chat } = await import('@/pages/Chat/index');
    render(<Chat />);

    await waitFor(() => {
      expect(agentsState.fetchAgents).toHaveBeenCalledWith({ reconcile: false });
    });

    expect(switchSessionSpy).not.toHaveBeenCalled();
    expect(useChatStore.getState().currentSessionKey).toBe(OFFICE_KEY);
  });
});
