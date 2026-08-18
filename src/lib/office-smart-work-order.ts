import { roleMentionToken } from '@/lib/office-mention';
import { workflowNodeRoleIds } from '@/lib/office-workflow-node';
import type { ProjectAgentRef } from '@/lib/office-workflow-node';
import type { OfficeFixedGroup, RoomMessage, WorkflowNode } from '@/types/office';
import {
  agentIdsMatch,
  normalizeTeamMembers,
  resolveTeamAgentId,
  resolveTeamAgentIds,
  roomMessageFromAgentMatches,
  roomMessageProjectId,
  type LegacyTeamMember,
} from '@/lib/office-agent-id-resolve';
import { SMART_SUBTASK_DONE_MARKER_RE } from '@/lib/office-smart-member-reply';

export type SmartWorkOrderStep = {
  stepIndex: number;
  nodeId: string;
  title: string;
  roleIds: string[];
};

export function buildSmartWorkOrderFromScenario(
  scenario: Pick<OfficeFixedGroup, 'workflow'>,
): SmartWorkOrderStep[] {
  const nodes = scenario.workflow?.nodes ?? [];
  return nodes.map((node, index) => ({
    stepIndex: index + 1,
    nodeId: node.id,
    title: node.title?.trim() || `步骤${index + 1}`,
    roleIds: workflowNodeRoleIds(node),
  }));
}

/** 从任务说明解析「1.PM…」类步骤行，按角色名匹配 owner（无 workflow 时兜底）。 */
export function buildSmartWorkOrderFromTaskDescription(
  description: string | null | undefined,
  roles: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[],
): SmartWorkOrderStep[] {
  const raw = (description ?? '').trim();
  if (!raw) return [];
  const lines = raw.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const steps: SmartWorkOrderStep[] = [];
  let idx = 0;
  for (const line of lines) {
    const m = line.match(/^(\d+)[.、)]\s*(.+)$/u);
    if (!m) continue;
    idx += 1;
    const body = m[2]!.trim();
    const roleIds = roles
      .filter((r) => {
        const label = (r.displayName ?? '').trim();
        return label && (body.includes(label) || new RegExp(label, 'iu').test(body));
      })
      .map((r) => r.agentId)
      .filter((id): id is string => Boolean(id?.trim()));
    steps.push({
      stepIndex: idx,
      nodeId: `desc-step-${idx}`,
      title: body.slice(0, 80),
      roleIds: roleIds.length > 0 ? roleIds : [],
    });
  }
  return steps;
}

export function resolveSmartWorkOrderSteps(
  scenario: Pick<OfficeFixedGroup, 'workflow'>,
  taskDescription: string | null | undefined,
  roles: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[],
): SmartWorkOrderStep[] {
  const fromScenario = buildSmartWorkOrderFromScenario(scenario);
  if (fromScenario.length > 0) return fromScenario;
  return buildSmartWorkOrderFromTaskDescription(taskDescription, roles);
}

/**
 * 当任务说明或固定组 workflow 已预置步骤时，校验至少一步能匹配项目成员。
 * Smart 启动不调用此函数：工作顺序由协调者在项目启动后通过群聊分工制定。
 */
export function assertSmartResolvableExecutors(
  steps: SmartWorkOrderStep[],
  projectAgentIds: string[],
): void {
  const agentSet = new Set(projectAgentIds.map((id) => id.trim()).filter(Boolean));
  const resolvable = steps.some((step) =>
    step.roleIds.some((id) => {
      const trimmed = id?.trim();
      return Boolean(trimmed) && agentSet.has(trimmed);
    }),
  );
  if (!resolvable) {
    throw new Error(
      '工作顺序中没有任何步骤能匹配项目成员。请检查任务说明中的角色名是否与团队成员显示名一致，或确认固定组 workflow 节点已绑定 Agent。',
    );
  }
}

