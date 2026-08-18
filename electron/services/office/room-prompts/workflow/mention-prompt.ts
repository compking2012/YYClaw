import type { OfficeRole, OfficeScenario, OfficeTask } from '../../types';
import { mentionPromptContextBlock, mentionTurnBlock } from '../shared';
import { WORKFLOW_MENTION_RULES_BLOCK } from './blocks';

export type WorkflowRoomMentionPromptParams = {
  role: OfficeRole;
  roomLine: string;
  scenario: Pick<OfficeScenario, 'name'>;
  task?: Pick<OfficeTask, 'title' | 'description' | 'status'> | null;
  teammateNames?: string[];
  replyQuote?: { fromLabel: string; preview: string } | null;
  roomContext?: string | null;
  taskProgressContext?: string | null;
  projectNotebookContext?: string | null;
  speakerLabel: string;
  isCoordinator?: boolean;
  fastAckAlreadyPosted?: boolean;
  assignmentSummary?: string | null;
  executionMode?: 'workflow';
  coordinatorRoleId?: string;
  promptVariant?: string;
};

export function buildWorkflowMentionTriggerBlock(
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
    '须结合工作流步骤与依赖；前置未满足不得声称已开展。',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildWorkflowRoomMentionAgentPrompt(
  params: WorkflowRoomMentionPromptParams,
): string {
  const speaker = params.speakerLabel.trim();
  const extras: string[] = [];
  if (params.fastAckAlreadyPosted) extras.push('【已极速确认】勿重复「收到/待我思考」。');
  if (params.isCoordinator && params.assignmentSummary) {
    extras.push(`【协调者摘要】${params.assignmentSummary}`);
  }
  if (params.promptVariant === 'workflow_upstream_clarification') {
    extras.push(
      '【上游补充·须在群内回复】你被下游步骤在【协作询问】中点名：上游交付物缺失或路径无效。须在协调者项目工作目录写入/补齐真实文件（给出可核验磁盘路径），并在【群聊回复】说明；勿写【分工】、勿 @ 指派下一 DAG 节点（由 runner 自动推进）。',
    );
  }

  const contextBlock = mentionPromptContextBlock({
    modeLabel: '【模式】Workflow',
    scenarioName: params.scenario.name,
    task: params.task,
    teammateNames: params.teammateNames,
    rulesBlock: WORKFLOW_MENTION_RULES_BLOCK,
    roomContext: params.roomContext,
    taskProgressContext: params.taskProgressContext,
    projectNotebookContext: params.projectNotebookContext,
    extraLines: extras,
  });

  const outputHint =
    params.promptVariant === 'workflow_upstream_clarification'
      ? '≥3句；【群聊回复】必写：说明已补齐的文件路径或为何暂无法交付；仅 @ 提问方（下游）即可'
      : params.isCoordinator
        ? '≥3句；【群聊回复】必写；监督/答疑为主，runner 已负责节点指派'
        : '≥2句；【群聊回复】必写（须中文、汇报进展或阻塞）；勿写【分工】、勿 @ 指派下一节点（由工作流 runner 推进）';

  const turnBlock = mentionTurnBlock({
    roleName: params.role.name,
    roleId: params.role.id,
    speakerLabel: speaker,
    triggerBlock: buildWorkflowMentionTriggerBlock(speaker, params.roomLine, params.replyQuote),
    outputHint,
    executionMode: 'workflow',
    isCoordinator: params.isCoordinator,
    fewShotRole: params.isCoordinator ? 'coordinator' : 'member',
  });

  return `${contextBlock}\n\n${turnBlock}`;
}
