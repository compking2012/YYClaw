import {
  shouldDispatchWorkflowRoomMentionLlm,
  shouldScheduleSmartBroadcastCoordinatorWatch,
} from '../../../src/lib/office-execution-mode-policy';
import { resolveRoomMessageSpeakerRoleId } from '../../../src/lib/office-room-speaker-role';
import {
  isWorkflowUpstreamClarificationMessage,
  isWorkflowUpstreamClarificationTarget,
} from '../../../src/lib/office-workflow-upstream-mention';
import { hasCoordinatorDirectAssignmentToRole } from '../../../src/lib/office-smart-member-reply';
import { workflowForTask } from './workflow-graph';
import { mentionsIncludeAll, resolveMentionTargets } from './room-mentions';
import type { OfficeScenario, OfficeTask, RoomMessage } from './types';
import { taskExecutionMode } from './task-execution-mode';
import type { OfficeTaskExecutionMode } from './types';
import { isWorkflowTaskRunnerActive } from './workflow-run-registry';
import type { ProjectAgentRef } from '../../../src/lib/office-workflow-node';
import { agentIdsMatch } from '../../../src/lib/office-agent-id-resolve';

export type RoomMessageDispatchKind = 'broadcast' | 'direct_mention';

type TeamMember = ProjectAgentRef;

function coordinatorAgentIdParam(
  coordinatorAgentId?: string,
  /** @deprecated use coordinatorAgentId */
  coordinatorRoleId?: string,
): string {
  return (coordinatorAgentId ?? coordinatorRoleId ?? '').trim();
}

function fromAgentIdParam(
  fromAgentId?: string,
  /** @deprecated use fromAgentId */
  fromRoleId?: string,
): string {
  return (fromAgentId ?? fromRoleId ?? '').trim();
}

function findCoordinator(
  team: TeamMember[],
  coordinatorAgentId: string,
): TeamMember | undefined {
  const id = coordinatorAgentId.trim();
  if (!id) return undefined;
  return team.find((m) => m.agentId === id);
}

/** 广播：@all 或无任何 @；点名：@ 具体角色（非 @all）。 */
export function classifyRoomMessageKind(mentionTokens: string[]): RoomMessageDispatchKind {
  if (mentionsIncludeAll(mentionTokens) || mentionTokens.length === 0) return 'broadcast';
  return 'direct_mention';
}

export function isCoordinatorBroadcast(params: {
  kind: RoomMessageDispatchKind;
  fromAgentId?: string;
  /** @deprecated use fromAgentId */
  fromRoleId?: string;
  coordinatorAgentId?: string;
  /** @deprecated use coordinatorAgentId */
  coordinatorRoleId?: string;
}): boolean {
  const coordId = coordinatorAgentIdParam(params.coordinatorAgentId, params.coordinatorRoleId);
  const fromId = fromAgentIdParam(params.fromAgentId, params.fromRoleId);
  return params.kind === 'broadcast' && !!coordId && fromId === coordId;
}

/** Smart 专用：非协调者广播 15s 无回应 → 协调者兜底介入。Workflow 由 runner 推进，不启用。 */
export function shouldScheduleBroadcastCoordinatorWatch(params: {
  kind: RoomMessageDispatchKind;
  coordinatorAgentId?: string;
  /** @deprecated use coordinatorAgentId */
  coordinatorRoleId?: string;
  fromAgentId?: string;
  /** @deprecated use fromAgentId */
  fromRoleId?: string;
  from: RoomMessage['from'];
  content: string;
  executionMode?: OfficeTaskExecutionMode;
  replyTargetCount?: number;
  resolvedTeamMentionCount?: number;
  mentionTokens?: string[];
}): boolean {
  if (params.mentionTokens && mentionsIncludeAll(params.mentionTokens)) return false;
  return shouldScheduleSmartBroadcastCoordinatorWatch({
    executionMode: params.executionMode ?? 'smart',
    kind: params.kind,
    replyTargetCount: params.replyTargetCount ?? 0,
    resolvedTeamMentionCount: params.resolvedTeamMentionCount,
    coordinatorRoleId: coordinatorAgentIdParam(params.coordinatorAgentId, params.coordinatorRoleId),
    fromRoleId: fromAgentIdParam(params.fromAgentId, params.fromRoleId),
    from: params.from as 'user' | 'agent' | 'system' | undefined,
    content: params.content,
  });
}

/** @deprecated 使用 {@link shouldScheduleBroadcastCoordinatorWatch} */
export const shouldScheduleUnmentionedCoordinatorWatch = shouldScheduleBroadcastCoordinatorWatch;

