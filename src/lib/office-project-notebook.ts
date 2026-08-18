import { deriveTaskProgressSync, type TaskStepSyncStatus } from '@/lib/office-task-progress-sync';
import { workflowNodeRoleIds } from '@/lib/office-workflow-node';
import type { OfficeTempProject, RoomMessage, WorkflowNode } from '@/types/office';

export const PROJECT_NOTEBOOK_FILE_PREFIX = '项目进度汇报';
export const PROJECT_NOTEBOOK_COORDINATOR_MAX_CHARS = 800;
export const PROJECT_NOTEBOOK_ROLE_MAX_CHARS = 400;

export type ProjectNotebook = {
  taskId: string;
  taskTitle: string;
  /** 协调者压缩总览（≤800 字） */
  coordinatorSummary: string;
  updatedAt: number;
  roles: Record<string, string>;
};

const STEP_STATUS_ZH: Record<TaskStepSyncStatus, string> = {
  pending: '尚未开展',
  running: '进行中',
  completed: '已完成',
  failed: '失败',
};

export function sanitizeNotebookDirName(taskTitle: string): string {
  const raw = typeof taskTitle === 'string' ? taskTitle : String(taskTitle ?? '');
  const trimmed = raw.trim() || '未命名任务';
  const safe = trimmed.replace(/[/\\?%*:|"<>]/g, '_').replace(/\s+/g, ' ').slice(0, 80);
  return safe || '未命名任务';
}

export function projectNotebookFileName(taskId: string): string {
  return `${PROJECT_NOTEBOOK_FILE_PREFIX}-${taskId}.json`;
}

function formatNotebookTimestamp(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function latestNodeActivityMs(
  roomMessages: RoomMessage[],
  taskId: string,
  nodeId: string,
): number | null {
  let latest: number | null = null;
  for (const m of roomMessages) {
    if (m.projectId !== taskId || m.nodeId !== nodeId) continue;
    if (latest == null || m.timestamp > latest) latest = m.timestamp;
  }
  return latest;
}

function truncateText(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function buildCoordinatorSummaryFromTask(params: {
  task: OfficeTempProject;
  workflowNodes: WorkflowNode[];
  roomMessages: RoomMessage[];
  roles: Array<{ agentId?: string; displayName?: string; id?: string; name?: string }>;
}): string {
  const { task, workflowNodes, roomMessages, roles } = params;
  if (workflowNodes.length === 0) return '';

  const roleLabel = (id: string) => {
    const hit = roles.find((r) => r.agentId === id || r.id === id);
    return hit?.displayName ?? hit?.name ?? id;
  };

  const sync = deriveTaskProgressSync(task, workflowNodes, roomMessages);
  const stepByNode = new Map(sync.steps.map((s) => [s.nodeId, s]));

  const lines: string[] = [];
  workflowNodes.forEach((node, index) => {
    const title = node.title?.trim() || `步骤${index + 1}`;
    const ownerIds = workflowNodeRoleIds(node);
    const owner =
      ownerIds
        .map((id) => roleLabel(id))
        .filter(Boolean)
        .join('、') || '未指定';
    const entry = stepByNode.get(node.id);
    const status = STEP_STATUS_ZH[entry?.status ?? 'pending'];
    const activityMs = latestNodeActivityMs(roomMessages, task.id, node.id);
    const time = activityMs != null ? formatNotebookTimestamp(activityMs) : '—';
    lines.push(`任务${index + 1}:${title}，owner:${owner}，时间(${time})：${status}`);
  });

  return truncateText(lines.join('\n'), PROJECT_NOTEBOOK_COORDINATOR_MAX_CHARS);
}

export function buildRoleNotebookSection(params: {
  roleName: string;
  task: OfficeTempProject;
  workflowNodes: WorkflowNode[];
  roomMessages: RoomMessage[];
  roleId: string;
  latestReplySnippet?: string | null;
}): string {
  const { roleName, task, workflowNodes, roomMessages, roleId, latestReplySnippet } = params;
  const sync = deriveTaskProgressSync(task, workflowNodes, roomMessages);
  const stepByNode = new Map(sync.steps.map((s) => [s.nodeId, s]));

  const mySteps = workflowNodes
    .map((node, index) => ({ node, index }))
    .filter(({ node }) => workflowNodeRoleIds(node).includes(roleId));

  const stepLines = mySteps.map(({ node, index }) => {
    const title = node.title?.trim() || `步骤${index + 1}`;
    const entry = stepByNode.get(node.id);
    return `${title}：${STEP_STATUS_ZH[entry?.status ?? 'pending']}`;
  });

  const time = formatNotebookTimestamp(Date.now());
  const parts = [
    `【${roleName}】${time}`,
    stepLines.length > 0 ? stepLines.join('；') : '当前无分配步骤',
  ];
  if (latestReplySnippet?.trim()) {
    parts.push(`最近回复：${latestReplySnippet.trim().slice(0, 120)}`);
  }
  return truncateText(parts.join('。'), PROJECT_NOTEBOOK_ROLE_MAX_CHARS);
}

export function formatProjectNotebookPromptBlock(
  notebook: ProjectNotebook,
  options: {
    isCoordinator: boolean;
    viewerRoleId: string;
    /** Latest per-role status lines (coordinator reads all; member reads own). */
    roleStatusLines?: Record<string, string>;
  },
): string | null {
  const parts: string[] = ['【项目进度汇报】'];
  const summary = notebook.coordinatorSummary.trim();
  if (summary) parts.push(summary);

  const statusLines = options.roleStatusLines ?? {};
  if (!options.isCoordinator) {
    const own = statusLines[options.viewerRoleId]?.trim() ?? notebook.roles[options.viewerRoleId]?.trim();
    if (own) parts.push(`【本角色工作状态】\n${own}`);
  } else {
    const roleLines = Object.entries(statusLines)
      .filter(([, v]) => v?.trim())
      .map(([id, v]) => `· ${id}: ${v.trim().slice(0, 120)}`);
    if (roleLines.length > 0) {
      parts.push(`【各角色最新状态】\n${roleLines.join('\n')}`);
    }
  }

  const body = parts.join('\n\n').trim();
  if (body.length <= '【项目进度汇报】'.length) return null;
  return truncateText(body, PROJECT_NOTEBOOK_COORDINATOR_MAX_CHARS + 200);
}

export function emptyProjectNotebook(taskId: string, taskTitle: string): ProjectNotebook {
  return {
    taskId,
    taskTitle,
    coordinatorSummary: '',
    updatedAt: Date.now(),
    roles: {},
  };
}

const TASK_STATUS_ZH: Record<string, string> = {
  pending: '待开始',
  running: '进行中',
  blocked: '阻塞',
  completed: '已完成',
  failed: '失败',
  aborted: '已中止',
};

/** Smart 任务：从群聊汇总协调者视角的压缩进展。 */
export function buildSmartCoordinatorSummaryFromRoom(params: {
  task: Pick<OfficeTempProject, 'id' | 'title' | 'status'>;
  roomMessages: RoomMessage[];
  roles: { agentId: string; displayName: string }[];
}): string {
  const { task, roomMessages, roles } = params;
  const taskRoom = roomMessages
    .filter((m) => m.projectId === task.id)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 12);
  const byRole = new Map<string, RoomMessage>();
  for (const m of taskRoom) {
    if (!m.fromAgentId || byRole.has(m.fromAgentId)) continue;
    byRole.set(m.fromAgentId, m);
  }
  const lines = [`整体：${TASK_STATUS_ZH[task.status] ?? task.status}`];
  for (const [roleId, m] of byRole) {
    const name = roles.find((r) => r.agentId === roleId)?.displayName ?? roleId;
    const snippet = (m.progressText ?? m.content ?? '').trim().slice(0, 80);
    if (snippet) lines.push(`${name}：${snippet}`);
  }
  return truncateText(lines.join('\n'), PROJECT_NOTEBOOK_COORDINATOR_MAX_CHARS);
}

/** Smart 任务：持久化本角色工作进展（群聊 + 最近回复）。 */
export function buildSmartRoleNotebookSection(params: {
  roleName: string;
  task: Pick<OfficeTempProject, 'id' | 'status'>;
  roomMessages: RoomMessage[];
  roleId: string;
  latestReplySnippet?: string | null;
}): string {
  const { roleName, task, roomMessages, roleId, latestReplySnippet } = params;
  const ownMsgs = roomMessages
    .filter((m) => m.projectId === task.id && m.fromAgentId === roleId)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 4);
  const snippets = ownMsgs
    .map((m) => (m.progressText ?? m.content ?? '').trim().slice(0, 80))
    .filter(Boolean);
  const time = formatNotebookTimestamp(Date.now());
  const parts = [
    `【${roleName}】${time}`,
    `任务状态：${TASK_STATUS_ZH[task.status] ?? task.status}`,
    snippets.length > 0 ? `近期群聊：${snippets.join('；')}` : '近期群聊：尚无记录',
  ];
  if (latestReplySnippet?.trim()) {
    parts.push(`最近回复：${latestReplySnippet.trim().slice(0, 120)}`);
  }
  return truncateText(parts.join('。'), PROJECT_NOTEBOOK_ROLE_MAX_CHARS);
}
