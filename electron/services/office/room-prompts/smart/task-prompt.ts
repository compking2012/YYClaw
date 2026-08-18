import { roleMentionToken } from '../../../../../src/lib/office-mention';
import { normalizeTeamMember, type LegacyTeamMember } from '../../../../../src/lib/office-agent-id-resolve';
import type { OfficeRole, OfficeScenario, OfficeTask } from '../../types';
import { SMART_MENTION_RULES_BLOCK } from './blocks';

export { SMART_TASK_COMPLETE_MARKERS } from './blocks';

/** 协调者自 @ 启动拆解（须配合 dispatchSmartCoordinatorKickoffDecomposition 点名 LLM）。 */
export function buildSmartTaskKickoffRoomLine(
  coordinator: Pick<OfficeRole, 'id' | 'name'> | LegacyTeamMember | { emoji?: string },
  task: Pick<OfficeTask, 'title' | 'featureDescription' | 'description'>,
): string {
  const coord = normalizeTeamMember(coordinator as LegacyTeamMember);
  const emoji =
    coordinator && typeof coordinator === 'object' && 'emoji' in coordinator && coordinator.emoji
      ? String(coordinator.emoji)
      : '🤖';
  const label = coord.displayName || coord.agentId;
  return [
    `${emoji} 【${label}】🚀 智能任务启动 · ${task.title}`,
    `@${roleMentionToken(coord)} 开始拆解任务「${task.title}」，在【分工】中 @ 工作顺序第一位(批)执行者。`,
    task.featureDescription?.trim()
      ? `功能描述：${task.featureDescription.trim().slice(0, 400)}`
      : '',
    task.description?.trim() ? `任务说明：${task.description.trim().slice(0, 400)}` : '',
    '执行模式：Smart。',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildSmartCoordinatorKickoffPrompt(params: {
  coordinator: OfficeRole;
  task: Pick<OfficeTask, 'title' | 'description'>;
  scenario: Pick<OfficeScenario, 'name'>;
  teammates: Pick<OfficeRole, 'id' | 'name'>[];
}): string {
  const roster = params.teammates
    .filter((r) => r.id !== params.coordinator.id)
    .map((r) => r.name)
    .join('、');

  const contextBlock = [
    `【模式】Smart`,
    `场景：${params.scenario.name}`,
    `任务：${params.task.title}`,
    params.task.description?.trim() ? `说明：${params.task.description.trim()}` : '',
    roster ? `成员：${roster}` : '',
    SMART_MENTION_RULES_BLOCK,
  ]
    .filter(Boolean)
    .join('\n\n');

  const turnBlock = [
    `【角色】${params.coordinator.name}（Smart·协调者）`,
    '【输出】在群内 @ 第一位执行者，给出子任务、验收标准与优先级。',
  ].join('\n\n');

  return `${contextBlock}\n\n${turnBlock}`;
}
