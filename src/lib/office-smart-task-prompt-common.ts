import { officeProjectRootDisplayPath } from '@/lib/office-agent-workspace';
import { projectDirSegment } from '@/lib/office-project-context';

export type SmartTaskPromptTask = {
  title?: string;
  description?: string | null;
  featureDescription?: string | null;
} | null;

export function extractProjectRootFromProgressContext(text: string | null | undefined): string {
  if (!text?.trim()) return '';
  const officeProject = text.match(/^-\s*(~\/\.openclaw\/office\/project\/[^\n]+)/m);
  if (officeProject?.[1]) return officeProject[1].trim();
  const legacyWorkspace = text.match(/^-\s*(~\/\.openclaw\/workspace-[^\n]+)/m);
  if (legacyWorkspace?.[1]) return legacyWorkspace[1].trim();
  const generic = text.match(/^-\s*(~\/[^\n]+)/m);
  return generic?.[1]?.trim() ?? '';
}

/** 提示词用规范项目根目录展示路径（与磁盘 tempProjectRoot 一致）。 */
export function formatOfficeProjectRootDisplayPath(
  taskTitle: string,
  taskId: string,
  openclawHome: string = process.env.OPENCLAW_HOME?.trim() || `${process.env.HOME || ''}/.openclaw`,
): string {
  return officeProjectRootDisplayPath(
    openclawHome,
    { agentId: '', name: '' },
    [],
    taskTitle,
    taskId,
    projectDirSegment,
  );
}

export function extractRoomTranscript(roomContext: string | null | undefined): string {
  if (!roomContext?.trim()) return '（尚无群聊记录）';
  const lines = roomContext.split('\n');
  const startIdx = lines.findIndex((line) => /^\[\d+\]/.test(line.trim()));
  if (startIdx >= 0) return lines.slice(startIdx).join('\n').trim();
  return roomContext.trim();
}

export function formatSmartTaskGoal(task: SmartTaskPromptTask): string {
  const feature = task?.featureDescription?.trim();
  if (feature) return feature;
  return task?.description?.trim() || '（见任务说明）';
}

/** 协调者本回合触发：去掉与「项目目标」重复的「功能描述：…」行。 */
export function sanitizeSmartCoordinatorCurrentTrigger(
  trigger: string | null | undefined,
  _task?: SmartTaskPromptTask,
): string {
  const raw = (trigger ?? '').trim() || '（见本次点名）';
  const lines = raw.split('\n').filter((line) => {
    const t = line.trim();
    return t.length > 0 && !/^功能描述[：:]/u.test(t);
  });
  const cleaned = lines.join('\n').trim();
  return cleaned || raw;
}

export const SMART_COORDINATOR_DUTY =
  '结合项目目标、团队角色分工与历史进展，将整体项目拆解为可落地的独立子任务，按工作顺序精准指派对应成员执行；无依赖的子任务可并行指派多名成员同步推进。';

export function buildSmartDeliverableSpecLines(roleName?: string): string[] {
  const role = roleName?.trim() || '角色名';
  const dir = `交付物-${role}/`;
  return [
    `1. 所有交付物须落在 \`${dir}\` 目录下（与 Workflow 一致）；文档类命名为 \`xxx-${role}.md\`（或协调者指派的 .pdf/.xlsx/.pptx 等），deliverable.items 写相对路径如 \`${dir}xxx-${role}.md\`。`,
    `2. 工程/多文件类 deliverable.items 写 \`${dir}\` 或目录内相对路径；禁止 target/、项目根散落文件或其它自定义目录名。`,
    '3. 通用约束：所有文件读取、校验、ls 查询仅限项目根目录；deliverable.outputValidation 写数组，逐项对应 deliverable.items 内文件/目录的完整 ls -l 结果行；deliverable.items 只写相对路径（禁止绝对路径）；禁止粘贴完整文档/源码；禁止输出撰写中、待开发等非终态进度话术。',
    '4. 协调者指派成员时：dispatch[].task 中的落盘路径必须写「交付物-{被指派成员显示名}/」，禁止写协调者自己的交付目录；成员须严格按此规则落盘，不得沿用任务描述里错误的协调者目录。',
  ];
}

export function buildSmartProjectBaseLines(params: {
  task: SmartTaskPromptTask;
  taskProgressContext?: string | null;
  projectRootDisplay?: string | null;
}): string[] {
  const projectRoot =
    params.projectRootDisplay?.trim()
    || extractProjectRootFromProgressContext(params.taskProgressContext)
    || '（由引擎管理）';
  const taskTitle = params.task?.title?.trim() || '（未命名项目）';
  return [
    '1. 项目基础',
    `- 项目名称：${taskTitle}`,
    `- 项目目标：${formatSmartTaskGoal(params.task)}`,
    `- 项目根目录（唯一读写路径，禁止私有目录存储）：${projectRoot}`,
  ];
}

/** 协调者 @ 指派协议：下一任务执行者须从协调者与团队成员中选择。 */
export function buildSmartCoordinatorDispatchProtocolLines(params: {
  coordinatorRoleId?: string;
  coordinatorAgentId?: string;
  coordinatorName: string;
  teamRoles?: Array<{ id?: string; name?: string; agentId?: string; displayName?: string }>;
  teammateNames?: string[];
}): string[] {
  const coordName = params.coordinatorName.trim() || '协调者';
  const coordId = (params.coordinatorAgentId ?? params.coordinatorRoleId)?.trim();
  const fromRoles = (params.teamRoles ?? []).filter((r) => {
    const id = (r.agentId ?? r.id ?? '').trim();
    return id !== coordId;
  });
  const memberNames =
    fromRoles.length > 0
      ? fromRoles.map((r) => (r.displayName ?? r.name ?? '').trim()).filter(Boolean)
      : (params.teammateNames ?? []).map((n) => n.trim()).filter(Boolean);
  const validPool = [coordName, ...memberNames.filter((n) => n !== coordName)];
  const uniquePool = [...new Set(validPool)];
  return uniquePool;
}

/** 协调者 @ 指派协议段落（动态名单）。 */
export function buildSmartCoordinatorAssignProtocolLines(
  assignableRolePool: string[],
  currentAssignableRoleNames?: string | null,
): string[] {
  const current = currentAssignableRoleNames?.trim();
  void assignableRolePool;
  return [
    `1. 本轮允许指派：${current || '（未提供，须从团队真实角色中选择）'}`,
    '2. dispatch[].role 必须严格填写团队成员显示名之一；禁止填写不存在的角色，禁止填写泛称如「分析师」「开发」；没有任务指派可填「无」。同一成员多个子任务：dispatch 数组中写多条相同 role（每条一项 task），禁止把多个子任务挤在一条 task 里省略编号。',
    '3. dispatch[].task 必须写清楚：任务目标、输入材料、输出文件名/格式、落盘位置、验收标准；没有任务指派可填「无」。',
    '4. 无依赖的多名执行者须在同一轮 dispatch 数组中一并列出以实现并行 Session 派发；成员 A 汇报完成后：验收写在 roomReply，禁止 dispatch 点名 A；须在 dispatch 数组指派下一阶段执行者（可并行多项）。',
  ].filter(Boolean);
}
