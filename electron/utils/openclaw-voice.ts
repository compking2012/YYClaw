/**
 * Voice (Talk / TTS) config sync for the OpenClaw kernel.
 *
 * Writes the speech-output (`messages.tts`) and speech-input (Talk transcription
 * / realtime via the `voice-call` plugin) provider config into
 * `~/.openclaw/openclaw.json`. Mirrors the provider sync pattern in
 * `openclaw-auth.ts` (`syncProviderConfigToOpenClaw`): all read-modify-write
 * runs under `withConfigLock`, and persistence goes through
 * `readOpenClawConfig`/`writeOpenClawConfig` so encryption-at-rest and the
 * `commands.restart` authorization are handled consistently.
 *
 * Credentials: provider API keys are injected as env vars at gateway startup
 * (see `loadProviderEnv` / `getProviderEnvVar`). Inline `apiKey` is only written
 * when the caller passes one (e.g. keyless providers, or explicit inline keys).
 */
import { withConfigLock } from './config-mutex';
import { readOpenClawConfig, writeOpenClawConfig, type OpenClawConfig } from './channel-config';
import type { ModelKind } from '../shared/providers/model-kind';

/** Plugin that owns Talk streaming (STT) and realtime voice config. */
export const VOICE_CALL_PLUGIN_ID = 'voice-call';

export type VoiceProviderConfig = Record<string, unknown>;

export interface VoiceConfigSelections {
  tts: { provider?: string; config?: VoiceProviderConfig; auto?: string };
  transcription: { provider?: string; config?: VoiceProviderConfig };
  realtime: { provider?: string; config?: VoiceProviderConfig };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = parent[key];
  if (isPlainRecord(existing)) {
    return existing;
  }
  const created: Record<string, unknown> = {};
  parent[key] = created;
  return created;
}

/** Ensure a plugin is registered (allow-list) + enabled so the kernel loads it. */
function ensurePluginEnabled(config: Record<string, unknown>, pluginId: string): Record<string, unknown> {
  const plugins = isPlainRecord(config.plugins)
    ? config.plugins
    : (Array.isArray(config.plugins) ? { load: [...config.plugins] } : {});
  plugins.enabled = true;

  if (Array.isArray(plugins.allow)) {
    const allow = (plugins.allow as unknown[]).filter((v): v is string => typeof v === 'string');
    if (!allow.includes(pluginId)) {
      plugins.allow = [...allow, pluginId];
    }
  }

  const entries = isPlainRecord(plugins.entries) ? plugins.entries : {};
  const entry = isPlainRecord(entries[pluginId])
    ? (entries[pluginId] as Record<string, unknown>)
    : {};
  entry.enabled = true;
  entries[pluginId] = entry;
  plugins.entries = entries;

  config.plugins = plugins;
  return entry;
}

/** Ensure the `voice-call` plugin is registered + enabled so the kernel loads it. */
function ensureVoiceCallPluginEnabled(config: Record<string, unknown>): Record<string, unknown> {
  return ensurePluginEnabled(config, VOICE_CALL_PLUGIN_ID);
}

/**
 * Realtime transcription / realtime voice providers are contributed by bundled
 * capability plugins whose id matches the provider id (e.g. `openai`, `deepgram`).
 * Ensure that plugin is enabled so the provider actually registers — otherwise
 * the gateway throws "No realtime transcription provider registered".
 */
function ensureCapabilityPluginEnabled(config: Record<string, unknown>, providerId: string): void {
  const id = providerId.trim();
  if (!id || id === VOICE_CALL_PLUGIN_ID) return;
  ensurePluginEnabled(config, id);
}

/** Read the `voice-call` plugin entry's `config` object, creating nothing. */
function readVoiceCallConfig(config: OpenClawConfig): Record<string, unknown> | null {
  const plugins = config.plugins as Record<string, unknown> | undefined;
  const entries = plugins && isPlainRecord(plugins.entries) ? plugins.entries : null;
  const entry = entries && isPlainRecord(entries[VOICE_CALL_PLUGIN_ID])
    ? (entries[VOICE_CALL_PLUGIN_ID] as Record<string, unknown>)
    : null;
  return entry && isPlainRecord(entry.config) ? (entry.config as Record<string, unknown>) : null;
}

/**
 * Remove one provider's block from a voice section (`messages.tts` /
 * voice-call `streaming` / `realtime`). If the removed provider was the active
 * `provider` pointer, promote another remaining provider as the new default
 * (so a still-configured sibling keeps working); if none remain, clear the
 * pointer. Returns true when the section still has at least one provider.
 */
