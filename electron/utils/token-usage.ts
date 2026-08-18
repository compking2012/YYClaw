import { type TokenUsageHistoryEntry } from './token-usage-core';
import { collectTranscriptAggregates } from './transcript-aggregate-cache';
import { logger } from './logger';

export {
  extractSessionIdFromTranscriptFileName,
  parseUsageEntriesFromJsonl,
  type TokenUsageHistoryEntry,
} from './token-usage-core';

/**
 * Safety ceiling for an unbounded request (the Models page calls with no limit).
 * Entries are sorted newest-first, so this keeps the most recent history while
 * guaranteeing the serialized response can never exceed V8's max string length.
 * After excluding checkpoint snapshots this is effectively never hit in practice.
 */
const DEFAULT_MAX_USAGE_ENTRIES = 100_000;

export async function getRecentTokenUsageHistory(limit?: number): Promise<TokenUsageHistoryEntry[]> {
  // Reuse the shared incremental transcript cache instead of re-scanning and
  // fully reading every session file. Aggregates come back sorted newest-first.
  const { usageEntries } = await collectTranscriptAggregates();
  const maxEntries = typeof limit === 'number' && Number.isFinite(limit)
    ? Math.max(Math.floor(limit), 0)
    : DEFAULT_MAX_USAGE_ENTRIES;
  if (usageEntries.length > maxEntries) {
    logger.warn(
      `Token usage history truncated to ${maxEntries} of ${usageEntries.length} entries to bound response size.`,
    );
    return usageEntries.slice(0, maxEntries);
  }
  return usageEntries;
}
