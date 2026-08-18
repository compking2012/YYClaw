/**
 * Provider Types & UI Metadata — single source of truth for the frontend.
 *
 * NOTE: Backend provider metadata is being refactored toward the new
 * account-based registry, but the renderer still keeps a local compatibility
 * layer so TypeScript project boundaries remain stable during the migration.
 */

import pkg from '../../package.json';

function getFarmApiBaseUrl(): string | null {
  const raw = String((pkg as { farmApiBaseUrl?: string }).farmApiBaseUrl ?? '').trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, '');
}

export const PROVIDER_TYPES = [
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'ark',
  'moonshot',
  'moonshot-global',
  'siliconflow',
  'deepseek',
  'minimax-portal',
  'minimax-portal-cn',
  'zai',
  'zai-global',
  'modelstudio',
  'ollama',
  'custom',
] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number] | (string & {});

export type ProviderProtocol =
  | 'openai-completions'
  | 'openai-responses'
  | 'openai-chatgpt-responses'
  | 'anthropic-messages'
  | 'google-generative-ai'
  | 'github-copilot'
  | 'bedrock-converse-stream'
  | 'ollama'
  | 'azure-openai-responses';

export const BUILTIN_PROVIDER_TYPES = [
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'ark',
  'moonshot',
  'moonshot-global',
  'siliconflow',
  'deepseek',
  'minimax-portal',
  'minimax-portal-cn',
  'zai',
  'zai-global',
  'modelstudio',
  'ollama',
] as const;

export type BuiltinProviderType = (typeof BUILTIN_PROVIDER_TYPES)[number];

export const OLLAMA_PLACEHOLDER_API_KEY = 'ollama-local';

/** Task-relevant strength dimensions a model can be scored on (0..1). */
export const MODEL_STRENGTH_KEYS = [
  'coding',
  'math',
  'reasoning',
  'longContext',
  'vision',
  'multilingual',
  'creative',
  'toolUse',
  'agentic',
  'instructionFollowing',
] as const;
export type ModelStrengthKey = (typeof MODEL_STRENGTH_KEYS)[number];

/**
 * Per-model enrichment metadata served by the Admin Console via
 * `/api/v1/provider-catalog` (`provider.models[modelId]`). All fields optional
 * and forward-compatible. Mirror of the electron-side `ModelMeta`.
 */
export interface ModelMeta {
  pricing?: {
    inputPerM?: number;
    outputPerM?: number;
    cacheReadPerM?: number;
    cacheWritePerM?: number;
    currency?: 'USD' | 'CNY';
  };
  contextWindow?: number;
  maxOutputTokens?: number;
  inputModalities?: ModelKind[];
  outputModalities?: ModelKind[];
  speed?: { throughputTokPerSec?: number; ttftMs?: number };
  strengths?: Partial<Record<ModelStrengthKey, number>>;
  toolUseReliability?: number;
  reasoningSupport?: boolean;
  knowledgeCutoff?: string;
  benchmarks?: { arenaElo?: number; qualityIndex?: number; [key: string]: number | undefined };
  provenance?: Record<string, { source: string; updatedAt: string; confidence?: number }>;
  status?: 'active' | 'deprecated';
  origin?: 'private' | 'domestic' | 'overseas';
}

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl?: string;
  apiProtocol?: ProviderProtocol;
  headers?: Record<string, string>;
  model?: string | string[];
  /** Supported model kinds (text/image/…), persisted so the backend can resolve
   * remote-catalog providers whose definition isn't in the bundled registry. */
  modelType?: ModelKind[];
  /** Per-kind extra params (voice kinds: voice/format/speed/language …), keyed by ModelKind. */
  modelParams?: ModelParamsByKind;
  fallbackModels?: string[];
  fallbackProviderIds?: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  supportsVision?: boolean;
}

export interface ProviderWithKeyInfo extends ProviderConfig {
  hasKey: boolean;
  keyMasked: string | null;
  /** When store `account.id` differs from `models.providers` key in openclaw.json. */
  openclawProviderKey?: string;
}

