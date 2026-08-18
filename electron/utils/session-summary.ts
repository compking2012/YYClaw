/**
 * Off-disk session summary helpers for `POST /api/sessions/summaries`.
 *
 * Derives a conversation's title (first genuine user line) and last-activity
 * timestamp from its JSONL transcript, reusing the SAME title cleaning the
 * renderer uses (`shared/session-title.ts`) so the sidebar label is identical
 * whether it was hydrated in the background or derived on click.
 */
import { cleanSessionLabelText } from '../../shared/session-title';

export interface TranscriptMessage {
  role?: string;
  content?: unknown;
  timestamp?: number;
}

/** Parse a `.jsonl` transcript into its `{type:'message'}` message objects. */
export function parseTranscriptMessages(raw: string): TranscriptMessage[] {
  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const entry = JSON.parse(line) as { type?: string; message?: unknown };
        return entry.type === 'message' && entry.message ? [entry.message as TranscriptMessage] : [];
      } catch {
        return [];
      }
    });
}

/** Flatten message content (string, or an array of content blocks) to plain text. */
export function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (block && typeof block === 'object' && 'text' in block) {
          const text = (block as { text?: unknown }).text;
          return typeof text === 'string' ? text : '';
        }
        return '';
      })
      .join('');
  }
  return '';
}

/**
 * The first user message whose cleaned text is non-empty. Messages that are
 * purely untrusted metadata (e.g. "System (untrusted): ...") clean to empty and
 * are skipped. Returns null when no usable user title exists.
 */
export function extractFirstUserTitle(messages: TranscriptMessage[]): string | null {
  for (const message of messages) {
    if ((message.role ?? '').toLowerCase() !== 'user') continue;
    const cleaned = cleanSessionLabelText(extractMessageText(message.content));
    if (cleaned) return cleaned;
  }
  return null;
}

/** Normalize a transcript timestamp (seconds or ms) to milliseconds. */
function toMs(ts: number): number {
  return ts < 1e12 ? Math.round(ts * 1000) : ts;
}

/** The latest message timestamp (ms), or null when none carry one. */
export function extractLastTimestampMs(messages: TranscriptMessage[]): number | null {
  let latest: number | null = null;
  for (const message of messages) {
    if (typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)) {
      const ms = toMs(message.timestamp);
      if (latest == null || ms > latest) latest = ms;
    }
  }
  return latest;
}
