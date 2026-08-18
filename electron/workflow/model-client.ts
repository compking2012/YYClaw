// @ts-nocheck
/**
 * Thin single-shot model client used by `runModel`.
 *
 * Deliberately bypasses OpenClaw's agent loop: a constrained model step should
 * not inherit OpenClaw's prompt wrapping or session behaviour. It reads provider
 * config + API key straight from the main-process secure store and issues ONE
 * request, mirroring the protocol handling already proven in
 * `provider-validation.ts`.
 *
 * v1 supports the two protocols that cover the vast majority of providers:
 *  - `anthropic-messages`  → POST {base}/messages
 *  - everything else       → POST {base}/chat/completions (OpenAI-compatible)
 */
import { proxyAwareFetch } from '../utils/proxy-fetch';
import { getProviderConfig } from '../utils/provider-registry';
import { getApiKey, getProvider } from '../utils/secure-storage';
import { getOpenClawProviderKeyForType } from '../utils/provider-keys';
import { getOpenClawProvidersConfig } from '../utils/openclaw-auth';
import { listProviderAccounts } from '../services/providers/provider-store';
import { resolveDefaultModelProviderAccountId } from '../utils/default-model-provider-account';

export interface ModelCallRequest {
  system: string;
  input: string;
  temperature?: number;
  maxOutputTokens?: number;
  providerId?: string;
  model?: string;
  /** Abort the request after this many ms (a constrained step must be bounded). */
  timeoutMs?: number;
}

export interface ModelCallResult {
  text: string;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/** Fetch with a hard timeout so a hung provider can never stall a workflow. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await proxyAwareFetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}

/** Strip a trailing endpoint suffix so we can re-append the one we need. */
function rootBase(baseUrl: string): string {
  return normalizeBaseUrl(baseUrl).replace(/(\/responses?|\/chat\/completions|\/messages)$/, '');
}

async function resolveProvider(providerId?: string) {
  // Which account to call, and which model ref to send. The DEFAULT path (no
  // explicit providerId) MUST mirror the OpenClaw gateway: it resolves the
  // account + model from `agents.defaults.model.primary` in openclaw.json — the
  // exact model the gateway is running. There is NO silent fallback: a missing
  // or unresolvable primary throws, exactly like the gateway fails when it isn't
  // configured. (Switching to some other "first" provider would make the
  // workflow run on a different model than the conversation — a subtle,
  // hard-to-debug divergence.) An explicit `providerId` override is honored as a
  // deliberate caller choice, not a fallback.
  let id: string;
  let modelRef: string | undefined;
  if (providerId) {
    id = providerId;
  } else {
    const { defaultModel } = await getOpenClawProvidersConfig();
    if (!defaultModel) {
      throw new Error(
        'No default model configured (agents.defaults.model.primary). Configure it so the workflow uses the same model as the gateway.',
      );
    }
    const accounts = await listProviderAccounts();
    const accountId = resolveDefaultModelProviderAccountId(defaultModel, accounts);
    if (!accountId) {
      throw new Error(`Cannot resolve a provider account for the default model "${defaultModel}".`);
    }
    id = accountId;
    modelRef = defaultModel;
  }
  const provider = await getProvider(id);
  if (!provider) {
    throw new Error(`Provider not found: ${id}`);
  }
  const apiKey = (await getApiKey(id)) ?? '';
  const registry = getProviderConfig(provider.type);
  const apiProtocol = provider.apiProtocol ?? registry?.api ?? 'openai-completions';
  const baseUrl = (provider.baseUrl ?? registry?.baseUrl ?? '').trim();
  // Model id sent to the server: prefer the gateway's primary ref on the default
  // path; for an explicit override, use the account's own model. Either way, take
  // the first (text) comma slot, then strip the runtime provider-key prefix so
  // the direct REST call sends the bare model id — exactly like the gateway's
  // extractModelId. Bare names (no matching prefix) and HuggingFace-style
  // `org/model` names (prefix ≠ provider key) pass through intact.
  const rawModel = modelRef ?? firstModel(provider.model);
  const primary = rawModel ? rawModel.split(',')[0].trim() : rawModel;
  const providerKey = getOpenClawProviderKeyForType(provider.type, id);
  const model = primary ? stripProviderPrefix(providerKey, primary) : primary;
  return { id, apiKey, apiProtocol, baseUrl, model };
}

/** Strip a leading `${providerKey}/` ref prefix, mirroring openclaw-auth's extractModelId. */
function stripProviderPrefix(providerKey: string, model: string): string {
  return providerKey && model.startsWith(`${providerKey}/`)
    ? model.slice(providerKey.length + 1)
    : model;
}

function firstModel(model: string | string[] | undefined): string | undefined {
  if (Array.isArray(model)) return model[0];
  return model;
}

interface OpenAiChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

interface AnthropicMessagesResponse {
  content?: Array<{ text?: string }>;
}

async function callOpenAiCompletions(
  baseUrl: string,
  apiKey: string,
  model: string,
  req: ModelCallRequest,
): Promise<ModelCallResult> {
  const url = `${rootBase(baseUrl)}/chat/completions`;
  const response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: req.temperature ?? 0,
        ...(req.maxOutputTokens ? { max_tokens: req.maxOutputTokens } : {}),
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.input },
        ],
      }),
    },
    req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(`Model call failed: HTTP ${response.status}`);
  }
  const data = (await response.json().catch(() => ({}))) as OpenAiChatResponse;
  return { text: data.choices?.[0]?.message?.content ?? '' };
}

async function callAnthropicMessages(
  baseUrl: string,
  apiKey: string,
  model: string,
  req: ModelCallRequest,
): Promise<ModelCallResult> {
  const base = baseUrl ? rootBase(baseUrl) : 'https://api.anthropic.com/v1';
  const url = `${base}/messages`;
  const response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        system: req.system,
        max_tokens: req.maxOutputTokens ?? 1024,
        temperature: req.temperature ?? 0,
        messages: [{ role: 'user', content: req.input }],
      }),
    },
    req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  if (!response.ok) {
    throw new Error(`Model call failed: HTTP ${response.status}`);
  }
  const data = (await response.json().catch(() => ({}))) as AnthropicMessagesResponse;
  return { text: data.content?.[0]?.text ?? '' };
}

/** Issue exactly one model request and return its raw text. */
export async function callModelOnce(req: ModelCallRequest): Promise<ModelCallResult> {
  const { apiKey, apiProtocol, baseUrl, model } = await resolveProvider(req.providerId);
  const resolvedModel = req.model ?? model;
  if (!resolvedModel) {
    throw new Error('No model configured for the selected provider');
  }
  if (apiProtocol === 'anthropic-messages') {
    return callAnthropicMessages(baseUrl, apiKey, resolvedModel, req);
  }
  if (!baseUrl) {
    throw new Error('Base URL is required for the selected provider');
  }
  return callOpenAiCompletions(baseUrl, apiKey, resolvedModel, req);
}
