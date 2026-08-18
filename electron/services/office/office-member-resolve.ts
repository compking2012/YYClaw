import { readAgentDisplayNamesFromConfig } from '../../utils/agent-config';
import {
  projectMembersFromIds,
  type AgentDisplayLookup,
} from '../../../src/lib/office-project-members';
import type { ProjectAgentRef } from '../../../src/lib/office-workflow-node';
import type { OfficeFixedGroup, OfficeTempProject } from './types';

let cachedLookup: AgentDisplayLookup | null = null;
let cacheAt = 0;
const LOOKUP_TTL_MS = 5_000;

export async function agentDisplayLookup(forceRefresh = false): Promise<AgentDisplayLookup> {
  const now = Date.now();
  if (!forceRefresh && cachedLookup && now - cacheAt < LOOKUP_TTL_MS) {
    return cachedLookup;
  }
  const snapshot = await readAgentDisplayNamesFromConfig();
  cachedLookup = (agentId: string) => snapshot.get(agentId) ?? agentId;
  cacheAt = now;
  return cachedLookup;
}

export async function membersForAgentIds(agentIds: string[]): Promise<ProjectAgentRef[]> {
  const lookup = await agentDisplayLookup();
  return projectMembersFromIds(agentIds, lookup);
}

export async function membersForProject(
  project: Pick<OfficeTempProject, 'agentIds'>,
): Promise<ProjectAgentRef[]> {
  return membersForAgentIds(project.agentIds);
}

export async function membersForFixedGroup(
  group: Pick<OfficeFixedGroup, 'agentIds'>,
): Promise<ProjectAgentRef[]> {
  return membersForAgentIds(group.agentIds);
}

export function findMember(
  members: ProjectAgentRef[],
  agentId: string | null | undefined,
): ProjectAgentRef | undefined {
  const id = agentId?.trim();
  if (!id) return undefined;
  return members.find((m) => m.agentId === id);
}
