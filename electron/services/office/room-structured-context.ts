import {
  buildRoomContextBlock,
  roomMessageBodyForContext,
  selectSubstantiveRoomContextMessages,
} from '../../../src/lib/office-room-context';
import { roomMessageFromAgentMatches } from '../../../src/lib/office-agent-id-resolve';
import { roomMessageAuthorLabel } from '../../../src/lib/office-room-reply';
import { roomContextLimitsForMention } from './room-context-limits';
import type { OfficeRole, OfficeTaskExecutionMode, RoomMessage } from './types';

const MAIN_ROOM_LABELS = { user: '用户', system: '系统' };

function orderedUpTo(
  history: RoomMessage[],
  upToMessageId: string,
): { ordered: RoomMessage[]; trigger: RoomMessage | null } {
  let ordered = [...history].sort((a, b) => a.timestamp - b.timestamp);
  const cut = ordered.findIndex((m) => m.id === upToMessageId);
  if (cut >= 0) ordered = ordered.slice(0, cut + 1);
  const trigger = ordered.find((m) => m.id === upToMessageId) ?? ordered[ordered.length - 1] ?? null;
  return { ordered, trigger };
}

function lastMessageFromRoleBefore(
  ordered: RoomMessage[],
  roleId: string,
  beforeTimestamp: number,
  excludeId?: string,
): RoomMessage | null {
  let found: RoomMessage | null = null;
  for (const m of ordered) {
    if (m.id === excludeId) continue;
    if (m.timestamp > beforeTimestamp) continue;
    if (m.fromRoleId === roleId || roomMessageFromAgentMatches(m, roleId)) found = m;
  }
  return found;
}

/** 点名回复用结构化群聊上下文（含触发句、协调者/点名者相关句 + 最近 N 条）。 */
export function selectStructuredRoomContextMessages(params: {
  history: RoomMessage[];
  upToMessageId: string;
  triggerMessageId: string;
  coordinatorRoleId: string;
  executionMode: OfficeTaskExecutionMode;
  isCoordinator: boolean;
}): RoomMessage[] {
  const { ordered, trigger } = orderedUpTo(params.history, params.upToMessageId);
  if (!trigger) return [];

  const limits = roomContextLimitsForMention(params.executionMode, params.isCoordinator);
  const selectedIds = new Set<string>();
  selectedIds.add(trigger.id);

  if (params.executionMode === 'smart' && params.isCoordinator) {
    const substantive = selectSubstantiveRoomContextMessages(ordered, {
      upToMessageId: params.upToMessageId,
      maxMessages: limits.maxMessages,
      maxChars: limits.maxChars,
    });
    if (substantive.length > 0) {
      return substantive;
    }
    return [trigger];
  }

  if (params.executionMode === 'smart' && !params.isCoordinator) {
    const coordLine = lastMessageFromRoleBefore(
      ordered,
      params.coordinatorRoleId,
      trigger.timestamp,
      trigger.id,
    );
    if (coordLine) selectedIds.add(coordLine.id);
  }

  const beforeTrigger = ordered.filter((m) => m.timestamp <= trigger.timestamp);
  const recent = beforeTrigger.slice(-limits.maxMessages);
  for (const m of recent) selectedIds.add(m.id);

  let selected = ordered.filter((m) => selectedIds.has(m.id));
  let chars = 0;
  const capped: RoomMessage[] = [];
  for (let i = selected.length - 1; i >= 0; i -= 1) {
    const message = selected[i]!;
    const cost = roomMessageBodyForContext(message).length + 48;
    if (capped.length >= limits.maxMessages) break;
    if (capped.length > 0 && chars + cost > limits.maxChars) break;
    capped.unshift(message);
    chars += cost;
  }
  return capped.length > 0 ? capped : selected.slice(-limits.maxMessages);
}

export function buildStructuredRoomContextForMention(
  history: RoomMessage[],
  roles: OfficeRole[],
  params: {
    upToMessageId: string;
    triggerMessageId: string;
    coordinatorRoleId: string;
    executionMode: OfficeTaskExecutionMode;
    isCoordinator: boolean;
  },
): string | null {
  const messages = selectStructuredRoomContextMessages({
    history,
    upToMessageId: params.upToMessageId,
    triggerMessageId: params.triggerMessageId,
    coordinatorRoleId: params.coordinatorRoleId,
    executionMode: params.executionMode,
    isCoordinator: params.isCoordinator,
  });
  return buildRoomContextBlock(messages, (m) => roomMessageAuthorLabel(m, roles, MAIN_ROOM_LABELS));
}
