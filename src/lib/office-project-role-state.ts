import {
  agentIdsWorkingFromRoom,
  agentIdsWorkingFromTasks,
} from '@/lib/office-scenario-role-activity';
import type { OfficeFixedGroup, OfficeTempProject, RoomMessage } from '@/types/office';

/** Per-agent presence in a project (derived from task progress + project room). */
export type AgentWorkState = 'idle' | 'working';

/** @deprecated Use AgentWorkState */
export type RoleWorkState = AgentWorkState;

export type ProjectAgentStateMap = Record<string, AgentWorkState>;

/** @deprecated Use ProjectAgentStateMap */
export type ProjectRoleStateMap = ProjectAgentStateMap;

export type ProjectAgentStateCache = Record<string, ProjectAgentStateMap>;

/** @deprecated Use ProjectAgentStateCache */
export type ProjectRoleStateCache = ProjectAgentStateCache;

/** Active projects: reconcile cached agent states with room + task every 2s. */
export const PROJECT_AGENT_STATE_RECONCILE_MS = 2_000;

/** @deprecated Use PROJECT_AGENT_STATE_RECONCILE_MS */
export const PROJECT_ROLE_STATE_RECONCILE_MS = PROJECT_AGENT_STATE_RECONCILE_MS;

/** Derive idle/working for each team agent on one project. */
export function deriveProjectAgentStates(
  group: Pick<OfficeFixedGroup, 'id' | 'agentIds' | 'workflow'>,
  project: OfficeTempProject,
  projectRoomMessages: RoomMessage[],
): ProjectAgentStateMap {
  const teamAgentIds = new Set<string>(group.agentIds);
  const fromTasks = agentIdsWorkingFromTasks(group, [project], projectRoomMessages);
  const fromRoom = agentIdsWorkingFromRoom(teamAgentIds, projectRoomMessages);
  const out: ProjectAgentStateMap = {};
  for (const agentId of group.agentIds) {
    out[agentId] = fromTasks.has(agentId) || fromRoom.has(agentId) ? 'working' : 'idle';
  }
  return out;
}

/** @deprecated Use deriveProjectAgentStates */
export const deriveProjectRoleStates = deriveProjectAgentStates;

/** Update cache entries for active project ids (room + task reconciled). */
export function reconcileActiveProjectAgentState(
  group: OfficeFixedGroup,
  projects: OfficeTempProject[],
  roomMessagesByProject: Record<string, RoomMessage[]>,
  activeProjectIds: readonly string[],
  prev: ProjectAgentStateCache,
): ProjectAgentStateCache {
  const next: ProjectAgentStateCache = { ...prev };
  for (const projectId of activeProjectIds) {
    const project = projects.find((p) => p.id === projectId);
    if (!project || project.parentGroupId !== group.id) continue;
    const room = roomMessagesByProject[projectId] ?? [];
    next[projectId] = deriveProjectAgentStates(group, project, room);
  }
  return next;
}

/** @deprecated Use reconcileActiveProjectAgentState */
export const reconcileActiveProjectRoleState = reconcileActiveProjectAgentState;

function statesForGroupProject(
  group: OfficeFixedGroup,
  project: OfficeTempProject,
  roomMessagesByProject: Record<string, RoomMessage[]>,
  cache: ProjectAgentStateCache,
): ProjectAgentStateMap {
  return (
    cache[project.id]
    ?? deriveProjectAgentStates(group, project, roomMessagesByProject[project.id] ?? [])
  );
}

/** Agents in working state on any project in the team (any task, any project). */
export function teamAgentIdsWorkingInGroup(
  group: OfficeFixedGroup,
  projects: OfficeTempProject[],
  roomMessagesByProject: Record<string, RoomMessage[]>,
  cache: ProjectAgentStateCache,
): Set<string> {
  const working = new Set<string>();
  for (const project of projects) {
    if (project.parentGroupId !== group.id) continue;
    const states = statesForGroupProject(group, project, roomMessagesByProject, cache);
    for (const agentId of group.agentIds) {
      if (states[agentId] === 'working') working.add(agentId);
    }
  }
  return working;
}

/** @deprecated Use teamAgentIdsWorkingInGroup */
export const teamRoleIdsWorkingInScenario = teamAgentIdsWorkingInGroup;
