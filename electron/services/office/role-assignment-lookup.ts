import type { ProjectNotebook } from '../../../src/lib/office-project-notebook';
import type { RoleWorkStatusRecord } from '../../../src/lib/office-project-context';
import { readProjectProgress } from './coordinator-project-fs';
import { loadProjectEpoch } from './project-context-load';
import { readLastRoleWorkStatus } from './role-work-status-fs';
import { resolveCoordinatorAgentId } from './project-context-paths';
import { pickRolesDelegatedByCoordinator } from './room-coordinator-delegates';
import type { ProjectAgentRef } from '../../../src/lib/office-workflow-node';
import {
  roomMessageFromAgentMatches,
  roomMessageProjectId,
} from '../../../src/lib/office-agent-id-resolve';
import type { RoomMessage } from './types';

import { SMART_COORDINATOR_DUTY } from '../../../src/lib/office-smart-task-prompt-common';
import {
  hasSmartCoordinatorStructuredDispatch,
  resolveSmartStructuredRawFromRoomMessage,
} from '../../../src/lib/office-smart-room-fields';
import { isSmartJsonShapeText } from '../../../src/lib/office-smart-json-schema';
import {
  inferSmartMemberReadinessForMention,
  isSmartCoordinatorProgressSyncReply,
  type SmartMemberExecutionReadiness,
} from '../../../src/lib/office-smart-member-reply';
import type { OfficeRole, OfficeScenario, OfficeFixedGroup, OfficeTask, OfficeTaskExecutionMode } from './types';

export { SMART_COORDINATOR_DUTY };

const UNASSIGNED_RE =
  /^(?:无|未分配|待分配|暂无|N\/A|NA|—|-|\s*|（无）|（暂无）)$/iu;

export type RoleAssignmentState = 'assigned' | 'unassigned';

export type RoleAssignmentResult = {
  state: RoleAssignmentState;
  summary: string | null;
  source: 'coordinator_meta' | 'progress' | 'ndjson' | 'none';
  /** Smart 非协调者：依赖是否已满足、可否真正开工 */
  smartMemberReadiness?: SmartMemberExecutionReadiness;
};

export function isUnassignedAssignmentText(text: string | null | undefined): boolean {
  const t = (text ?? '').trim();
  if (!t) return true;
  if (UNASSIGNED_RE.test(t)) return true;
  if (/未分配|待协调|尚无分工|无分工/u.test(t) && t.length < 40) return true;
  return false;
}

function roleProgressLine(notebook: ProjectNotebook | null, roleId: string): string | null {
  if (!notebook?.roles) return null;
  const line = notebook.roles[roleId]?.trim();
  return line || null;
}

function assignmentFromStatusRecord(record: RoleWorkStatusRecord | null): string | null {
  if (!record) return null;
  const body = record.工作进展?.trim() ?? '';
  if (!body) return null;
  const dutyMatch = body.match(/分工[：:]\s*([^\n；;]+)/u);
  if (dutyMatch?.[1]?.trim()) return dutyMatch[1].trim();
  return body;
}

/** 触发消息是否为 Smart 协调者 kickoff 拆解消息（仅引擎 kickoff 行 id，不含协调者点名发布 id）。 */
export function isSmartCoordKickoffTriggerMessageId(msgId: string): boolean {
  return /^room-\d+-smart-coord-kickoff$/u.test(msgId.trim());
}

/**
 * 成员 Session 仍绑定 kickoff 触发消息时：若该成员 kickoff 后已在群聊发过实质汇报，跳过重复派活。
 */