/** @deprecated 结项闸门仅认 RoomMessage.smartMemberEnd（JSON action=end 落盘）。 */
export function smartMemberSubtaskDoneReportText(message: Pick<RoomMessage, 'content' | 'progressText'>): string {
  const progress = (message.progressText ?? '').trim();
  const content = (message.content ?? '').trim();
  if (SMART_SUBTASK_DONE_MARKER_RE.test(progress)) return progress;
  if (SMART_SUBTASK_DONE_MARKER_RE.test(content)) return content;
  return progress || content;
}

function resolveSmartRoomScopeId(taskId?: string, projectId?: string): string {
  return (projectId ?? taskId ?? '').trim();
}

export function roleReportedSubtaskDoneInRoom(
  roomMessages: RoomMessage[],
  taskId: string,
  roleId: string,
  teamMembers?: LegacyTeamMember[],
): boolean {
  return roomMessages.some((m) => {
    const projectId = roomMessageProjectId(m);
    if (projectId && projectId !== taskId) return false;
    if (!roomMessageFromAgentMatches(m, roleId, teamMembers)) return false;
    return m.smartMemberEnd === true;
  });
}

/** 工作顺序中排除协调者本人步骤（协调者结项由 **项目结项** 覆盖，不要求【…已完成】）。 */
export function smartMemberWorkOrderSteps(
  steps: SmartWorkOrderStep[],
  coordinatorRoleId: string,
): SmartWorkOrderStep[] {
  return steps.filter((step) => {
    const executors = step.roleIds.filter((id) => id && id !== coordinatorRoleId);
    return executors.length > 0;
  });
}

/** 本步骤内尚未 action=end（smartMemberEnd）汇报完成的执行者（同一步可并行多人）。 */
export function pendingExecutorsInSmartWorkOrderStep(
  step: SmartWorkOrderStep,
  roomMessages: RoomMessage[],
  taskId: string,
): string[] {
  const pending: string[] = [];
  const seen = new Set<string>();
  for (const roleId of step.roleIds) {
    const id = roleId?.trim();
    if (!id || seen.has(id)) continue;
    if (roleReportedSubtaskDoneInRoom(roomMessages, taskId, id)) continue;
    seen.add(id);
    pending.push(id);
  }
  return pending;
}

/** 本步骤全部执行者均已 smartMemberEnd 汇报完成。 */
export function isSmartWorkOrderStepDoneInRoom(
  step: SmartWorkOrderStep,
  roomMessages: RoomMessage[],
  taskId: string,
): boolean {
  const executors = step.roleIds.filter((id) => id?.trim());
  if (executors.length === 0) return false;
  return executors.every((id) => roleReportedSubtaskDoneInRoom(roomMessages, taskId, id));
}

/** 工作顺序中每个步骤是否全部执行者 smartMemberEnd 完成（一步内须全部角色完成）。 */
function allWorkOrderStepsDoneInRoom(
  steps: SmartWorkOrderStep[],
  roomMessages: RoomMessage[],
  taskId: string,
): boolean {
  if (steps.length === 0) return false;
  for (const step of steps) {
    if (!isSmartWorkOrderStepDoneInRoom(step, roomMessages, taskId)) return false;
  }
  return true;
}

/** 成员步骤是否均已 smartMemberEnd 完成。 */
export function smartAllMemberWorkOrderStepsDoneInRoom(
  steps: SmartWorkOrderStep[],
  roomMessages: RoomMessage[],
  taskId: string,
  coordinatorRoleId: string,
): boolean {
  if (steps.length === 0) return true;
  const memberSteps = smartMemberWorkOrderSteps(steps, coordinatorRoleId);
  if (memberSteps.length === 0) return true;
  return allWorkOrderStepsDoneInRoom(memberSteps, roomMessages, taskId);
}

/**
 * 是否满足 Smart 结项闸门：成员步骤均已完成，且下一跳仅剩协调者或已全部完成。
 * （协调者在工作顺序末位时，不要求其 smartMemberEnd，以协调者 action=end 为准。）
 */
