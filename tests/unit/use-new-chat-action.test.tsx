import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { agentsState, chatState, navigateMock, settingsState } = vi.hoisted(() => ({
  agentsState: {
    agents: [] as Array<{ id: string; workspace: string }>,
    defaultAgentId: '',
  },
  chatState: {
    currentSessionKey: 'agent:main:main',
    sessions: [] as Array<{ key: string; workspacePath?: string; createdLocally?: boolean }>,
    newSession: vi.fn(),
  },
  navigateMock: vi.fn(),
  settingsState: {
    chatWorkspacePath: '~/.openclaw/workspace',
    setChatWorkspacePath: vi.fn(),
  },
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

vi.mock('@/stores/agents', () => {
  const useAgentsStore = Object.assign(
    (selector: (state: typeof agentsState) => unknown) => selector(agentsState),
    { getState: () => agentsState },
  );
  return { useAgentsStore };
});

vi.mock('@/stores/chat', () => {
  const useChatStore = Object.assign(
    (selector: (state: typeof chatState) => unknown) => selector(chatState),
    { getState: () => chatState },
  );
  return { useChatStore };
});

vi.mock('@/stores/settings', () => {
  const useSettingsStore = Object.assign(
    (selector: (state: typeof settingsState) => unknown) => selector(settingsState),
    { getState: () => settingsState },
  );
  return { useSettingsStore };
});

describe('useNewChatAction', () => {
  beforeEach(() => {
    agentsState.agents = [{ id: 'main', workspace: '~/.openclaw/workspace' }];
    agentsState.defaultAgentId = 'main';
    chatState.messages = [];
    chatState.currentSessionKey = 'agent:main:main';
    chatState.sessions = [];
    chatState.newSession.mockReset();
    settingsState.chatWorkspacePath = '~/.openclaw/workspace';
    settingsState.setChatWorkspacePath.mockReset();
    navigateMock.mockReset();
  });

  it('starts a fresh local chat on the default agent workspace', async () => {
    const { useNewChatAction } = await import('@/components/layout/use-new-chat-action');
    const { result } = renderHook(() => useNewChatAction());

    act(() => result.current());

    expect(settingsState.setChatWorkspacePath).toHaveBeenCalledWith('~/.openclaw/workspace');
    expect(chatState.newSession).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith('/');
  });

  it('resets to the default agent workspace instead of inheriting the selected conversation', async () => {
    agentsState.agents = [{ id: 'main', workspace: '/Users/e2e/default-agent-workspace' }];
    agentsState.defaultAgentId = 'main';
    chatState.currentSessionKey = 'agent:writer:session-a';
    chatState.sessions = [{
      key: chatState.currentSessionKey,
      workspacePath: '/Users/e2e/workspace/ClawX',
    }];

    const { useNewChatAction } = await import('@/components/layout/use-new-chat-action');
    const { result } = renderHook(() => useNewChatAction());

    act(() => result.current());

    expect(settingsState.setChatWorkspacePath).toHaveBeenCalledWith('/Users/e2e/default-agent-workspace');
    expect(chatState.newSession).toHaveBeenCalledTimes(1);
    expect(navigateMock).toHaveBeenCalledWith('/');
  });
});
