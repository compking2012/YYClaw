import {
  roomMessageFromAgentMatches,
  roomMessageProjectId,
} from '@/lib/office-agent-id-resolve';
import type { RoomMessage } from '@/types/office';

function resolveAssignTriggerTimestamp(
  roomMessages: RoomMessage[],
  triggerMsg: Pick<RoomMessage, 'id' | 'replyToId' | 'timestamp'>,
): number {
  const direct = roomMessages.find((m) => m.id === triggerMsg.id);
  if (direct?.timestamp) return direct.timestamp;
  if (triggerMsg.timestamp) return triggerMsg.timestamp;
  const replyRoot = triggerMsg.replyToId?.trim();
  if (replyRoot) {
    const parent = roomMessages.find((m) => m.id === replyRoot);
    if (parent?.timestamp) return parent.timestamp;
  }
  return 0;
}

/** 成员在指定时间之后是否已有 action=end（smartMemberEnd）汇报。 */
export function memberSmartEndReportAfterTimestamp(
  roomMessages: RoomMessage[],
  projectId: string,
  memberAgentId: string,
  afterTs: number,
): RoomMessage | undefined {
  let latest: RoomMessage | undefined;
  for (const m of roomMessages) {
    if (roomMessageProjectId(m) !== projectId) continue;
    if (!roomMessageFromAgentMatches(m, memberAgentId)) continue;
    if (m.smartMemberEnd !== true) continue;
    if (m.timestamp <= afterTs) continue;
    if (!latest || m.timestamp > latest.timestamp) latest = m;
  }
  return latest;
}

/**
 * 协调者派活后成员已 action=end 汇报完成时，跳过重复派活 Session（coalesce drain 第二批、重复 follow-up 等）。
 * 新派活触发消息时间晚于已完成汇报时不会跳过。
 */
export function shouldSkipSmartMemberDispatchAfterCompletedReport(input: {
  memberAgentId: string;
  roomMessages: RoomMessage[];
  projectId: string;
  triggerMsg: Pick<RoomMessage, 'id' | 'replyToId' | 'timestamp'>;
}): boolean {
  const triggerTs = resolveAssignTriggerTimestamp(input.roomMessages, input.triggerMsg);
  if (!triggerTs) return false;
  return (
    memberSmartEndReportAfterTimestamp(
      input.roomMessages,
      input.projectId,
      input.memberAgentId,
      triggerTs,
    ) !== undefined
  );
}
