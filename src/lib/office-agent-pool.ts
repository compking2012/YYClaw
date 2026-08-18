import { normalizeAgentId } from '@/lib/agent-lookup';
import { orderedBoundAgentIds } from '@/lib/office-group-agents';
import { isAgentBoundElsewhere } from '@/lib/office-agent-binding-label';
import type { AgentSummary } from '@/types/agent';
import type { AgentBindingRecord } from '@/types/office';

function catalogIdByNormalized(agents: Pick<AgentSummary, 'id'>[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const agent of agents) {
    const key = normalizeAgentId(agent.id);
    if (key) map.set(key, agent.id);
  }
  return map;
}

/** Keep selection order; drop unknown ids; map to catalog casing. */
export function canonicalizeSelectedAgentIds(
  selectedAgentIds: string[],
  agents: Pick<AgentSummary, 'id'>[],
): string[] {
  const catalog = catalogIdByNormalized(agents);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of selectedAgentIds) {
    const canonical = catalog.get(normalizeAgentId(id));
    if (!canonical) continue;
    const key = normalizeAgentId(canonical);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(canonical);
  }
  return out;
}

export function isAgentIdSelected(
  agentId: string,
  selectedAgentIds: string[],
): boolean {
  const key = normalizeAgentId(agentId);
  return selectedAgentIds.some((id) => normalizeAgentId(id) === key);
}

export function removeAgentFromSelection(
  selectedAgentIds: string[],
  agentId: string,
): string[] {
  const key = normalizeAgentId(agentId);
  return selectedAgentIds.filter((id) => normalizeAgentId(id) !== key);
}

export function partitionAgentPoolLists(input: {
  selectedAgentIds: string[];
  coordinatorAgentId: string;
  agents: AgentSummary[];
  agentBindings?: Record<string, AgentBindingRecord>;
  bindingScope?: { entityId: string };
}): { boundIds: string[]; availableIds: string[] } {
  const selected = canonicalizeSelectedAgentIds(input.selectedAgentIds, input.agents);
  const coordinator = input.coordinatorAgentId;
  const boundIds = orderedBoundAgentIds(selected, coordinator, input.agents);
  const availableIds = [...input.agents]
    .sort((a, b) => {
      const an = a.name?.trim() || a.id;
      const bn = b.name?.trim() || b.id;
      return an.localeCompare(bn, undefined, { sensitivity: 'base' });
    })
    .map((agent) => agent.id)
    .filter(
      (id) =>
        !isAgentIdSelected(id, selected)
        && !isAgentBoundElsewhere(id, input.agentBindings, input.bindingScope),
    );
  return { boundIds, availableIds };
}
