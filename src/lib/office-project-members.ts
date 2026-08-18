import type { OfficeTempProject } from '@/types/office';
import type { ProjectAgentRef } from '@/lib/office-workflow-node';
import { normalizeAgentId } from '@/lib/agent-lookup';
import { displayAgentsForProject } from '@/lib/office-task-workflow';

export type AgentDisplayLookup = (agentId: string) => string | undefined;

export function projectMembersFromIds(
  agentIds: string[],
  lookupName: AgentDisplayLookup,
): ProjectAgentRef[] {
  return agentIds.map((agentId) => ({
    agentId,
    displayName: lookupName(agentId)?.trim() || agentId,
  }));
}

export function projectMembersForProject(
  project: Pick<OfficeTempProject, 'agentIds'>,
  lookupName: AgentDisplayLookup,
): ProjectAgentRef[] {
  return projectMembersFromIds(project.agentIds, lookupName);
}

/**
 * Agent ids shown / @-mentionable in an office project room:
 * edit-page members (`agentIds`) plus the marked coordinator (if any).
 * Scoped to the current project only — never union other groups/projects.
 *
 * Dedupes with `normalizeAgentId` (trim + lower-case) so casing variants of the
 * same agent (e.g. roster `PM` + coordinator `pm`) appear once — matching the
 * edit-page pool canonicalization intent.
 */
export function projectRoomParticipantIds(
  project: Pick<OfficeTempProject, 'agentIds' | 'coordinatorAgentId'> | null | undefined,
): string[] {
  if (!project) return [];
  const ids: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string | null | undefined) => {
    const id = (raw ?? '').trim();
    if (!id) return;
    const key = normalizeAgentId(id);
    if (!key || seen.has(key)) return;
    seen.add(key);
    ids.push(id);
  };
  for (const raw of project.agentIds ?? []) {
    push(raw);
  }
  push(project.coordinatorAgentId);
  return ids;
}

export function projectRoomParticipants(
  project: Pick<OfficeTempProject, 'agentIds' | 'coordinatorAgentId'> | null | undefined,
  lookupName: AgentDisplayLookup,
): ProjectAgentRef[] {
  return projectMembersFromIds(projectRoomParticipantIds(project), lookupName);
}

/**
 * Room member strip / @ candidates for the open project chat.
 * Matches the project edit-page roster, including fixed-group template inheritance.
 */
export function resolveProjectRoomParticipants(
  project:
    | Parameters<typeof displayAgentsForProject>[0]
    | null
    | undefined,
  group: Parameters<typeof displayAgentsForProject>[1],
  lookupName: AgentDisplayLookup,
): ProjectAgentRef[] {
  if (!project) return [];
  const display = displayAgentsForProject(project, group);
  return projectRoomParticipants(
    {
      agentIds: display.agentIds ?? [],
      coordinatorAgentId: display.coordinatorAgentId,
    },
    lookupName,
  );
}

export function agentMentionToken(member: Pick<ProjectAgentRef, 'agentId' | 'displayName'>): string {
  return member.displayName.trim() || member.agentId;
}
