import { describe, expect, it } from 'vitest';
import { resolveDefaultModelProviderAccountId } from '@electron/utils/default-model-provider-account';
import type { ProviderAccount } from '@electron/shared/providers/types';

function account(partial: Partial<ProviderAccount> & Pick<ProviderAccount, 'id' | 'vendorId'>): ProviderAccount {
  return {
    label: partial.label ?? partial.id,
    authMode: partial.authMode ?? 'api_key',
    enabled: partial.enabled ?? true,
    isDefault: partial.isDefault ?? false,
    createdAt: partial.createdAt ?? new Date().toISOString(),
    updatedAt: partial.updatedAt ?? new Date().toISOString(),
    ...partial,
  };
}

describe('resolveDefaultModelProviderAccountId', () => {
  it('returns null when ref has no provider prefix', () => {
    expect(resolveDefaultModelProviderAccountId(null, [])).toBeNull();
    expect(resolveDefaultModelProviderAccountId('', [account({ id: 'a', vendorId: 'moonshot' })])).toBeNull();
    expect(resolveDefaultModelProviderAccountId('nope', [account({ id: 'a', vendorId: 'moonshot' })])).toBeNull();
  });

  it('matches builtin vendor by runtime key (moonshot)', () => {
    const acc = account({ id: 'moonshot-work', vendorId: 'moonshot', label: 'Moonshot' });
    expect(resolveDefaultModelProviderAccountId('moonshot/kimi-k2.6', [acc])).toBe('moonshot-work');
  });

  it('matches custom account id when ref uses the same id as openclaw key', () => {
    const id = 'clawserverglm51-clawserv';
    const acc = account({ id, vendorId: 'custom', label: 'GLM' });
    expect(resolveDefaultModelProviderAccountId(`${id}/GLM51`, [acc])).toBe(id);
  });

  it('matches custom account when ref uses hashed runtime key', () => {
    const id = 'clawserverglm51-clawserv';
    const acc = account({ id, vendorId: 'custom', label: 'GLM' });
    // getOpenClawProviderKeyForType('custom', id) => custom-<8-char suffix>
    expect(resolveDefaultModelProviderAccountId('custom-clawserv/GLM51', [acc])).toBe(id);
  });
});
