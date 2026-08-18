import type { GatewayManager } from '../../gateway/manager';
import {
  awaitAgentRuntimeConvergence,
  noteConfigWatcherRefresh,
  scheduleGatewayProcessRestart,
} from '../../gateway/config-refresh-scheduler';
import { getProviderAccount, listProviderAccounts } from './provider-store';
import { getProviderSecret } from '../secrets/secret-store';
import type { ProviderConfig } from '../../utils/secure-storage';
import { getAllProviders, getApiKey, getDefaultProvider, getProvider } from '../../utils/secure-storage';
import { BUILTIN_PROVIDER_TYPES, type BuiltinProviderType, getProviderConfig, getProviderDefaultModel, getProviderTypeInfo } from '../../utils/provider-registry';
import { getOpenClawProviderKeyForType } from '../../utils/provider-keys';
import {
  ensureAnthropicMessagesModelMaxTokens,
  ensureOpenClawProviderAgentRuntimePins,
  ensureOpenClawProviderAllowPrivateNetwork,
  ensureProviderModelAllowlistWildcardPersisted,
  migrateAllAgentAuthProfilesToSqlite,
  pruneInvalidApiProviderEntries,
  removeProviderFromOpenClaw,
  removeProviderKeyFromOpenClaw,
  saveOAuthTokenToOpenClaw,
  saveProviderKeyToOpenClaw,
  OPENAI_CODEX_OAUTH_PROVIDER_CONFIG,
  setOpenClawDefaultModel,
  setOpenClawDefaultModelWithOverride,
  syncProviderConfigToOpenClaw,
  updateAgentModelProvider,
  updateSingleAgentModelProvider,
  clearOpenClawUnsupportedDefaultModels,
  removeDefaultModelSlotsForMissingProviders,
  getProviderApiKeyFromOpenClaw,
} from '../../utils/openclaw-auth';
import { piAiModelsJsonModelEntry } from '../../shared/pi-ai-model-cost';
import { logger } from '../../utils/logger';
import { listAgentsSnapshot, listAgentsSnapshotReadOnly, updateAgentModel } from '../../utils/agent-config';
import { normalizeModelTypes, isVoiceKind, type ModelKind } from '../../shared/providers/model-kind';
import {
  syncTtsConfigToOpenClaw,
  syncTranscriptionConfigToOpenClaw,
  syncRealtimeConfigToOpenClaw,
  removeVoiceProviderFromOpenClaw,
  listConfiguredVoiceProviderKinds,
  type VoiceProviderConfig,
} from '../../utils/openclaw-voice';
import { getVoiceRuntimeParams, isSupportedVoiceRuntime } from '../../utils/voice-runtime';

const GOOGLE_OAUTH_RUNTIME_PROVIDER = 'google-gemini-cli';
const GOOGLE_OAUTH_DEFAULT_MODEL_REF = `${GOOGLE_OAUTH_RUNTIME_PROVIDER}/gemini-3-pro-preview`;
/** OpenClaw Codex OAuth hooks only apply to the canonical `openai` provider id. */
const OPENAI_OAUTH_RUNTIME_PROVIDER = 'openai';
const OPENAI_OAUTH_DEFAULT_MODEL_REF = `${OPENAI_OAUTH_RUNTIME_PROVIDER}/gpt-5.6-sol`;

/**
 * Provider types that are not in the built-in provider registry (no `apiProtocol`).
 * They require explicit api-protocol defaulting to `openai-completions`.
 */
function isUnregisteredProviderType(type: string): boolean {
  if (type === 'custom' || type === 'ollama') return true;
  return !BUILTIN_PROVIDER_TYPES.includes(type as BuiltinProviderType);
}

type RuntimeProviderSyncContext = {
  runtimeProviderKey: string;
  meta: ReturnType<typeof getProviderConfig>;
  api: string;
};

function normalizeProviderBaseUrl(
  config: ProviderConfig,
  baseUrl?: string,
  apiProtocol?: string,
): string | undefined {
  if (!baseUrl) {
    return undefined;
  }

  const normalized = baseUrl.trim().replace(/\/+$/, '');

  if (config.type === 'minimax-portal' || config.type === 'minimax-portal-cn') {
    return normalized.replace(/\/v1$/, '').replace(/\/anthropic$/, '').replace(/\/$/, '') + '/anthropic';
  }

  if (isUnregisteredProviderType(config.type)) {
    const protocol = apiProtocol || config.apiProtocol || 'openai-completions';
    if (protocol === 'openai-responses') {
      return normalized.replace(/\/responses?$/i, '');
    }
    if (protocol === 'openai-completions') {
      return normalized.replace(/\/chat\/completions$/i, '');
    }
    if (protocol === 'anthropic-messages') {
      return normalized.replace(/\/v1\/messages$/i, '').replace(/\/messages$/i, '');
    }
  }

  return normalized;
}

function shouldUseExplicitDefaultOverride(config: ProviderConfig, runtimeProviderKey: string): boolean {
  return Boolean(config.baseUrl || config.apiProtocol || runtimeProviderKey !== config.type);
}

export function getOpenClawProviderKey(type: string, providerId: string): string {
  return getOpenClawProviderKeyForType(type, providerId);
}

async function resolveRuntimeProviderKey(config: ProviderConfig): Promise<string> {
  const account = await getProviderAccount(config.id);
  if (account?.authMode === 'oauth_browser') {
    if (config.type === 'google') {
      return GOOGLE_OAUTH_RUNTIME_PROVIDER;
    }
    if (config.type === 'openai') {
      return OPENAI_OAUTH_RUNTIME_PROVIDER;
    }
  }
  return getOpenClawProviderKey(config.type, config.id);
}

async function getBrowserOAuthRuntimeProvider(config: ProviderConfig): Promise<string | null> {
  const account = await getProviderAccount(config.id);
  if (account?.authMode !== 'oauth_browser') {
    return null;
  }

  const secret = await getProviderSecret(config.id);
  if (secret?.type !== 'oauth') {
    return null;
  }

  if (config.type === 'google') {
    return GOOGLE_OAUTH_RUNTIME_PROVIDER;
  }
  if (config.type === 'openai') {
    return OPENAI_OAUTH_RUNTIME_PROVIDER;
  }
  return null;
}

