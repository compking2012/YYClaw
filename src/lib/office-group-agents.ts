import { ensureCoordinatorInTeam } from '@/lib/office-workflow-roles';
import type { AgentSummary } from '@/types/agent';

export function filterKnownAgentIds(
  agentIds: string[],
  agents: Pick<AgentSummary, 'id'>[],
): string[] {
  const known = new Set(agents.map((a) => a.id));
  return agentIds.filter((id) => known.has(id));
}

/** 协调者排最前，其余按显示名排序。 */
export function orderedBoundAgentIds(
  agentIds: string[],
  coordinatorAgentId: string,
  agents: Pick<AgentSummary, 'id' | 'name'>[],
): string[] {
  const coordinator = ensureCoordinatorInTeam(
    coordinatorAgentId,
    agentIds,
    agentIds[0] ?? '',
  );
  const label = (id: string) =>
    agents.find((a) => a.id === id)?.name?.trim() || id;
  const rest = agentIds
    .filter((id) => id !== coordinator)
    .sort((a, b) => label(a).localeCompare(label(b), undefined, { sensitivity: 'base' }));
  return coordinator ? [coordinator, ...rest] : rest;
}

export function agentDisplayName(
  agentId: string,
  agents: Pick<AgentSummary, 'id' | 'name'>[],
): string {
  return agents.find((a) => a.id === agentId)?.name?.trim() || agentId;
}
