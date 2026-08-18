import type { ProjectAgentRef } from '@/lib/office-workflow-node';
import { isRoomFastAckSuperseded } from '@/lib/office-room-fast-ack';
import { inferPhaseFromRoleReplyContent } from '@/lib/office-mention-task-sync';
import { deriveTaskProgressSync } from '@/lib/office-task-progress-sync';
import { workflowForProject, workflowForTask } from '@/lib/office-task-workflow';
import { workflowNodeAgentIds } from '@/lib/office-workflow-node';
import {
  isLegacyMisleadingGatewayAbortProgressText,
  isWorkflowUpstreamReworkProgressText,
} from '@/lib/office-workflow-node-run-settled';
import { nodeRunStatusFromRoomPhase } from '@/lib/task-room-progress-reconcile';
import type { OfficeProjectLight } from '@/lib/office-project-status-light';
import type {
  NodeRunStatus,
  OfficeFixedGroup,
  OfficeTempProject,
  RoomMessage,
  RoomMessagePhase,
} from '@/types/office';

export type RoleActivitySource = 'task' | 'room' | 'both';

export type ScenarioAgentActivity = {
  agentId: string;
  working: boolean;
  source?: RoleActivitySource;
  projectId?: string;
};

/** @deprecated Use ScenarioAgentActivity */
export type ScenarioRoleActivity = ScenarioAgentActivity;

function effectiveRoomPhase(message: RoomMessage): RoomMessagePhase | null {
  const body = (message.progressText ?? message.content ?? '').trim();
  let phase = message.phase ?? null;
  if (!phase && message.fromAgentId && message.from !== 'user' && message.from !== 'system' && body) {
    phase = inferPhaseFromRoleReplyContent(body);
  }
  return phase;
}

function roomPhaseImpliesWorking(phase: RoomMessagePhase): boolean {
  return nodeRunStatusFromRoomPhase(phase) === 'running';
}

/** Latest team-room line per agent decides idle vs in-progress (deliver/handoff = not working). */
export function agentIdsWorkingFromRoom(
  teamAgentIds: ReadonlySet<string>,
  roomMessages: RoomMessage[],
): Map<string, { projectId?: string }> {
  const latestByAgent = new Map<string, RoomMessage>();

  for (const m of roomMessages) {
    if (!m.fromAgentId || !teamAgentIds.has(m.fromAgentId)) continue;
    if (m.from === 'user' || m.from === 'system') continue;
    const prev = latestByAgent.get(m.fromAgentId);
    if (!prev || m.timestamp >= prev.timestamp) {
      latestByAgent.set(m.fromAgentId, m);
    }
  }

  const out = new Map<string, { projectId?: string }>();
  for (const [agentId, msg] of latestByAgent) {
    const phase = effectiveRoomPhase(msg);
    if (!phase || !roomPhaseImpliesWorking(phase)) continue;
    out.set(agentId, { projectId: msg.projectId });
  }
  return out;
}

/** @deprecated Use agentIdsWorkingFromRoom */
export const roleIdsWorkingFromRoom = agentIdsWorkingFromRoom;

/** Agents on in-flight workflow steps (project nodeRuns merged with room phases). */
export function agentIdsWorkingFromTasks(
  group: Pick<OfficeFixedGroup, 'workflow' | 'id'>,
  projects: OfficeTempProject[],
  roomMessages: RoomMessage[],
): Map<string, { projectId?: string }> {
  const out = new Map<string, { projectId?: string }>();
  for (const project of projects) {
    if (project.parentGroupId !== group.id) continue;
    const workflowNodes = workflowForTask(project, group).nodes;
    if (workflowNodes.length === 0) continue;
    const projectRoom = roomMessages.filter((m) => m.projectId === project.id);

    const sync = deriveTaskProgressSync(project, workflowNodes, projectRoom);

    workflowNodes.forEach((node, stepIndex) => {
      const step = sync.steps[stepIndex];
      const running =
        step?.status === 'running'
        || project.nodeRuns.find((r) => r.nodeId === node.id)?.status === 'running';
      if (!running) return;
      for (const agentId of workflowNodeAgentIds(node)) {
        if (!out.has(agentId)) {
          out.set(agentId, { projectId: project.id });
        }
      }
    });
  }

  return out;
}

