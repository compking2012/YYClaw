import { ensureCoordinatorInTeam } from '@/lib/office-workflow-roles';
import { resolveTeamAgentId, type LegacyTeamMember } from '@/lib/office-agent-id-resolve';
import type { OfficeFixedGroup, OfficeTempProject } from '@/types/office';

export function resolveProjectCoordinatorAgentId(
  project: Pick<OfficeTempProject, 'coordinatorAgentId' | 'agentIds'>,
  group?: Pick<OfficeFixedGroup, 'agentIds' | 'coordinatorAgentId'> | null,
): string {
  const agentIds = project.agentIds ?? [];
  const fromProject = project.coordinatorAgentId?.trim();
  if (fromProject && agentIds.includes(fromProject)) return fromProject;
  if (group) {
    const groupAgentIds = group.agentIds ?? [];
    return ensureCoordinatorInTeam(
      group.coordinatorAgentId?.trim(),
      agentIds.length > 0 ? agentIds : groupAgentIds,
      group.coordinatorAgentId,
    );
  }
  return ensureCoordinatorInTeam(
    fromProject ?? '',
    agentIds,
    agentIds[0],
  );
}

type LegacyTaskCoordinatorInput = {
  coordinatorRoleId?: string;
  coordinatorAgentId?: string;
  assignedRoleIds?: string[];
  agentIds?: string[];
};

type LegacyScenarioCoordinatorInput = {
  coordinatorRoleId?: string;
  coordinatorAgentId?: string;
  roleIds?: string[];
  agentIds?: string[];
};

/** @deprecated Use resolveProjectCoordinatorAgentId */
export function resolveTaskCoordinatorRoleId(
  task: LegacyTaskCoordinatorInput,
  scenario?: LegacyScenarioCoordinatorInput | null,
  teamRoles: LegacyTeamMember[] = [],
): string {
  const agentIds = (task.agentIds ?? task.assignedRoleIds ?? []).map((id) =>
    resolveTeamAgentId(teamRoles, id),
  );
  const projectCoord = resolveTeamAgentId(
    teamRoles,
    task.coordinatorAgentId ?? task.coordinatorRoleId,
  );
  const project: Pick<OfficeTempProject, 'coordinatorAgentId' | 'agentIds'> = {
    coordinatorAgentId: projectCoord,
    agentIds,
  };
  const groupAgentIds = (scenario?.agentIds ?? scenario?.roleIds ?? []).map((id) =>
    resolveTeamAgentId(teamRoles, id),
  );
  const group = scenario
    ? {
        coordinatorAgentId: resolveTeamAgentId(
          teamRoles,
          scenario.coordinatorAgentId ?? scenario.coordinatorRoleId,
        ),
        agentIds: groupAgentIds,
      }
    : null;
  return resolveProjectCoordinatorAgentId(project, group);
}
