import type { GatewayManager } from '../../gateway/manager';
import type {
  NodeRunRecord,
  OfficeExecutionMember,
  OfficeFixedGroup,
  OfficeTempProject,
  WorkflowNode,
} from './types';
import { postRoomAnnouncement } from './orchestrator';
import { roleMentionToken } from '../../../src/lib/office-mention';
import { workflowNodeRoleIds } from '../../../src/lib/office-workflow-node';
import {
  executionMemberLabel,
  loadProjectExecutionMembers,
  resolveRoomCoordinatorMember,
} from './office-execution-members';

function stepLabel(task: OfficeTempProject, node: WorkflowNode): string {
  return node.title?.trim() || task.title;
}

function memberPrefix(member: OfficeExecutionMember): string {
  return `${member.emoji ?? '🤖'} 【${executionMemberLabel(member)}】`;
}

/** Coordinator for room posts; per-project override, then group default. */
export function resolveRoomCoordinator(
  group: OfficeFixedGroup,
  teamMembers: OfficeExecutionMember[],
  fallback?: OfficeExecutionMember,
  task?: Pick<OfficeTempProject, 'coordinatorAgentId' | 'agentIds'> | null,
): OfficeExecutionMember | null {
  return resolveRoomCoordinatorMember(group, teamMembers, task, fallback);
}

/** Runner 满足依赖后启动一批节点：群聊仅公示指派，不触发成员点名 LLM。 */
/** 输入不合格 / 结论不通过：工作流回流至前驱步骤，群聊公示 @ 上游（执行仍由 runner 触发节点会话）。 */
export async function announceWorkflowUpstreamRework(
  gateway: GatewayManager,
  group: OfficeFixedGroup,
  task: OfficeTempProject,
  fromMember: OfficeExecutionMember,
  currentNode: WorkflowNode,
  predecessorNodes: WorkflowNode[],
  upstreamMembers: OfficeExecutionMember[],
  reason: string,
  opts?: { reasonLabel?: string },
): Promise<void> {
  const team = await loadProjectExecutionMembers(task);
  const coord = resolveRoomCoordinatorMember(group, team, task, fromMember);
  if (!coord) return;

  const assignLines = predecessorNodes.map((node, index) => {
    const nodeMembers = workflowNodeRoleIds(node)
      .map((id) => team.find((m) => m.agentId === id))
      .filter((m): m is OfficeExecutionMember => !!m);
    const assignees =
      nodeMembers.length > 0
        ? nodeMembers.map((m) => `@${roleMentionToken(m)}`).join(' ')
        : '（未分配）';
    const name = node.title?.trim() || `步骤 ${index + 1}`;
    return `${name} → ${assignees}`;
  });

  const mentionIds = [
    ...new Set([
      ...upstreamMembers.map((m) => m.agentId),
      ...predecessorNodes.flatMap((n) => workflowNodeRoleIds(n)),
    ]),
  ];

  const step = currentNode.title?.trim() || task.title;
  const reasonLabel = opts?.reasonLabel?.trim() || '输入校验未通过';
  await postRoomAnnouncement(gateway, {
    scenarioId: group.id,
    coordinatorAgentId: coord.agentId,
    fromRoleId: fromMember.agentId,
    content: [
      `${memberPrefix(fromMember)}↩️ 工作流回流 · ${step}`,
      `${reasonLabel}：${reason.trim().slice(0, 300)}`,
      '系统已将下列上游步骤重新置为待执行，完成后本步将自动重试：',
      assignLines.join('\n'),
    ].join('\n'),
    phase: 'task_clarification',
    taskId: task.id,
    nodeId: currentNode.id,
    mentions: mentionIds,
    notifyMentionedRoles: false,
    syncGateway: true,
  });
}