/** @deprecated Use agentIdsWorkingFromTasks */
export const roleIdsWorkingFromTasks = agentIdsWorkingFromTasks;

/**
 * Per-agent status light within a single project (group-chat agent dots).
 * Mapping (aligned with officeProjectStatusLight palette): 运行中=running(绿),
 * 已完成=completed(蓝), 中止=aborted(黄), 失败=failed(红), 待执行=pending(灰).
 * `running` takes precedence over `completed` so a reopened (re-activated) node goes green again.
 */
function agentLightFromNodeStatuses(
  statuses: ReadonlySet<NodeRunStatus>,
  projectStatus: OfficeTempProject['status'],
): OfficeProjectLight {
  if (statuses.has('running')) return 'running';
  if (statuses.has('failed')) return 'failed';
  if (statuses.has('pending')) return projectStatus === 'aborted' ? 'aborted' : 'pending';
  if (statuses.has('completed')) return 'completed';
  return projectStatus === 'aborted' ? 'aborted' : 'pending';
}

const IN_FLIGHT_ROOM_PHASES = new Set<RoomMessagePhase>([
  'task_received',
  'task_understanding',
  'task_running',
  'task_clarification',
  'task_team_review',
]);

function roomProgressTextTerminalStatus(
  progressText: string | undefined,
): 'completed' | 'failed' | null {
  const t = (progressText ?? '').trim();
  if (!t) return null;
  if (t === '执行完成' || t.startsWith('执行完成')) return 'completed';
  // 回流短终态：业务控制流，不得按失败染红
  if (isWorkflowUpstreamReworkProgressText(t)) return null;
  if (t.includes('执行失败')) return 'failed';
  return null;
}

function nodeStatusForRoomMessagePhase(phase: RoomMessagePhase): NodeRunStatus {
  if (phase === 'task_received') return 'pending';
  return nodeRunStatusFromRoomPhase(phase);
}

/**
 * Per-message status light for group-chat bubble tint.
 * Colors follow the message's own task (phase / progressText / nodeId), not the agent's latest
 * project-wide state — so prior completed steps stay blue when the same agent starts a new step.
 */
export function deriveRoomMessageAgentLight(
  message: RoomMessage,
  project: OfficeTempProject,
  group: Pick<OfficeFixedGroup, 'workflow' | 'id'> | null | undefined,
  projectRoomMessages?: ReadonlyArray<RoomMessage>,
): OfficeProjectLight | undefined {
  if (!message.fromAgentId || message.from === 'user' || message.from === 'system') {
    return undefined;
  }

  if (
    projectRoomMessages
    && projectRoomMessages.length > 0
    && isRoomFastAckSuperseded(message, projectRoomMessages)
  ) {
    return 'completed';
  }

  const progressTerminal = roomProgressTextTerminalStatus(message.progressText);
  if (progressTerminal === 'completed') return 'completed';
  if (progressTerminal === 'failed') {
    // Legacy false-positive abort copy after room_heal 回流: if node is already
    // pending again, do not keep the bubble red.
    if (
      isLegacyMisleadingGatewayAbortProgressText(message.progressText)
      && message.nodeId
    ) {
      const run = project.nodeRuns.find((r) => r.nodeId === message.nodeId);
      if (run?.status === 'pending') {
        return agentLightFromNodeStatuses(new Set(['pending']), project.status);
      }
    }
    return 'failed';
  }
  // 回流短终态：进度卡已结束本轮执行，按 pending（等上游）着色，勿沿用 task_running→绿
  if (isWorkflowUpstreamReworkProgressText(message.progressText)) {
    return agentLightFromNodeStatuses(new Set(['pending']), project.status);
  }

  const phase = effectiveRoomPhase(message);
  let status: NodeRunStatus | null = phase ? nodeStatusForRoomMessagePhase(phase) : null;

  // When the consolidated progress line is still in-flight phase but this node's run already
  // finished, tint from the node scoped to this message (not other nodes for the same agent).
  if (message.nodeId && phase && IN_FLIGHT_ROOM_PHASES.has(phase)) {
    const run = project.nodeRuns.find((r) => r.nodeId === message.nodeId);
    if (run?.status === 'failed') status = 'failed';
    else if (run?.status === 'completed' && phase !== 'task_received') status = 'completed';
  }

  if (status) {
    return agentLightFromNodeStatuses(new Set([status]), project.status);
  }

  if (message.nodeId) {
    const run = project.nodeRuns.find((r) => r.nodeId === message.nodeId);
    const nodeStatus: NodeRunStatus = run?.status ?? 'pending';
    return agentLightFromNodeStatuses(new Set([nodeStatus]), project.status);
  }

  return project.status === 'aborted' ? 'aborted' : 'pending';
}

