import { describe, expect, it, vi, beforeEach } from 'vitest';
import { normalizeProviderAccountModelField } from '@electron/shared/providers/normalize-account-model';

const storeState: { accounts: Record<string, unknown> } = { accounts: {} };

vi.mock('@electron/services/providers/store-instance', () => ({
  getClawXProviderStore: vi.fn(async () => ({
    get: (key: string) => (key === 'providerAccounts' ? storeState.accounts : undefined),
    set: (key: string, value: unknown) => {
      if (key === 'providerAccounts') {
        storeState.accounts = value as Record<string, unknown>;
      }
    },
    delete: vi.fn(),
  })),
}));

vi.mock('../../electron/shared/providers/registry', () => ({
  getProviderDefinition: vi.fn(() => ({ providerConfig: { api: 'openai-completions' } })),
}));

describe('provider account model normalization', () => {
  beforeEach(() => {
    storeState.accounts = {};
  });

  it('coerces OpenClaw agent-style { primary } to a string', () => {
    expect(normalizeProviderAccountModelField({ primary: 'openai/gpt-4o' })).toBe('openai/gpt-4o');
    expect(normalizeProviderAccountModelField('gpt-4o')).toBe('gpt-4o');
    expect(normalizeProviderAccountModelField({})).toBeUndefined();
  });

  it('persists positional model arrays as comma-joined strings, keeping empty slots', () => {
    // Position maps each model id to its modelType kind — empty slots must survive.
    expect(normalizeProviderAccountModelField(['gpt-4o', '', '', '', '', 'gpt-4o-mini-tts']))
      .toBe('gpt-4o,,,,,gpt-4o-mini-tts');
    expect(normalizeProviderAccountModelField(['gpt-4o'])).toBe('gpt-4o');
    // Sparse/undefined slots normalize to empty strings instead of crashing.
    expect(normalizeProviderAccountModelField(['a', undefined as unknown as string, 'c'])).toBe('a,,c');
    // All-empty arrays mean "no model configured".
    expect(normalizeProviderAccountModelField(['', '', ''])).toBeUndefined();
    expect(normalizeProviderAccountModelField([])).toBeUndefined();
  });

  it('repairs persisted providerAccounts on listProviderAccounts', async () => {
    storeState.accounts = {
      broken: {
        id: 'broken',
        vendorId: 'openai',
        label: 'OpenAI',
        authMode: 'api_key',
        model: { primary: 'openai/gpt-4o' },
        enabled: true,
        isDefault: false,
        createdAt: '2020-01-01T00:00:00.000Z',
        updatedAt: '2020-01-01T00:00:00.000Z',
      },
    };

    const { listProviderAccounts } = await import('@electron/services/providers/provider-store');
    const accounts = await listProviderAccounts();
    expect(accounts[0]?.model).toBe('openai/gpt-4o');
    expect((storeState.accounts.broken as { model?: unknown }).model).toBe('openai/gpt-4o');
  });
});
