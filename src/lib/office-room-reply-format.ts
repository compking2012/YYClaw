/** Blank line between an inline quote tag and the reply body in team room messages. */
export const ROOM_QUOTED_REPLY_GAP = '\n\n';

const INLINE_QUOTE_PREFIX_RE = /^（引用(?:协调)?：[^）]*）\s*/u;

/** Inline quote tag + blank line + body (when quote is embedded in `content`). */
export function joinInlineQuotedReply(
  quoteExcerpt: string,
  body: string,
  opts?: { tag?: 'quote' | 'quoteCoord' },
): string {
  const q = quoteExcerpt.trim();
  const b = body.trim();
  const label = opts?.tag === 'quoteCoord' ? '引用协调' : '引用';
  if (!q) return b;
  if (!b) return `（${label}：${q}）`;
  const short = q.length > 160 ? `${q.slice(0, 159)}…` : q;
  return `（${label}：${short}）${ROOM_QUOTED_REPLY_GAP}${b}`;
}

/** Body text for a reply that already has `replyToId` / UI quote block. */
export function formatRoomReplyBody(content: string, hasReplyTarget: boolean): string {
  const body = stripInlineQuotePrefix(content).trim();
  if (!body || !hasReplyTarget) return body;
  if (body.startsWith(ROOM_QUOTED_REPLY_GAP) || body.startsWith('\n')) return body;
  return `${ROOM_QUOTED_REPLY_GAP}${body}`;
}

export function stripInlineQuotePrefix(content: string): string {
  const m = content.match(INLINE_QUOTE_PREFIX_RE);
  if (!m) return content;
  return content.slice(m[0].length).replace(/^\n+/, '');
}

export function splitInlineQuotedContent(content: string): {
  inlineQuote: string | null;
  body: string;
} {
  const m = content.match(/^（引用(?:协调)?：([^）]*)）\s*([\s\S]*)$/u);
  if (!m) return { inlineQuote: null, body: content };
  return {
    inlineQuote: m[1]!.trim() || null,
    body: m[2]!.replace(/^\n+/, '').trim(),
  };
}

/** Text shown in the message bubble (respects replyTo + legacy inline quotes). */
export function displayRoomMessageBody(message: {
  content: string;
  replyToId?: string;
  replyPreview?: string;
}): string {
  const raw = message.content ?? '';
  if (message.replyToId?.trim()) {
    return formatRoomReplyBody(raw, true);
  }
  const split = splitInlineQuotedContent(raw);
  if (split.inlineQuote != null) {
    return joinInlineQuotedReply(split.inlineQuote, split.body);
  }
  return raw;
}

/** Remove agent emoji + 【name】 prefix from the first line of a room message body. */
export function stripRoomAgentIconPrefix(line: string): string {
  return line.replace(/^(\p{Extended_Pictographic}\uFE0F?\s*)?【[^】]*】\s*/u, '');
}

/** Strip agent icon prefixes from room message content for group-chat display. */
export function stripRoomAgentIconFromContent(content: string): string {
  const lines = content.split('\n');
  if (lines.length === 0) return content;
  lines[0] = stripRoomAgentIconPrefix(lines[0]!);
  return lines.join('\n');
}