export function getProviderModelRef(config: ProviderConfig): string | undefined {
  const providerKey = getOpenClawProviderKey(config.type, config.id);

  const modelStrArray = (Array.isArray(config.model) ? config.model : [config.model || '']).flatMap(id => id.split(','));
  const modelStr = modelStrArray[0];
  if (modelStr) {
    return modelStr.startsWith(`${providerKey}/`)
      ? modelStr
      : `${providerKey}/${modelStr}`;
  }

  const defaultModel = getProviderDefaultModel(config.type);
  if (!defaultModel) {
    return undefined;
  }

  return defaultModel.startsWith(`${providerKey}/`)
    ? defaultModel
    : `${providerKey}/${defaultModel}`;
}

export async function getProviderFallbackModelRefs(config: ProviderConfig): Promise<string[]> {
  const allProviders = await getAllProviders();
  const providerMap = new Map(allProviders.map((provider) => [provider.id, provider]));
  const seen = new Set<string>();
  const results: string[] = [];
  const providerKey = getOpenClawProviderKey(config.type, config.id);

  for (const fallbackModel of config.fallbackModels ?? []) {
    const normalizedModel = fallbackModel.trim();
    if (!normalizedModel) continue;

    const modelRef = normalizedModel.startsWith(`${providerKey}/`)
      ? normalizedModel
      : `${providerKey}/${normalizedModel}`;

    if (seen.has(modelRef)) continue;
    seen.add(modelRef);
    results.push(modelRef);
  }

  for (const fallbackId of config.fallbackProviderIds ?? []) {
    if (!fallbackId || fallbackId === config.id) continue;

    const fallbackProvider = providerMap.get(fallbackId);
    if (!fallbackProvider) continue;

    const modelRef = getProviderModelRef(fallbackProvider);
    if (!modelRef || seen.has(modelRef)) continue;

    seen.add(modelRef);
    results.push(modelRef);
  }

  return results;
}

type GatewayRefreshMode = 'watcher' | 'restart';

/** Ordinary writes rely on OpenClaw's native watcher; restart-only writes remain explicit. */
export function scheduleGatewayRefresh(
  gatewayManager: GatewayManager | undefined,
  message: string,
  options?: { delayMs?: number; onlyIfRunning?: boolean; mode?: GatewayRefreshMode },
): void {
  if (options?.mode === 'restart') {
    scheduleGatewayProcessRestart(gatewayManager, message, options);
    return;
  }
  noteConfigWatcherRefresh(gatewayManager, message, options);
}

async function awaitConfiguredAgentModels(gatewayManager?: GatewayManager): Promise<void> {
  if (!gatewayManager || gatewayManager.getStatus().state !== 'running') {
    return;
  }
  const snapshot = await listAgentsSnapshotReadOnly();
  await awaitAgentRuntimeConvergence(
    gatewayManager,
    snapshot.agents.flatMap((agent) => {
      const modelRef = agent.modelRef?.trim();
      return modelRef ? [{ agentId: agent.id, modelRef }] : [];
    }),
  );
}

export async function syncProviderApiKeyToRuntime(
  providerType: string,
  providerId: string,
  apiKey: string,
): Promise<void> {
  const ock = getOpenClawProviderKey(providerType, providerId);
  await saveProviderKeyToOpenClaw(ock, apiKey);
}

export async function syncAllProviderAuthToRuntime(): Promise<void> {
  await migrateAllAgentAuthProfilesToSqlite();
  const accounts = await listProviderAccounts();
  for (const account of accounts) {
    const runtimeProviderKey = await resolveRuntimeProviderKey({
      id: account.id,
      name: account.label,
      type: account.vendorId,
      baseUrl: account.baseUrl,
      model: account.model,
      modelType: account.modelType,
      fallbackModels: account.fallbackModels,
      fallbackProviderIds: account.fallbackAccountIds,
      enabled: account.enabled,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    });

    const secret = await getProviderSecret(account.id);
    if (!secret) {
      continue;
    }

    // Backfill for providers registered before the /model directive allowlist
    // wildcard existed (or via a path that predates it) — see
    // `ensureProviderModelAllowlistWildcardPersisted`'s doc comment.
    await ensureProviderModelAllowlistWildcardPersisted(runtimeProviderKey);

    if (secret.type === 'api_key') {
      await saveProviderKeyToOpenClaw(runtimeProviderKey, secret.apiKey);
      continue;
    }

    if (secret.type === 'local' && secret.apiKey) {
      await saveProviderKeyToOpenClaw(runtimeProviderKey, secret.apiKey);
      continue;
    }

    if (secret.type === 'oauth') {
      await saveOAuthTokenToOpenClaw(runtimeProviderKey, {
        access: secret.accessToken,
        refresh: secret.refreshToken,
        expires: secret.expiresAt,
        email: secret.email,
        projectId: secret.subject,
      });
    }
  }
}

async function syncProviderSecretToRuntime(
  config: ProviderConfig,
  runtimeProviderKey: string,
  apiKey: string | undefined,
): Promise<void> {
  const secret = await getProviderSecret(config.id);
  if (apiKey !== undefined) {
    const trimmedKey = apiKey.trim();
    if (trimmedKey) {
      await saveProviderKeyToOpenClaw(runtimeProviderKey, trimmedKey);
    }
    return;
  }

  if (secret?.type === 'api_key') {
    await saveProviderKeyToOpenClaw(runtimeProviderKey, secret.apiKey);
    return;
  }

  if (secret?.type === 'oauth') {
    await saveOAuthTokenToOpenClaw(runtimeProviderKey, {
      access: secret.accessToken,
      refresh: secret.refreshToken,
      expires: secret.expiresAt,
      email: secret.email,
      projectId: secret.subject,
    });
    return;
  }

  if (secret?.type === 'local' && secret.apiKey) {
    await saveProviderKeyToOpenClaw(runtimeProviderKey, secret.apiKey);
  }
}

async function resolveRuntimeSyncContext(config: ProviderConfig): Promise<RuntimeProviderSyncContext | null> {
  const runtimeProviderKey = await resolveRuntimeProviderKey(config);
  const meta = getProviderConfig(config.type);
  const api = config.apiProtocol || (isUnregisteredProviderType(config.type) ? 'openai-completions' : meta?.api);
  if (!api) {
    return null;
  }

  return {
    runtimeProviderKey,
    meta,
    api,
  };
}

