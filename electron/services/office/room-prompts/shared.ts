import type { OfficeTask, OfficeTaskExecutionMode } from '../types';
import { roomMentionOutputFormatBlock } from '../room-mention-structured-reply';
import { roomMentionFewShotBlock, type RoomMentionFewShotRole } from './few-shots';
import type { SmartMemberExecutionReadiness } from '../../../../src/lib/office-smart-member-reply';

export function roomTaskBlock(
  task: Pick<OfficeTask, 'title' | 'description' | 'status'> | null | undefined,
): string {
  if (!task) return '';
  return [
    `任务：${task.title}（${task.status}）`,
    task.description ? `说明：${task.description}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** 点名/协调者 prompt 共用上下文块（规则块 + 进展 + 群聊摘录）。 */
export function mentionPromptContextBlock(parts: {
  modeLabel: string;
  scenarioName: string;
  task?: Pick<OfficeTask, 'title' | 'description' | 'status'> | null;
  teammateNames?: string[];
  rulesBlock: string;
  roomContext?: string | null;
  taskProgressContext?: string | null;
  projectNotebookContext?: string | null;
  extraLines?: string[];
}): string {
  const roster = parts.teammateNames?.length ? `成员：${parts.teammateNames.join('、')}` : '';
  return [
    parts.modeLabel,
    `场景：${parts.scenarioName}`,
    roster,
    roomTaskBlock(parts.task),
    parts.roomContext?.trim(),
    parts.taskProgressContext?.trim(),
    parts.projectNotebookContext?.trim(),
    parts.rulesBlock,
    ...(parts.extraLines ?? []).filter(Boolean),
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function mentionTurnBlock(parts: {
  roleName: string;
  roleId: string;
  speakerLabel: string;
  triggerBlock: string;
  outputHint: string;
  includeOutputFormat?: boolean;
  executionMode?: OfficeTaskExecutionMode;
  isCoordinator?: boolean;
  fewShotRole?: RoomMentionFewShotRole;
  smartMemberReadiness?: SmartMemberExecutionReadiness;
}): string {
  const mode = parts.executionMode ?? 'workflow';
  const fewShots =
    parts.executionMode && parts.fewShotRole
      ? roomMentionFewShotBlock(parts.executionMode, parts.fewShotRole)
      : '';
  const formatBlock =
    parts.includeOutputFormat !== false
      ? roomMentionOutputFormatBlock(
          mode,
          parts.isCoordinator ?? false,
          parts.smartMemberReadiness,
        )
      : '';
  return [
    `【角色】${parts.roleName}（${parts.roleId}）`,
    `【点名人】${parts.speakerLabel}`,
    parts.triggerBlock,
    formatBlock,
    fewShots,
    `【输出】${parts.outputHint}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** 协调者广播介入 / 补指派专用轮次块（无「点名人」）。 */
export function coordinatorInterventionTurnBlock(parts: {
  roleName: string;
  roleId: string;
  triggerBlock: string;
  outputHint: string;
  executionMode: OfficeTaskExecutionMode;
  fewShotRole: 'coordinator_unmentioned' | 'coordinator_missing_mention';
}): string {
  return mentionTurnBlock({
    roleName: parts.roleName,
    roleId: parts.roleId,
    speakerLabel: '（群聊广播/监督触发）',
    triggerBlock: parts.triggerBlock,
    outputHint: parts.outputHint,
    executionMode: parts.executionMode,
    isCoordinator: true,
    fewShotRole: parts.fewShotRole,
  });
}