export interface ProviderTypeInfo {
  id: ProviderType;
  name: string;
  icon: string;
  iconBase64?: string;
  placeholder: string;
  model?: string | string[];
  modelType?: ModelKind[];
  requiresApiKey: boolean;
  defaultApiKey?: string;
  defaultBaseUrl?: string;
  showBaseUrl?: boolean;
  showModelId?: boolean;
  showModelIdInDevModeOnly?: boolean;
  modelIdPlaceholder?: string | string[] | (string | string[])[];
  defaultModelId?: string | string[];
  isOAuth?: boolean;
  supportsApiKey?: boolean;
  apiKeyUrl?: string;
  docsUrl?: string;
  docsUrlZh?: string;
  codePlanPresetBaseUrl?: string;
  codePlanPresetModelId?: string;
  codePlanDocsUrl?: string;
  /** When true, OpenClaw provider HTTP fetch may access baseUrl when DNS resolves to private IPs. */
  requestAllowPrivateNetwork?: boolean;
  /** If true, this provider is not shown in the "Add Provider" dialog. */
  hidden?: boolean;
  /** For voice providers: the kernel-side provider id used in messages.tts / voice-call config keys. */
  voiceRuntimeProviderId?: string;
  /** Per-kind extra param fields rendered in the model row editor (falls back to DEFAULT_VOICE_KIND_PARAMS for voice kinds). */
  kindParamsSchema?: KindParamsSchema;
  /** Vendor-level fields carried through from the remote catalog so a ProviderTypeInfo
   * can be assembled into a ProviderVendorInfo without re-deriving them. */
  category?: ProviderVendorCategory;
  envVar?: string;
  supportedAuthModes?: ProviderAuthMode[];
  defaultAuthMode?: ProviderAuthMode;
  supportsMultipleAccounts?: boolean;
  /** Per-model enrichment metadata keyed by model id (from the enriched provider catalog). */
  models?: Record<string, ModelMeta>;
}

export interface RemoteProviderConfig {
  id: string;
  name: string;
  icon?: string;
  iconBase64?: string;
  placeholder: string;
  model?: string | string[];
  modelType?: ModelKind[];
  requiresApiKey: boolean;
  defaultApiKey?: string;
  defaultBaseUrl?: string;
  showBaseUrl?: boolean;
  showModelId?: boolean;
  showModelIdInDevModeOnly?: boolean;
  modelIdPlaceholder?: string | string[] | (string | string[])[];
  defaultModelId?: string | string[];
  isOAuth?: boolean;
  supportsApiKey?: boolean;
  apiKeyUrl?: string;
  docsUrl?: string;
  docsUrlZh?: string;
  codePlanPresetBaseUrl?: string;
  codePlanPresetModelId?: string;
  codePlanDocsUrl?: string;
  requestAllowPrivateNetwork?: boolean;
  hidden?: boolean;
  voiceRuntimeProviderId?: string;
  kindParamsSchema?: KindParamsSchema;
  models?: Record<string, ModelMeta>;
}

export interface RemoteProvidersResponse {
  /** Ignored for whether `custom` appears; the catalog lists `custom` only if the server includes it in `providers`. */
  allowCustomProvider?: boolean;
  providers: RemoteProviderConfig[];
}

export type ProviderAuthMode =
  | 'api_key'
  | 'oauth_device'
  | 'oauth_browser'
  | 'local';

export type ProviderVendorCategory =
  | 'official'
  | 'compatible'
  | 'local'
  | 'custom';

export interface ProviderModelEntry extends Record<string, unknown> {
  id: string;
  name: string;
  modelType?: ModelKind[];
}

export interface ProviderBackendConfig {
  baseUrl: string;
  api: 'openai-completions' | 'openai-responses' | 'anthropic-messages';
  apiKeyEnv: string;
  models?: ProviderModelEntry[];
  headers?: Record<string, string>;
}

export interface ProviderVendorInfo extends ProviderTypeInfo {
  category: ProviderVendorCategory;
  envVar?: string;
  supportedAuthModes: ProviderAuthMode[];
  defaultAuthMode: ProviderAuthMode;
  supportsMultipleAccounts: boolean;
  providerConfig?: ProviderBackendConfig;
}