/** 用户介入：群聊公示重开步骤，执行由 runner 在节点会话完成。 */
export async function announceWorkflowUserIntervention(
  gateway: GatewayManager,
  group: OfficeFixedGroup,
  task: OfficeTempProject,
  node: WorkflowNode,
  targetMembers: OfficeExecutionMember[],
  userContent: string,
  hasDownstream: boolean,
  opts?: { kind?: 'redo' | 'skip_to' | 'other'; skippedTitle?: string },
): Promise<void> {
  const team = await loadProjectExecutionMembers(task);
  const coord = resolveRoomCoordinatorMember(group, team, task);
  if (!coord) return;

  const assignees = targetMembers.map((m) => `@${roleMentionToken(m)}`).join(' ');
  const step = node.title?.trim() || task.title;
  const tail = hasDownstream
    ? '完成后工作流将按 DAG 自动推进后续步骤（如下游测试等）。'
    : '完成后工作流将按 DAG 继续。';
  const actionLine =
    opts?.kind === 'skip_to' && opts.skippedTitle
      ? `已跳过「${opts.skippedTitle}」，按用户要求执行下一步「${step}」（指派 ${assignees}）。`
      : `已按用户要求重开工作流步骤「${step}」，指派 ${assignees} 在节点任务会话中重新执行。`;

  await postRoomAnnouncement(gateway, {
    scenarioId: group.id,
    coordinatorAgentId: coord.agentId,
    fromRoleId: coord.agentId,
    content: [
      `${memberPrefix(coord)}👤 用户介入 · ${task.title}`,
      actionLine,
      `用户要求摘要：${userContent.trim().slice(0, 400)}`,
      '介入标记将在本步骤执行完成后自动清除；介入期间将忽略其他用户介入指令。',
      tail,
    ].join('\n'),
    phase: 'task_received',
    taskId: task.id,
    nodeId: node.id,
    mentions: targetMembers.map((m) => m.agentId),
    notifyMentionedRoles: false,
    syncGateway: true,
  });
}

export async function announceWorkflowRunnableBatch(
  gateway: GatewayManager,
  group: OfficeFixedGroup,
  task: OfficeTempProject,
  nodes: WorkflowNode[],
): Promise<void> {
  if (nodes.length === 0) return;
  const team = await loadProjectExecutionMembers(task);
  const coord = resolveRoomCoordinatorMember(group, team, task);
  if (!coord) return;

  const lines = nodes.map((node, index) => {
    const nodeMembers = workflowNodeRoleIds(node)
      .map((id) => team.find((m) => m.agentId === id))
      .filter((m): m is OfficeExecutionMember => !!m);
    const assignees =
      nodeMembers.length > 0
        ? nodeMembers.map((m) => `@${roleMentionToken(m)}`).join(' ')
        : '（未分配 Agent）';
    const name = node.title?.trim() || `步骤 ${index + 1}`;
    return `${index + 1}. ${name} → ${assignees}`;
  });

  const mentionIds = [...new Set(nodes.flatMap((n) => workflowNodeRoleIds(n)))];

  await postRoomAnnouncement(gateway, {
    scenarioId: group.id,
    coordinatorAgentId: coord.agentId,
    fromRoleId: coord.agentId,
    content: [
      `${memberPrefix(coord)}🔀 工作流推进 · ${task.title}`,
      '以下步骤依赖已满足，系统已自动指派（成员在节点任务会话中执行，无需群聊 @ 触发）：',
      lines.join('\n'),
    ].join('\n'),
    phase: 'task_running',
    taskId: task.id,
    mentions: mentionIds,
    notifyMentionedRoles: false,
    syncGateway: false,
  });
}

export async function announceTaskWorkflowStarted(
  gateway: GatewayManager,
  group: OfficeFixedGroup,
  task: OfficeTempProject,
  nodes: WorkflowNode[],
  mode: string,
): Promise<void> {
  const team = await loadProjectExecutionMembers(task);
  const coord = resolveRoomCoordinatorMember(group, team, task);
  if (!coord) return;

  const stepLines = nodes.map((node, index) => {
    const nodeMembers = workflowNodeRoleIds(node)
      .map((id) => team.find((m) => m.agentId === id))
      .filter((m): m is OfficeExecutionMember => !!m);
    const roleLabel =
      nodeMembers.length > 0
        ? nodeMembers.map((m) => `${m.emoji ?? '🤖'} ${executionMemberLabel(m)}`).join(' + ')
        : node.agentId;
    const name = node.title?.trim() || `步骤 ${index + 1}`;
    return `${index + 1}. ${name} · ${roleLabel}`;
  });

  await postRoomAnnouncement(gateway, {
    scenarioId: group.id,
    coordinatorAgentId: coord.agentId,
    fromRoleId: coord.agentId,
    content: [
      `${memberPrefix(coord)}🚀 任务开始 · ${task.title}`,
      `执行模式：${mode === 'fresh' ? '全新执行' : mode === 'continue' ? '续跑' : mode}`,
      task.featureDescription?.trim()
        ? `功能描述：${task.featureDescription.trim().slice(0, 400)}`
        : '',
      task.description?.trim() ? `任务说明：${task.description.trim().slice(0, 400)}` : '',
      stepLines.length > 0 ? `工作流步骤（共 ${stepLines.length} 步）：\n${stepLines.join('\n')}` : '',
      '各 Agent 执行进度将同步更新到本群。',
    ]
      .filter(Boolean)
      .join('\n'),
    phase: 'task_received',
    taskId: task.id,
    syncGateway: false,
  });
}