function removeProviderFromVoiceSection(
  section: Record<string, unknown>,
  voiceProviderId: string,
): boolean {
  const providers = isPlainRecord(section.providers) ? section.providers : null;
  if (providers && voiceProviderId in providers) {
    delete providers[voiceProviderId];
  }
  const remaining = providers ? Object.keys(providers) : [];
  if (section.provider === voiceProviderId) {
    if (remaining.length > 0) {
      section.provider = remaining[0];
    } else {
      delete section.provider;
    }
  }
  return remaining.length > 0;
}

/** Disable + de-register the voice-call plugin (used when it has no config left). */
function disableVoiceCallPlugin(config: Record<string, unknown>): void {
  const plugins = isPlainRecord(config.plugins) ? config.plugins : null;
  if (!plugins) return;
  const entries = isPlainRecord(plugins.entries) ? plugins.entries : null;
  const entry = entries && isPlainRecord(entries[VOICE_CALL_PLUGIN_ID])
    ? (entries[VOICE_CALL_PLUGIN_ID] as Record<string, unknown>)
    : null;
  if (entry) {
    entry.enabled = false;
  }
  if (Array.isArray(plugins.allow)) {
    plugins.allow = (plugins.allow as unknown[]).filter((v) => v !== VOICE_CALL_PLUGIN_ID);
  }
}

/**
 * Write `messages.tts` provider config. Sets the active provider and its
 * provider-scoped block. `auto` is only written when provided (the desktop
 * auto-read toggle is client-side, so model selection does not force it).
 */
export async function syncTtsConfigToOpenClaw(params: {
  provider: string;
  config: VoiceProviderConfig;
  auto?: string;
}): Promise<void> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig();
    const messages = asRecord(config as Record<string, unknown>, 'messages');
    const tts = asRecord(messages, 'tts');
    tts.provider = params.provider;
    if (params.auto !== undefined) {
      tts.auto = params.auto;
    }
    const providers = asRecord(tts, 'providers');
    providers[params.provider] = {
      ...(isPlainRecord(providers[params.provider]) ? providers[params.provider] as Record<string, unknown> : {}),
      ...params.config,
    };
    await writeOpenClawConfig(config);
  });
}

/**
 * Write the Talk streaming (STT) provider config under
 * `plugins.entries["voice-call"].config.streaming`.
 */
export async function syncTranscriptionConfigToOpenClaw(params: {
  provider: string;
  config: VoiceProviderConfig;
}): Promise<void> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig();
    const entry = ensureVoiceCallPluginEnabled(config as Record<string, unknown>);
    ensureCapabilityPluginEnabled(config as Record<string, unknown>, params.provider);
    const entryConfig = asRecord(entry, 'config');
    const streaming = asRecord(entryConfig, 'streaming');
    streaming.provider = params.provider;
    const providers = asRecord(streaming, 'providers');
    providers[params.provider] = {
      ...(isPlainRecord(providers[params.provider]) ? providers[params.provider] as Record<string, unknown> : {}),
      ...params.config,
    };
    await writeOpenClawConfig(config);
  });
}

/**
 * Write the Talk realtime (continuous conversation) provider config under
 * `plugins.entries["voice-call"].config.realtime`.
 *
 * The OpenAI realtime-voice provider hardcodes `wss://api.openai.com/v1/realtime`
 * for the standard path and only honors a custom WS base via its **azureEndpoint**
 * branch (which builds `wss://<azureEndpoint>/v1/realtime?model=...` + Bearer auth).
 * So when a non-OpenAI baseUrl is configured (e.g. aiserver), we mirror it into
 * `azureEndpoint` so realtime can reach that endpoint.
 */
function deriveAzureEndpoint(baseUrl: unknown): string | undefined {
  if (typeof baseUrl !== 'string') return undefined;
  const trimmed = baseUrl.trim();
  if (!trimmed || /api\.openai\.com/i.test(trimmed)) return undefined;
  return trimmed.replace(/\/+$/, '').replace(/\/v1$/i, '');
}

export async function syncRealtimeConfigToOpenClaw(params: {
  provider: string;
  config: VoiceProviderConfig;
}): Promise<void> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig();
    const entry = ensureVoiceCallPluginEnabled(config as Record<string, unknown>);
    ensureCapabilityPluginEnabled(config as Record<string, unknown>, params.provider);
    const entryConfig = asRecord(entry, 'config');
    const realtime = asRecord(entryConfig, 'realtime');
    realtime.provider = params.provider;
    const providers = asRecord(realtime, 'providers');
    const azureEndpoint = deriveAzureEndpoint((params.config as Record<string, unknown>).baseUrl);
    providers[params.provider] = {
      ...(isPlainRecord(providers[params.provider]) ? providers[params.provider] as Record<string, unknown> : {}),
      ...params.config,
      ...(azureEndpoint ? { azureEndpoint } : {}),
    };
    await writeOpenClawConfig(config);
  });
}