export interface ProviderAccount {
  id: string;
  vendorId: ProviderType;
  label: string;
  authMode: ProviderAuthMode;
  baseUrl?: string;
  apiProtocol?: ProviderProtocol;
  headers?: Record<string, string>;
  model?: string | string[];
  /** Supported model kinds (text/image/…), persisted so the backend can resolve
   * remote-catalog providers whose definition isn't in the bundled registry. */
  modelType?: ModelKind[];
  /** Per-kind extra params (voice kinds: voice/format/speed/language …), keyed by ModelKind. */
  modelParams?: ModelParamsByKind;
  fallbackModels?: string[];
  fallbackAccountIds?: string[];
  enabled: boolean;
  isDefault: boolean;
  metadata?: {
    region?: string;
    email?: string;
    resourceUrl?: string;
    customModels?: string[];
  };
  createdAt: string;
  updatedAt: string;
  supportsVision?: boolean;
}

export type ModelKind = 'text' | 'image' | 'image_generate' | 'music_generate' | 'video_generate' | 'tts' | 'transcription' | 'realtime';

/** Extra per-kind model params (currently voice kinds), keyed by ModelKind. */
export type ModelParamsByKind = Partial<Record<ModelKind, Record<string, string | number | boolean>>>;

/**
 * Declarative field schema for kind-specific params, defined per provider in
 * providers.json (`kindParamsSchema`). Labels resolve via
 * `aiProviders.kindParams.<key>` i18n keys with `key` as fallback.
 */
export interface KindParamField {
  key: string;
  /** `combobox` = free-text Input backed by a datalist of `options` (pick a preset or type your own). */
  type: 'text' | 'number' | 'select' | 'combobox';
  options?: string[];
  placeholder?: string;
  /** Shown as placeholder hint only — NOT written to modelParams unless the user enters it. */
  default?: string | number;
  /** Numeric constraints for `type: 'number'`. */
  min?: number;
  max?: number;
  step?: number;
}

export type KindParamsSchema = Partial<Record<ModelKind, KindParamField[]>>;

/**
 * Default voice param fields, applied when a provider declares voice kinds but
 * no explicit `kindParamsSchema`. Grounded in the OpenClaw voice config blocks
 * (`messages.tts` / voice-call `streaming`+`realtime`) and the OpenAI voice APIs.
 */
