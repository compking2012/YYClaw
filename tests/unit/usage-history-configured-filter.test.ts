import { describe, expect, it } from 'vitest';
import type { ProviderAccount } from '@/lib/providers';
import {
  collectConfiguredModelIds,
  isUnconfiguredModelEntry,
  type UsageHistoryEntry,
} from '@/pages/Models/usage-history';

function account(model: string | string[]): ProviderAccount {
  return {
    id: `acct-${Math.random().toString(36).slice(2)}`,
    name: 'test',
    type: 'openai-completions' as never,
    model,
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as unknown as ProviderAccount;
}

function entry(model: string | undefined, totalTokens = 100): UsageHistoryEntry {
  return {
    timestamp: '2026-06-23T00:00:00.000Z',
    sessionId: 's1',
    agentId: 'main',
    model,
    inputTokens: 10,
    outputTokens: 10,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens,
  };
}

describe('collectConfiguredModelIds + isUnconfiguredModelEntry', () => {
  it('returns null when accounts are empty/null (skip filtering)', () => {
    expect(collectConfiguredModelIds([])).toBeNull();
    expect(collectConfiguredModelIds(null)).toBeNull();
    expect(collectConfiguredModelIds(undefined)).toBeNull();
  });

  it('parses comma-separated and array model ids, lowercased', () => {
    const ids = collectConfiguredModelIds([account('kimi-k2.6, GLM51'), account(['minimax-m3'])]);
    expect(ids).not.toBeNull();
    expect([...ids!].sort()).toEqual(['glm51', 'kimi-k2.6', 'minimax-m3']);
  });

  it('keeps entries whose model matches by bare id, ref, or case variant', () => {
    const ids = collectConfiguredModelIds([account('kimi-k2.6')])!;
    expect(isUnconfiguredModelEntry(entry('kimi-k2.6'), ids)).toBe(false);
    expect(isUnconfiguredModelEntry(entry('kimi/kimi-k2.6'), ids)).toBe(false); // ref form
    expect(isUnconfiguredModelEntry(entry('KIMI-K2.6'), ids)).toBe(false); // case
  });

  it('hides entries whose model is not configured', () => {
    const ids = collectConfiguredModelIds([account('kimi-k2.6')])!;
    expect(isUnconfiguredModelEntry(entry('ghost-model-xyz'), ids)).toBe(true);
    expect(isUnconfiguredModelEntry(entry('deleted/gpt-x'), ids)).toBe(true);
  });

  it('keeps entries with no model (Unknown) — they are not a deleted model', () => {
    const ids = collectConfiguredModelIds([account('kimi-k2.6')])!;
    expect(isUnconfiguredModelEntry(entry(undefined), ids)).toBe(false);
    expect(isUnconfiguredModelEntry(entry(''), ids)).toBe(false);
  });

  it('does not filter when ids is null (accounts not loaded)', () => {
    expect(isUnconfiguredModelEntry(entry('ghost-model'), null)).toBe(false);
  });
});
