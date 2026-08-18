import type { RoomMessage } from '@/types/office';
import { isRoomCoordinatorReceiptAckText, isRoomFastAckText } from '@/lib/office-room-fast-ack';

/** 已由协调者 member-inbound 成功处理的成员汇报 trigger 消息 id（按 task）。 */
const handledTriggerIdsByTask = new Map<string, Set<string>>();

export function registerSmartMemberReportsHandledByCoordinatorInbound(
  taskId: string,
  triggerMsgIds: string[],
): void {
  const trimmedTask = taskId.trim();
  if (!trimmedTask) return;
  const ids = triggerMsgIds.map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) return;
  let set = handledTriggerIdsByTask.get(trimmedTask);
  if (!set) {
    set = new Set<string>();
    handledTriggerIdsByTask.set(trimmedTask, set);
  }
  for (const id of ids) set.add(id);
}

export function isSmartMemberReportHandledByCoordinatorInbound(
  taskId: string,
  triggerMsgId: string,
): boolean {
  const trimmedTask = taskId.trim();
  const trimmedId = triggerMsgId.trim();
  if (!trimmedTask || !trimmedId) return false;
  return handledTriggerIdsByTask.get(trimmedTask)?.has(trimmedId) ?? false;
}

export function clearSmartMemberReportInboundDedupForTask(taskId: string): void {
  const trimmedTask = taskId.trim();
  if (!trimmedTask) return;
  handledTriggerIdsByTask.delete(trimmedTask);
}

function memberRoleNameMatchTokens(memberRoleName: string): string[] {
  const full = memberRoleName.trim();
  if (!full) return [];
  const tokens = new Set<string>([full]);
  const short = full.replace(/(分析师|规划师|工程师|师)$/u, '').trim();
  if (short.length >= 2) tokens.add(short);
  return [...tokens];
}

function coordinatorReplyAcceptsMemberReport(
  text: string,
  memberRoleName: string,
): boolean {
  if (!/验收|已通过|已验收|通过验收|也已提交并通过|完成验收/u.test(text)) return false;
  return memberRoleNameMatchTokens(memberRoleName).some((token) => text.includes(token));
}

function isCoordinatorInboundReceiptRoomMessage(message: RoomMessage): boolean {
  if (message.id.startsWith('room-ack-postsend-')) return true;
  const text = (message.progressText ?? message.content ?? '').trim();
  return isRoomCoordinatorReceiptAckText(text) || isRoomFastAckText(text);
}

/** 群聊中是否已有针对该成员汇报的协调者 receipt ack。 */
export function coordinatorReceiptAckExistsForMemberReport(input: {
  roomMessages: RoomMessage[];
  coordinatorAgentId: string;
  triggerMsgId: string;
}): boolean {
  const coordinatorId = input.coordinatorAgentId.trim();
  const triggerId = input.triggerMsgId.trim();
  if (!coordinatorId || !triggerId) return false;
  return input.roomMessages.some((message) => {
    if (message.fromAgentId !== coordinatorId) return false;
    if (message.replyToId !== triggerId) return false;
    return isCoordinatorInboundReceiptRoomMessage(message);
  });
}

function isNonSubstantiveCoordinatorProgressMessage(
  message: RoomMessage,
  coordinatorRoleId: string,
): boolean {
  if (message.fromAgentId !== coordinatorRoleId) return true;
  if (message.from === 'system') return true;
  if (message.id.startsWith('room-ack-')) return true;
  const text = (message.progressText ?? message.content ?? '').trim();
  if (!text) return true;
  if (isCoordinatorInboundReceiptRoomMessage(message)) return true;
  return false;
}

export type SmartMemberReportInboundDedupReason = 'registry' | 'room_history';

export type SmartMemberReportInboundDedupDecision = {
  skip: boolean;
  reason?: SmartMemberReportInboundDedupReason;
  /** 命中 room_history 时：协调者哪条消息被视为已覆盖 */
  matchedCoordinatorMsgId?: string;
  matchedBy?: 'replyToId' | 'acceptance_text' | 'registry';
  /** 便于日志：成员汇报时间戳 vs 最近协调者实质回复时间戳 */
  memberReportTs?: number;
  latestCoordinatorSubstantiveTs?: number;
};

