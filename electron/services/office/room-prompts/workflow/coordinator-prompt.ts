import type { OfficeRole, OfficeScenario, OfficeTask } from '../../types';
import { coordinatorInterventionTurnBlock, mentionPromptContextBlock } from '../shared';
import { WORKFLOW_COORDINATOR_MENTION_AUDIT_RULE, WORKFLOW_MENTION_RULES_BLOCK } from './blocks';

type WorkflowCoordParams = {
  coordinator: OfficeRole;
  roomLine: string;
  scenario: Pick<OfficeScenario, 'name'>;
  task?: Pick<OfficeTask, 'title' | 'description' | 'status'> | null;
  teammateNames?: string[];
  replyQuote?: { fromLabel: string; preview: string } | null;
  roomContext?: string | null;
  taskProgressContext?: string | null;
  projectNotebookContext?: string | null;
  speakerLabel: string;
  waitSeconds?: number;
};

function quoteSnippet(params: WorkflowCoordParams): string {
  return (params.replyQuote?.preview ?? params.roomLine).trim().slice(0, 200);
}

export function buildWorkflowRoomCoordinatorUnmentionedPrompt(
  params: WorkflowCoordParams,
): string {
  const wait = params.waitSeconds ?? 15;
  const contextBlock = mentionPromptContextBlock({
    modeLabel: '【模式】Workflow',
    scenarioName: params.scenario.name,
    task: params.task,
    teammateNames: params.teammateNames,
    rulesBlock: WORKFLOW_MENTION_RULES_BLOCK,
    roomContext: params.roomContext,
    taskProgressContext: params.taskProgressContext,
    projectNotebookContext: params.projectNotebookContext,
    extraLines: [
      `【无@发言】${wait}s 内无成员回应，请你介入。`,
      '无需跟进→【判定】无需回应（一句），勿 @。',
      '需跟进→【理解】【判定】【群聊回复】说明进展/阻塞；runner 活跃时勿【分工】@派节点（仅监督/答疑）。',
    ],
  });
  const turnBlock = coordinatorInterventionTurnBlock({
    roleName: params.coordinator.name,
    roleId: params.coordinator.id,
    executionMode: 'workflow',
    fewShotRole: 'coordinator_unmentioned',
    triggerBlock: [
      `【发言人】${params.speakerLabel}`,
      `摘录：${quoteSnippet(params)}`,
      `原话：「${params.roomLine.trim()}」`,
    ].join('\n'),
    outputHint:
      '无需跟进→仅【理解】+【判定】无需回应；需跟进→【理解】【群聊回复】监督/答疑（勿 @ 指派 DAG 节点）',
  });
  return `${contextBlock}\n\n${turnBlock}`;
}

export function buildWorkflowRoomCoordinatorMissingMentionPrompt(params: {
  coordinator: OfficeRole;
  speakerRoleName: string;
  speakerExcerpt: string;
  missingRoleNames: string[];
  scenario: Pick<OfficeScenario, 'name'>;
  task?: Pick<OfficeTask, 'title' | 'description' | 'status'> | null;
  roomContext?: string | null;
  taskProgressContext?: string | null;
  projectNotebookContext?: string | null;
}): string {
  const missing = params.missingRoleNames.join('、');
  const contextBlock = mentionPromptContextBlock({
    modeLabel: '【模式】Workflow',
    scenarioName: params.scenario.name,
    task: params.task,
    rulesBlock: WORKFLOW_MENTION_RULES_BLOCK,
    roomContext: params.roomContext,
    taskProgressContext: params.taskProgressContext,
    projectNotebookContext: params.projectNotebookContext,
    extraLines: [
      WORKFLOW_COORDINATOR_MENTION_AUDIT_RULE,
      `【补指派】${params.speakerRoleName} 提及 ${missing} 但未 @。`,
      `须 @${missing} 并写清步骤事项。`,
    ],
  });
  const turnBlock = coordinatorInterventionTurnBlock({
    roleName: params.coordinator.name,
    roleId: params.coordinator.id,
    executionMode: 'workflow',
    fewShotRole: 'coordinator_missing_mention',
    triggerBlock: `摘录：「${params.speakerExcerpt.trim().slice(0, 300)}」`,
    outputHint: '≥2句；【群聊回复】+【分工】必须 @ 角色',
  });
  return `${contextBlock}\n\n${turnBlock}`;
}

/** @deprecated 旧 @all 协调路径已移除；保留供测试兼容。 */
export function buildWorkflowRoomCoordinatorPrompt(params: WorkflowCoordParams): string {
  const contextBlock = mentionPromptContextBlock({
    modeLabel: '【模式】Workflow',
    scenarioName: params.scenario.name,
    task: params.task,
    teammateNames: params.teammateNames,
    rulesBlock: WORKFLOW_MENTION_RULES_BLOCK,
    roomContext: params.roomContext,
    taskProgressContext: params.taskProgressContext,
    projectNotebookContext: params.projectNotebookContext,
  });
  const turnBlock = [
    `【角色】${params.coordinator.name}（协调者）`,
    `【发起人】${params.speakerLabel}`,
    `最新：「${params.roomLine.trim()}」`,
    `摘录：${quoteSnippet(params)}`,
    '【输出】≥3句：理解、@分工，禁止空回复/仅收到。',
  ].join('\n\n');
  return `${contextBlock}\n\n${turnBlock}`;
}