async function syncRuntimeProviderConfig(
  config: ProviderConfig,
  context: RuntimeProviderSyncContext,
): Promise<void> {
  const modelStrArray = (Array.isArray(config.model) ? config.model : [config.model || '']).flatMap(id => (id ?? '').split(','));
  const typeInfo = getProviderTypeInfo(config.type);
  const providerKinds = normalizeModelTypes(config.modelType ?? typeInfo?.modelType);

  const validModels: string[] = [];
  const validKinds: string[] = [];
  for (let i = 0; i < providerKinds.length; i++) {
    // Voice kinds live in the OpenClaw voice sections (syncVoiceKindsToRuntime),
    // not in the chat model registry (models.providers).
    if (modelStrArray[i] && !isVoiceKind(providerKinds[i])) {
      validModels.push(modelStrArray[i]);
      validKinds.push(providerKinds[i]);
    }
  }

  // Pure-voice providers (or voice-only configurations) have nothing for the
  // chat model registry — skip the empty models.providers write.
  if (validModels.length === 0 && providerKinds.some((kind) => isVoiceKind(kind))) {
    return;
  }

  await syncProviderConfigToOpenClaw(context.runtimeProviderKey, validModels, {
    baseUrl: normalizeProviderBaseUrl(config, config.baseUrl || context.meta?.baseUrl, context.api),
    api: context.api,
    apiKeyEnv: context.meta?.apiKeyEnv,
    headers: config.headers ?? context.meta?.headers,
  }, validKinds);
}

async function syncCustomProviderAgentModel(
  config: ProviderConfig,
  runtimeProviderKey: string,
  apiKey: string | undefined,
): Promise<void> {
  if (!isUnregisteredProviderType(config.type)) {
    return;
  }

  const resolvedKey = apiKey !== undefined ? (apiKey.trim() || null) : await getApiKey(config.id);
  if (!resolvedKey || !config.baseUrl) {
    return;
  }

  const modelStrArray = (Array.isArray(config.model) ? config.model : [config.model || '']).flatMap(id => (id ?? '').split(','));
  const typeInfo = getProviderTypeInfo(config.type);
  const providerKinds = normalizeModelTypes(config.modelType ?? typeInfo?.modelType);
  // Voice models are not chat-agent models — keep them out of the agent registry.
  const models = modelStrArray
    .filter((id, i) => Boolean(id) && !isVoiceKind(providerKinds[i] ?? 'text'))
    .map(id => ({ id, name: id }));
  if (models.length === 0) {
    return;
  }

  await updateAgentModelProvider(runtimeProviderKey, {
    baseUrl: normalizeProviderBaseUrl(config, config.baseUrl, config.apiProtocol || 'openai-completions'),
    api: config.apiProtocol || 'openai-completions',
    models,
    apiKey: resolvedKey,
  });
}

async function syncProviderToRuntime(
  config: ProviderConfig,
  apiKey: string | undefined,
): Promise<RuntimeProviderSyncContext | null> {
  const context = await resolveRuntimeSyncContext(config);
  if (!context) {
    return null;
  }

  await syncProviderSecretToRuntime(config, context.runtimeProviderKey, apiKey);
  await syncRuntimeProviderConfig(config, context);
  await syncCustomProviderAgentModel(config, context.runtimeProviderKey, apiKey);
  await syncVoiceKindsToRuntime(config, apiKey);
  // `syncVoiceKindsToRuntime` is additive — drop voice sections for kinds this
  // account no longer declares a model for (e.g. user cleared a voice model).
  await cleanupRemovedVoiceKindsForProvider(config);
  return context;
}

/** Positional model id for one kind, following the provider `modelType` order. */
export function modelIdForKind(config: ProviderConfig, kind: ModelKind): string | undefined {
  const modelStrArray = (Array.isArray(config.model) ? config.model : [config.model || '']).flatMap(id => (id ?? '').split(','));
  const typeInfo = getProviderTypeInfo(config.type);
  const providerKinds = normalizeModelTypes(config.modelType ?? typeInfo?.modelType);
  const index = providerKinds.indexOf(kind);
  if (index < 0) return undefined;
  const id = (modelStrArray[index] ?? '').trim();
  return id || undefined;
}

/**
 * Bridge voice kinds (tts / transcription / realtime) of a provider account
 * into the OpenClaw voice config sections (`messages.tts` / voice-call
 * `streaming`+`realtime`). Chat kinds keep flowing through
 * `syncRuntimeProviderConfig` (models.providers); voice kinds are read by the
 * kernel from these dedicated sections instead.
 *
 * The voice section key is the kernel capability provider id
 * (`voiceRuntimeProviderId`, default `openai` — OpenAI-compatible HTTP).
 */
async function syncVoiceKindsToRuntime(
  config: ProviderConfig,
  apiKey: string | null | undefined,
): Promise<void> {
  const typeInfo = getProviderTypeInfo(config.type);
  const providerKinds = normalizeModelTypes(config.modelType ?? typeInfo?.modelType);
  const voiceKinds = providerKinds.filter((kind) => isVoiceKind(kind) && modelIdForKind(config, kind));
  if (voiceKinds.length === 0) {
    return;
  }

  const voiceProviderId = typeInfo?.voiceRuntimeProviderId || 'openai';
  // Only the built-in runtimes (openai/minimax) are supported this release.
  if (!isSupportedVoiceRuntime(voiceProviderId)) {
    return;
  }
  const resolvedKey = apiKey ? (apiKey.trim() || undefined) : (await getApiKey(config.id)) || undefined;
  const baseUrl = config.baseUrl?.trim() ? config.baseUrl.trim().replace(/\/+$/, '') : undefined;

  for (const kind of voiceKinds) {
    const voiceConfig: VoiceProviderConfig = {
      model: modelIdForKind(config, kind),
      ...(baseUrl ? { baseUrl } : {}),
      ...(resolvedKey ? { apiKey: resolvedKey } : {}),
      // Built-in defaults baked into the voice runtime; modelParams (currently
      // unused — no UI) still layered on top to keep the override path for later.
      ...getVoiceRuntimeParams(voiceProviderId, kind),
      ...(config.modelParams?.[kind] ?? {}),
    };
    try {
      if (kind === 'tts') {
        await syncTtsConfigToOpenClaw({ provider: voiceProviderId, config: voiceConfig });
      } else if (kind === 'transcription') {
        await syncTranscriptionConfigToOpenClaw({ provider: voiceProviderId, config: voiceConfig });
      } else if (kind === 'realtime') {
        await syncRealtimeConfigToOpenClaw({ provider: voiceProviderId, config: voiceConfig });
      }
    } catch (err) {
      logger.warn(`[provider-runtime] Failed to sync voice kind "${kind}" for provider "${config.id}":`, err);
    }
  }
}

/**
 * Given the voice kinds we intend to drop for `provider` from openclaw.json,
 * return the runtime voice provider id plus the subset that is actually safe to
 * remove — i.e. no *other* enabled account still feeds the same
 * `voiceRuntimeProviderId` + kind. The voice block is shared by runtime id
 * across OpenAI-compatible accounts, so a kind still claimed by a sibling must
 * be preserved. Shared by the delete and update sync paths.
 */