function latestCoordinatorSubstantiveTs(
  roomMessages: RoomMessage[],
  coordinatorRoleId: string,
): number | undefined {
  let latest: number | undefined;
  for (const message of roomMessages) {
    if (isNonSubstantiveCoordinatorProgressMessage(message, coordinatorRoleId)) continue;
    if (message.timestamp > (latest ?? 0)) latest = message.timestamp;
  }
  return latest;
}

/** 协调者 substantive 回复是否已在群聊中覆盖该成员汇报（含合并 batch 验收同轮催办其他成员）。 */
export function coordinatorAlreadyAddressedMemberReportInRoom(input: {
  roomMessages: RoomMessage[];
  memberReport: RoomMessage;
  coordinatorAgentId?: string;
  /** @deprecated use coordinatorAgentId */
  coordinatorRoleId?: string;
  memberRoleName?: string;
}): Pick<
  SmartMemberReportInboundDedupDecision,
  'skip' | 'matchedCoordinatorMsgId' | 'matchedBy'
> & { skip: boolean } {
  const { roomMessages, memberReport, memberRoleName } = input;
  const coordinatorId = (input.coordinatorAgentId ?? input.coordinatorRoleId ?? '').trim();
  const reportTs = memberReport.timestamp;

  for (const message of roomMessages) {
    if (message.timestamp < reportTs) continue;
    if (isNonSubstantiveCoordinatorProgressMessage(message, coordinatorId)) continue;

    if (message.replyToId === memberReport.id) {
      return { skip: true, matchedCoordinatorMsgId: message.id, matchedBy: 'replyToId' };
    }

    if (!memberRoleName?.trim()) continue;
    const text = (message.progressText ?? message.content ?? '').trim();
    if (coordinatorReplyAcceptsMemberReport(text, memberRoleName)) {
      return { skip: true, matchedCoordinatorMsgId: message.id, matchedBy: 'acceptance_text' };
    }
  }

  return { skip: false };
}

export function evaluateSmartMemberReportInboundDedup(input: {
  taskId: string;
  triggerMsgId: string;
  memberReport: RoomMessage;
  roomMessages: RoomMessage[];
  coordinatorAgentId?: string;
  /** @deprecated use coordinatorAgentId */
  coordinatorRoleId?: string;
  memberRoleName?: string;
}): SmartMemberReportInboundDedupDecision {
  const coordinatorId = (input.coordinatorAgentId ?? input.coordinatorRoleId ?? '').trim();
  const memberReportTs = input.memberReport.timestamp;
  const coordinatorSubstantiveTs = latestCoordinatorSubstantiveTs(
    input.roomMessages,
    coordinatorId,
  );

  if (isSmartMemberReportHandledByCoordinatorInbound(input.taskId, input.triggerMsgId)) {
    return {
      skip: true,
      reason: 'registry',
      matchedBy: 'registry',
      memberReportTs,
      latestCoordinatorSubstantiveTs: coordinatorSubstantiveTs,
    };
  }

  const room = coordinatorAlreadyAddressedMemberReportInRoom({
    roomMessages: input.roomMessages,
    memberReport: input.memberReport,
    coordinatorAgentId: coordinatorId,
    memberRoleName: input.memberRoleName,
  });
  if (room.skip) {
    return {
      skip: true,
      reason: 'room_history',
      matchedCoordinatorMsgId: room.matchedCoordinatorMsgId,
      matchedBy: room.matchedBy,
      memberReportTs,
      latestCoordinatorSubstantiveTs: coordinatorSubstantiveTs,
    };
  }

  return {
    skip: false,
    memberReportTs,
    latestCoordinatorSubstantiveTs: coordinatorSubstantiveTs,
  };
}

export function shouldSkipSmartCoordinatorMemberReportInbound(input: {
  taskId: string;
  triggerMsgId: string;
  memberReport: RoomMessage;
  roomMessages: RoomMessage[];
  coordinatorAgentId?: string;
  /** @deprecated use coordinatorAgentId */
  coordinatorRoleId?: string;
  memberRoleName?: string;
}): { skip: boolean; reason?: SmartMemberReportInboundDedupReason } {
  const decision = evaluateSmartMemberReportInboundDedup(input);
  return { skip: decision.skip, reason: decision.reason };
}
