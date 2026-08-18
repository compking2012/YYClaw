import type { ProviderAccount } from '../shared/providers/types';
import { getOpenClawProviderKeyForType } from './provider-keys';

function parseModelRefProviderPrefix(ref: string | null | undefined): string {
  if (!ref || typeof ref !== 'string') return '';
  const trimmed = ref.trim();
  const slashIndex = trimmed.indexOf('/');
  if (slashIndex <= 0) return '';
  return trimmed.slice(0, slashIndex).trim();
}

/**
 * Map OpenClaw `agents.defaults.model.primary` ref (e.g. `custom-ab12cd34/model`)
 * to the ClawX provider **account id** shown in the Models UI.
 *
 * The ref prefix is the OpenClaw runtime provider key; `account.id` is often a
 * longer human-readable id — comparing only those two strings misses matches
 * after manager-side config edits.
 */
export function resolveDefaultModelProviderAccountId(
  defaultModelRef: string | null | undefined,
  accounts: ProviderAccount[],
): string | null {
  const prefix = parseModelRefProviderPrefix(defaultModelRef);
  if (!prefix || accounts.length === 0) return null;

  for (const account of accounts) {
    const runtimeKey = getOpenClawProviderKeyForType(account.vendorId, account.id);
    if (account.id === prefix || runtimeKey === prefix) {
      return account.id;
    }
  }
  return null;
}