export function smartReadyForProjectClosure(
  steps: SmartWorkOrderStep[],
  roomMessages: RoomMessage[],
  taskOrProjectId: string,
  coordinatorRoleId: string,
): boolean {
  if (steps.length === 0) return true;
  if (!smartAllMemberWorkOrderStepsDoneInRoom(steps, roomMessages, taskOrProjectId, coordinatorRoleId)) {
    return false;
  }
  const next = resolveSmartNextExecutorRoleIds({
    steps,
    roomMessages,
    projectId: taskOrProjectId,
    taskId: taskOrProjectId,
  });
  return next.length === 0 || (next.length === 1 && next[0] === coordinatorRoleId);
}

/** @deprecated alias */
export const smartTaskAllStepsCompleteForClosure = smartReadyForProjectClosure;

/**
 * 当前应推进的工作顺序阶段：第一个尚未全部完成的步骤中，所有待执行角色 id（可并行多人）。
 * 全部完成时返回 []。
 */
export function resolveSmartNextExecutorRoleIds(params: {
  steps: SmartWorkOrderStep[];
  roomMessages: RoomMessage[];
  taskId?: string;
  projectId?: string;
}): string[] {
  const scopeId = resolveSmartRoomScopeId(params.taskId, params.projectId);
  for (const step of params.steps) {
    const pending = pendingExecutorsInSmartWorkOrderStep(
      step,
      params.roomMessages,
      scopeId,
    );
    if (pending.length > 0) return pending;
  }
  return [];
}

/** @deprecated 使用 {@link resolveSmartNextExecutorRoleIds}；仅取并行阶段第一个 id。 */
export function resolveSmartNextExecutorRoleId(params: {
  steps: SmartWorkOrderStep[];
  roomMessages: RoomMessage[];
  taskId?: string;
  projectId?: string;
}): string | null {
  const ids = resolveSmartNextExecutorRoleIds(params);
  return ids[0] ?? null;
}

export function findSmartWorkOrderStepIndexForRole(
  steps: SmartWorkOrderStep[],
  roleId: string | null | undefined,
): number {
  const id = (roleId ?? '').trim();
  if (!id) return -1;
  return steps.findIndex((s) => s.roleIds.includes(id));
}

/** 工作顺序中，viewer 所在步骤的上一跳全部执行者（并行步骤返回多人）。 */
export function resolveSmartPriorStepProducerRoleIds(
  viewerRoleId: string,
  steps: SmartWorkOrderStep[],
): string[] {
  const viewerIdx = findSmartWorkOrderStepIndexForRole(steps, viewerRoleId);
  if (viewerIdx <= 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of steps[viewerIdx - 1]!.roleIds) {
    const roleId = id?.trim();
    if (!roleId || seen.has(roleId)) continue;
    seen.add(roleId);
    out.push(roleId);
  }
  return out;
}

/** 工作顺序中，viewer 上一跳的第一个执行者（打回/上游补交付例外等单点场景）。 */
export function resolveSmartPriorProducerRoleId(
  viewerRoleId: string,
  steps: SmartWorkOrderStep[],
): string | null {
  return resolveSmartPriorStepProducerRoleIds(viewerRoleId, steps)[0] ?? null;
}

/** 结项过早失败说明：带上真实下一执行者与步骤名，避免泛泛「开发未交付」。 */
export function formatSmartPrematureProjectEndReason(params: {
  nextExecutorRoleIds: string[];
  teamRoles: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[];
  steps: SmartWorkOrderStep[];
}): string {
  const ids = params.nextExecutorRoleIds.filter(Boolean);
  if (ids.length === 0) {
    return '工作顺序尚有步骤未在群内汇报 **…已完成**，禁止 **项目结项**';
  }
  const names = ids
    .map((id) => params.teamRoles.find((r) => r.agentId === id)?.displayName ?? id)
    .join('、');
  const step = params.steps.find((s) => ids.some((id) => s.roleIds.includes(id)));
  const stepHint = step ? `步骤${step.stepIndex}「${step.title}」` : '当前步骤';
  const parallel =
    ids.length > 1
      ? `本阶段并行执行者：${names}（${stepHint}），须待该阶段全部成员在群内汇报 **…已完成** 后再 **项目结项**`
      : `下一执行者为 ${names}（${stepHint}），须待其在群内汇报 **…已完成** 后再 **项目结项**`;
  return `${parallel}；现须 @ ${names} 继续`;
}

