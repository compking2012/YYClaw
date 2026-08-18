import { describe, expect, it } from 'vitest';
import {
  computeCacheHitRate,
  filterUsageHistoryByWindow,
  groupUsageHistory,
  resolveStableUsageHistory,
  resolveVisibleUsageHistory,
  type UsageHistoryEntry,
} from '@/pages/Models/usage-history';

function createEntry(day: number, totalTokens: number): UsageHistoryEntry {
  return {
    timestamp: `2026-03-${String(day).padStart(2, '0')}T12:00:00.000Z`,
    sessionId: `session-${day}`,
    agentId: 'main',
    model: 'gpt-5',
    inputTokens: totalTokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens,
  };
}

describe('models usage history helpers', () => {
  it('aggregates cache read and write separately while keeping the combined total', () => {
    const entries: UsageHistoryEntry[] = [
      {
        ...createEntry(1, 0),
        model: 'glm',
        inputTokens: 100,
        cacheReadTokens: 300,
        cacheWriteTokens: 40,
        totalTokens: 440,
      },
      {
        ...createEntry(2, 0),
        model: 'glm',
        inputTokens: 50,
        cacheReadTokens: 100,
        cacheWriteTokens: 10,
        totalTokens: 160,
      },
    ];

    const [group] = groupUsageHistory(entries, 'model');

    expect(group.cacheReadTokens).toBe(400);
    expect(group.cacheWriteTokens).toBe(50);
    expect(group.cacheTokens).toBe(450); // combined, backward-compatible
  });

  it('computes cache hit rate from uncached input + cacheRead, ignoring cacheWrite', () => {
    // 400 cached reads out of 150 uncached input + 400 reads = 400/550.
    expect(computeCacheHitRate({ inputTokens: 150, cacheReadTokens: 400 })).toBeCloseTo(400 / 550);
    // No cache reads → 0% hit rate.
    expect(computeCacheHitRate({ inputTokens: 200, cacheReadTokens: 0 })).toBe(0);
    // No input at all → undefined rate (null), not a divide-by-zero.
    expect(computeCacheHitRate({ inputTokens: 0, cacheReadTokens: 0 })).toBeNull();
  });

  it('keeps all day buckets instead of truncating to the first eight', () => {
    const entries = Array.from({ length: 12 }, (_, index) => createEntry(index + 1, index + 1));

    const groups = groupUsageHistory(entries, 'day');

    expect(groups).toHaveLength(12);
    expect(groups[0]?.totalTokens).toBe(1);
    expect(groups[11]?.totalTokens).toBe(12);
  });

  it('limits model buckets to the top eight by total tokens', () => {
    const entries = Array.from({ length: 10 }, (_, index) => ({
      ...createEntry(index + 1, index + 1),
      model: `model-${index + 1}`,
    }));

    const groups = groupUsageHistory(entries, 'model');

    expect(groups).toHaveLength(8);
    expect(groups[0]?.label).toBe('model-10');
    expect(groups[7]?.label).toBe('model-3');
  });

  it('filters the last 30 days relative to now instead of calendar month boundaries', () => {
    const now = Date.parse('2026-03-12T12:00:00.000Z');
    const entries = [
      {
        ...createEntry(12, 12),
        timestamp: '2026-03-12T12:00:00.000Z',
      },
      {
        ...createEntry(11, 11),
        timestamp: '2026-02-11T12:00:00.000Z',
      },
      {
        ...createEntry(10, 10),
        timestamp: '2026-02-10T11:59:59.000Z',
      },
    ];

    const filtered = filterUsageHistoryByWindow(entries, '30d', now);

    expect(filtered).toHaveLength(2);
    expect(filtered.map((entry) => entry.totalTokens)).toEqual([12, 11]);
  });

  it('clears the stable usage snapshot when a successful refresh returns empty', () => {
    const stable = [createEntry(12, 12)];

    expect(resolveStableUsageHistory(stable, [])).toEqual([]);
  });

  it('can preserve the last stable usage snapshot while a refresh is still in flight', () => {
    const stable = [createEntry(12, 12)];

    expect(resolveStableUsageHistory(stable, [], { preservePreviousOnEmpty: true })).toEqual(stable);
  });

  it('prefers fresh usage entries over the cached snapshot when available', () => {
    const stable = [createEntry(12, 12)];
    const fresh = [createEntry(13, 13)];

    expect(resolveVisibleUsageHistory([], stable)).toEqual([]);
    expect(resolveVisibleUsageHistory([], stable, { preferStableOnEmpty: true })).toEqual(stable);
    expect(resolveVisibleUsageHistory(fresh, stable, { preferStableOnEmpty: true })).toEqual(fresh);
  });
});
