import { deriveTaskProgressSync, type TaskStepSyncStatus } from '@/lib/office-task-progress-sync';
import {
  getBlockingPredecessorSteps,
  nodeRunsMap,
} from '@/lib/office-workflow-deps';
import { workflowNodeHasRole, workflowNodeRoleIds } from '@/lib/office-workflow-node';
import type {
  OfficeTempProject,
  RoomMessage,
  RoomMessagePhase,
  WorkflowEdge,
  WorkflowNode,
} from '@/types/office';
import type { ProjectAgentRef } from '@/lib/office-workflow-node';
import { roomMessageFromAgentId, roomMessageProjectId } from '@/lib/office-agent-id-resolve';

import {
  ROOM_MENTION_PROGRESS_REPLY_RULE,
  SMART_MENTION_PROGRESS_REPLY_RULE,
  WORKFLOW_MENTION_PROGRESS_REPLY_RULE,
} from '@/lib/office-room-progress-rules';
import { roleReportedSubtaskDoneInRoom } from '@/lib/office-smart-work-order';

export {
  ROOM_MENTION_PROGRESS_REPLY_RULE,
  SMART_MENTION_PROGRESS_REPLY_RULE,
  WORKFLOW_MENTION_PROGRESS_REPLY_RULE,
};

const STATUS_ZH: Record<TaskStepSyncStatus, string> = {
  pending: '待开始',
  running: '进行中',
  completed: '已完成',
  failed: '失败',
};

const NODE_RUN_STATUS_ZH: Record<string, string> = {
  pending: '待开始',
  running: '进行中',
  completed: '已完成',
  failed: '失败',
  skipped: '已跳过',
};

const PHASE_ZH: Partial<Record<RoomMessagePhase, string>> = {
  task_received: '已接任务',
  task_understanding: '理解复述',
  task_clarification: '协作询问',
  task_team_review: '团队评审',
  task_running: '执行中',
  task_deliver: '已交付',
  task_handoff: '已交接',
  project_closure: '项目收尾',
  deliverable_bundle: '交付物打包',
};

const TASK_STATUS_ZH: Record<string, string> = {
  pending: '待开始',
  running: '进行中',
  blocked: '阻塞',
  completed: '已完成',
  failed: '失败',
  aborted: '已中止',
};

function stepTitle(node: WorkflowNode, fallbackIndex: number): string {
  return node.title?.trim() || `步骤${fallbackIndex + 1}`;
}

function formatDependencyNote(
  node: WorkflowNode,
  index: number,
  status: TaskStepSyncStatus,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  task: OfficeTempProject,
  roles: { id: string; name: string }[],
): string | null {
  if (status === 'completed' || status === 'failed') return null;
  const blocking = getBlockingPredecessorSteps(
    node.id,
    nodes,
    edges,
    nodeRunsMap(task.nodeRuns),
    roles,
  );
  if (blocking.length === 0) return null;
  const parts = blocking.map(
    (b) => `「${b.title}」（${b.ownerNames}，${NODE_RUN_STATUS_ZH[b.status] ?? b.status}）`,
  );
  return `前置依赖未完成：${parts.join('、')}；依赖解除前不可开展本步骤（${stepTitle(node, index)}）。`;
}

function formatStepLine(
  title: string,
  status: TaskStepSyncStatus,
  phase: RoomMessagePhase | null,
  snippet: string | null,
  dependencyNote: string | null,
): string {
  const phasePart = phase ? `，${PHASE_ZH[phase] ?? phase}` : '';
  const snippetPart = snippet?.trim() ? ` — ${snippet.trim().slice(0, 200)}` : '';
  const depPart = dependencyNote ? `；${dependencyNote}` : '';
  return `- ${title}：${STATUS_ZH[status]}${phasePart}${snippetPart}${depPart}`;
}

