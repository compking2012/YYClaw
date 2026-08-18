import { isRoomFastAckText } from '@/lib/office-room-fast-ack';
import { roomMessageProgressText } from '@/lib/office-room-message';
import type { RoomMessage } from '@/types/office';

const DEFAULT_MAX_MESSAGES = 24;
const DEFAULT_MAX_CHARS = 8_000;
const MAX_BODY_CHARS = 420;

/** Text of one room line for agent context (skips huge running logs). */
export function roomMessageBodyForContext(message: RoomMessage): string {
  if (message.phase === 'task_running') {
    const header = message.content.split('\n')[0]?.trim();
    if (header) return header;
    return '（任务执行中）';
  }

  const raw = roomMessageProgressText(message) || message.content;
  const trimmed = raw.trim();
  if (!trimmed) return '（空消息）';
  const lines = trimmed.split('\n').slice(0, 6);
  let body = lines.join('\n');
  if (body.length > MAX_BODY_CHARS) {
    body = `${body.slice(0, MAX_BODY_CHARS)}…`;
  }
  return body;
}

/** 群聊上下文用：是否为极速确认占位（含引用式 ack）。 */
export function isRoomContextFastAckMessage(message: RoomMessage): boolean {
  const raw = (roomMessageProgressText(message) || message.content || '').trim();
  const body = roomMessageBodyForContext(message);
  return isRoomFastAckText(body) || isRoomFastAckText(raw);
}

/** 剔除极速确认后，取最近若干条群聊（Smart 协调者历史段用）。 */
export function selectSubstantiveRoomContextMessages(
  history: RoomMessage[],
  opts?: {
    upToMessageId?: string;
    maxMessages?: number;
    maxChars?: number;
  },
): RoomMessage[] {
  const maxMessages = opts?.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const maxChars = opts?.maxChars ?? DEFAULT_MAX_CHARS;

  let ordered = [...history].sort((a, b) => a.timestamp - b.timestamp);
  if (opts?.upToMessageId) {
    const cut = ordered.findIndex((m) => m.id === opts.upToMessageId);
    if (cut >= 0) ordered = ordered.slice(0, cut + 1);
  }

  const substantive = ordered.filter((m) => !isRoomContextFastAckMessage(m));
  const selected: RoomMessage[] = [];
  let chars = 0;
  for (let i = substantive.length - 1; i >= 0; i -= 1) {
    const message = substantive[i]!;
    const body = roomMessageBodyForContext(message);
    const lineCost = body.length + 48;
    if (selected.length >= maxMessages) break;
    if (selected.length > 0 && chars + lineCost > maxChars) break;
    selected.unshift(message);
    chars += lineCost;
  }
  return selected;
}

export function selectRoomContextMessages(
  history: RoomMessage[],
  opts?: {
    /** Include messages up to and including this id (typically the triggering user line). */
    upToMessageId?: string;
    maxMessages?: number;
    maxChars?: number;
  },
): RoomMessage[] {
  const maxMessages = opts?.maxMessages ?? DEFAULT_MAX_MESSAGES;
  const maxChars = opts?.maxChars ?? DEFAULT_MAX_CHARS;

  let ordered = [...history].sort((a, b) => a.timestamp - b.timestamp);
  if (opts?.upToMessageId) {
    const cut = ordered.findIndex((m) => m.id === opts.upToMessageId);
    if (cut >= 0) ordered = ordered.slice(0, cut + 1);
  }

  const selected: RoomMessage[] = [];
  let chars = 0;
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const message = ordered[i]!;
    const body = roomMessageBodyForContext(message);
    const lineCost = body.length + 48;
    if (selected.length >= maxMessages) break;
    if (selected.length > 0 && chars + lineCost > maxChars) break;
    selected.unshift(message);
    chars += lineCost;
  }
  return selected;
}

export function formatRoomTranscript(
  messages: RoomMessage[],
  authorLabel: (message: RoomMessage) => string,
): string {
  return messages
    .map((message, index) => {
      const author = authorLabel(message);
      const body = roomMessageBodyForContext(message);
      const quote =
        message.replyPreview?.trim() || (message.replyToId ? '（引用某条历史消息）' : '');
      if (!quote) return `[${index + 1}] ${author}: ${body}`;
      const short = quote.length > 100 ? `${quote.slice(0, 100)}…` : quote;
      return `[${index + 1}] ${author}（引用：${short}）:\n\n${body}`;
    })
    .join('\n');
}

/** Block injected into agent prompts so deictic phrases map to prior room lines. */
export function buildRoomContextBlock(
  messages: RoomMessage[],
  authorLabel: (message: RoomMessage) => string,
): string | null {
  if (messages.length === 0) return null;
  const transcript = formatRoomTranscript(messages, authorLabel);
  return [
    '【团队群聊近期记录】（按时间从早到晚排列）',
    '解读用户或同事口中的「上面」「前述」「这个问题」「刚才说的」等指代时，必须结合下列记录定位具体议题，并在回复中点明你所理解的是哪一条。',
    transcript,
  ].join('\n');
}