/**
 * Final bubble tint for Office group chat.
 * Coordinator chatter stays completed (blue) by default, but never overrides an explicit
 * failure progress line (`执行失败…`) — otherwise gateway-abort failures on a coordinator-run
 * node would incorrectly show blue while the project card step is red.
 */
export function resolveOfficeRoomBubbleLight(params: {
  message: RoomMessage;
  coordinatorAgentId?: string | null;
  isCoordinatorMessage: boolean;
  project: OfficeTempProject | null | undefined;
  group: Pick<OfficeFixedGroup, 'workflow' | 'id'> | null | undefined;
  projectRoomMessages?: ReadonlyArray<RoomMessage>;
}): OfficeProjectLight | undefined {
  const { message, project, group, projectRoomMessages, isCoordinatorMessage } = params;
  if (message.from === 'system') return 'completed';
  if (message.from === 'user' || !message.fromAgentId || !project) return undefined;
  const derived = deriveRoomMessageAgentLight(message, project, group, projectRoomMessages);
  if (isCoordinatorMessage) {
    return derived === 'failed' ? 'failed' : 'completed';
  }
  return derived;
}

/** Smart (or any node-less) project: derive each member's light from their latest room phase. */
function deriveSmartProjectAgentLights(
  project: OfficeTempProject,
  projectRoom: RoomMessage[],
): Map<string, OfficeProjectLight> {
  const out = new Map<string, OfficeProjectLight>();
  const latestByAgent = new Map<string, RoomMessage>();
  for (const m of projectRoom) {
    if (!m.fromAgentId) continue;
    if (m.from === 'user' || m.from === 'system') continue;
    const prev = latestByAgent.get(m.fromAgentId);
    if (!prev || m.timestamp >= prev.timestamp) latestByAgent.set(m.fromAgentId, m);
  }
  for (const agentId of project.agentIds ?? []) {
    const latest = latestByAgent.get(agentId);
    const phase = latest ? effectiveRoomPhase(latest) : null;
    const status: NodeRunStatus = phase ? nodeRunStatusFromRoomPhase(phase) : 'pending';
    out.set(agentId, agentLightFromNodeStatuses(new Set([status]), project.status));
  }
  return out;
}

/**
 * Derive each agent's status light for a project (group-chat message border/background color).
 * Workflow projects map the agent's node(s) to their reconciled run status; Smart / node-less
 * projects fall back to each member's latest room phase. Palette matches the project card.
 */
