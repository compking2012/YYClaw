import type { OfficeRole, OfficeScenario, OfficeTask } from '../../types';
import { buildSmartCoordinatorAgentTaskPrompt } from '../../../../../src/lib/office-smart-coordinator-task-prompt';

type SmartCoordInterventionBase = {
  coordinator: OfficeRole;
  scenario: Pick<OfficeScenario, 'name'>;
  task?: Pick<OfficeTask, 'title' | 'description' | 'status' | 'featureDescription'> | null;
  teammateNames?: string[];
  teamRoles?: Array<Pick<OfficeRole, 'id' | 'name'>>;
  coordinatorRoleId?: string;
  roomContext?: string | null;
  taskProgressContext?: string | null;
  projectNotebookContext?: string | null;
  currentAssignableRoleNames?: string | null;
  executionMode?: 'smart';
  promptVariant?: string;
  memberReportKind?: import('../../../../../src/lib/office-smart-member-reply').SmartMemberReportToCoordinatorKind;
  needsDecomposition?: boolean;
};

type SmartCoordParams = SmartCoordInterventionBase & {
  roomLine: string;
  replyQuote?: { fromLabel: string; preview: string } | null;
  speakerLabel: string;
  waitSeconds?: number;
  triggerFromUser?: boolean;
};

function buildSmartCoordinatorInterventionPrompt(
  base: SmartCoordInterventionBase,
  currentTrigger: string,
  triggerFromUser?: boolean,
): string {
  return buildSmartCoordinatorAgentTaskPrompt({
    roleName: base.coordinator.name,
    coordinatorRoleId: base.coordinatorRoleId ?? base.coordinator.id,
    teammateNames: base.teammateNames,
    teamRoles: base.teamRoles,
    task: base.task,
    taskProgressContext: base.taskProgressContext,
    roomContext: base.roomContext,
    currentTrigger,
    currentAssignableRoleNames: base.currentAssignableRoleNames,
    triggerFromUser,
    promptVariant: base.promptVariant,
    memberReportKind: base.memberReportKind,
    needsDecomposition: base.needsDecomposition,
  });
}

/** Smart 协调者 · 用户 @ 成员：成员不响应，由协调者立即兜底。 */
export function buildSmartRoomCoordinatorUserMentionMemberPrompt(
  params: SmartCoordParams & { mentionedMemberNames: string[] },
): string {
  return buildSmartCoordinatorAgentTaskPrompt({
    roleName: params.coordinator.name,
    coordinatorRoleId: params.coordinatorRoleId ?? params.coordinator.id,
    teammateNames: params.teammateNames,
    teamRoles: params.teamRoles,
    task: params.task,
    taskProgressContext: params.taskProgressContext,
    roomContext: params.roomContext,
    currentTrigger: params.roomLine.trim(),
    currentAssignableRoleNames: params.currentAssignableRoleNames,
    triggerFromUser: true,
    promptVariant: 'coordinator_user_mention_member',
    smartUserMentionedMemberNames: params.mentionedMemberNames,
  });
}

/** Smart 协调者 · 无 @ 发言介入。 */
export function buildSmartRoomCoordinatorUnmentionedPrompt(params: SmartCoordParams): string {
  return buildSmartCoordinatorInterventionPrompt(
    { ...params, promptVariant: 'coordinator_broadcast_unmentioned' },
    params.roomLine.trim(),
    params.triggerFromUser,
  );
}

/** Smart 协调者 · 补 @ 介入。 */
export function buildSmartRoomCoordinatorMissingMentionPrompt(
  params: SmartCoordInterventionBase & {
    speakerRoleName: string;
    speakerExcerpt: string;
    missingRoleNames: string[];
  },
): string {
  const missing = params.missingRoleNames.join('、');
  const trigger = `@${params.speakerRoleName} 需要 ${missing} 参与但未 @。摘录：「${params.speakerExcerpt.trim().slice(0, 300)}」`;
  return buildSmartCoordinatorInterventionPrompt(
    { ...params, promptVariant: 'coordinator_missing_mention' },
    trigger,
  );
}

/** @deprecated 旧 @all 协调路径已移除；保留供测试兼容。 */
export function buildSmartRoomCoordinatorPrompt(params: SmartCoordParams): string {
  return buildSmartCoordinatorInterventionPrompt(params, params.roomLine.trim());
}
