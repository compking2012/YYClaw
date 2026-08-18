import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Minimal chat.history row shape used by office settle tests. */
export type OfficeSessionHistoryMessage = Record<string, unknown>;

/**
 * Load OpenClaw session `.jsonl` transcript lines into gateway `chat.history` messages.
 * Source: real 五子棋 gen-2 软件测试验收 session (2026-07-08 stall repro).
 */
export function loadOfficeSessionJsonlFixture(filename: string): OfficeSessionHistoryMessage[] {
  const filePath = join(__dirname, '../fixtures/office', filename);
  const raw = readFileSync(filePath, 'utf8');
  const messages: OfficeSessionHistoryMessage[] = [];

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line) as { type?: string; message?: Record<string, unknown> };
      if (entry.type !== 'message' || !entry.message) continue;
      const message = entry.message;
      messages.push({
        role: message.role,
        content: message.content,
        timestamp: message.timestamp,
        stopReason: message.stopReason,
        toolCallId: message.toolCallId,
        tool_call_id: message.toolCallId,
        toolName: message.toolName,
      });
    } catch {
      // skip malformed lines
    }
  }

  return messages;
}