export function shouldSkipStaleSmartKickoffMemberDispatch(input: {
  triggerMsgId: string;
  memberAgentId: string;
  roomMessages: RoomMessage[];
  coordinatorAgentId: string;
  projectId: string;
}): boolean {
  if (!isSmartCoordKickoffTriggerMessageId(input.triggerMsgId)) return false;
  const kickoff = input.roomMessages.find((m) => m.id === input.triggerMsgId);
  const kickoffTs = kickoff?.timestamp ?? 0;
  if (!kickoffTs) return false;
  const memberPostedAfterKickoff = input.roomMessages.some((m) => {
    if (m.fromAgentId !== input.memberAgentId) return false;
    if (m.timestamp <= kickoffTs) return false;
    return (m.progressText?.trim() || m.content?.trim() || '').length >= 8;
  });
  if (!memberPostedAfterKickoff) return false;
  if (isSmartCoordKickoffTriggerMessageId(input.triggerMsgId)) return true;
  return smartCoordinatorHasDecomposedInRoom(
    input.roomMessages,
    input.coordinatorAgentId,
    input.projectId,
  );
}

/** 协调者 kickoff 拆解派活正文（🚀 正式启动 + 【任务N】）。 */
export function isSmartCoordinatorKickoffDecompositionText(text: string): boolean {
  const t = text.trim();
  if (!t || !/正式启动/u.test(t)) return false;
  return /【任务\s*\d+】/u.test(t);
}

/** 群聊中协调者 kickoff 式拆解消息条数（用于区分首轮派活 vs 重复 kickoff）。 */
export function countSmartCoordinatorKickoffDecompositionsInRoom(
  roomMessages: RoomMessage[],
  coordinatorAgentId: string,
  projectId: string,
): number {
  let count = 0;
  for (const m of roomMessages) {
    const pid = m.projectId ?? (m as { taskId?: string }).taskId;
    if (pid && pid !== projectId) continue;
    const from = m.fromAgentId ?? (m as { fromRoleId?: string }).fromRoleId;
    if (from !== coordinatorAgentId) continue;
    const text = (m.progressText ?? m.content ?? '').trim();
    if (isSmartCoordinatorKickoffDecompositionText(text)) count++;
  }
  return count;
}

/** 是否属于结项阶段的 kickoff 式二次派活（群聊中已有 ≥2 条 kickoff 拆解）。 */
export function isSmartCoordinatorKickoffRedispatchInRoom(
  roomMessages: RoomMessage[],
  coordinatorAgentId: string,
  projectId: string,
): boolean {
  return (
    countSmartCoordinatorKickoffDecompositionsInRoom(
      roomMessages,
      coordinatorAgentId,
      projectId,
    ) >= 2
  );
}

/** 协调者已在群聊中 @ 执行者派活（非纯进度同步）。 */
export function smartCoordinatorHasDecomposedInRoom(
  roomMessages: RoomMessage[],
  coordinatorAgentId: string,
  projectId: string,
): boolean {
  for (const m of roomMessages) {
    const pid = m.projectId ?? (m as { taskId?: string }).taskId;
    if (pid && pid !== projectId) continue;
    const from = m.fromAgentId ?? m.fromRoleId;
    if (from !== coordinatorAgentId) continue;
    const text = (m.progressText ?? m.content ?? '').trim();
    if (!text) continue;
    if (isSmartCoordinatorKickoffDecompositionText(text)) return true;
    const structRaw = resolveSmartStructuredRawFromRoomMessage(m);
    if (structRaw && hasSmartCoordinatorStructuredDispatch(structRaw)) return true;
  }
  return false;
}

/** 协调者本条群聊回复是否通过 dispatch 向成员派活（roomReply @ 不计）。 */
export function smartCoordinatorReplyDispatchesMembers(
  replyText: string,
  coordinatorAgentId: string,
  teamMembers: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[],
  options?: { userInitiated?: boolean },
): boolean {
  const text = replyText.trim();
  if (!text || !hasSmartCoordinatorStructuredDispatch(text)) return false;
  if (!options?.userInitiated && isSmartCoordinatorProgressSyncReply(text)) return false;
  return (
    pickRolesDelegatedByCoordinator(
      text,
      teamMembers,
      coordinatorAgentId,
      coordinatorAgentId,
      { executionMode: 'smart' },
    ).length > 0
  );
}