/**
 * Remove a provider from the voice sections matching `kinds`, used when a
 * provider account that declared voice capabilities is deleted.
 *
 * Scope is per-provider across ALL listed kinds: only blocks keyed by this
 * `voiceProviderId` are touched; unrelated voice providers are preserved. When
 * the removed provider was a section's active default, a remaining provider is
 * promoted; when a section is left with no providers it is dropped. If the
 * voice-call plugin ends up with neither `streaming` nor `realtime`, it is
 * disabled.
 *
 * Callers must skip kinds still claimed by another configured account on the
 * same `voiceProviderId` (the voice block is shared by runtime id).
 */
export async function removeVoiceProviderFromOpenClaw(
  voiceProviderId: string,
  kinds: ModelKind[],
): Promise<void> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig();
    const root = config as Record<string, unknown>;

    if (kinds.includes('tts')) {
      const messages = isPlainRecord(root.messages) ? root.messages : null;
      const tts = messages && isPlainRecord(messages.tts)
        ? (messages.tts as Record<string, unknown>)
        : null;
      if (messages && tts) {
        const stillHasProvider = removeProviderFromVoiceSection(tts, voiceProviderId);
        if (!stillHasProvider) {
          delete (messages as Record<string, unknown>).tts;
        }
      }
    }

    const voiceCall = readVoiceCallConfig(config);
    if (voiceCall) {
      if (kinds.includes('transcription') && isPlainRecord(voiceCall.streaming)) {
        const stillHasProvider = removeProviderFromVoiceSection(
          voiceCall.streaming as Record<string, unknown>,
          voiceProviderId,
        );
        if (!stillHasProvider) {
          delete voiceCall.streaming;
        }
      }
      if (kinds.includes('realtime') && isPlainRecord(voiceCall.realtime)) {
        const stillHasProvider = removeProviderFromVoiceSection(
          voiceCall.realtime as Record<string, unknown>,
          voiceProviderId,
        );
        if (!stillHasProvider) {
          delete voiceCall.realtime;
        }
      }
      // No streaming nor realtime config left → nothing for voice-call to do.
      if (!('streaming' in voiceCall) && !('realtime' in voiceCall)) {
        disableVoiceCallPlugin(root);
      }
    }

    await writeOpenClawConfig(config);
  });
}

/**
 * Enumerate which voice provider ids are currently present in openclaw.json's
 * voice sections (`messages.tts` / voice-call `streaming` / `realtime`), keyed
 * by provider id -> the set of kinds it appears under. Startup reconciliation
 * uses this to drop voice blocks no longer backed by any provider account.
 */
export async function listConfiguredVoiceProviderKinds(): Promise<Map<string, Set<ModelKind>>> {
  const config = await readOpenClawConfig();
  const root = config as Record<string, unknown>;
  const result = new Map<string, Set<ModelKind>>();

  const add = (providerId: unknown, kind: ModelKind): void => {
    if (typeof providerId !== 'string' || !providerId) return;
    const set = result.get(providerId) ?? new Set<ModelKind>();
    set.add(kind);
    result.set(providerId, set);
  };

  const collectSection = (section: Record<string, unknown> | null, kind: ModelKind): void => {
    if (!section) return;
    const providers = isPlainRecord(section.providers) ? section.providers : null;
    if (providers) {
      for (const id of Object.keys(providers)) add(id, kind);
    }
    // Count the active pointer too, in case the providers map is missing.
    add(section.provider, kind);
  };

  const messages = isPlainRecord(root.messages) ? root.messages : null;
  collectSection(
    messages && isPlainRecord(messages.tts) ? (messages.tts as Record<string, unknown>) : null,
    'tts',
  );
  const voiceCall = readVoiceCallConfig(config);
  collectSection(
    voiceCall && isPlainRecord(voiceCall.streaming) ? (voiceCall.streaming as Record<string, unknown>) : null,
    'transcription',
  );
  collectSection(
    voiceCall && isPlainRecord(voiceCall.realtime) ? (voiceCall.realtime as Record<string, unknown>) : null,
    'realtime',
  );
  return result;
}

/**
 * Clear the global speech-synthesis (TTS) config when the user turns it off in
 * the Agents global config. Scope is deliberately narrow: only `messages.tts`
 * is removed — transcription / realtime / voice-call plugin state is untouched.
 */
export async function clearTtsConfigFromOpenClaw(): Promise<void> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig();
    const root = config as Record<string, unknown>;
    const messages = isPlainRecord(root.messages) ? root.messages : null;
    if (messages && 'tts' in messages) {
      delete (messages as Record<string, unknown>).tts;
    }
    await writeOpenClawConfig(config);
  });
}