async function resolveVoiceKindsToRemove(
  provider: ProviderConfig,
  candidateKinds: ModelKind[],
  excludeAccountId: string,
): Promise<{ voiceProviderId: string; kindsToRemove: ModelKind[] }> {
  const typeInfo = getProviderTypeInfo(provider.type);
  const voiceProviderId = typeInfo?.voiceRuntimeProviderId || 'openai';
  if (candidateKinds.length === 0) {
    return { voiceProviderId, kindsToRemove: [] };
  }
  const remaining = (await getAllProviders()).filter(
    (p) => p.id !== excludeAccountId && p.enabled !== false,
  );
  const kindsToRemove = candidateKinds.filter((kind) => {
    const siblingClaims = remaining.some((p) => {
      const info = getProviderTypeInfo(p.type);
      if ((info?.voiceRuntimeProviderId || 'openai') !== voiceProviderId) return false;
      const pKinds = normalizeModelTypes(p.modelType ?? info?.modelType);
      return pKinds.includes(kind) && Boolean(modelIdForKind(p, kind));
    });
    return !siblingClaims;
  });
  return { voiceProviderId, kindsToRemove };
}

/**
 * After a provider account is saved/updated, drop voice sections for kinds the
 * account no longer declares a model for. `syncVoiceKindsToRuntime` only *writes*
 * voice config (additive), so clearing a voice model in the account editor would
 * otherwise leave a stale `messages.tts` / voice-call block in openclaw.json.
 */
async function cleanupRemovedVoiceKindsForProvider(config: ProviderConfig): Promise<void> {
  const typeInfo = getProviderTypeInfo(config.type);
  const providerKinds = normalizeModelTypes(config.modelType ?? typeInfo?.modelType);
  // Voice kinds the account could declare but currently has no model id for.
  const clearedKinds = providerKinds.filter(
    (kind) => isVoiceKind(kind) && !modelIdForKind(config, kind),
  );
  if (clearedKinds.length === 0) {
    return;
  }
  const { voiceProviderId, kindsToRemove } = await resolveVoiceKindsToRemove(
    config,
    clearedKinds,
    config.id,
  );
  if (kindsToRemove.length > 0) {
    await removeVoiceProviderFromOpenClaw(voiceProviderId, kindsToRemove);
  }
}

async function removeDeletedProviderFromOpenClaw(
  provider: ProviderConfig,
  providerId: string,
  runtimeProviderKey?: string,
): Promise<void> {
  const keys = new Set<string>();
  if (runtimeProviderKey) {
    keys.add(runtimeProviderKey);
  } else {
    keys.add(await resolveRuntimeProviderKey({ ...provider, id: providerId }));
  }
  keys.add(providerId);

  for (const key of keys) {
    await removeProviderFromOpenClaw(key);
  }

  // Voice kinds (tts/transcription/realtime) live in dedicated voice sections,
  // not models.providers — clean those too. The voice block is keyed by the
  // runtime voice provider id (shared across OpenAI-compatible accounts), so we
  // only drop a kind when no other enabled account still feeds the same id+kind.
  const typeInfo = getProviderTypeInfo(provider.type);
  const providerKinds = normalizeModelTypes(provider.modelType ?? typeInfo?.modelType);
  const voiceKinds = providerKinds.filter((kind) => isVoiceKind(kind));
  if (voiceKinds.length > 0) {
    const { voiceProviderId, kindsToRemove } = await resolveVoiceKindsToRemove(
      provider,
      voiceKinds,
      providerId,
    );
    if (kindsToRemove.length > 0) {
      await removeVoiceProviderFromOpenClaw(voiceProviderId, kindsToRemove);
    }
  }

  // Legacy Codex OAuth used runtime key openai-codex; cleanup may leave a bare
  // models.providers.openai entry behind. Drop that slot when no API key credentials remain.
  if (runtimeProviderKey === OPENAI_OAUTH_RUNTIME_PROVIDER || runtimeProviderKey === 'openai-codex') {
    const openClawKey = await getProviderApiKeyFromOpenClaw('openai');
    if (openClawKey) {
      return;
    }
    const storeAccounts = await listProviderAccounts();
    for (const account of storeAccounts) {
      if (account.vendorId !== 'openai' || account.authMode === 'oauth_browser') {
        continue;
      }
      const apiKey = await getApiKey(account.id);
      if (apiKey) {
        return;
      }
    }
    await removeProviderFromOpenClaw('openai');
  }
}

/**
 * Startup reconciliation: drop voice provider blocks in openclaw.json that no
 * enabled provider account backs anymore. New saves/updates self-clean via
 * `cleanupRemovedVoiceKindsForProvider`, but residue written by older builds
 * (before the update path removed voice kinds) can only be repaired here.
 */
export async function reconcileVoiceConfigWithAccounts(): Promise<void> {
  const configured = await listConfiguredVoiceProviderKinds();
  if (configured.size === 0) {
    return;
  }

  // Build the set of (voiceProviderId, kind) claimed by enabled accounts.
  const accounts = (await getAllProviders()).filter((p) => p.enabled !== false);
  const claimed = new Map<string, Set<ModelKind>>();
  for (const account of accounts) {
    const info = getProviderTypeInfo(account.type);
    const voiceProviderId = info?.voiceRuntimeProviderId || 'openai';
    const kinds = normalizeModelTypes(account.modelType ?? info?.modelType);
    for (const kind of kinds) {
      if (isVoiceKind(kind) && modelIdForKind(account, kind)) {
        const set = claimed.get(voiceProviderId) ?? new Set<ModelKind>();
        set.add(kind);
        claimed.set(voiceProviderId, set);
      }
    }
  }

  for (const [voiceProviderId, kinds] of configured) {
    const claimedKinds = claimed.get(voiceProviderId) ?? new Set<ModelKind>();
    const orphanKinds = [...kinds].filter((kind) => !claimedKinds.has(kind));
    if (orphanKinds.length > 0) {
      logger.warn(
        `[provider-runtime] Removing orphaned voice config for "${voiceProviderId}": ${orphanKinds.join(', ')}`,
      );
      await removeVoiceProviderFromOpenClaw(voiceProviderId, orphanKinds);
    }
  }
}

function parseModelRef(modelRef: string): { providerKey: string; modelId: string } | null {
  const trimmed = modelRef.trim();
  const separatorIndex = trimmed.indexOf('/');
  if (separatorIndex <= 0 || separatorIndex >= trimmed.length - 1) {
    return null;
  }

  return {
    providerKey: trimmed.slice(0, separatorIndex),
    modelId: trimmed.slice(separatorIndex + 1),
  };
}

