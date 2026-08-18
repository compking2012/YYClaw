import type { OfficeRole, OfficeScenario, OfficeTask } from '../../types';
import type { SmartMemberExecutionReadiness, SmartMemberReportToCoordinatorKind } from '../../../../../src/lib/office-smart-member-reply';
import { buildSmartCoordinatorAgentTaskPrompt } from '../../../../../src/lib/office-smart-coordinator-task-prompt';
import { buildSmartMemberAgentTaskPrompt } from '../../../../../src/lib/office-smart-member-task-prompt';

export type SmartRoomMentionPromptParams = {
  role: OfficeRole;
  roomLine: string;
  scenario: Pick<OfficeScenario, 'name'>;
  task?: Pick<OfficeTask, 'title' | 'description' | 'status' | 'featureDescription'> | null;
  teammateNames?: string[];
  replyQuote?: { fromLabel: string; preview: string } | null;
  roomContext?: string | null;
  taskProgressContext?: string | null;
  projectNotebookContext?: string | null;
  projectRootDisplay?: string | null;
  speakerLabel: string;
  isCoordinator?: boolean;
  fastAckAlreadyPosted?: boolean;
  needsDecomposition?: boolean;
  assignmentSummary?: string | null;
  executionMode?: 'smart';
  coordinatorAgentId?: string;
  coordinatorRoleId?: string;
  coordinatorName?: string;
  smartMemberReadiness?: SmartMemberExecutionReadiness;
  memberReportKind?: SmartMemberReportToCoordinatorKind;
  promptVariant?: string;
  smartNextExecutorRoleIds?: string[];
  /** @deprecated 使用 smartNextExecutorRoleIds */
  smartNextExecutorRoleId?: string | null;
  smartNextExecutorNames?: string | null;
  teamRoles?: Array<Pick<OfficeRole, 'id' | 'name'>>;
  /** 本回合是否由用户在群聊发言触发（仅协调者） */
  triggerFromUser?: boolean;
  smartUserMentionedMemberNames?: string[];
};

/** Smart 点名 agent prompt：仅输出任务提示词，不含轮次块/样例/镜像格式等附加段。 */
export function buildSmartRoomMentionAgentPrompt(params: SmartRoomMentionPromptParams): string {
  const isCoordinator = params.isCoordinator ?? false;
  if (isCoordinator) {
    return buildSmartCoordinatorAgentTaskPrompt({
      roleName: params.role.name,
      coordinatorAgentId: params.coordinatorAgentId,
      coordinatorRoleId: params.coordinatorRoleId,
      teammateNames: params.teammateNames,
      teamRoles: params.teamRoles,
      task: params.task,
      taskProgressContext: params.taskProgressContext,
      projectRootDisplay: params.projectRootDisplay,
      roomContext: params.roomContext,
      currentTrigger: params.roomLine,
      currentAssignableRoleNames: params.smartNextExecutorNames,
      triggerFromUser: params.triggerFromUser,
      promptVariant: params.promptVariant,
      memberReportKind: params.memberReportKind,
      smartUserMentionedMemberNames: params.smartUserMentionedMemberNames,
      needsDecomposition: params.needsDecomposition,
    });
  }
  return buildSmartMemberAgentTaskPrompt({
    roleName: params.role.name,
    coordinatorName: params.coordinatorName?.trim() || '协调者',
    task: params.task,
    taskProgressContext: params.taskProgressContext,
    projectRootDisplay: params.projectRootDisplay,
    currentAssignment: params.roomLine,
    smartMemberReadiness: params.smartMemberReadiness,
  });
}

/** @deprecated 轮次触发块已并入【任务信息】段，保留导出供兼容。 */
export function buildSmartMentionTriggerBlock(
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
