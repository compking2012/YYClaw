import type { RoomMessage } from '@/types/office';
import { roomMessageFromAgentId, roomMessageProjectId } from '@/lib/office-agent-id-resolve';
import { stripInlineQuotePrefix } from '@/lib/office-room-reply-format';

/** 群聊点名极速确认文案（与 electron/room-fast-ack 一致）。 */
export const ROOM_FAST_ACK_TEXT = 'OK，待我思考下';

/** 协调者 member-inbound：模型已开始处理后再发 receipt，语义区别于成员 fast ack /「已思考」。 */
export const ROOM_COORDINATOR_RECEIPT_ACK_TEXT = '【已收到】协调者处理中…';

const FAST_ACK_NORMALIZED = [
  ROOM_FAST_ACK_TEXT.replace(/\s+/g, ''),
  'OK，待我在思考下'.replace(/\s+/g, ''),
  'OK，我在思考中'.replace(/\s+/g, ''),
  '收到，待我思考下'.replace(/\s+/g, ''),
  'OK,待我思考下'.replace(/\s+/g, ''),
  'OK,待我在思考下'.replace(/\s+/g, ''),
  'OK,我在思考中'.replace(/\s+/g, ''),
];

function roomMessageBodyText(content: string): string {
  return stripInlineQuotePrefix(content).trim();
}

export function isRoomCoordinatorReceiptAckText(text: string): boolean {
  const t = roomMessageBodyText(text).replace(/\s+/g, '');
  const norm = ROOM_COORDINATOR_RECEIPT_ACK_TEXT.replace(/\s+/g, '');
  if (t === norm || t === `${norm}。` || t === `${norm}！`) return true;
  if (t.includes(norm) && t.startsWith('（引用：')) return true;
  return false;
}

/** Deterministic id for the substantive mention reply paired with a member fast ack. */
export function roomFastAckFormalReplyMessageId(fastAckMessageId: string): string | null {
  if (
    fastAckMessageId.startsWith('room-ack-')
    && !fastAckMessageId.startsWith('room-ack-postsend-')
  ) {
    return fastAckMessageId.replace(/^room-ack-/, 'room-mention-');
  }
  return null;
}

export function isRoomFastAckText(text: string): boolean {
  const t = roomMessageBodyText(text).replace(/\s+/g, '');
  for (const norm of FAST_ACK_NORMALIZED) {
    const n = norm.replace(/\s+/g, '');
    if (t === n || t === `${n}。` || t === `${n}！`) return true;
  }
  const legacy = '收到，待我思考下'.replace(/\s+/g, '');
  if (t.includes(legacy) && t.startsWith('（引用：')) return true;
  const legacyThinking = 'OK，待我思考下'.replace(/\s+/g, '');
  if (t.includes(legacyThinking) && t.startsWith('（引用：')) return true;
  const current = ROOM_FAST_ACK_TEXT.replace(/\s+/g, '');
  if (t.includes(current) && t.startsWith('（引用：')) return true;
  return false;
}

function isRoomFastAckPlaceholderText(text: string): boolean {
  return isRoomFastAckText(text) || isRoomCoordinatorReceiptAckText(text);
}

function isSubstantiveRoomReplyContent(text: string): boolean {
  const body = roomMessageBodyText(text);
  return Boolean(body && !isRoomFastAckPlaceholderText(body));
}

export function isRoomFastAckMessage(message: Pick<RoomMessage, 'id' | 'content'>): boolean {
  const body = roomMessageBodyText(message.content ?? '');
  const hasStandardAckId =
    message.id.startsWith('room-ack-')
    && !message.id.startsWith('room-ack-postsend-');
  if (hasStandardAckId) {
    // In-place update replaced ack body with substantive content — no longer a fast ack.
    if (body && !isRoomFastAckPlaceholderText(body)) return false;
    return true;
  }
  return isRoomFastAckText(body);
}

function sameRoomMessageAgent(left: RoomMessage, right: RoomMessage): boolean {
  const a = roomMessageFromAgentId(left);
  const b = roomMessageFromAgentId(right);
  return Boolean(a && b && a === b);
}

function sameRoomMessageProject(left: RoomMessage, right: RoomMessage): boolean {
  const a = roomMessageProjectId(left);
  const b = roomMessageProjectId(right);
  return Boolean(a && b && a === b);
}

/**
 * True when a fast ack was followed by a substantive reply for the same @mention round.
 * Paired ids (`room-ack-*` → `room-mention-*`) must be newer than the ack; reusing a round id
 * on a later dispatch must not turn a fresh ack blue because an older formal reply exists.
 */
export function isRoomFastAckSuperseded(
  message: RoomMessage,
  projectRoomMessages: ReadonlyArray<RoomMessage>,
): boolean {
  if (!isRoomFastAckMessage(message)) return false;

  const scoped = projectRoomMessages.filter((m) => sameRoomMessageProject(m, message));

  const formalId = roomFastAckFormalReplyMessageId(message.id);
  if (formalId) {
    const formal = scoped.find((m) => m.id === formalId);
    if (
      formal
      && formal.id !== message.id
      && formal.timestamp >= message.timestamp
      && isSubstantiveRoomReplyContent(formal.content ?? '')
    ) {
      return true;
    }
    return false;
  }

  // Legacy fast ack without room-ack-* id.
  if (!message.replyToId) return false;

  return scoped.some((m) => {
    if (m.id === message.id) return false;
    if (!sameRoomMessageAgent(m, message)) return false;
    if (m.replyToId !== message.replyToId) return false;
    if (m.timestamp < message.timestamp) return false;
    if (!m.id.startsWith('room-mention-')) return false;
    return isSubstantiveRoomReplyContent(m.content ?? '');
  });
}