export function smartCoordinatorNeedsDecomposition(
  notebook: ProjectNotebook | null,
  options?: {
    roomMessages?: RoomMessage[];
    coordinatorAgentId?: string;
    coordinatorRoleId?: string;
    taskId?: string;
    projectId?: string;
  },
): boolean {
  const coordinatorId = (options?.coordinatorAgentId ?? options?.coordinatorRoleId)?.trim();
  const scopeId = (options?.projectId ?? options?.taskId)?.trim();
  if (
    options?.roomMessages
    && coordinatorId
    && scopeId
    && smartCoordinatorHasDecomposedInRoom(
      options.roomMessages,
      coordinatorId,
      scopeId,
    )
  ) {
    return false;
  }
  if (!notebook) return true;
  if (!isUnassignedAssignmentText(notebook.coordinatorSummary)) {
    const anyRole = Object.values(notebook.roles ?? {}).some(
      (line) => !isUnassignedAssignmentText(line),
    );
    if (anyRole) return false;
    if (notebook.coordinatorSummary.trim().length >= 12) return false;
  }
  const anyRole = Object.values(notebook.roles ?? {}).some(
    (line) => !isUnassignedAssignmentText(line),
  );
  return !anyRole;
}

/** Smart：磁盘无分工时，从本次点名触发的协调者群聊原文推断是否已派活。 */
export function augmentSmartAssignmentFromCoordinatorLines(params: {
  assignment: RoleAssignmentResult;
  coordinatorRoomLines: string[];
  role: Pick<OfficeRole, 'id' | 'name'> & { agentId?: string };
}): RoleAssignmentResult {
  if (params.assignment.state === 'assigned') return params.assignment;
  for (const line of params.coordinatorRoomLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const readiness = inferSmartMemberReadinessForMention({
      coordinatorRoomLine: trimmed,
      mentionTargetRole: {
        agentId: params.role.agentId ?? params.role.id,
        displayName: params.role.name,
      },
    });
    if (readiness !== 'ready' && readiness !== 'acceptance') continue;
    return {
      state: 'assigned',
      summary: trimmed.slice(0, 800),
      source: 'coordinator_meta',
      smartMemberReadiness: readiness,
    };
  }
  return params.assignment;
}

/** 收集协调者近期群聊行（含本次触发消息全文），供 Smart 派活推断。 */
export function collectSmartCoordinatorRoomLinesForRole(params: {
  roomMessages: RoomMessage[];
  coordinatorRoleId: string;
  role: Pick<OfficeRole, 'id' | 'name'>;
  triggerMessage: RoomMessage;
  fallbackContent?: string;
  maxMessages?: number;
}): string[] {
  const lines: string[] = [];
  const push = (text: string) => {
    const t = text.trim();
    if (t && !lines.includes(t)) lines.push(t);
  };

  push(params.fallbackContent?.trim() && isSmartJsonShapeText(params.fallbackContent)
    ? params.fallbackContent.trim()
    : '');
  push(resolveSmartStructuredRawFromRoomMessage(params.triggerMessage));

  const triggerTs = params.triggerMessage.timestamp;
  const coordMsgs = params.roomMessages
    .filter(
      (m) =>
        roomMessageProjectId(m) === roomMessageProjectId(params.triggerMessage)
        && m.timestamp <= triggerTs
        && roomMessageFromAgentMatches(m, params.coordinatorRoleId),
    )
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, params.maxMessages ?? 8);

  for (const m of coordMsgs) {
    const raw = resolveSmartStructuredRawFromRoomMessage(m);
    if (raw) push(raw);
  }

  return lines;
}

