/** @deprecated Role-based agent picker removed in Office v2. Use AgentPoolPicker instead. */
export function RoleAgentPicker(_props: {
  agents?: unknown[];
  value?: string;
  onChange?: (agentId: string) => void;
  disabled?: boolean;
  boundAgentHint?: string | null;
}): null {
  return null;
}

export function resolveRoleNameFromAgent(
  agents: Array<{ id: string; name: string }>,
  agentId: string,
  fallback: string,
): string {
  if (!agentId.trim()) return fallback;
  return agents.find((a) => a.id === agentId)?.name ?? fallback;
}