/**
 * Clear the global speech-transcription (STT) config when the user turns it off
 * in the Agents global config. Only the voice-call `streaming` section is
 * removed; realtime is left untouched. If the voice-call plugin ends up with
 * neither `streaming` nor `realtime`, it is disabled.
 */
export async function clearTranscriptionConfigFromOpenClaw(): Promise<void> {
  return withConfigLock(async () => {
    const config = await readOpenClawConfig();
    const voiceCall = readVoiceCallConfig(config);
    if (voiceCall && 'streaming' in voiceCall) {
      delete (voiceCall as Record<string, unknown>).streaming;
      if (!('streaming' in voiceCall) && !('realtime' in voiceCall)) {
        disableVoiceCallPlugin(config as Record<string, unknown>);
      }
    }
    await writeOpenClawConfig(config);
  });
}

/** Read the currently persisted voice selections so the UI can pre-fill. */
export async function readVoiceConfigSelections(): Promise<VoiceConfigSelections> {
  const config = await readOpenClawConfig();
  const messages = (config as Record<string, unknown>).messages;
  const tts = isPlainRecord(messages) && isPlainRecord(messages.tts)
    ? (messages.tts as Record<string, unknown>)
    : null;
  const voiceCall = readVoiceCallConfig(config);
  const streaming = voiceCall && isPlainRecord(voiceCall.streaming)
    ? (voiceCall.streaming as Record<string, unknown>)
    : null;
  const realtime = voiceCall && isPlainRecord(voiceCall.realtime)
    ? (voiceCall.realtime as Record<string, unknown>)
    : null;

  const pickProviderConfig = (
    block: Record<string, unknown> | null,
  ): VoiceProviderConfig | undefined => {
    if (!block || typeof block.provider !== 'string') return undefined;
    const providers = isPlainRecord(block.providers) ? block.providers : null;
    const cfg = providers && isPlainRecord(providers[block.provider])
      ? (providers[block.provider] as Record<string, unknown>)
      : undefined;
    // Never echo secrets back to the renderer.
    if (cfg && 'apiKey' in cfg) {
      const { apiKey: _apiKey, ...rest } = cfg;
      return rest;
    }
    return cfg;
  };

  return {
    tts: {
      provider: tts && typeof tts.provider === 'string' ? tts.provider : undefined,
      auto: tts && typeof tts.auto === 'string' ? tts.auto : undefined,
      config: pickProviderConfig(tts),
    },
    transcription: {
      provider: streaming && typeof streaming.provider === 'string' ? streaming.provider : undefined,
      config: pickProviderConfig(streaming),
    },
    realtime: {
      provider: realtime && typeof realtime.provider === 'string' ? realtime.provider : undefined,
      config: pickProviderConfig(realtime),
    },
  };
}

export interface TranscriptionRuntime {
  provider: string;
  baseUrl: string;
  apiKey: string | undefined;
  model: string;
}

/**
 * Resolve the runtime params for batch transcription (`POST /v1/audio/transcriptions`).
 * Reads the Talk streaming provider block (where the Models page voice row wrote
 * `{baseUrl, apiKey, model}`). main-only — returns the secret apiKey, never sent
 * to the renderer.
 */
export async function readTranscriptionRuntime(): Promise<TranscriptionRuntime> {
  const config = await readOpenClawConfig();
  const voiceCall = readVoiceCallConfig(config);
  const streaming = voiceCall && isPlainRecord(voiceCall.streaming)
    ? (voiceCall.streaming as Record<string, unknown>)
    : null;
  const provider = streaming && typeof streaming.provider === 'string' ? streaming.provider : 'openai';
  const providers = streaming && isPlainRecord(streaming.providers)
    ? (streaming.providers as Record<string, unknown>)
    : null;
  const providerCfg = providers && isPlainRecord(providers[provider])
    ? (providers[provider] as Record<string, unknown>)
    : {};

  const baseUrlRaw = typeof providerCfg.baseUrl === 'string' && providerCfg.baseUrl.trim()
    ? providerCfg.baseUrl.trim()
    : 'https://api.openai.com/v1';
  const baseUrl = baseUrlRaw.replace(/\/+$/, '');
  const apiKeyRaw = typeof providerCfg.apiKey === 'string' ? providerCfg.apiKey.trim() : '';
  // No env-key fallback: transcription must use the configured streaming
  // provider's own key, so it can't silently borrow the chat provider's
  // OPENAI_API_KEY when speech-to-text isn't configured.
  const apiKey = apiKeyRaw || undefined;
  const model = (typeof providerCfg.model === 'string' && providerCfg.model.trim())
    || (typeof providerCfg.sttModel === 'string' && (providerCfg.sttModel as string).trim())
    || 'gpt-4o-transcribe';

  return { provider, baseUrl, apiKey, model };
}