/**
 * Startup reconciliation: drop generate-capability default model slots
 * (`agents.defaults.{imageModel,imageGenerationModel,musicGenerationModel,videoGenerationModel}`)
 * whose primary model-ref points to a provider no enabled account backs anymore.
 * The delete path now strips these slots (see `removeProviderFromOpenClaw`), but
 * residue written by older builds (which only cleaned the text `model` slot) can
 * only be repaired here. Mirrors `reconcileVoiceConfigWithAccounts`.
 */
export async function reconcileDefaultModelSlotsWithAccounts(): Promise<void> {
  const runtimeProviderConfigs = await buildRuntimeProviderConfigMap();
  if (runtimeProviderConfigs.size === 0) {
    // No accounts loaded — avoid wiping slots on a transient provider-store glitch.
    return;
  }

  // Tolerate legacy ref prefixes: a slot may key off the runtime key, the account
  // id, or the bare vendor type. Treat all of them as still-backed.
  const validKeys = new Set<string>(runtimeProviderConfigs.keys());
  for (const config of runtimeProviderConfigs.values()) {
    validKeys.add(config.id);
    validKeys.add(config.type);
  }

  const removed = await removeDefaultModelSlotsForMissingProviders(validKeys);
  if (removed.length > 0) {
    logger.warn(
      `[provider-runtime] Removed orphaned default model slots: ${removed.join(', ')}`,
    );
  }
}

async function buildRuntimeProviderConfigMap(): Promise<Map<string, ProviderConfig>> {
  const configs = await getAllProviders();
  const runtimeMap = new Map<string, ProviderConfig>();

  for (const config of configs) {
    const runtimeKey = await resolveRuntimeProviderKey(config);
    runtimeMap.set(runtimeKey, config);
  }

  return runtimeMap;
}

/**
 * Resolve a model-ref provider prefix to the canonical OpenClaw runtime key.
 *
 * Handles legacy/divergent prefixes that are an account id or a bare vendor type
 * (e.g. `qwen3coder`) which do NOT match the hashed runtime key registered in
 * `models.providers` (e.g. `qwen3coder-qwen3cod`). Returns the canonical runtime
 * key, or `undefined` when the prefix is unknown or maps ambiguously to multiple
 * accounts (in which case we must not guess).
 */
function resolveCanonicalRuntimeKey(
  prefix: string,
  runtimeProviderConfigs: Map<string, ProviderConfig>,
): string | undefined {
  if (runtimeProviderConfigs.has(prefix)) return prefix;
  let byType: string | undefined;
  let typeAmbiguous = false;
  for (const [key, config] of runtimeProviderConfigs) {
    if (config.id === prefix) return key;
    if (config.type === prefix) {
      if (byType && byType !== key) typeAmbiguous = true;
      byType = key;
    }
  }
  return typeAmbiguous ? undefined : byType;
}

/**
 * One-time reconciliation run at startup: rewrite agent primary model refs whose
 * provider-key prefix doesn't match a registered runtime key but resolves
 * unambiguously to a provider account (e.g. a legacy bare `qwen3coder/Model`
 * becomes `qwen3coder-qwen3cod/Model`). This repairs configs written before the
 * runtime-key logic was unified and prevents OpenClaw "Unknown model" failures.
 */
export async function reconcileAgentModelRefProviderKeys(): Promise<void> {
  const runtimeProviderConfigs = await buildRuntimeProviderConfigMap();
  if (runtimeProviderConfigs.size === 0) return;
  const snapshot = await listAgentsSnapshot();
  for (const agent of snapshot.agents) {
    const ref = agent.overrideModelRef;
    if (!ref) continue;
    const parsed = parseModelRef(ref);
    if (!parsed || runtimeProviderConfigs.has(parsed.providerKey)) continue;
    const canonical = resolveCanonicalRuntimeKey(parsed.providerKey, runtimeProviderConfigs);
    if (!canonical || canonical === parsed.providerKey) continue;
    const nextRef = `${canonical}/${parsed.modelId}`;
    logger.info(
      `[provider-runtime] Reconciling agent "${agent.id}" model ref "${ref}" -> "${nextRef}"`,
    );
    try {
      await updateAgentModel(agent.id, nextRef, 'model');
    } catch (err) {
      logger.warn(`[provider-runtime] Failed to reconcile agent "${agent.id}" model ref:`, err);
    }
  }
}


async function buildAgentModelProviderEntry(
  config: ProviderConfig,
  modelId: string,
): Promise<{
  baseUrl?: string;
  api?: string;
  models?: Array<{ id: string; name: string }>;
  apiKey?: string;
  authHeader?: boolean;
  supportsVision?: boolean;
} | null> {
  const meta = getProviderConfig(config.type);
  const api = config.apiProtocol || (isUnregisteredProviderType(config.type) ? 'openai-completions' : meta?.api);
  const baseUrl = normalizeProviderBaseUrl(config, config.baseUrl || meta?.baseUrl, api);
  if (!api || !baseUrl) {
    return null;
  }

  let apiKey: string | undefined;
  let authHeader: boolean | undefined;

  if (isUnregisteredProviderType(config.type)) {
    apiKey = (await getApiKey(config.id)) || undefined;
  } else if (config.type === 'minimax-portal' || config.type === 'minimax-portal-cn') {
    const accountApiKey = await getApiKey(config.id);
    if (accountApiKey) {
      apiKey = accountApiKey;
    } else {
      authHeader = true;
      apiKey = 'minimax-oauth';
    }
  }

  return {
    baseUrl,
    api,
    models: [piAiModelsJsonModelEntry(modelId)],
    apiKey,
    authHeader,
    supportsVision: config.supportsVision,
  };
}

