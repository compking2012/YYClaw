import type { AgentSummary } from '@/types/agent';

export function normalizeAgentId(value?: string): string {
  return (value || '').trim().toLowerCase();
}

/** Keep only agent ids that exist in the current catalog (drops stale/orphan ids). */
export function resolveAgentIdSelection(
  agentIds: string[],
  availableAgents: AgentSummary[],
): string[] {
  const catalogIds = new Set(availableAgents.map((agent) => normalizeAgentId(agent.id)));
  const resolved = new Set<string>();
  for (const id of agentIds) {
    const normalized = normalizeAgentId(id);
    if (normalized && catalogIds.has(normalized)) {
      resolved.add(normalized);
    }
  }
  return [...resolved];
}

export function countSelectedCatalogAgents(
  availableAgents: AgentSummary[],
  selectedAgentIds: Iterable<string>,
): number {
  return resolveAgentIdSelection([...selectedAgentIds], availableAgents).length;
}

export function isCatalogAgentSelected(
  agent: AgentSummary,
  selectedAgentIds: string[],
  availableAgents: AgentSummary[],
): boolean {
  const selected = new Set(resolveAgentIdSelection(selectedAgentIds, availableAgents));
  return selected.has(normalizeAgentId(agent.id));
}

export function sortAgentIds(ids: string[]): string[] {
  return [...ids].sort();
}

export function normalizeAgentIdsForPersist(
  selectedAgentIds: string[],
  availableAgents: AgentSummary[],
): string[] {
  return sortAgentIds(resolveAgentIdSelection(selectedAgentIds, availableAgents));
}

export function agentIdsSelectionChanged(
  selectedAgentIds: string[],
  storedAgentIds: string[],
  availableAgents: AgentSummary[],
): boolean {
  const selectedPersisted = normalizeAgentIdsForPersist(selectedAgentIds, availableAgents);
  const storedResolved = normalizeAgentIdsForPersist(storedAgentIds, availableAgents);
  if (selectedPersisted.join('\0') !== storedResolved.join('\0')) {
    return true;
  }
  const rawFingerprint = sortAgentIds(storedAgentIds.map(normalizeAgentId)).join('\0');
  const persistedFingerprint = sortAgentIds(selectedPersisted.map(normalizeAgentId)).join('\0');
  return rawFingerprint !== persistedFingerprint;
}
