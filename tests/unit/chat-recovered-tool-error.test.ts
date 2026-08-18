import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const { gatewayRpcMock, hostApiFetchMock, agentsState } = vi.hoisted(() => ({
  gatewayRpcMock: vi.fn(),
  hostApiFetchMock: vi.fn(),
  agentsState: {
    agents: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: {
    getState: () => ({
      status: { state: 'running', port: 18789 },
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
  hostApiFetch: (...args: unknown[]) => hostApiFetchMock(...args),
}));

/**
 * Covers the "agent recovered, don't report it as an error" rule: a run
 * whose only failure is isolated to its closing step (final wrap-up reply,
 * or a lifecycle `phase: error` notification) must not surface `error`/
 * `runError` when the run already produced usable output — a completed
 * tool result, or real assistant reply text. Only a run that produced
 * nothing usable (truly blocked) should still report an error.
 */
describe('chat store: recovered vs blocking failures', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    window.localStorage.clear();
    gatewayRpcMock.mockReset();
    hostApiFetchMock.mockReset();
    agentsState.agents = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const baseState = {
    currentSessionKey: 'agent:main:main',
    currentAgentId: 'main',
    sessions: [{ key: 'agent:main:main' }],
    messages: [],
    sessionLabels: {},
    sessionLastActivity: {},
    sending: false,
    activeRunId: null as string | null,
    streamingText: '',
    streamingMessage: null as unknown,
    streamingTools: [] as unknown[],
    pendingFinal: false,
    lastUserMessageAt: null as number | null,
    pendingToolImages: [],
    error: null as string | null,
    runError: null as string | null,
    loading: false,
    thinkingLevel: null,
  };

  describe('handleChatEvent state=error', () => {
    it('does not surface a banner when a tool already succeeded before the closing error', async () => {
      const { useChatStore } = await import('@/stores/chat');
      useChatStore.setState({
        ...baseState,
        streamingTools: [{ name: 'lark-cli', status: 'completed', updatedAt: 1 }],
      });

      useChatStore.getState().handleChatEvent({
        state: 'error',
        runId: 'run-recovered',
        sessionKey: 'agent:main:main',
        errorMessage: '403 This token has no access to model GLM52',
      });

      const next = useChatStore.getState();
      expect(next.error).toBeNull();
      expect(next.runError).toBeNull();
      expect(next.sending).toBe(false);
    });

    it('does not surface a banner when the run already streamed real reply text', async () => {
      const { useChatStore } = await import('@/stores/chat');
      useChatStore.setState({
        ...baseState,
        streamingText: '游戏已经生成好了！部署完成。',
      });

      useChatStore.getState().handleChatEvent({
        state: 'error',
        runId: 'run-text-recovered',
        sessionKey: 'agent:main:main',
        errorMessage: 'stream closed unexpectedly',
      });

      const next = useChatStore.getState();
      expect(next.error).toBeNull();
      expect(next.runError).toBeNull();
    });

    it('still surfaces the error when the run produced no usable output at all', async () => {
      const { useChatStore } = await import('@/stores/chat');
      useChatStore.setState({
        ...baseState,
        streamingTools: [],
        streamingText: '',
        streamingMessage: null,
      });

      useChatStore.getState().handleChatEvent({
        state: 'error',
        runId: 'run-blocked',
        sessionKey: 'agent:main:main',
        errorMessage: '403 This token has no access to model GLM52',
      });

      const next = useChatStore.getState();
      expect(next.error).toBe('403 This token has no access to model GLM52');
      expect(next.runError).toBeNull();
    });

    it('a plain conversational turn with no tool calls is not penalized for lacking a tool result', async () => {
      const { useChatStore } = await import('@/stores/chat');
      useChatStore.setState({
        ...baseState,
        streamingTools: [],
        streamingMessage: { role: 'assistant', content: [{ type: 'text', text: 'Hello! I am GLM-5.2.' }] },
      });

      useChatStore.getState().handleChatEvent({
        state: 'error',
        runId: 'run-hello',
        sessionKey: 'agent:main:main',
        errorMessage: 'transient hiccup after reply',
      });

      const next = useChatStore.getState();
      expect(next.error).toBeNull();
      expect(next.runError).toBeNull();
    });
  });

  describe('handleRuntimeEvent run.ended status=error', () => {
    it('clears state immediately without the grace-period banner when a tool already succeeded', async () => {
      const { useChatStore } = await import('@/stores/chat');
      useChatStore.setState({
        ...baseState,
        sending: true,
        activeRunId: 'run-recovered-2',
        streamingTools: [{ name: 'lark-cli', status: 'completed', updatedAt: 1 }],
      });

      useChatStore.getState().handleRuntimeEvent({
        type: 'run.ended',
        runId: 'run-recovered-2',
        sessionKey: 'agent:main:main',
        status: 'error',
        error: 'lark-cli auth qrcode ... failed',
      });

      // No grace-period timer should even be pending — the failure was
      // classified as recovered synchronously.
      vi.advanceTimersByTime(20_000);

      const next = useChatStore.getState();
      expect(next.error).toBeNull();
      expect(next.runError).toBeNull();
      expect(next.sending).toBe(false);
      expect(next.activeRunId).toBeNull();
    });

    it('commits the banner after the grace period when nothing usable was produced', async () => {
      const { useChatStore } = await import('@/stores/chat');
      useChatStore.setState({
        ...baseState,
        sending: true,
        activeRunId: 'run-blocked-2',
        streamingTools: [],
        streamingText: '',
        streamingMessage: null,
      });

      useChatStore.getState().handleRuntimeEvent({
        type: 'run.ended',
        runId: 'run-blocked-2',
        sessionKey: 'agent:main:main',
        status: 'error',
        error: 'model unavailable',
      });

      // Immediately after the event, the banner is still withheld (grace period).
      expect(useChatStore.getState().runError).toBeNull();

      vi.advanceTimersByTime(20_000);

      const next = useChatStore.getState();
      expect(next.runError).toBe('model unavailable');
    });
  });
});