async function syncAgentModelsToRuntime(agentIds?: Set<string>): Promise<void> {
  const snapshot = await listAgentsSnapshot();
  const runtimeProviderConfigs = await buildRuntimeProviderConfigMap();

  const targets = snapshot.agents.filter((agent) => {
    // Never sync inherited defaults onto per-agent runtime registries — that can
    // make OpenClaw pick up the global default (e.g. GLM52) mid-run.
    if (!agent.overrideModelRef) return false;
    if (!agentIds) return true;
    return agentIds.has(agent.id);
  });

  for (const agent of targets) {
    const parsed = parseModelRef(agent.overrideModelRef || '');
    if (!parsed) {
      continue;
    }

    let resolvedKey = parsed.providerKey;
    let providerConfig = runtimeProviderConfigs.get(resolvedKey);
    if (!providerConfig) {
      // Self-heal legacy/divergent prefixes (bare vendor type or account id) by
      // rewriting the agent ref to the canonical runtime key registered in
      // models.providers, so OpenClaw can resolve the model.
      const canonical = resolveCanonicalRuntimeKey(parsed.providerKey, runtimeProviderConfigs);
      if (canonical && canonical !== parsed.providerKey) {
        const nextRef = `${canonical}/${parsed.modelId}`;
        logger.info(
          `[provider-runtime] Reconciling agent "${agent.id}" model ref "${agent.overrideModelRef}" -> "${nextRef}"`,
        );
        try {
          await updateAgentModel(agent.id, nextRef, 'model');
        } catch (err) {
          logger.warn(`[provider-runtime] Failed to reconcile agent "${agent.id}" model ref:`, err);
        }
        resolvedKey = canonical;
        providerConfig = runtimeProviderConfigs.get(canonical);
      }
    }
    if (!providerConfig) {
      logger.warn(
        `[provider-runtime] No provider account mapped to runtime key "${parsed.providerKey}" for agent "${agent.id}"`,
      );
      continue;
    }

    const entry = await buildAgentModelProviderEntry(providerConfig, parsed.modelId);
    if (!entry) {
      continue;
    }

    await updateSingleAgentModelProvider(agent.id, resolvedKey, entry);
  }
}

export async function syncAgentModelOverrideToRuntime(agentId: string): Promise<void> {
  await syncAgentModelsToRuntime(new Set([agentId]));
}

export async function syncSavedProviderToRuntime(
  config: ProviderConfig,
  apiKey: string | undefined,
  gatewayManager?: GatewayManager,
): Promise<void> {
  const context = await syncProviderToRuntime(config, apiKey);
  if (!context) {
    return;
  }

  await syncAgentModelsToRuntime();

  scheduleGatewayRefresh(
    gatewayManager,
    `OpenClaw config written after saving provider "${context.runtimeProviderKey}"`,
  );
  await awaitConfiguredAgentModels(gatewayManager);
}

export async function syncUpdatedProviderToRuntime(
  config: ProviderConfig,
  apiKey: string | undefined,
  gatewayManager?: GatewayManager,
): Promise<void> {
  const context = await syncProviderToRuntime(config, apiKey);
  if (!context) {
    return;
  }

  const ock = context.runtimeProviderKey;
  const fallbackModels = await getProviderFallbackModelRefs(config);

  const defaultProviderId = await getDefaultProvider();
  if (defaultProviderId === config.id) {
    const modelStrArray = (Array.isArray(config.model) ? config.model : [config.model || '']).flatMap(id => id.split(','));
    const typeInfo = getProviderTypeInfo(config.type);
    const providerKinds = normalizeModelTypes(config.modelType ?? typeInfo?.modelType);
    const defaultModels = Array.isArray(typeInfo?.defaultModelId) ? typeInfo.defaultModelId : [typeInfo?.defaultModelId || ''];
    const supportedSlots = new Set<string>();

    for (let i = 0; i < providerKinds.length; i++) {
      const kind = providerKinds[i] as ModelKind;
      // Voice kinds have no default-model slot — they live in the voice sections.
      if (isVoiceKind(kind)) continue;
      let mStr = modelStrArray[i];
      if (!mStr && i > 0) {
        if (kind === 'image') {
          mStr = modelStrArray[0];
        } else {
          mStr = defaultModels[i];
          if (!mStr) continue;
        }
      }

      const modelOverride = mStr ? `${ock}/${mStr}` : undefined;

      let targetSlot: 'model' | 'imageModel' | 'imageGenerationModel' | 'musicGenerationModel' | 'videoGenerationModel' = 'model';
      if (kind === 'image') targetSlot = 'imageModel';
      else if (kind === 'image_generate') targetSlot = 'imageGenerationModel';
      else if (kind === 'music_generate') targetSlot = 'musicGenerationModel';
      else if (kind === 'video_generate') targetSlot = 'videoGenerationModel';

      if (mStr) {
        supportedSlots.add(targetSlot);
      }

      if (!isUnregisteredProviderType(config.type)) {
        if (shouldUseExplicitDefaultOverride(config, ock)) {
          await setOpenClawDefaultModelWithOverride(ock, modelOverride, {
            baseUrl: normalizeProviderBaseUrl(config, config.baseUrl || context.meta?.baseUrl, context.api),
            api: context.api,
            apiKeyEnv: context.meta?.apiKeyEnv,
            headers: config.headers ?? context.meta?.headers,
          }, fallbackModels, targetSlot);
        } else {
          await setOpenClawDefaultModel(ock, modelOverride, fallbackModels, targetSlot);
        }
      } else {
        await setOpenClawDefaultModelWithOverride(ock, modelOverride, {
          baseUrl: normalizeProviderBaseUrl(config, config.baseUrl, config.apiProtocol || 'openai-completions'),
          api: config.apiProtocol || 'openai-completions',
          headers: config.headers,
        }, fallbackModels, targetSlot);
      }
    }

    await clearOpenClawUnsupportedDefaultModels(supportedSlots);
  }

  await syncAgentModelsToRuntime();

  scheduleGatewayRefresh(
    gatewayManager,
    `OpenClaw config written after updating provider "${ock}"`,
  );
  await awaitConfiguredAgentModels(gatewayManager);
}

export async function syncDeletedProviderToRuntime(
  provider: ProviderConfig | null,
  providerId: string,
  gatewayManager?: GatewayManager,
  runtimeProviderKey?: string,
): Promise<void> {
  if (!provider?.type) {
    return;
  }

  const ock = runtimeProviderKey ?? await resolveRuntimeProviderKey({ ...provider, id: providerId });
  await removeDeletedProviderFromOpenClaw(provider, providerId, ock);

  scheduleGatewayRefresh(
    gatewayManager,
    `OpenClaw config written after deleting provider "${ock}"`,
  );
  await awaitConfiguredAgentModels(gatewayManager);
}

export async function syncDeletedProviderApiKeyToRuntime(
  provider: ProviderConfig | null,
  providerId: string,
  runtimeProviderKey?: string,
): Promise<void> {
  if (!provider?.type) {
    return;
  }

  const ock = runtimeProviderKey ?? await resolveRuntimeProviderKey({ ...provider, id: providerId });
  await removeProviderKeyFromOpenClaw(ock);
}

