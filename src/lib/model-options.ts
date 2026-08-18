import type { ModelKind, ProviderAccount, ProviderVendorInfo, ProviderWithKeyInfo } from '@/lib/providers';
import { accountModelKinds } from '@/lib/providers';

export interface ConfiguredModelOption {
  modelRef: string;
  label: string;
  runtimeProviderKey: string;
  accountId: string;
}

export interface RuntimeProviderOption {
  runtimeProviderKey: string;
  accountId: string;
  label: string;
  modelIdPlaceholder?: string;
  configuredModelId?: string;
}

export function resolveRuntimeProviderKey(account: ProviderAccount): string {
  if (account.authMode === 'oauth_browser') {
    if (account.vendorId === 'openai') return 'openai';
  }

  if (account.vendorId === 'custom' || account.vendorId === 'ollama') {
    const prefix = `${account.vendorId}-`;
    if (account.id.startsWith(prefix)) {
      const tail = account.id.slice(prefix.length);
      if (tail.length === 8 && !tail.includes('-')) {
        return account.id;
      }
    }

    const suffix = account.id.replace(/-/g, '').slice(0, 8);
    return `${account.vendorId}-${suffix}`;
  }

  if (account.vendorId === 'minimax-portal-cn') {
    return 'minimax-portal';
  }

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

export function parseModelIds(model: string | string[] | null | undefined): string[] {
  const values = Array.isArray(model) ? model : [model ?? ''];
  return values
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter(Boolean);
}

export function normalizeModelIdForRuntimeProvider(
  modelId: string | null | undefined,
  runtimeProviderKey: string,
): string {
  const value = (modelId || '').trim();
  const prefix = `${runtimeProviderKey}/`;
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

export function formatModelRefLabel(modelRef: string | null | undefined): string {
  const parsed = splitModelRef(modelRef);
  return parsed?.modelId || (modelRef || '').trim() || 'Model';
}

export function formatProviderDisplayName(
  account: ProviderAccount,
  vendorMap: Map<string, ProviderVendorInfo>,
): string {
  const vendor = vendorMap.get(account.vendorId);
  return account.label.trim() || vendor?.name || account.vendorId;
}

export function formatConfiguredModelLabel(
  modelId: string,
  account: ProviderAccount,
  vendorMap: Map<string, ProviderVendorInfo>,
  options?: { disambiguate?: boolean },
): string {
  const providerName = formatProviderDisplayName(account, vendorMap);
  // The picker should read like the account's own name from Settings, not
  // a raw model id (e.g. "GLM52") — those are meaningful to whoever set up
  // the provider, not to someone just picking a model for this chat. Only
  // fall back to the id when an account configures more than one model and
  // needs disambiguating.
  return options?.disambiguate ? `${providerName} · ${modelId}` : providerName;
}

export function toModelOptionTestId(label: string): string {
  return label.replace(/[^a-zA-Z0-9_-]+/g, '-');
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

export function buildRuntimeProviderOptions(
  providerAccounts: ProviderAccount[],
  providerStatuses: ProviderWithKeyInfo[],
  providerVendors: ProviderVendorInfo[],
  providerDefaultAccountId: string | null,
): RuntimeProviderOption[] {
  const safeAccounts = Array.isArray(providerAccounts) ? providerAccounts : [];
  const safeStatuses = Array.isArray(providerStatuses) ? providerStatuses : [];
  const safeVendors = Array.isArray(providerVendors) ? providerVendors : [];
  const vendorMap = new Map<string, ProviderVendorInfo>(safeVendors.map((vendor) => [vendor.id, vendor]));
  const statusById = new Map<string, ProviderWithKeyInfo>(safeStatuses.map((status) => [status.id, status]));
  const entries = safeAccounts
    .filter((account) => account.enabled && hasConfiguredProviderCredentials(account, statusById))
    .sort((left, right) => {
      if (left.id === providerDefaultAccountId) return -1;
      if (right.id === providerDefaultAccountId) return 1;
      return right.updatedAt.localeCompare(left.updatedAt);
    });

  const deduped = new Map<string, RuntimeProviderOption>();
  for (const account of entries) {
    const runtimeProviderKey = resolveRuntimeProviderKey(account);
    if (!runtimeProviderKey || deduped.has(runtimeProviderKey)) continue;
    const vendor = vendorMap.get(account.vendorId);
    const label = `${account.label} (${vendor?.name || account.vendorId})`;
    const firstModelId = parseModelIds(account.model)[0];
    const configuredModelId = firstModelId
      ? (firstModelId.startsWith(`${runtimeProviderKey}/`)
        ? firstModelId.slice(runtimeProviderKey.length + 1)
        : firstModelId)
      : undefined;

    deduped.set(runtimeProviderKey, {
      runtimeProviderKey,
      accountId: account.id,
      label,
      modelIdPlaceholder: firstStringValue(vendor?.modelIdPlaceholder),
      configuredModelId,
    });
  }

  return [...deduped.values()];
}

export function buildConfiguredModelOptions(
  providerAccounts: ProviderAccount[],
  providerStatuses: ProviderWithKeyInfo[],
  providerVendors: ProviderVendorInfo[],
  providerDefaultAccountId: string | null,
  options?: { includeKinds?: ModelKind[] },
): ConfiguredModelOption[] {
  const safeAccounts = Array.isArray(providerAccounts) ? providerAccounts : [];
  const safeStatuses = Array.isArray(providerStatuses) ? providerStatuses : [];
  const safeVendors = Array.isArray(providerVendors) ? providerVendors : [];
  const vendorMap = new Map<string, ProviderVendorInfo>(safeVendors.map((vendor) => [vendor.id, vendor]));
  const statusById = new Map<string, ProviderWithKeyInfo>(safeStatuses.map((status) => [status.id, status]));
  const includeKinds = options?.includeKinds;
  const entries = safeAccounts
    .filter((account) => {
      const hasModel = parseModelIds(account.model).length > 0
        || Boolean(account.metadata?.customModels?.some((modelId) => modelId.trim()));
      if (!account.enabled || !hasModel || !hasConfiguredProviderCredentials(account, statusById)) return false;
      if (!includeKinds) return true;
      // Keep an account when it supports ANY of the requested kinds — matching
      // the Agents page's `kinds.includes('text')`. Requiring the account's
      // whole kind set to be a subset of `includeKinds` would drop every
      // vision-capable chat model (modelType ['text','image']) from a
      // text-only picker.
      const kinds = accountModelKinds(account, vendorMap.get(account.vendorId));
      return kinds.some((kind) => includeKinds.includes(kind));
    })
    .sort((left, right) => {
      if (left.id === providerDefaultAccountId) return -1;
      if (right.id === providerDefaultAccountId) return 1;
      return right.updatedAt.localeCompare(left.updatedAt);
    });

  const deduped = new Map<string, ConfiguredModelOption>();
  for (const account of entries) {
    const runtimeProviderKey = resolveRuntimeProviderKey(account);
    const kinds = accountModelKinds(account, vendorMap.get(account.vendorId));
    const accountModelIds = (() => {
      // `account.model` is positional — one slot per declared kind, in the
      // account's own `modelType` order — and each slot may itself be a
      // comma-joined string, so always parse before indexing.
      const positional = parseModelIds(account.model)
        .map((modelId) => normalizeModelIdForRuntimeProvider(modelId, runtimeProviderKey))
        .filter(Boolean);
      const configured = (account.metadata?.customModels ?? [])
        .map((modelId) => normalizeModelIdForRuntimeProvider(modelId, runtimeProviderKey))
        .filter(Boolean);
      const supportsMultipleModels = account.vendorId === 'custom' || account.vendorId === 'ollama';
      if (!supportsMultipleModels) {
        // Take the slot for the requested kind, not blindly index 0 — asking
        // for text on a voice-first account would otherwise surface its TTS id.
        // `customModels` is a flat set with no kind information, so it is never
        // fanned out here: a built-in account's positional `model` is the
        // source of truth, and a multi-kind account (e.g. MiniMax: text +
        // image/music/video) would leak non-text ids into a text-only picker.
        const kindIndex = includeKinds ? kinds.findIndex((kind) => includeKinds.includes(kind)) : 0;
        const selected = positional[kindIndex >= 0 ? kindIndex : 0];
        if (selected) return [selected];
      }
      if (configured.length > 0) return configured;
      return positional;
    })();
    // A multi-kind account repeats the same id across kind slots (e.g.
    // "cd-h-4-5,cd-h-4-5" for text + image), so dedupe before labelling —
    // otherwise the count looks like >1 model and the label picks up an
    // unnecessary " · <model id>" disambiguation suffix.
    const modelIds = Array.from(new Set(accountModelIds));
    for (const modelId of modelIds) {
      const modelRef = `${runtimeProviderKey}/${modelId}`;
      if (deduped.has(modelRef)) continue;
      deduped.set(modelRef, {
        modelRef,
        label: formatConfiguredModelLabel(modelId, account, vendorMap, { disambiguate: modelIds.length > 1 }),
        runtimeProviderKey,
        accountId: account.id,
      });
    }
  }

  return [...deduped.values()];
}

export function isConfiguredModelRefAvailable(
  modelRef: string | null | undefined,
  modelOptions: ConfiguredModelOption[],
): boolean {
  const value = (modelRef || '').trim();
  if (!value) return false;
  return modelOptions.some((option) => option.modelRef === value);
}

export function resolveConfiguredModelRef(
  preferredModelRef: string | null | undefined,
  defaultModelRef: string | null | undefined,
  modelOptions: ConfiguredModelOption[],
): string | null {
  const preferred = (preferredModelRef || '').trim();
  if (preferred && isConfiguredModelRefAvailable(preferred, modelOptions)) {
    return preferred;
  }

  const fallbackDefault = (defaultModelRef || '').trim();
  if (fallbackDefault && isConfiguredModelRefAvailable(fallbackDefault, modelOptions)) {
    return fallbackDefault;
  }

  return modelOptions[0]?.modelRef ?? null;
}