export function applySmartDirectMentionTargets(params: {
  executionMode: OfficeTaskExecutionMode;
  coordinatorAgentId?: string;
  /** @deprecated use coordinatorAgentId */
  coordinatorRoleId?: string;
  fromAgentId?: string;
  /** @deprecated use fromAgentId */
  fromRoleId?: string;
  from?: RoomMessage['from'];
  content?: string;
  targets: TeamMember[];
  teamRoles: TeamMember[];
}): TeamMember[] {
  const coordId = coordinatorAgentIdParam(params.coordinatorAgentId, params.coordinatorRoleId);
  if (params.executionMode !== 'smart' || !coordId) return params.targets;
  if (params.targets.length === 0) return params.targets;
  if (params.from === 'user') return params.targets;
  const fromId = fromAgentIdParam(params.fromAgentId, params.fromRoleId);
  if (fromId && agentIdsMatch(params.teamRoles, fromId, coordId)) return params.targets;
  const coord = findCoordinator(params.teamRoles, coordId);
  if (!coord) return params.targets;
  if (
    params.targets.length === 1
    && hasCoordinatorDirectAssignmentToRole(params.content ?? '', params.targets[0]!)
  ) {
    return params.targets;
  }
  return [coord];
}

export function resolveRoomReplyTargets(params: {
  mentionTokens: string[];
  teamRoles: TeamMember[];
  fromAgentId?: string;
  /** @deprecated use fromAgentId */
  fromRoleId?: string;
  from?: RoomMessage['from'];
  focusTask: Pick<OfficeTask, 'executionMode'> | null;
  coordinatorAgentId?: string;
  /** @deprecated use coordinatorAgentId */
  coordinatorRoleId?: string;
  content?: string;
}): TeamMember[] {
  const kind = classifyRoomMessageKind(params.mentionTokens);
  if (kind === 'broadcast') return [];

  const coordId = coordinatorAgentIdParam(params.coordinatorAgentId, params.coordinatorRoleId);
  const mode = params.focusTask ? taskExecutionMode(params.focusTask) : 'workflow';
  let targets = resolveMentionTargets(params.mentionTokens, params.teamRoles, {
    coordinatorAgentId: coordId,
  });
  const fromId = fromAgentIdParam(params.fromAgentId, params.fromRoleId);
  const smartCoordinatorSelfMention =
    mode === 'smart' && fromId && coordId && agentIdsMatch(params.teamRoles, fromId, coordId);
  if (!smartCoordinatorSelfMention) {
    targets = targets.filter(
      (r) => !fromId || !agentIdsMatch(params.teamRoles, r.agentId, fromId),
    );
  }
  targets = applySmartDirectMentionTargets({
    executionMode: mode,
    coordinatorAgentId: coordId,
    fromAgentId: fromId,
    from: params.from,
    content: params.content,
    targets,
    teamRoles: params.teamRoles,
  });

  return targets;
}

/**
 * Workflow：子任务由 runner/节点会话推进；群聊默认不触发成员点名 LLM。
 * 例外：成员【协作询问】@ 直接前驱（补交付）。
 * 用户发言：无论 runner 是否活跃、是否 @ 成员，仅协调者 LLM 判定/回复（见 workflow-coordinator-intervention）。
 */
/** Smart 模式：用户发言仅协调者响应；无论 @ 成员或 @ 协调者，均立即由协调者兜底。 */
export function resolveSmartUserRoomReplyTargets(params: {
  coordinatorAgentId?: string;
  /** @deprecated use coordinatorAgentId */
  coordinatorRoleId?: string;
  targets: TeamMember[];
  teamRoles: TeamMember[];
}): TeamMember[] {
  const coordId = coordinatorAgentIdParam(params.coordinatorAgentId, params.coordinatorRoleId);
  const coord = findCoordinator(params.teamRoles, coordId);
  if (!coord) return [];
  return [coord];
}

/** 用户 @ 的是否包含非协调者成员（Smart 下成员不直接响应用户）。 */
export function smartUserMentionedNonCoordinatorRoles(
  mentioned: TeamMember[],
  coordinatorAgentId?: string,
  /** @deprecated use coordinatorAgentId */
  coordinatorRoleId?: string,
): TeamMember[] {
  const coordId = coordinatorAgentIdParam(coordinatorAgentId, coordinatorRoleId);
  return mentioned.filter((m) => m.agentId !== coordId);
}

export function shouldDispatchSmartMentionToRole(params: {
  messageFrom?: 'user' | 'agent' | 'system';
  targetAgentId: string;
  /** @deprecated use targetAgentId */
  targetRoleId?: string;
  coordinatorAgentId?: string;
  /** @deprecated use coordinatorAgentId */
  coordinatorRoleId?: string;
  speakerAgentId?: string;
  /** @deprecated use speakerAgentId */
  speakerRoleId?: string;
  teamRoles?: TeamMember[];
}): boolean {
  const team = params.teamRoles ?? [];
  const targetId = (params.targetAgentId ?? params.targetRoleId ?? '').trim();
  const coordId = coordinatorAgentIdParam(params.coordinatorAgentId, params.coordinatorRoleId);
  const speakerId = (params.speakerAgentId ?? params.speakerRoleId ?? '').trim();
  if (params.messageFrom === 'user') {
    return agentIdsMatch(team, targetId, coordId);
  }
  if (params.messageFrom === 'agent' && speakerId) {
    const isCoordinatorSpeaker = agentIdsMatch(team, speakerId, coordId);
    const isCoordinatorTarget = agentIdsMatch(team, targetId, coordId);
    if (!isCoordinatorSpeaker && !isCoordinatorTarget) {
      return false;
    }
  }
  return true;
}