export async function syncDefaultProviderToRuntime(
  providerId: string,
  gatewayManager?: GatewayManager,
): Promise<void> {
  const provider = await getProvider(providerId);
  if (!provider) {
    return;
  }

  try {
    const removed = await pruneInvalidApiProviderEntries();
    if (removed.length > 0) {
      logger.warn(
        `[provider-runtime] Pruned invalid models.providers entries before switch: ${removed.join(', ')}`,
      );
    }
  } catch (err) {
    logger.warn('[provider-runtime] Failed to prune invalid provider entries before switch:', err);
  }

  try {
    const pinned = await ensureOpenClawProviderAgentRuntimePins();
    if (pinned.length > 0) {
      logger.warn(
        `[provider-runtime] Pinned embedded agent runtime for models.providers entries before switch: ${pinned.join(', ')}`,
      );
    }
  } catch (err) {
    logger.warn('[provider-runtime] Failed to pin embedded agent runtime for provider entries before switch:', err);
  }

  try {
    const healed = await ensureAnthropicMessagesModelMaxTokens();
    if (healed.length > 0) {
      logger.warn(
        `[provider-runtime] Ensured anthropic-messages maxTokens for models.providers entries before switch: ${healed.join(', ')}`,
      );
    }
  } catch (err) {
    logger.warn('[provider-runtime] Failed to ensure anthropic-messages maxTokens before switch:', err);
  }

  try {
    const allowPrivateHealed = await ensureOpenClawProviderAllowPrivateNetwork();
    if (allowPrivateHealed.length > 0) {
      logger.warn(
        `[provider-runtime] Ensured request.allowPrivateNetwork for models.providers entries before switch: ${allowPrivateHealed.join(', ')}`,
      );
    }
  } catch (err) {
    logger.warn('[provider-runtime] Failed to ensure request.allowPrivateNetwork before switch:', err);
  }

  const ock = await resolveRuntimeProviderKey(provider);
  const providerKey = await getApiKey(providerId);
  const fallbackModels = await getProviderFallbackModelRefs(provider);
  const oauthTypes = ['minimax-portal', 'minimax-portal-cn'];
  const browserOAuthRuntimeProvider = await getBrowserOAuthRuntimeProvider(provider);
  const isOAuthProvider = (oauthTypes.includes(provider.type) && !providerKey) || Boolean(browserOAuthRuntimeProvider);

  const typeInfo = getProviderTypeInfo(provider.type);
  const providerKinds = normalizeModelTypes(provider.modelType ?? typeInfo?.modelType);
  const defaultModels = Array.isArray(typeInfo?.defaultModelId) ? typeInfo.defaultModelId : [typeInfo?.defaultModelId || ''];
  const supportedSlots = new Set<string>();

  // Unify capability auto-enable: mirror add/update paths by syncing this
  // account's voice kinds (tts/transcription/realtime) into messages.tts /
  // voice-call sections, so switching the default provider enables voice
  // capabilities the same way the loop below enables generate slots.
  await syncVoiceKindsToRuntime(provider, providerKey);
  await cleanupRemovedVoiceKindsForProvider(provider);

  if (!isOAuthProvider) {
    const modelStr = (Array.isArray(provider.model) ? provider.model : [provider.model || '']).flatMap(id => id.split(','));

    for (let i = 0; i < providerKinds.length; i++) {
      const kind = providerKinds[i] as ModelKind;
      // Voice kinds have no default-model slot — they live in the voice sections.
      if (isVoiceKind(kind)) continue;
      let mStr = modelStr[i];
      if (!mStr && i > 0) {
        if (kind === 'image') {
          mStr = modelStr[0];
        } else {
          mStr = defaultModels[i];
          if (!mStr) continue;
        }
      }

      const modelOverride = mStr
        ? (mStr.startsWith(`${ock}/`) ? mStr : `${ock}/${mStr}`)
        : undefined;

      let targetSlot: 'model' | 'imageModel' | 'imageGenerationModel' | 'musicGenerationModel' | 'videoGenerationModel' = 'model';
      if (kind === 'image') targetSlot = 'imageModel';
      else if (kind === 'image_generate') targetSlot = 'imageGenerationModel';
      else if (kind === 'music_generate') targetSlot = 'musicGenerationModel';
      else if (kind === 'video_generate') targetSlot = 'videoGenerationModel';

      if (mStr) {
        supportedSlots.add(targetSlot);
      }

      if (mStr) {
        if (isUnregisteredProviderType(provider.type)) {
          await setOpenClawDefaultModelWithOverride(ock, modelOverride, {
            baseUrl: normalizeProviderBaseUrl(provider, provider.baseUrl, provider.apiProtocol || 'openai-completions'),
            api: provider.apiProtocol || 'openai-completions',
            headers: provider.headers,
          }, fallbackModels, targetSlot);
        } else if (shouldUseExplicitDefaultOverride(provider, ock)) {
          await setOpenClawDefaultModelWithOverride(ock, modelOverride, {
            baseUrl: normalizeProviderBaseUrl(
              provider,
              provider.baseUrl || getProviderConfig(provider.type)?.baseUrl,
              provider.apiProtocol || getProviderConfig(provider.type)?.api,
            ),
            api: provider.apiProtocol || getProviderConfig(provider.type)?.api,
            apiKeyEnv: getProviderConfig(provider.type)?.apiKeyEnv,
            headers: provider.headers ?? getProviderConfig(provider.type)?.headers,
          }, fallbackModels, targetSlot);
        } else {
          await setOpenClawDefaultModel(ock, modelOverride, fallbackModels, targetSlot);
        }
      }
    }

    if (providerKey) {
      await saveProviderKeyToOpenClaw(ock, providerKey);
    }
  } else {
    if (browserOAuthRuntimeProvider) {
      const secret = await getProviderSecret(provider.id);
      if (secret?.type === 'oauth') {
        await saveOAuthTokenToOpenClaw(browserOAuthRuntimeProvider, {
          access: secret.accessToken,
          refresh: secret.refreshToken,
          expires: secret.expiresAt,
          email: secret.email,
          projectId: secret.subject,
          accountId: secret.subject,
        });
      }

      if (browserOAuthRuntimeProvider === OPENAI_OAUTH_RUNTIME_PROVIDER) {
        const model = Array.isArray(provider.model) ? provider.model[0] : provider.model;
        const modelOverride = model
          ? (model.startsWith(`${browserOAuthRuntimeProvider}/`)
            ? model.replace(/^openai-codex\//, `${browserOAuthRuntimeProvider}/`)
            : `${browserOAuthRuntimeProvider}/${model}`)
          : OPENAI_OAUTH_DEFAULT_MODEL_REF;

        await setOpenClawDefaultModelWithOverride(
          browserOAuthRuntimeProvider,
          modelOverride,
          {
            baseUrl: OPENAI_CODEX_OAUTH_PROVIDER_CONFIG.baseUrl,
            api: OPENAI_CODEX_OAUTH_PROVIDER_CONFIG.api,
          },
          fallbackModels.map((fallback) => fallback.replace(/^openai-codex\//, `${browserOAuthRuntimeProvider}/`)),
        );
        supportedSlots.add('model');
      } else {
        const defaultModelRef = GOOGLE_OAUTH_DEFAULT_MODEL_REF;
        const modelStrArray = (Array.isArray(provider.model) ? provider.model : [provider.model || '']).flatMap(id => id.split(','));

        for (let i = 0; i < providerKinds.length; i++) {
          const kind = providerKinds[i] as ModelKind;
          if (isVoiceKind(kind)) continue;
          let mStr = modelStrArray[i];
          if (!mStr && i > 0) {
            if (kind === 'image') {
              mStr = modelStrArray[0];
            } else {
              mStr = defaultModels[i];
              if (!mStr) continue;
            }
          }

          const modelOverride = mStr
            ? (mStr.startsWith(`${browserOAuthRuntimeProvider}/`)
              ? mStr
              : `${browserOAuthRuntimeProvider}/${mStr}`)
            : defaultModelRef;

          let targetSlot: 'model' | 'imageModel' | 'imageGenerationModel' | 'musicGenerationModel' | 'videoGenerationModel' = 'model';
          if (kind === 'image') targetSlot = 'imageModel';
          else if (kind === 'image_generate') targetSlot = 'imageGenerationModel';
          else if (kind === 'music_generate') targetSlot = 'musicGenerationModel';
          else if (kind === 'video_generate') targetSlot = 'videoGenerationModel';

          supportedSlots.add(targetSlot);

          await setOpenClawDefaultModel(browserOAuthRuntimeProvider, modelOverride, fallbackModels, targetSlot);
        }
      }
      logger.info(`Configured openclaw.json for browser OAuth provider "${provider.id}"`);
      await clearOpenClawUnsupportedDefaultModels(supportedSlots);
      try {
        await syncAgentModelsToRuntime();
      } catch (err) {
        logger.warn('[provider-runtime] Failed to sync per-agent model registries after browser OAuth switch:', err);
      }
      scheduleGatewayRefresh(
        gatewayManager,
        `OpenClaw config written after provider switch to "${browserOAuthRuntimeProvider}"`,
      );
      await awaitConfiguredAgentModels(gatewayManager);
      return;
    }

    const defaultBaseUrl = provider.type === 'minimax-portal'
      ? 'https://api.minimax.io/anthropic'
      : 'https://api.minimaxi.com/anthropic';
    const api = 'anthropic-messages' as const;

    let baseUrl = provider.baseUrl || defaultBaseUrl;
    if (baseUrl) {
      baseUrl = baseUrl.replace(/\/v1$/, '').replace(/\/anthropic$/, '').replace(/\/$/, '') + '/anthropic';
    }

    const targetProviderKey = 'minimax-portal';

    const modelStrArray = (Array.isArray(provider.model) ? provider.model : [provider.model || '']).flatMap(id => id.split(','));

    for (let i = 0; i < providerKinds.length; i++) {
      const kind = providerKinds[i] as ModelKind;
      if (isVoiceKind(kind)) continue;
      let mStr = modelStrArray[i];
      if (!mStr && i > 0) {
        if (kind === 'image') {
          mStr = modelStrArray[0];
        } else {
          mStr = defaultModels[i];
          if (!mStr) continue;
        }
      }

      const modelOverride = mStr
        ? (mStr.startsWith(`${targetProviderKey}/`) ? mStr : `${targetProviderKey}/${mStr}`)
        : undefined;

      let targetSlot: 'model' | 'imageModel' | 'imageGenerationModel' | 'musicGenerationModel' | 'videoGenerationModel' = 'model';
      if (kind === 'image') targetSlot = 'imageModel';
      else if (kind === 'image_generate') targetSlot = 'imageGenerationModel';
      else if (kind === 'music_generate') targetSlot = 'musicGenerationModel';
      else if (kind === 'video_generate') targetSlot = 'videoGenerationModel';

      if (mStr) {
        supportedSlots.add(targetSlot);
      }

      await setOpenClawDefaultModelWithOverride(targetProviderKey, modelOverride || getProviderModelRef(provider), {
        baseUrl,
        api,
        authHeader: targetProviderKey === 'minimax-portal' ? true : undefined,
        apiKeyEnv: targetProviderKey === 'minimax-portal' ? 'minimax-oauth' : 'qwen-oauth',
      }, fallbackModels, targetSlot);
    }

    logger.info(`Configured openclaw.json for OAuth provider "${provider.type}"`);

    try {
      const modelStrArray = (Array.isArray(provider.model) ? provider.model : [provider.model || '']).flatMap(id => id.split(','));
      const modelStr = modelStrArray[0];
      const defaultModelId = modelStr?.split('/').pop();
      await updateAgentModelProvider(targetProviderKey, {
        baseUrl,
        api,
        authHeader: targetProviderKey === 'minimax-portal' ? true : undefined,
        apiKey: targetProviderKey === 'minimax-portal' ? 'minimax-oauth' : 'qwen-oauth',
        models: defaultModelId ? [piAiModelsJsonModelEntry(defaultModelId)] : [],
      });
    } catch (err) {
      logger.warn(`Failed to update models.json for OAuth provider "${targetProviderKey}":`, err);
    }
  }

  await clearOpenClawUnsupportedDefaultModels(supportedSlots);

  if (
    isUnregisteredProviderType(provider.type) &&
    providerKey &&
    provider.baseUrl
  ) {
    const modelStrArray = (Array.isArray(provider.model) ? provider.model : [provider.model || '']).flatMap(id => id.split(','));
    const modelId = modelStrArray[0];
    await updateAgentModelProvider(ock, {
      baseUrl: normalizeProviderBaseUrl(provider, provider.baseUrl, provider.apiProtocol || 'openai-completions'),
      api: provider.apiProtocol || 'openai-completions',
      models: modelId ? [piAiModelsJsonModelEntry(modelId as string)] : [],
      apiKey: providerKey,
    });
  }

  await syncAgentModelsToRuntime();

  scheduleGatewayRefresh(
    gatewayManager,
    `OpenClaw config written after provider switch to "${ock}"`,
    { onlyIfRunning: true },
  );
  await awaitConfiguredAgentModels(gatewayManager);
}
