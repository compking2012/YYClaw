import type { ModelKind, ModelParamsByKind } from './model-kind';

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

export type ProviderType = (typeof PROVIDER_TYPES)[number];
export type BuiltinProviderType = (typeof BUILTIN_PROVIDER_TYPES)[number];

export const OLLAMA_PLACEHOLDER_API_KEY = 'ollama-local';

/**
 * Authoritative set of `models.providers.*.api` values accepted by the
 * OpenClaw Gateway config schema.  Keep in sync with OpenClaw's
 * `assertValidGatewayStartupConfigSnapshot`.
 *
 * Writing any other value into `~/.openclaw/openclaw.json` triggers
 * `Invalid config` rejection on next reload/restart and tears down all
 * channels.  Use `assertValidApiProtocol` at every write site.
 */
export const OPENCLAW_API_PROTOCOLS = [
  'openai-completions',
  'openai-responses',
  'openai-chatgpt-responses',
  'anthropic-messages',
  'google-generative-ai',
  'github-copilot',
  'bedrock-converse-stream',
  'ollama',
  'azure-openai-responses',
] as const;

export type OpenClawApiProtocol = (typeof OPENCLAW_API_PROTOCOLS)[number];

/** Legacy api values ClawX previously wrote that OpenClaw no longer accepts. */
export const LEGACY_OPENCLAW_API_PROTOCOL_MIGRATIONS = {
  'openai-codex-responses': 'openai-chatgpt-responses',
} as const satisfies Record<string, OpenClawApiProtocol>;

export function normalizeOpenClawApiProtocol(api: unknown): OpenClawApiProtocol | undefined {
  if (typeof api !== 'string') return undefined;
  if ((OPENCLAW_API_PROTOCOLS as readonly string[]).includes(api)) {
    return api as OpenClawApiProtocol;
  }
  const migrated = (LEGACY_OPENCLAW_API_PROTOCOL_MIGRATIONS as Record<string, OpenClawApiProtocol>)[api];
  return migrated;
}

export class InvalidApiProtocolError extends Error {
  constructor(public readonly api: unknown, public readonly providerKey?: string) {
    super(
      `Invalid OpenClaw api protocol${providerKey ? ` for provider "${providerKey}"` : ''}: ` +
      `${JSON.stringify(api)}. Expected one of: ${OPENCLAW_API_PROTOCOLS.join(', ')}.`,
    );
    this.name = 'InvalidApiProtocolError';
  }
}

export function assertValidApiProtocol(
  api: unknown,
  providerKey?: string,
): asserts api is OpenClawApiProtocol {
  if (typeof api !== 'string' || !(OPENCLAW_API_PROTOCOLS as readonly string[]).includes(api)) {
    throw new InvalidApiProtocolError(api, providerKey);
  }
}

export type ProviderProtocol = OpenClawApiProtocol;

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
  supportsVision?: boolean;
  fallbackModels?: string[];
  fallbackProviderIds?: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderWithKeyInfo extends ProviderConfig {
  hasKey: boolean;
  keyMasked: string | null;
}

export interface ProviderTypeInfo {
  id: ProviderType;
  name: string;
  icon: string;
  placeholder: string;
  model?: string | string[];
  modelType?: ModelKind[];
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  showBaseUrl?: boolean;
  showModelId?: boolean;
  showModelIdInDevModeOnly?: boolean;
  modelIdPlaceholder?: string;
  defaultModelId?: string | string[];
  isOAuth?: boolean;
  supportsApiKey?: boolean;
  apiKeyUrl?: string;
  codePlanPresetBaseUrl?: string;
  codePlanPresetModelId?: string;
  codePlanDocsUrl?: string;
  /** When true, OpenClaw provider HTTP fetch may access baseUrl when DNS resolves to private IPs. */
  requestAllowPrivateNetwork?: boolean;
  /** For voice-capable providers: the kernel-side provider id used in messages.tts / voice-call config keys. */
  voiceRuntimeProviderId?: string;
  /** Per-model enrichment metadata keyed by model id (from the enriched provider catalog). */
  models?: Record<string, ModelMeta>;
}

export interface ProviderModelEntry extends Record<string, unknown> {
  id: string;
  name: string;
}

export interface ProviderBackendConfig {
  baseUrl: string;
  api: OpenClawApiProtocol;
  apiKeyEnv: string;
  models?: ProviderModelEntry[];
  headers?: Record<string, string>;
}

export interface ProviderDefinition extends ProviderTypeInfo {
  category: ProviderVendorCategory;
  envVar?: string;
  apiProtocol?: ProviderProtocol;
  headers?: Record<string, string>;
  backendModels?: ProviderModelEntry[];
  providerConfig?: ProviderBackendConfig;
  supportedAuthModes: ProviderAuthMode[];
  defaultAuthMode: ProviderAuthMode;
  supportsMultipleAccounts: boolean;
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
}

export type ProviderSecret =
  | {
    type: 'api_key';
    accountId: string;
    apiKey: string;
  }
  | {
    type: 'oauth';
    accountId: string;
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    scopes?: string[];
    email?: string;
    subject?: string;
  }
  | {
    type: 'local';
    accountId: string;
    apiKey?: string;
  };

export interface ModelSummary {
  id: string;
  name: string;
  vendorId: string;
  accountId?: string;
  supportsVision?: boolean;
  supportsReasoning?: boolean;
  contextWindow?: number;
  pricing?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  source: 'builtin' | 'remote' | 'gateway' | 'custom';
}

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
 * and forward-compatible: consumers degrade gracefully on missing fields.
 * Drives the Agent auto-select-model utility scoring. See the model-router plan.
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
  /** Domain strength scores in 0..1 — the core signal for quality scoring. */
  strengths?: Partial<Record<ModelStrengthKey, number>>;
  toolUseReliability?: number;
  reasoningSupport?: boolean;
  knowledgeCutoff?: string;
  benchmarks?: { arenaElo?: number; qualityIndex?: number; [key: string]: number | undefined };
  /** Per-field source/time/confidence for display and confidence-weighted scoring. */
  provenance?: Record<string, { source: string; updatedAt: string; confidence?: number }>;
  status?: 'active' | 'deprecated';
  /** Data-residency origin: self-hosted private > domestic (CN) > overseas. Drives sensitive-task routing. */
  origin?: 'private' | 'domestic' | 'overseas';
}
