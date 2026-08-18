import { BUILTIN_PROVIDER_TYPES, type ProviderAccount, type ProviderVendorInfo, type ProviderWithKeyInfo } from '@/lib/providers';

export interface RuntimeProviderOption {
  runtimeProviderKey: string;
  accountId: string;
  label: string;
  modelIdPlaceholder?: string;
  configuredModelId?: string;
}

function isUnregisteredProviderType(type: string): boolean {
  if (type === 'custom' || type === 'ollama') return true;
  return !BUILTIN_PROVIDER_TYPES.includes(type as (typeof BUILTIN_PROVIDER_TYPES)[number]);
}

export function resolveRuntimeProviderKey(account: ProviderAccount): string {
  if (account.authMode === 'oauth_browser') {
    if (account.vendorId === 'google') return 'google-gemini-cli';
    if (account.vendorId === 'openai') return 'openai-codex';
  }
  if (isUnregisteredProviderType(account.vendorId)) {
    const prefix = `${account.vendorId}-`;
    if (account.id.startsWith(prefix)) {
      const tail = account.id.slice(prefix.length);
      if (tail.length === 8 && !tail.includes('-')) return account.id;
    }
    const suffix = account.id.replace(/-/g, '').slice(0, 8);
    return `${account.vendorId}-${suffix}`;
  }
  if (account.vendorId === 'minimax-portal-cn') return 'minimax-portal';
  return account.vendorId;
}

export function splitModelRef(modelRef: string | null | undefined): { providerKey: string; modelId: string } | null {
  const value = (modelRef || '').trim();
  if (!value) return null;
  const separatorIndex = value.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex >= value.length - 1) return null;
  return {
    providerKey: value.slice(0, separatorIndex),
    modelId: value.slice(separatorIndex + 1),
  };
}

export function buildModelRef(providerKey: string, modelId: string): string {
  return `${providerKey.trim()}/${modelId.trim()}`;
}

function parseModelIds(model: string | string[] | null | undefined): string[] {
  const values = Array.isArray(model) ? model : [model ?? ''];
  return values
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}

function firstStringValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.find((entry): entry is string => typeof entry === 'string');
  }
  return undefined;
}

export function hasConfiguredProviderCredentials(
  account: ProviderAccount,
  statusById: Map<string, ProviderWithKeyInfo>,
): boolean {
  if (account.authMode === 'oauth_device' || account.authMode === 'oauth_browser' || account.authMode === 'local') {
    return true;
  }
  return statusById.get(account.id)?.hasKey ?? false;
}

export function buildRuntimeProviderOptions(params: {
  accounts: ProviderAccount[];
  statuses: ProviderWithKeyInfo[];
  vendors: ProviderVendorInfo[];
  defaultAccountId: string | null;
}): RuntimeProviderOption[] {
  const { accounts, statuses, vendors, defaultAccountId } = params;
  const vendorMap = new Map(vendors.map((v) => [v.id, v]));
  const statusById = new Map(statuses.map((s) => [s.id, s]));
  const entries = accounts
    .filter((a) => a.enabled && hasConfiguredProviderCredentials(a, statusById))
    .sort((a, b) => {
      if (a.id === defaultAccountId) return -1;
      if (b.id === defaultAccountId) return 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });

  const deduped = new Map<string, RuntimeProviderOption>();
  for (const account of entries) {
    const runtimeProviderKey = resolveRuntimeProviderKey(account);
    if (!runtimeProviderKey || deduped.has(runtimeProviderKey)) continue;
    const vendor = vendorMap.get(account.vendorId);
    const firstModelId = parseModelIds(account.model)[0];
    const configuredModelId = firstModelId
      ? firstModelId.startsWith(`${runtimeProviderKey}/`)
        ? firstModelId.slice(runtimeProviderKey.length + 1)
        : firstModelId
      : undefined;
    deduped.set(runtimeProviderKey, {
      runtimeProviderKey,
      accountId: account.id,
      label: `${account.label} (${vendor?.name || account.vendorId})`,
      modelIdPlaceholder: firstStringValue(vendor?.modelIdPlaceholder),
      configuredModelId,
    });
  }
  return [...deduped.values()];
}

export function modelIdOptionsForProvider(option: RuntimeProviderOption | null, currentModelId: string): string[] {
  const ids = new Set<string>();
  if (option?.configuredModelId) ids.add(option.configuredModelId);
  if (currentModelId.trim()) ids.add(currentModelId.trim());
  if (option?.modelIdPlaceholder) ids.add(option.modelIdPlaceholder);
  return [...ids];
}
