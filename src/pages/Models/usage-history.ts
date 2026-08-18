export type UsageHistoryEntry = {
  timestamp: string;
  sessionId: string;
  agentId: string;
  model?: string;
  provider?: string;
  content?: string;
  usageStatus?: 'available' | 'missing' | 'error';
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  costUsd?: number;
};

import type { ProviderAccount } from '@/lib/providers';
import { parseModelIds, splitModelRef } from '@/lib/model-options';

export const HIDDEN_USAGE_MARKERS = ['gateway-injected', 'delivery-mirror'];

export function isHiddenUsageSource(source?: string): boolean {
  if (!source) return false;
  const normalizedSource = source.trim().toLowerCase();
  return HIDDEN_USAGE_MARKERS.some((marker) => normalizedSource.includes(marker));
}

export type UsageWindow = '7d' | '30d' | 'all';
export type UsageGroupBy = 'model' | 'day';

export type UsageGroup = {
  label: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  sortKey: number | string;
};

/**
 * Fraction of input tokens served from the prompt cache, i.e.
 * cacheRead / (uncached input + cacheRead). Returns null when there is no
 * input at all (no meaningful rate). Note `inputTokens` already excludes cache
 * (see token-usage-core.ts invariant), and cacheWrite is the one-time cost of
 * creating the cache, so it is intentionally NOT part of the hit rate.
 */
export function computeCacheHitRate(
  group: Pick<UsageGroup, 'inputTokens' | 'cacheReadTokens'>,
): number | null {
  const denominator = group.inputTokens + group.cacheReadTokens;
  if (denominator <= 0) return null;
  return group.cacheReadTokens / denominator;
}

export function resolveStableUsageHistory(
  previousStableEntries: UsageHistoryEntry[],
  nextEntries: UsageHistoryEntry[],
  options: { preservePreviousOnEmpty?: boolean } = {},
): UsageHistoryEntry[] {
  if (nextEntries.length > 0) {
    return nextEntries;
  }

  return options.preservePreviousOnEmpty ? previousStableEntries : [];
}

export function resolveVisibleUsageHistory(
  currentEntries: UsageHistoryEntry[],
  stableEntries: UsageHistoryEntry[],
  options: { preferStableOnEmpty?: boolean } = {},
): UsageHistoryEntry[] {
  if (options.preferStableOnEmpty && currentEntries.length === 0) {
    return stableEntries;
  }

  return currentEntries;
}

export function formatUsageDay(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export function getUsageDaySortKey(timestamp: string): number {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return 0;
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Lowercased set of bare model ids currently configured across all provider
 * accounts (the user's active model setup). A model id leaves this set when the
 * user removes it from an account's model list or deletes the account; it
 * re-enters when re-added. Returns `null` when there are no accounts so callers
 * can skip filtering entirely — the store's initial state and a transient
 * snapshot-fetch failure both surface as an empty array, and hiding every
 * entry in that window would blank the whole usage panel for a flaky fetch.
 */
export function collectConfiguredModelIds(accounts: ProviderAccount[] | null | undefined): Set<string> | null {
  if (!accounts || accounts.length === 0) return null;
  const ids = new Set<string>();
  for (const account of accounts) {
    for (const raw of parseModelIds(account.model)) {
      const id = (raw ?? '').trim().toLowerCase();
      if (id) ids.add(id);
    }
  }
  // An empty set with a non-null accounts array is valid: it means the user has
  // accounts but no model ids listed on any of them. Distinguish from the
  // "not loaded / skip" sentinel by returning a (possibly empty) Set.
  return ids.size === 0 ? new Set<string>() : ids;
}

/** Normalize a usage entry's model field to a bare, lowercased id for set lookup. */
function normalizeEntryModelId(model: string | undefined): string {
  const value = (model ?? '').trim();
  if (!value) return '';
  // `entry.model` may be a bare id ("GLM51") or a ref ("providerKey/modelId").
  const split = splitModelRef(value);
  return (split?.modelId ?? value).toLowerCase();
}

/**
 * True when the entry carries a model id that is NOT in the configured set, i.e.
 * a model the user has since removed. Entries with no model (Unknown) are kept —
 * they aren't "a deleted model", just unattributed usage. Pass `null` for the
 * set (accounts not loaded) to keep everything.
 */
export function isUnconfiguredModelEntry(
  entry: UsageHistoryEntry,
  configuredIds: Set<string> | null,
): boolean {
  if (!configuredIds) return false;
  const id = normalizeEntryModelId(entry.model);
  if (!id) return false;
  return !configuredIds.has(id);
}

export function groupUsageHistory(
  entries: UsageHistoryEntry[],
  groupBy: UsageGroupBy,
): UsageGroup[] {
  const grouped = new Map<string, UsageGroup>();

  for (const entry of entries) {
    const label = groupBy === 'model'
      ? (entry.model || 'Unknown')
      : formatUsageDay(entry.timestamp);
    const current = grouped.get(label) ?? {
      label,
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      sortKey: groupBy === 'day' ? getUsageDaySortKey(entry.timestamp) : label.toLowerCase(),
    };
    current.totalTokens += entry.totalTokens;
    current.inputTokens += entry.inputTokens;
    current.outputTokens += entry.outputTokens;
    current.cacheReadTokens += entry.cacheReadTokens;
    current.cacheWriteTokens += entry.cacheWriteTokens;
    current.cacheTokens += entry.cacheReadTokens + entry.cacheWriteTokens;
    grouped.set(label, current);
  }

  const sorted = Array.from(grouped.values()).sort((a, b) => {
    if (groupBy === 'day') {
      return Number(a.sortKey) - Number(b.sortKey);
    }
    return b.totalTokens - a.totalTokens;
  });

  return groupBy === 'model' ? sorted.slice(0, 8) : sorted;
}

export function filterUsageHistoryByWindow(
  entries: UsageHistoryEntry[],
  window: UsageWindow,
  now = Date.now(),
): UsageHistoryEntry[] {
  if (window === 'all') return entries;

  const days = window === '7d' ? 7 : 30;
  const cutoff = now - days * 24 * 60 * 60 * 1000;

  return entries.filter((entry) => {
    const timestamp = Date.parse(entry.timestamp);
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  });
}
