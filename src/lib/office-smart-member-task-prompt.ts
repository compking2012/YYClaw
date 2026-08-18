import { buildSmartMemberJsonSchemaLines } from '@/lib/office-smart-task-prompt-shared';
import type { SmartMemberExecutionReadiness } from '@/lib/office-smart-member-reply';
import {
  extractProjectRootFromProgressContext,
  formatSmartTaskGoal,
  type SmartTaskPromptTask,
} from '@/lib/office-smart-task-prompt-common';

export type SmartMemberTaskPromptParams = {
  roleName: string;
  coordinatorName: string;
  task?: SmartTaskPromptTask;
  taskProgressContext?: string | null;
  projectRootDisplay?: string | null;
  /** 协调者本条点名/指派原文 */
  currentAssignment: string;
  /** @deprecated 不再写入提示词，仅保留参数兼容 */
  smartMemberReadiness?: SmartMemberExecutionReadiness;
};

function resolveMemberProjectRoot(params: SmartMemberTaskPromptParams): string {
  return (
    params.projectRootDisplay?.trim()
    || extractProjectRootFromProgressContext(params.taskProgressContext)
    || '（由引擎管理）'
  );
}

/** @deprecated 不再注入成员提示词 */
export function buildSmartMemberReadinessRuleSuffix(
  _readiness: SmartMemberExecutionReadiness | undefined,
  _coordinatorName: string,
): string {
  return '';
}

/** Smart 成员角色任务提示词（严格五段结构）。 */
export function buildSmartMemberAgentTaskPrompt(params: SmartMemberTaskPromptParams): string {
  const roleName = (params.roleName ?? '').trim() || '成员';
  const coordinatorName = (params.coordinatorName ?? '').trim() || '协调者';
  const assignment = (params.currentAssignment ?? '').trim() || '（见本次点名）';
  const taskTitle = params.task?.title?.trim() || '（未命名）';
  const taskGoal = formatSmartTaskGoal(params.task ?? null);
  const projectRoot = resolveMemberProjectRoot(params);
  const deliverableDir = `交付物-${roleName}/`;

  const sections: string[] = [
    '一.【角色信息】',
    `1.1.我是:${roleName}`,
    `1.2.协调者:${coordinatorName}`,
    '',
    '二.【项目信息】',
    `2.1 项目名称：${taskTitle}`,
    `2.2 项目目标：${taskGoal}`,
    `2.3 项目根目录（唯一读写路径，禁止私有目录存储）：${projectRoot}`,
    '',
    '三. 当前任务(来自协调者的指派)：',
    assignment,
    '',
    '四.【执行与交付规范】',
    '4.1 任务接收：以最新指令为执行基准，不因历史记录"已完成"拒做。',
    '4.2 完成任务与自测验收：',
    '-正常交付：前置条件就绪→完成任务→文件落盘+自测→通过 action="end" 汇报，dispatch 数组派给协调者验收。禁止 虚报任务完成、或无 ls -l 校验谎称交付',
    '-阻塞求助：若资源缺失或任务无法开展，使用 action="help"，deliverable.items 与 outputValidation 均为 []，dispatch 派给协调者。',
    '4.3 交付物规范：',
    `-交付物命名格式：xxx-角色名.格式，项目如对格式有要求，则按要求填写(如.pdf,.xlsx,.pptx等)；对格式无要求则默认.md，如 xxx-${roleName}.md）`,
    `-交付物存放路径：所有交付物必须存放于项目根目录下的 交付物-角色名/ 目录下（如 ${deliverableDir}）`,
    '',
    '五、输出格式规范（**绝对强制**）',
    '1. 仅输出标准JSON字符串，禁止任何额外文字、注释、Markdown、解释性内容',
    '2. 所有字段约束已内嵌至Schema的description中，必须逐条遵守',
    ...buildSmartMemberJsonSchemaLines(roleName),
  ];

  return sections.join('\n');
}
