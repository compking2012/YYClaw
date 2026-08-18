import { buildCoordinatorRoundGoal } from '@/lib/office-smart-coordinator-round-goal';
import { extractSmartCoordinatorDispatchOnlyText } from '@/lib/office-smart-room-fields';
import { buildSmartCoordinatorJsonSchemaLines } from '@/lib/office-smart-task-prompt-shared';
import type { SmartMemberReportToCoordinatorKind } from '@/lib/office-smart-member-reply';
import {
  extractProjectRootFromProgressContext,
  extractRoomTranscript,
  formatSmartTaskGoal,
  sanitizeSmartCoordinatorCurrentTrigger,
  type SmartTaskPromptTask,
} from '@/lib/office-smart-task-prompt-common';

export type SmartCoordinatorTaskPromptParams = {
  roleName?: string;
  displayName?: string;
  coordinatorRoleId?: string;
  coordinatorAgentId?: string;
  teammateNames?: string[];
  teamRoles?: Array<{ id?: string; name?: string; agentId?: string; displayName?: string }>;
  task?: SmartTaskPromptTask;
  taskProgressContext?: string | null;
  projectRootDisplay?: string | null;
  roomContext?: string | null;
  currentTrigger: string;
  currentAssignableRoleNames?: string | null;
  triggerFromUser?: boolean;
  promptVariant?: string;
  memberReportKind?: SmartMemberReportToCoordinatorKind;
  smartUserMentionedMemberNames?: string[];
  needsDecomposition?: boolean;
};

function formatTeamMemberLines(params: SmartCoordinatorTaskPromptParams): string {
  const coordinatorId = (params.coordinatorAgentId ?? params.coordinatorRoleId)?.trim();
  const fromRoles = (params.teamRoles ?? []).filter((r) => {
    const id = (r.agentId ?? r.id ?? '').trim();
    return id !== coordinatorId;
  });
  if (fromRoles.length > 0) {
    return fromRoles.map((r) => (r.displayName ?? r.name ?? '').trim()).filter(Boolean).join('、');
  }
  const names = (params.teammateNames ?? []).map((n) => n.trim()).filter(Boolean);
  return names.length > 0 ? names.join('、') : '（未配置）';
}

function resolveCoordinatorProjectRoot(params: SmartCoordinatorTaskPromptParams): string {
  return (
    params.projectRootDisplay?.trim()
    || extractProjectRootFromProgressContext(params.taskProgressContext)
    || '（由引擎管理）'
  );
}

/** Smart 协调者角色任务提示词（严格五段结构）。 */
export function buildSmartCoordinatorAgentTaskPrompt(
  params: SmartCoordinatorTaskPromptParams,
): string {
  const roleName = (params.roleName ?? params.displayName ?? '').trim() || '协调者';
  const triggerRaw = (params.currentTrigger ?? '').trim() || '（见本次触发）';
  const trigger = (() => {
    if (params.promptVariant === 'coordinator_member_report') {
      const dispatchOnly = extractSmartCoordinatorDispatchOnlyText(triggerRaw);
      if (dispatchOnly && !/^无$/iu.test(dispatchOnly)) return dispatchOnly;
    }
    return sanitizeSmartCoordinatorCurrentTrigger(triggerRaw, params.task) || '（见本次触发）';
  })();
  const teamMembers = formatTeamMemberLines(params);
  const taskTitle = params.task?.title?.trim() || '（未命名）';
  const taskGoal = formatSmartTaskGoal(params.task ?? null);
  const projectRoot = resolveCoordinatorProjectRoot(params);

  const roundGoal = buildCoordinatorRoundGoal({
    promptVariant: params.promptVariant,
    memberReportKind: params.memberReportKind,
    triggerFromUser: params.triggerFromUser,
    smartUserMentionedMemberNames: params.smartUserMentionedMemberNames,
    needsDecomposition: params.needsDecomposition,
    currentAssignableRoleNames: params.currentAssignableRoleNames,
  });

  const sections: string[] = [
    '一.【角色信息】',
    `1.1 我是:${roleName}（协调者）`,
    `1.2 团队成员:${teamMembers}`,
    '',
    '二.【项目信息】',
    `2.1 项目名称：${taskTitle}`,
    `2.2 项目目标：${taskGoal}`,
    `2.3 项目目录(项目根目录，唯一读写根目录)：${projectRoot}`,
    '',
    '三.【历史记录与本轮任务】',
    '3.1 【历史群聊记录（指代释义唯一依据）】',
    extractRoomTranscript(params.roomContext),
    '',
    '3.2【本轮目标】',
    roundGoal,
    '',
    '3.3 【本回合触发】',
    trigger,
    '',
    '四.【执行与交付规范】',
    '4.1 任务执行与收尾流程',
    '4.1.1 任务指派：',
    '-首轮启动：项目kickoff/任务拆解必须用 action="assign"，仅指派第一阶段执行者，每名成员最多1个子任务。',
    '-并行与依赖：100%确认无上下游依赖关系的多个任务可并行指派（dispatch数组每名成员至多1项，禁止同一角色重复）；无法确认是否存在上下游依赖关系或者确认存在上下游依赖关系的任务必须先验收上游再指派下游；',
    `-本轮允许角色：${teamMembers}。`,
    '4.1.2验收与响应',
    '-成员求助后：先 inputValidation 核验成员声称的缺失依赖，然后必须 action=assign 排障/补上游/改派',
    '-成员汇报后：验收结论写入 taskUnderstanding；续派意图仅写在 dispatch。如果验收通过则用 action="assign"续派下游（禁止催促并行未汇报者），此时禁止dispatch 点名汇报者；验收不通过需返工/补交付时，可以 dispatch 点名该汇报者，且 dispatch[].task 须写明返工原因与正确落盘路径。',
    '-验收前提：仅对已通过 action="end" 汇报的成员写验收结论；并行任务未全部汇报时，不得宣称完成。',
    '4.1.3 Action使用规范',
    '-action="assign"：用于新任务、返工、补交付、续派或验收后指派，dispatch 至少1项且须有效点名。',
    '-action="end"：仅当所有成员交付均验收通过，且无待办/阻塞/返工任务时使用，dispatch=[]。',
    '4.1.4 禁止行为',
    '-禁止代写成员交付物，禁止在 dispatch 中重复指派同一角色。',
    '-协调者指派时，dispatch[].task 必须写 交付物-{被指派成员显示名}/，禁止使用协调者自身目录',
    '',
    '4.2 交付物规范',
    '-交付物命名格式：xxx-角色名.格式，项目如对格式有要求，则按要求填写(如.pdf,.xlsx,.pptx等)；对格式无要求则默认.md，如 方案报告-AI-Agent开发专家.md）',
    '-交付物存放路径：所有交付物必须存放于项目根目录下的 交付物-角色名/ 目录下（如 交付物-开发专家/）',
    '',
    '五、强制输出格式（仅 JSON）',
    '仅输出纯 JSON，禁止 Markdown、注释、解释或额外文字。字段不可增删改、不可缺省，必须符合 JSON Schema。',
    'json格式：',
    ...buildSmartCoordinatorJsonSchemaLines(roleName),
  ];

  return sections.join('\n');
}
