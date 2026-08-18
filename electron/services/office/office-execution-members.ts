import { normalizeTeamMember, type LegacyTeamMember } from '../../../src/lib/office-agent-id-resolve';
import { projectMembersFromIds } from '../../../src/lib/office-project-members';
import type { OfficeExecutionMember, OfficeFixedGroup, OfficeTempProject } from './types';
import { resolveProjectCoordinatorAgentId } from './task-coordinator';
import { agentDisplayLookup } from './office-member-resolve';

export async function loadProjectExecutionMembers(
  project: Pick<OfficeTempProject, 'agentIds'>,
): Promise<OfficeExecutionMember[]> {
  const lookup = await agentDisplayLookup();
  return projectMembersFromIds(project.agentIds, lookup).map((m) => ({
    agentId: m.agentId,
    displayName: m.displayName,
    emoji: '🤖',
  }));
}

export function resolveRoomCoordinatorMember(
  group: Pick<OfficeFixedGroup, 'coordinatorAgentId' | 'agentIds'>,
  teamMembers: OfficeExecutionMember[],
  project?: Pick<OfficeTempProject, 'coordinatorAgentId' | 'agentIds'> | null,
  fallback?: OfficeExecutionMember,
): OfficeExecutionMember | null {
  const coordId = project
    ? resolveProjectCoordinatorAgentId(project, group)
    : group.coordinatorAgentId;
  return (
    teamMembers.find((m) => m.agentId === coordId)
    ?? fallback
    ?? teamMembers.find((m) => group.agentIds.includes(m.agentId))
    ?? null
  );
}

export function executionMemberLabel(member: OfficeExecutionMember | LegacyTeamMember): string {
  const ref = normalizeTeamMember(member);
  return ref.displayName || ref.agentId;
}