export function buildTaskWorkflowFinishedContent(params: {
  coordinator: Pick<OfficeExecutionMember, 'emoji' | 'displayName' | 'agentId'>;
  task: Pick<OfficeTempProject, 'title' | 'status'>;
  nodes: WorkflowNode[];
  runs: Map<string, NodeRunRecord>;
}): string {
  const { coordinator, task, nodes, runs } = params;
  const completed = nodes.filter((n) => runs.get(n.id)?.status === 'completed').length;
  const failedNodes = nodes.filter((n) => runs.get(n.id)?.status === 'failed');
  const total = nodes.length;

  const icon = task.status === 'completed' ? '✅' : task.status === 'aborted' ? '⏹️' : task.status === 'failed' ? '⚠️' : '📌';
  const headline =
    task.status === 'completed'
      ? '任务完成'
      : task.status === 'aborted'
        ? '任务中止'
        : failedNodes.length > 0 && completed > 0
          ? '任务暂停'
          : '任务结束';

  const lines = [
    `${coordinator.emoji ?? '🤖'} 【${executionMemberLabel(coordinator)}】${icon} ${headline} · ${task.title}`,
    `进度：${completed}/${total} 步完成${failedNodes.length > 0 ? `，${failedNodes.length} 步失败` : ''}。`,
  ];

  if (failedNodes.length > 0) {
    lines.push('', '失败步骤：');
    for (const node of failedNodes) {
      const run = runs.get(node.id);
      const title = node.title?.trim() || node.id;
      const err = run?.error?.trim();
      lines.push(err ? `· ${title}：${err.slice(0, 200)}` : `· ${title}`);
    }
    if (completed > 0) {
      lines.push(
        '',
        '说明：其他步骤可能已在群聊交付成功；请根据失败步骤修正后，由协调者续跑或单步重试。',
      );
    }
  }

  return lines.join('\n');
}

export async function announceTaskWorkflowFinished(
  gateway: GatewayManager,
  group: OfficeFixedGroup,
  task: OfficeTempProject,
  nodes: WorkflowNode[],
  runs: Map<string, NodeRunRecord>,
): Promise<void> {
  const team = await loadProjectExecutionMembers(task);
  const coord = resolveRoomCoordinatorMember(group, team, task);
  if (!coord) return;

  await postRoomAnnouncement(gateway, {
    scenarioId: group.id,
    coordinatorAgentId: coord.agentId,
    fromRoleId: coord.agentId,
    content: buildTaskWorkflowFinishedContent({
      coordinator: coord,
      task,
      nodes,
      runs,
    }),
    phase: task.status === 'completed' ? 'task_handoff' : 'task_clarification',
    taskId: task.id,
    syncGateway: false,
  });
}

export async function announceTaskNodeStalled(
  gateway: GatewayManager,
  group: OfficeFixedGroup,
  task: OfficeTempProject,
  node: WorkflowNode,
  member: OfficeExecutionMember,
  reason: string,
): Promise<void> {
  const team = await loadProjectExecutionMembers(task);
  const coord = resolveRoomCoordinatorMember(group, team, task, member);
  if (!coord) return;

  await postRoomAnnouncement(gateway, {
    scenarioId: group.id,
    coordinatorAgentId: coord.agentId,
    fromRoleId: member.agentId,
    content: `${memberPrefix(member)}⏸️ 步骤阻塞 · ${stepLabel(task, node)}\n${reason.slice(0, 500)}`,
    phase: 'task_clarification',
    taskId: task.id,
    nodeId: node.id,
    syncGateway: false,
  });
}
