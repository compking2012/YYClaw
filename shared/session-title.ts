/**
 * Session title cleaning — the single source of truth shared by the renderer
 * (which derives a session label from the first user message) and the main
 * process (`/api/sessions/summaries`, which does the same off-disk).
 *
 * Gateway-persisted user messages carry untrusted metadata that must never be
 * used as a conversation title:
 *   - leading sender metadata `Sender (untrusted ...): <name>` (optionally a
 *     fenced ```json``` / `{...}` block) followed by the real body;
 *   - "System (untrusted): ..." internal injections (exec/tool output);
 *   - "Conversation info (untrusted ...): ```json...```" blocks;
 *   - `[Mon 2026-04-22 10:30 GMT+8]` timestamp prefixes, `[message_id: ...]`
 *     and `[media attached: ...]` tags.
 *
 * Stripping all of these yields the genuine first line the user typed (or an
 * empty string when the message was purely internal metadata, in which case the
 * caller should skip it and look at the next message).
 */
export function cleanSessionLabelText(text: string): string {
  return text
    // Sender metadata (untrusted): fenced block / json object / single line + body separator.
    .replace(/^Sender\s*\([^)]*\)\s*:\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    .replace(/^Sender\s*\([^)]*\)\s*:\s*\{[\s\S]*?\}\s*/i, '')
    .replace(/^Sender\s*\([^)]*\)\s*:\s*[^\n]*(?:\n\s*)*/i, '')
    .replace(/^Sender\s*:\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    .replace(/^Sender\s*:\s*\{[\s\S]*?\}\s*/i, '')
    .replace(/^Sender\s*:\s*[^\n]*(?:\n\s*)*/i, '')
    // System (untrusted): internal injections — drop the line entirely.
    .replace(/^System\s*\([^)]*\)\s*:\s*[^\n]*(?:\n\s*)*/i, '')
    .replace(/^```json\n[\s\S]*?```\s*/i, '')
    .replace(/^\{[\s\S]*?\}\s*/i, '')
    .replace(/\s*\[media attached:[^\]]*\]/g, '')
    .replace(/\s*\[message_id:\s*[^\]]+\]/g, '')
    .replace(/^Conversation info\s*\([^)]*\):\s*```[a-z]*\n[\s\S]*?```\s*/i, '')
    .replace(/^Conversation info\s*\([^)]*\):\s*\{[\s\S]*?\}\s*/i, '')
    .replace(/^\[(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}\s+[^\]]+\]\s*/i, '')
    .trim();
}