function teamRolesAsProjectMembers(
  teamRoles: Pick<OfficeRole, 'id' | 'name' | 'agentId'>[],
): ProjectAgentRef[] {
  return teamRoles.map((r) => {
    const agentId = (r.agentId ?? r.id ?? '').trim();
    return {
      agentId: agentId || (r.id ?? '').trim() || 'member',
      displayName: (r.name ?? r.agentId ?? r.id ?? '').trim() || agentId || 'member',
    };
  });
}

function scenarioAsCoordinatorGroup(
  scenario: Pick<OfficeScenario, 'coordinatorRoleId' | 'roleIds'> & {
    coordinatorAgentId?: string;
    agentIds?: string[];
  },
): Pick<OfficeFixedGroup, 'coordinatorAgentId' | 'agentIds'> {
  return {
    coordinatorAgentId: (scenario.coordinatorAgentId ?? scenario.coordinatorRoleId ?? '').trim(),
    agentIds: scenario.agentIds ?? scenario.roleIds ?? [],
  };
}

export async function resolveRoleAssignment(params: {
  task: OfficeTask;
  scenario: Pick<OfficeScenario, 'coordinatorRoleId' | 'roleIds'>;
  role: Pick<OfficeRole, 'id' | 'name' | 'agentId'>;
  teamRoles: Pick<OfficeRole, 'id' | 'name' | 'agentId'>[];
  executionMode: OfficeTaskExecutionMode;
  isCoordinator: boolean;
}): Promise<RoleAssignmentResult> {
  if (params.executionMode === 'smart' && params.isCoordinator) {
    return {
      state: 'assigned',
      summary: SMART_COORDINATOR_DUTY,
      source: 'coordinator_meta',
    };
  }

  if (params.executionMode === 'workflow') {
    if (params.isCoordinator) {
      return {
        state: 'assigned',
        summary: '按工作流 nodeRuns / DAG 监督推进（勿依赖群聊分工指派）',
        source: 'coordinator_meta',
      };
    }
    return { state: 'assigned', summary: null, source: 'none' };
  }

  const scenarioGroup = scenarioAsCoordinatorGroup(params.scenario);
  const teamMembers = teamRolesAsProjectMembers(params.teamRoles);
  const coord = resolveCoordinatorAgentId(params.task, scenarioGroup);
  let notebook: ProjectNotebook | null = null;
  if (coord) {
    const { resolveCoordinatorPathContext } = await import('./project-context-paths');
    notebook = await readProjectProgress(
      await resolveCoordinatorPathContext(coord, teamMembers),
      params.task.title,
      params.task.id,
    );
  }

  const progressLine = roleProgressLine(notebook, params.role.id);
  if (progressLine && !isUnassignedAssignmentText(progressLine)) {
    return {
      state: 'assigned',
      summary: progressLine,
      source: 'progress',
    };
  }

  const epochPack = await loadProjectEpoch({
    project: params.task,
    group: scenarioGroup,
    members: teamMembers,
  });
  const epoch = epochPack?.epoch ?? 1;
  const last =
    coord && epochPack
      ? await readLastRoleWorkStatus({
          coordinatorAgentId: coord.coordinatorAgentId,
          coordinatorRoleId: coord.coordinatorAgentId,
          teamRoles: teamMembers,
          taskTitle: params.task.title,
          taskId: params.task.id,
          roleId: params.role.id,
          roleName: params.role.name,
          epoch,
        })
      : null;
  const fromNdjson = assignmentFromStatusRecord(last);
  if (fromNdjson && !isUnassignedAssignmentText(fromNdjson)) {
    return {
      state: 'assigned',
      summary: fromNdjson,
      source: 'ndjson',
    };
  }

  // Smart 成员：以协调者群聊点名为准；磁盘无分工也不阻塞流程
  if (params.executionMode === 'smart' && !params.isCoordinator) {
    return { state: 'assigned', summary: null, source: 'none' };
  }

  return {
    state: 'unassigned',
    summary: null,
    source: 'none',
  };
}