export function buildMentionProgressContextBlock(params: {
  task: OfficeTempProject;
  workflowNodes: WorkflowNode[];
  workflowEdges?: WorkflowEdge[];
  roomMessages: RoomMessage[];
  roles: { id: string; name: string }[];
  viewerRoleId: string;
  isCoordinator: boolean;
}): string | null {
  const { task, workflowNodes, roomMessages, roles, viewerRoleId, isCoordinator } = params;
  const edges = params.workflowEdges ?? task.workflow?.edges ?? [];
  if (workflowNodes.length === 0) return null;

  const sync = deriveTaskProgressSync(task, workflowNodes, roomMessages ?? []);
  const stepByNode = new Map(sync.steps.map((s) => [s.nodeId, s]));

  const roleIds = isCoordinator ? roles.map((r) => r.id) : [viewerRoleId];

  const sections: string[] = [];

  for (const roleId of roleIds) {
    const role = roles.find((r) => r.id === roleId);
    const nodes = workflowNodes
      .map((node, index) => ({ node, index }))
      .filter(({ node }) => workflowNodeHasRole(node, roleId));
    if (nodes.length === 0) continue;

    const lines: string[] = [];
    for (const { node, index } of nodes) {
      const entry = stepByNode.get(node.id);
      const status = entry?.status ?? 'pending';
      const depNote = formatDependencyNote(
        node,
        index,
        status,
        workflowNodes,
        edges,
        task,
        roles,
      );
      lines.push(
        formatStepLine(
          stepTitle(node, index),
          status,
          entry?.phase ?? null,
          entry?.progressSnippet ?? null,
          depNote,
        ),
      );
    }

    const multiOnStep = nodes.some(({ node }) => workflowNodeRoleIds(node).length > 1);
    const header = isCoordinator
      ? `【${role?.name ?? roleId}】${multiOnStep ? '（协同步骤）' : ''}`
      : null;
    sections.push([header, ...lines].filter(Boolean).join('\n'));
  }

  if (sections.length === 0) return null;

  const summary =
    sync.runningLog && (isCoordinator || sync.currentStep != null)
      ? `任务总览：${sync.completedSteps}/${sync.totalSteps} 步已完成${sync.currentStep != null ? `，当前约第 ${sync.currentStep} 步` : ''}。最新执行日志：${sync.runningLog}`
      : `任务总览：${sync.completedSteps}/${sync.totalSteps} 步已完成。`;

  const title = isCoordinator
    ? '【本任务 · 各角色工作进度（含依赖阻塞）】'
    : '【本任务 · 我的工作进度（含依赖阻塞）】';

  return [
    title,
    summary,
    WORKFLOW_MENTION_PROGRESS_REPLY_RULE,
    sections.join('\n\n'),
  ].join('\n');
}

function formatSmartRoomLine(m: RoomMessage): string {
  const phase = m.phase ? PHASE_ZH[m.phase] ?? m.phase : null;
  const body = (m.progressText ?? m.content ?? '').trim().slice(0, 200);
  return [phase, body].filter(Boolean).join('：') || body || '（无正文）';
}