/** 解析点名上下文中的发言者 agentId（用于日志/后续策略）。 */
export function resolveWorkflowMentionSpeakerAgentId(params: {
  teamRoles: TeamMember[];
  explicitFromAgentId?: string;
  /** @deprecated use explicitFromAgentId */
  explicitFromRoleId?: string;
  message?: Pick<RoomMessage, 'from' | 'fromAgentId' | 'content'>;
}): string | undefined {
  const explicit = (
    params.explicitFromAgentId
    ?? params.explicitFromRoleId
    ?? params.message?.fromAgentId
    ?? ''
  ).trim();
  if (explicit) {
    const byAgent = params.teamRoles.find((m) => m.agentId === explicit);
    if (byAgent) return byAgent.agentId;
  }
  if (params.message) {
    return resolveRoomMessageSpeakerRoleId(params.message, params.teamRoles);
  }
  return undefined;
}

/** @deprecated use resolveWorkflowMentionSpeakerAgentId */
export function resolveWorkflowMentionSpeakerRoleId(params: {
  teamRoles: TeamMember[];
  explicitFromRoleId?: string;
  message?: Pick<RoomMessage, 'from' | 'fromAgentId' | 'content'>;
}): string | undefined {
  return resolveWorkflowMentionSpeakerAgentId({
    teamRoles: params.teamRoles,
    explicitFromAgentId: params.explicitFromRoleId,
    message: params.message,
  });
}

export function shouldDispatchWorkflowMentionToRole(params: {
  executionMode: OfficeTaskExecutionMode;
  taskId: string;
  targetAgentId?: string;
  /** @deprecated use targetAgentId */
  targetRoleId?: string;
  coordinatorAgentId?: string;
  /** @deprecated use coordinatorAgentId */
  coordinatorRoleId?: string;
  message?: Pick<RoomMessage, 'from' | 'fromAgentId' | 'content' | 'phase' | 'nodeId'>;
  focusTask?: Pick<OfficeTask, 'nodeRuns'> | null;
  scenario?: Pick<OfficeScenario, 'workflow' | 'agentIds'> | null;
  teamRoles?: TeamMember[];
}): boolean {
  if (params.executionMode !== 'workflow') return true;

  const targetId = (params.targetAgentId ?? params.targetRoleId ?? '').trim();
  const coordId = coordinatorAgentIdParam(params.coordinatorAgentId, params.coordinatorRoleId);

  if (params.message?.from === 'user') {
    return shouldDispatchWorkflowRoomMentionLlm({
      targetRoleId: targetId,
      coordinatorRoleId: coordId,
      messageFrom: 'user',
      allowUpstreamClarification: false,
    });
  }

  if (!isWorkflowTaskRunnerActive(params.taskId)) return true;

  let allowUpstreamClarification = false;
  const speakerAgentId = resolveWorkflowMentionSpeakerAgentId({
    teamRoles: params.teamRoles ?? [],
    message: params.message,
  });
  if (
    params.message
    && params.focusTask
    && params.scenario
    && params.teamRoles
    && speakerAgentId
    && isWorkflowUpstreamClarificationMessage(params.message)
  ) {
    const wf = workflowForTask(params.focusTask as OfficeTask, params.scenario as OfficeScenario);
    allowUpstreamClarification = isWorkflowUpstreamClarificationTarget({
      message: params.message,
      speakerRoleId: speakerAgentId,
      targetRoleId: targetId,
      coordinatorRoleId: coordId,
      nodes: wf.nodes,
      edges: wf.edges,
      nodeRuns: params.focusTask.nodeRuns,
      teamRoles: params.teamRoles,
    });
  }

  return shouldDispatchWorkflowRoomMentionLlm({
    targetRoleId: targetId,
    coordinatorRoleId: coordId,
    messageFrom: params.message?.from as 'user' | 'agent' | 'system' | undefined,
    allowUpstreamClarification,
  });
}

export function filterWorkflowRunnerMentionTargets(params: {
  executionMode: OfficeTaskExecutionMode;
  taskId: string;
  coordinatorAgentId?: string;
  /** @deprecated use coordinatorAgentId */
  coordinatorRoleId?: string;
  targets: TeamMember[];
  teamRoles?: TeamMember[];
  message?: Pick<RoomMessage, 'from' | 'fromAgentId' | 'content' | 'phase' | 'nodeId'>;
  focusTask?: Pick<OfficeTask, 'nodeRuns'> | null;
  scenario?: Pick<OfficeScenario, 'workflow' | 'agentIds'> | null;
}): TeamMember[] {
  if (params.executionMode !== 'workflow') return params.targets;
  const coordId = coordinatorAgentIdParam(params.coordinatorAgentId, params.coordinatorRoleId);
  return params.targets.filter((r) =>
    shouldDispatchWorkflowMentionToRole({
      executionMode: params.executionMode,
      taskId: params.taskId,
      targetAgentId: r.agentId,
      coordinatorAgentId: coordId,
      message: params.message,
      focusTask: params.focusTask,
      scenario: params.scenario,
      teamRoles: params.teamRoles,
    }),
  );
}
