import type { RoomMessage } from '@/types/office';

/**
 * Smart 一轮对话 id：同一线程（replyToId 链）或单条触发消息。
 * 用于同轮多次 @ 同一角色时的 sessionsSend 幂等键与合并。
 */
export function resolveSmartMentionRoundId(
  userMsg: Pick<RoomMessage, 'id' | 'replyToId'>,
): string {
  const replyRoot = userMsg.replyToId?.trim();
  return replyRoot || userMsg.id;
}

/** Smart 合并点名：多 trigger 合并为一批 Session 时使用稳定 batch 键，避免幂等键冲突导致 sessionsSend 被跳过。 */
export function resolveSmartMentionSessionRoundId(
  userMsg: Pick<RoomMessage, 'id' | 'replyToId'>,
  coalescedFromUserMsgIds?: string[],
): string {
  const unique = [...new Set(coalescedFromUserMsgIds?.map((id) => id.trim()).filter(Boolean) ?? [])]
    .sort();
  if (unique.length > 1) {
    return `batch:${unique.join('+')}`;
  }
  return resolveSmartMentionRoundId(userMsg);
}

/** 成员 @ 协调者汇报：Session 幂等键须按各成员 trigger 区分，不能共用 replyToId（同一协调者派活消息）。 */
export function resolveSmartMentionDispatchRoundId(
  userMsg: Pick<RoomMessage, 'id' | 'replyToId'>,
  coalescedFromUserMsgIds?: string[],
  options?: { memberInboundCoordinator?: boolean },
): string {
  if (options?.memberInboundCoordinator) {
    return resolveSmartMentionSessionRoundId(
      { id: userMsg.id, replyToId: undefined },
      coalescedFromUserMsgIds,
    );
  }
  return resolveSmartMentionSessionRoundId(userMsg, coalescedFromUserMsgIds);
}

export function isSmartMemberInboundCoordinatorDispatch(input: {
  coordinatorAgentId?: string;
  coordinatorRoleId?: string;
  targetRoleId: string;
  promptVariant?: string;
  userMsg: Pick<RoomMessage, 'from' | 'fromAgentId'>;
}): boolean {
  const coordinatorId = (input.coordinatorAgentId ?? input.coordinatorRoleId ?? '').trim();
  if (!coordinatorId || input.targetRoleId !== coordinatorId) return false;
  const fromMember =
    input.userMsg.from === 'agent'
    && !!input.userMsg.fromAgentId?.trim()
    && input.userMsg.fromAgentId !== coordinatorId;
  return fromMember || input.promptVariant === 'coordinator_member_report';
}

export const SMART_MEMBER_INBOUND_COORDINATOR_INFLIGHT_SUFFIX = ':member-inbound';

/** 合并同轮多次点名的群聊正文（去重、保留最新意图）。 */
export function mergeSmartMentionTriggerContent(prev: string, next: string): string {
  const a = prev.trim();
  const b = next.trim();
  if (!a) return b;
  if (!b || a === b) return a;
  if (a.includes(b)) return a;
  if (b.includes(a)) return b;
  return `${a}\n\n---\n\n${b}`;
}

export function resolveMergedSmartCoordinatorPromptVariant(
  baseVariant: string | undefined,
  incomingVariant: string | undefined,
  baseFromMemberAgent: boolean,
  incomingFromMemberAgent: boolean,
): string | undefined {
  if (
    baseFromMemberAgent
    || incomingFromMemberAgent
    || baseVariant === 'coordinator_member_report'
    || incomingVariant === 'coordinator_member_report'
  ) {
    return 'coordinator_member_report';
  }
  return incomingVariant ?? baseVariant;
}

export function dedupeMentionTargetsByRoleId<T extends { agentId: string }>(targets: T[]): T[] {
  const out: T[] = [];
  for (const role of targets) {
    if (!out.some((x) => x.agentId === role.agentId)) out.push(role);
  }
  return out;
}

export function smartMentionSessionIdempotencyKey(
  roundId: string,
  roleId: string,
  retry = false,
): string {
  const prefix = retry ? 'room-mention-smart-retry' : 'room-mention-smart';
  return `${prefix}-${roundId}-${roleId}`;
}