export const DEFAULT_VOICE_KIND_PARAMS: KindParamsSchema = {
  tts: [
    { key: 'voice', type: 'select', options: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'] },
    { key: 'responseFormat', type: 'select', options: ['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm'] },
    { key: 'speed', type: 'number', placeholder: '1.0' },
  ],
  transcription: [
    { key: 'language', type: 'text', placeholder: 'auto / zh / en …' },
  ],
  realtime: [
    { key: 'voice', type: 'select', options: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'] },
  ],
};

/**
 * Resolve the kind-param fields for one kind: only the provider's explicit
 * `kindParamsSchema` (from config) drives the editor now. The
 * `DEFAULT_VOICE_KIND_PARAMS` fallback is intentionally NOT applied this
 * release — voice params are built-in on the backend voice runtime, so with no
 * config schema this returns `[]` and the editor renders nothing. The constant
 * is kept for a planned future revamp of voice-param configuration.
 */
export function getKindParamFields(
  info: { kindParamsSchema?: KindParamsSchema } | undefined | null,
  kind: ModelKind,
): KindParamField[] {
  return info?.kindParamsSchema?.[kind] ?? [];
}

export const MODEL_KIND_ORDER: ModelKind[] = [
  'text',
  'image',
  'image_generate',
  'music_generate',
  'video_generate',
  'tts',
  'transcription',
  'realtime',
];

export function normalizeModelTypes(modelType: unknown): ModelKind[] {
  if (!modelType || !Array.isArray(modelType) || modelType.length === 0) {
    return ['text'];
  }

  const validKinds = new Set<ModelKind>(MODEL_KIND_ORDER);
  const result = new Set<ModelKind>();

  for (const item of modelType) {
    if (typeof item === 'string' && validKinds.has(item as ModelKind)) {
      result.add(item as ModelKind);
    }
  }

  if (result.size === 0) {
    result.add('text'); // 仅当声明的全部是非法值时，兜底为 text
  }

  return Array.from(result);
}

/**
 * Pick the first non-empty `modelType` among the candidates. An empty array is
 * truthy in JS, so a plain `a || b` would let an empty `[]` short-circuit the
 * intended fallback (and `normalizeModelTypes([])` then collapses to ['text']).
 * Use this wherever a richer source should win over an empty one.
 */
export function pickModelType(
  ...candidates: Array<ModelKind[] | undefined>
): ModelKind[] | undefined {
  for (const candidate of candidates) {
    if (candidate && candidate.length > 0) return candidate;
  }
  return undefined;
}

/**
 * Resolve the model kinds for an EXISTING account, account-first. The account's
 * persisted `modelType` is saved aligned with its positional `model` array, so
 * using it (over the live vendor/typeInfo catalog, which can drift in online
 * mode) keeps kind gating and positional model-id lookups consistent. Only
 * legacy accounts without a persisted `modelType` fall back to the catalog.
 */
export function accountModelKinds(
  account: Pick<ProviderAccount, 'modelType'>,
  vendor?: { modelType?: ModelKind[] },
  typeInfo?: { modelType?: ModelKind[] },
): ModelKind[] {
  return normalizeModelTypes(pickModelType(account.modelType, vendor?.modelType, typeInfo?.modelType));
}

import { providerIcons } from '@/assets/providers';

import LOCAL_PROVIDER_TYPE_INFO_JSON from '../../resources/config/providers.json';

/** All supported provider types with UI metadata */
const LOCAL_PROVIDER_TYPE_INFO: ProviderTypeInfo[] = (LOCAL_PROVIDER_TYPE_INFO_JSON as any[]).map(def => ({
  ...def,
  isOAuth: def.supportedAuthModes?.some((m: string) => m.startsWith('oauth')) ?? false,
  supportsApiKey: def.supportedAuthModes?.includes('api_key') ?? false,
}));

/** Get the SVG logo URL for a provider type, falls back to undefined */
export function getProviderIconUrl(type: ProviderType | string): string | undefined {
  const info = getProviderTypeInfo(type as ProviderType);
  if (info?.iconBase64) {
    return `data:image/svg+xml;base64,${info.iconBase64}`;
  }
  return providerIcons[type as keyof typeof providerIcons];
}

/** Whether a provider's logo needs CSS invert in dark mode (all logos are monochrome) */
export function shouldInvertInDark(_type: ProviderType | string): boolean {
  return true;
}

/** All supported provider types with UI metadata */
export let PROVIDER_TYPE_INFO: ProviderTypeInfo[] = [...LOCAL_PROVIDER_TYPE_INFO];

export let SETUP_PROVIDERS: ProviderTypeInfo[] = PROVIDER_TYPE_INFO;

export async function fetchRemoteProviders(
  options?: { allowLocalFallback?: boolean },
): Promise<{ providers: ProviderTypeInfo[]; source: 'remote' | 'local' }> {
  try {
    const base = getFarmApiBaseUrl();
    if (!base) {
      throw new Error('REMOTE_API_NO_BASE_URL');
    }
    const catalogUrl = `${base}/api/v1/provider-catalog`;
    const res = await fetch(catalogUrl);
    if (!res.ok) throw new Error('Failed to fetch remote providers');

    const data: any = await res.json();

    // Support both { data: { providers: [] } } and { providers: [] } structures
    const rawProviders = data.data?.providers || data.providers || [];

    const newProviders: ProviderTypeInfo[] = rawProviders.map((p: any) => ({
      id: p.id,
      name: p.name,
      icon: p.icon || '⚙️',
      iconBase64: p.iconBase64,
      placeholder: p.placeholder || '',
      model: p.model,
      modelType: p.modelType,
      requiresApiKey: p.requiresApiKey ?? false,
      defaultApiKey: p.defaultApiKey,
      defaultBaseUrl: p.defaultBaseUrl,
      showBaseUrl: p.showBaseUrl,
      showModelId: p.showModelId,
      showModelIdInDevModeOnly: p.showModelIdInDevModeOnly,
      modelIdPlaceholder: p.modelIdPlaceholder,
      defaultModelId: p.defaultModelId,
      isOAuth: p.isOAuth ?? (p.supportedAuthModes?.some((m: string) => m.startsWith('oauth')) ?? false),
      supportsApiKey: p.supportsApiKey ?? (p.supportedAuthModes?.includes('api_key') ?? false),
      apiKeyUrl: p.apiKeyUrl,
      docsUrl: p.docsUrl,
      docsUrlZh: p.docsUrlZh,
      codePlanPresetBaseUrl: p.codePlanPresetBaseUrl,
      codePlanPresetModelId: p.codePlanPresetModelId,
      codePlanDocsUrl: p.codePlanDocsUrl,
      hidden: p.hidden,
      voiceRuntimeProviderId: p.voiceRuntimeProviderId,
      kindParamsSchema: p.kindParamsSchema,
      models: p.models,
      // Vendor-level fields, carried through so the store can assemble a
      // ProviderVendorInfo directly from the remote catalog (either/or source).
      category: p.category,
      envVar: p.envVar,
      supportedAuthModes: p.supportedAuthModes,
      defaultAuthMode: p.defaultAuthMode,
      supportsMultipleAccounts: p.supportsMultipleAccounts,
    }));

    PROVIDER_TYPE_INFO = newProviders;
    SETUP_PROVIDERS = newProviders;

    return { providers: newProviders, source: 'remote' };
  } catch (err) {
    // Loading the bundled local catalog is a developer-only fallback. In normal
    // (non-dev) mode the provider list must come from the online catalog; when
    // that fails we rethrow so the caller can surface a prompt instead of
    // silently serving stale packaged data.
    if (!options?.allowLocalFallback) {
      throw err;
    }
    console.warn('Failed to load remote providers, using local fallback.', err);
    PROVIDER_TYPE_INFO = [...LOCAL_PROVIDER_TYPE_INFO];
    SETUP_PROVIDERS = PROVIDER_TYPE_INFO;
    return { providers: PROVIDER_TYPE_INFO, source: 'local' };
  }
}

/** Get type info by provider type id */
export function getProviderTypeInfo(type: ProviderType): ProviderTypeInfo | undefined {
  return PROVIDER_TYPE_INFO.find((t) => t.id === type);
}

/** Voice capability kinds, parallel to OpenClaw's speech/streaming/realtime config sections. */
export const VOICE_MODEL_KINDS: ModelKind[] = ['tts', 'transcription', 'realtime'];

/** True when a single kind is a voice capability (tts / transcription / realtime). */
export function isVoiceKind(kind: ModelKind): boolean {
  return VOICE_MODEL_KINDS.includes(kind);
}

export function getProviderDocsUrl(
  provider: Pick<ProviderTypeInfo, 'docsUrl' | 'docsUrlZh'> | undefined,
  language: string
): string | undefined {
  if (!provider?.docsUrl) {
    return undefined;
  }

  if (language.startsWith('zh') && provider.docsUrlZh) {
    return provider.docsUrlZh;
  }

  return provider.docsUrl;
}

export function shouldShowProviderModelId(
  provider: Pick<ProviderTypeInfo, 'showModelId' | 'showModelIdInDevModeOnly' | 'modelType'> | undefined,
  devModeUnlocked: boolean
): boolean {
  const kinds = normalizeModelTypes(provider?.modelType);
  if (kinds.length > 1) {
    return true; // 如果有多种类型，必定需要展示来让用户进行分别配置
  }

  if (!provider?.showModelId) return false;
  if (provider.showModelIdInDevModeOnly && !devModeUnlocked) return false;
  return true;
}

export function resolveProviderModelForSave(
  type: string,
  provider: Pick<ProviderTypeInfo, 'defaultModelId' | 'showModelId' | 'showModelIdInDevModeOnly' | 'modelType'> | undefined,
  modelId: string | string[],
  devModeUnlocked: boolean
): string | string[] | undefined {
  const isCustom = !BUILTIN_PROVIDER_TYPES.includes(type as any);
  if (!shouldShowProviderModelId(provider, devModeUnlocked)) {
    if (isCustom && provider?.defaultModelId) {
      return provider.defaultModelId;
    }
    return undefined;
  }

  if (Array.isArray(modelId)) {
    const trimmedModelIds = modelId.flatMap((id) => (id ?? '').split(',')).map((id) => id.trim());
    if (trimmedModelIds.every((id) => !id)) {
      return provider?.defaultModelId || undefined;
    }
    return trimmedModelIds;
  }

  const trimmedModelId = modelId.trim();
  return trimmedModelId || provider?.defaultModelId || undefined;
}

export function normalizeProviderApiKeyInput(apiKey: string): string {
  return apiKey.trim();
}

/** Normalize provider API key before saving; Ollama uses a local placeholder when blank. */
export function resolveProviderApiKeyForSave(type: ProviderType | string, apiKey: string): string | undefined {
  const trimmed = normalizeProviderApiKeyInput(apiKey);
  if (type === 'ollama') {
    return trimmed || OLLAMA_PLACEHOLDER_API_KEY;
  }
  return trimmed || undefined;
}
