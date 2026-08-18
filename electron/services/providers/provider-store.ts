import type { ProviderAccount, ProviderConfig, ProviderType } from '../../shared/providers/types';
import { normalizeProviderAccountModelField } from '../../shared/providers/normalize-account-model';
import { getProviderDefinition } from '../../shared/providers/registry';
import { getClawXProviderStore } from './store-instance';

function sanitizeProviderAccount(account: ProviderAccount): ProviderAccount {
  const model = normalizeProviderAccountModelField(account.model);
  if (model === account.model) {
    return account;
  }
  return { ...account, model };
}


function inferAuthMode(type: ProviderType): ProviderAccount['authMode'] {
  if (type === 'ollama') {
    return 'local';
  }

  const definition = getProviderDefinition(type);
  if (definition?.defaultAuthMode) {
    return definition.defaultAuthMode;
  }

  return 'api_key';
}

export function providerConfigToAccount(
  config: ProviderConfig,
  options?: { isDefault?: boolean },
): ProviderAccount {
  return {
    id: config.id,
    vendorId: config.type,
    label: config.name,
    authMode: inferAuthMode(config.type),
    baseUrl: config.baseUrl,
    apiProtocol: config.apiProtocol || (config.type === 'custom' || config.type === 'ollama'
      ? 'openai-completions'
      : getProviderDefinition(config.type)?.apiProtocol),
    headers: config.headers,
    model: normalizeProviderAccountModelField(config.model),
    modelType: config.modelType,
    modelParams: config.modelParams,
    fallbackModels: config.fallbackModels,
    fallbackAccountIds: config.fallbackProviderIds,
    enabled: config.enabled,
    isDefault: options?.isDefault ?? false,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

export function providerAccountToConfig(account: ProviderAccount): ProviderConfig {
  return {
    id: account.id,
    name: account.label,
    type: account.vendorId,
    baseUrl: account.baseUrl,
    apiProtocol: account.apiProtocol,
    headers: account.headers,
    model: account.model,
    modelType: account.modelType,
    modelParams: account.modelParams,
    fallbackModels: account.fallbackModels,
    fallbackProviderIds: account.fallbackAccountIds,
    enabled: account.enabled,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

export async function listProviderAccounts(): Promise<ProviderAccount[]> {
  const store = await getClawXProviderStore();
  const raw = (store.get('providerAccounts') ?? {}) as Record<string, ProviderAccount>;
  const repaired: Record<string, ProviderAccount> = {};
  let changed = false;
  for (const [id, account] of Object.entries(raw)) {
    const next = sanitizeProviderAccount(account);
    repaired[id] = next;
    if (next !== account) changed = true;
  }
  if (changed) {
    store.set('providerAccounts', repaired);
  }
  return Object.values(repaired);
}

export async function getProviderAccount(accountId: string): Promise<ProviderAccount | null> {
  const store = await getClawXProviderStore();
  const accounts = store.get('providerAccounts') as Record<string, ProviderAccount> | undefined;
  const account = accounts?.[accountId];
  if (!account) return null;
  const sanitized = sanitizeProviderAccount(account);
  if (sanitized !== account) {
    accounts[accountId] = sanitized;
    store.set('providerAccounts', accounts);
  }
  return sanitized;
}

export async function saveProviderAccount(account: ProviderAccount): Promise<void> {
  const store = await getClawXProviderStore();
  const accounts = (store.get('providerAccounts') ?? {}) as Record<string, ProviderAccount>;
  accounts[account.id] = sanitizeProviderAccount(account);
  store.set('providerAccounts', accounts);
}

export async function deleteProviderAccount(accountId: string): Promise<void> {
  const store = await getClawXProviderStore();
  const accounts = (store.get('providerAccounts') ?? {}) as Record<string, ProviderAccount>;
  delete accounts[accountId];
  store.set('providerAccounts', accounts);

  if (store.get('defaultProviderAccountId') === accountId) {
    store.delete('defaultProviderAccountId');
  }
}

export async function setDefaultProviderAccount(accountId: string): Promise<void> {
  const store = await getClawXProviderStore();
  store.set('defaultProviderAccountId', accountId);

  const accounts = (store.get('providerAccounts') ?? {}) as Record<string, ProviderAccount>;
  for (const account of Object.values(accounts)) {
    account.isDefault = account.id === accountId;
  }
  store.set('providerAccounts', accounts);
}

export async function getDefaultProviderAccountId(): Promise<string | undefined> {
  const store = await getClawXProviderStore();
  return store.get('defaultProviderAccountId') as string | undefined;
}
