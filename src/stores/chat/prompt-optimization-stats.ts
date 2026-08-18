import type { RawMessage, TurnPromptOptimizationStats } from './types';

/** Stats map is keyed by Gateway runId (same as chat.send idempotencyKey). */
export function resolvePromptOptimizationStatsForMessage(
  message: Pick<RawMessage, 'id'>,
  statsByRunId: Record<string, TurnPromptOptimizationStats>,
): TurnPromptOptimizationStats | null {
  const messageId = message.id;
  if (!messageId) return null;
  const direct = statsByRunId[messageId];
  if (direct) return direct;
  if (messageId.startsWith('run-')) {
    return statsByRunId[messageId.slice(4)] ?? null;
  }
  return null;
}