/** Smart 模式：从群聊镜像与任务状态汇总本角色已保存的工作进展。 */
export function buildSmartMentionProgressContextBlock(params: {
  task: OfficeTempProject;
  roomMessages: RoomMessage[];
  roles: ProjectAgentRef[];
  viewerAgentId: string;
  /** @deprecated use viewerAgentId */
  viewerRoleId?: string;
  isCoordinator: boolean;
  savedRoleSections?: Record<string, string>;
}): string | null {
  const {
    task,
    roomMessages,
    roles,
    isCoordinator,
    savedRoleSections,
  } = params;
  const viewerAgentId = (params.viewerAgentId ?? params.viewerRoleId ?? '').trim();
  const taskRoom = (roomMessages ?? []).filter((m) => roomMessageProjectId(m) === task.id);

  const sections: string[] = [];
  const agentIds = isCoordinator ? roles.map((r) => r.agentId) : [viewerAgentId];

  for (const agentId of agentIds) {
    const role = roles.find((r) => r.agentId === agentId);
    const ownMsgs = taskRoom
      .filter((m) => roomMessageFromAgentId(m) === agentId)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 6);
    const saved = savedRoleSections?.[agentId]?.trim() ?? null;

    const lines: string[] = [];
    if (saved) lines.push(`已保存进展：${saved}`);
    if (ownMsgs.length > 0) {
      lines.push(
        '群聊记录：',
        ...ownMsgs.map((m) => `  · ${formatSmartRoomLine(m)}`),
      );
    } else if (!saved) {
      lines.push('群聊记录：尚无本角色在本任务下的发言');
    }
    if (lines.length === 0) continue;
    const header = isCoordinator ? `【${role?.displayName ?? agentId}】` : null;
    sections.push([header, ...lines].filter(Boolean).join('\n'));
  }

  if (sections.length === 0) {
    const role = roles.find((r) => r.agentId === viewerAgentId);
    sections.push(
      [
        `【${role?.displayName ?? viewerAgentId}】`,
        '尚无已保存进展或群聊交付记录；若点名人交办的是新子任务，说明当前未开展并写清前置条件。',
      ].join('\n'),
    );
  }

  const title = isCoordinator
    ? '【智能任务 · 各角色工作进展】'
    : '【智能任务 · 我的工作进展】';

  return [
    title,
    `项目状态：${TASK_STATUS_ZH[task.status] ?? task.status}`,
    task.featureDescription?.trim() ? `功能范围：${task.featureDescription.trim().slice(0, 300)}` : '',
    SMART_MENTION_PROGRESS_REPLY_RULE,
    sections.join('\n\n'),
  ]
    .filter(Boolean)
    .join('\n');
}

/** Smart 协调者点名：每角色一行已保存进展（不重复群聊子弹；详录见【团队群聊近期记录】）。 */
export function buildSmartCoordinatorCompactProgressContext(params: {
  task: OfficeTempProject;
  roles: ProjectAgentRef[];
  savedRoleSections?: Record<string, string>;
  coordinatorSummary?: string | null;
  roomMessages?: RoomMessage[];
}): string {
  const { task, roles, savedRoleSections, coordinatorSummary, roomMessages } = params;
  const roomGate = Boolean(roomMessages?.length && task.id);
  const lines: string[] = [];
  for (const role of roles) {
    const reportedInRoom =
      roomGate && task.id
        ? roleReportedSubtaskDoneInRoom(roomMessages!, task.id, role.agentId)
        : true;
    if (!reportedInRoom) {
      lines.push(
        `· ${role.displayName}：尚未在群内汇报 **…已完成**（磁盘产物或状态文件不代表完成）`,
      );
      continue;
    }
    const saved = savedRoleSections?.[role.agentId]?.trim();
    if (saved) {
      lines.push(`· ${role.displayName}：${saved.slice(0, 160)}`);
    } else if (roomGate) {
      lines.push(`· ${role.displayName}：已在群内汇报完成`);
    } else {
      lines.push(`· ${role.displayName}：尚无已保存进展`);
    }
  }
  const summary = coordinatorSummary?.trim();
  return [
    '【进展摘要】',
    `项目状态：${TASK_STATUS_ZH[task.status] ?? task.status}`,
    summary ? `协调者备忘：${summary.slice(0, 300)}` : '',
    lines.join('\n'),
  ]
    .filter(Boolean)
    .join('\n');
}

/** @deprecated 点名触发块已按模式拆分至 electron room-prompts；保留供旧测试。 */
export function buildMentionTriggerBlock(
  speaker: string,
  roomLine: string,
  replyQuote?: { fromLabel: string; preview: string } | null,
): string {
  const line = roomLine.trim();
  const preview = replyQuote?.preview?.trim() || line;
  return [
    '【本次点名】',
    `点名人：${speaker}`,
    `群聊：「${line}」`,
    preview && preview !== line ? `摘录：${preview}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