export function deriveProjectAgentLights(
  project: OfficeTempProject,
  group: Pick<OfficeFixedGroup, 'workflow' | 'id'> | null | undefined,
  roomMessages: RoomMessage[],
): Map<string, OfficeProjectLight> {
  const out = new Map<string, OfficeProjectLight>();
  const projectRoom = roomMessages.filter((m) => m.projectId === project.id);
  const nodes = workflowForProject(project, group ?? null).nodes;
  if (nodes.length === 0) {
    return deriveSmartProjectAgentLights(project, projectRoom);
  }
  const sync = deriveTaskProgressSync(project, nodes, projectRoom);
  const stepByNode = new Map(sync.steps.map((s) => [s.nodeId, s]));

  const byAgent = new Map<string, Set<NodeRunStatus>>();
  for (const node of nodes) {
    const status: NodeRunStatus =
      stepByNode.get(node.id)?.status
      ?? project.nodeRuns.find((r) => r.nodeId === node.id)?.status
      ?? 'pending';
    for (const agentId of workflowNodeAgentIds(node)) {
      if (!byAgent.has(agentId)) byAgent.set(agentId, new Set());
      byAgent.get(agentId)!.add(status);
    }
  }

  for (const [agentId, statuses] of byAgent) {
    out.set(agentId, agentLightFromNodeStatuses(statuses, project.status));
  }
  return out;
}

export function deriveScenarioAgentActivity(
  group: OfficeFixedGroup,
  projects: OfficeTempProject[],
  roomMessages: RoomMessage[],
): ScenarioAgentActivity[] {
  const teamAgentIds = new Set(group.agentIds);
  const groupProjects = projects.filter((p) => p.parentGroupId === group.id);
  const groupRoom = roomMessages.filter((m) => m.groupId === group.id);

  const fromTasks = agentIdsWorkingFromTasks(group, groupProjects, groupRoom);
  const fromRoom = agentIdsWorkingFromRoom(teamAgentIds, groupRoom);

  return group.agentIds.map((agentId) => {
    const taskHit = fromTasks.get(agentId);
    const roomHit = fromRoom.get(agentId);
    const working = Boolean(taskHit || roomHit);
    let source: RoleActivitySource | undefined;
    if (taskHit && roomHit) source = 'both';
    else if (taskHit) source = 'task';
    else if (roomHit) source = 'room';

    return {
      agentId,
      working,
      source,
      projectId: taskHit?.projectId ?? roomHit?.projectId,
    };
  });
}

/** @deprecated Use deriveScenarioAgentActivity */
export const deriveScenarioRoleActivity = deriveScenarioAgentActivity;

/** Working agents first, then original team order. */
export function sortScenarioAgentIdsByActivity(
  agentIds: string[],
  activity: ScenarioAgentActivity[],
): string[] {
  const workingSet = new Set(activity.filter((a) => a.working).map((a) => a.agentId));
  return [...agentIds].sort((a, b) => {
    const wa = workingSet.has(a) ? 1 : 0;
    const wb = workingSet.has(b) ? 1 : 0;
    if (wa !== wb) return wb - wa;
    return agentIds.indexOf(a) - agentIds.indexOf(b);
  });
}

/** @deprecated Use sortScenarioAgentIdsByActivity */
export const sortScenarioRoleIdsByActivity = sortScenarioAgentIdsByActivity;

export function groupTeamMembers(
  group: Pick<OfficeFixedGroup, 'agentIds' | 'coordinatorAgentId'>,
  allMembers: ProjectAgentRef[],
): ProjectAgentRef[] {
  const byId = new Map(allMembers.map((m) => [m.agentId, m]));
  const team = group.agentIds
    .map((id) => byId.get(id))
    .filter((m): m is ProjectAgentRef => Boolean(m));
  const coordinatorId = group.coordinatorAgentId?.trim();
  if (!coordinatorId) return team;
  return [...team].sort((a, b) => {
    if (a.agentId === coordinatorId) return -1;
    if (b.agentId === coordinatorId) return 1;
    return group.agentIds.indexOf(a.agentId) - group.agentIds.indexOf(b.agentId);
  });
}

/** @deprecated Use groupTeamMembers */
export const scenarioTeamRoles = groupTeamMembers;
