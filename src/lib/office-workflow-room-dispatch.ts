import type { RoomMessage } from '@/types/office';

/**
 * Workflow 模式下：成员任务由 runner 推进；用户 @ 成员走「重开工作流节点」而非群聊点名 LLM。
 * 仅协调者角色仍可通过群聊点名 LLM 做监督/补指派。
 */
export function isWorkflowRoomUserIntervention(
  message?: Pick<RoomMessage, 'from'>,
): boolean {
  return message?.from === 'user';
}
