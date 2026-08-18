import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAgentsStore } from '@/stores/agents';
import { useChatStore } from '@/stores/chat';
import { useSettingsStore } from '@/stores/settings';

export function useNewChatAction(): () => void {
  const navigate = useNavigate();
  const newSession = useChatStore((state) => state.newSession);
  const setChatWorkspacePath = useSettingsStore((state) => state.setChatWorkspacePath);

  return useCallback(() => {
    // New Chat opens under the default agent; use that agent's own workspace.
    const { defaultAgentId, agents } = useAgentsStore.getState();
    const agentId = defaultAgentId || agents[0]?.id;
    const workspace = agentId
      ? agents.find((agent) => agent.id === agentId)?.workspace?.trim()
      : undefined;
    if (workspace) {
      setChatWorkspacePath(workspace);
    }

    newSession();
    navigate('/');
  }, [navigate, newSession, setChatWorkspacePath]);
}
