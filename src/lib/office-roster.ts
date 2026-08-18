import type { AgentSummary } from '@/types/agent';
import type { ProjectAgentRef } from '@/lib/office-workflow-node';

export interface OfficeRosterEntry {
  agentId: string;
  agent: AgentSummary;
  member: ProjectAgentRef | null;
}

/**
 * 名册：每个已绑定 Agent 一张卡片；未纳入任何编制的客户端 Agent 单独占「待添加」卡片。
 */
export function buildOfficeRoster(
  agents: AgentSummary[],
  members: ProjectAgentRef[],
): OfficeRosterEntry[] {
  const agentById = new Map(agents.map((a) => [a.id, a]));
  const agentIdsWithMember = new Set(members.map((m) => m.agentId.trim()).filter(Boolean));

  const memberEntries: OfficeRosterEntry[] = members.map((member) => {
    const agent = agentById.get(member.agentId) ?? agentSummaryFromMember(member);
    return { agentId: member.agentId, agent, member };
  });

  const unboundAgents: OfficeRosterEntry[] = agents
    .filter((a) => !agentIdsWithMember.has(a.id))
    .map((agent) => ({
      agentId: agent.id,
      agent,
      member: null,
    }));

  return [...memberEntries, ...unboundAgents].sort(compareRosterEntries);
}

function compareRosterEntries(a: OfficeRosterEntry, b: OfficeRosterEntry): number {
  if (a.agent.isDefault && !b.agent.isDefault) return -1;
  if (!a.agent.isDefault && b.agent.isDefault) return 1;
  const nameA = a.member?.displayName ?? a.agent.name;
  const nameB = b.member?.displayName ?? b.agent.name;
  return nameA.localeCompare(nameB, 'zh');
}

function agentSummaryFromMember(member: ProjectAgentRef): AgentSummary {
  return {
    id: member.agentId,
    name: member.displayName,
    isDefault: false,
    modelDisplay: '—',
    modelRef: null,
    overrideModelRef: null,
    inheritedModel: false,
    workspace: '',
    agentDir: '',
    mainSessionKey: '',
    channelTypes: [],
  };
}