export function formatSmartWorkOrderHint(
  steps: SmartWorkOrderStep[],
  roles: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[],
  nextRoleIds: string[] | null,
): string {
  if (steps.length === 0) {
    const roster = roles.map((r) => r.displayName).join('、');
    return [
      '【工作顺序】场景未配置 workflow 步骤；须按任务说明拆解。',
      `【团队成员】仅可 @ 以下角色（禁止编造「前端开发A」「后端开发B」等）：${roster}`,
      '【下一执行者】从上述成员中选一人或同阶段多人并行，在【分工】中 @ 其显示名。',
    ].join('\n');
  }
  const lines = steps.map((s) => {
    const owners = s.roleIds
      .map((id) => roles.find((r) => r.agentId === id)?.displayName ?? id)
      .join('、');
    return `${s.stepIndex}. ${s.title} → ${owners || '未指定'}`;
  });
  const ids = nextRoleIds?.filter(Boolean) ?? [];
  const nextLabel =
    ids.length === 0
      ? '（全部完成，可结项）'
      : ids
          .map((id) => roles.find((r) => r.agentId === id)?.displayName ?? id)
          .join('、');
  const nextLine =
    ids.length > 1
      ? `【本阶段·可并行 @】${nextLabel}（须待该阶段全部成员 **…已完成** 后再进入下一步）`
      : `【下一执行者】仅可 @：${nextLabel}`;
  return ['【工作顺序】', ...lines, nextLine].join('\n');
}

/** Smart 协调者：本项目唯一可 @ 的成员名册（禁止编造角色）。 */
export function buildSmartTeamMentionRosterBlock(params: {
  teamRoles: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[];
  coordinatorRoleId: string;
  nextExecutorRoleIds?: string[] | null;
  /** @deprecated 使用 nextExecutorRoleIds */
  nextExecutorRoleId?: string | null;
}): string {
  const team = params.teamRoles as LegacyTeamMember[];
  const roster = normalizeTeamMembers(team);
  const coordinatorId = resolveTeamAgentId(team, params.coordinatorRoleId);
  const members = roster.filter((r) => !agentIdsMatch(team, r.agentId, coordinatorId));
  const mentionList = members
    .map((r) => `${r.displayName}→@${roleMentionToken(r)}`)
    .join('；');
  const nextIds = resolveTeamAgentIds(team, [
    ...(params.nextExecutorRoleIds ?? []),
    ...(params.nextExecutorRoleId ? [params.nextExecutorRoleId] : []),
  ]);
  const uniqueNext = [...new Set(nextIds)];
  const nextRoles = uniqueNext
    .map((id) => roster.find((r) => agentIdsMatch(team, r.agentId, id)))
    .filter((r): r is Pick<ProjectAgentRef, 'agentId' | 'displayName'> => Boolean(r));
  const lines = [
    '【本项目·唯一可 @ 成员】',
    mentionList || '（无成员）',
    '禁止编造未上表的角色名；禁止 Markdown 表格/「任务拆解」清单代替【分工】；输出须含【任务理解】【输入校验】【输出校验】【交付产物】【群聊回复】【分工】。',
  ];
  if (nextRoles.length === 1) {
    const next = nextRoles[0]!;
    lines.push(`【本回合【分工】可 @】@${roleMentionToken(next)}（${next.displayName}）`);
  } else if (nextRoles.length > 1) {
    const tokens = nextRoles.map((r) => `@${roleMentionToken(r)}（${r.displayName}）`).join('、');
    lines.push(`【本回合【分工】可并行 @】${tokens}（同阶段须全部 **…已完成** 后再进入下一步）`);
  }
  return lines.join('\n');
}

/** 供测试：从 workflow 节点列表构建步骤。 */
export function smartWorkOrderFromNodes(nodes: WorkflowNode[]): SmartWorkOrderStep[] {
  return nodes.map((node, index) => ({
    stepIndex: index + 1,
    nodeId: node.id,
    title: node.title?.trim() || `步骤${index + 1}`,
    roleIds: workflowNodeRoleIds(node),
  }));
}
