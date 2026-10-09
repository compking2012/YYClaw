import { describe, expect, it } from 'vitest';
import {
  normalizeProviderApiKeyInput,
  PROVIDER_TYPES,
  PROVIDER_TYPE_INFO,
  getProviderDocsUrl,
  getProviderIconUrl,
  isProviderAvailableForLanguage,
  resolveProviderApiKeyForSave,
  resolveProviderModelForSave,
  shouldInvertInDark,
  shouldShowProviderModelId,
} from '@/lib/providers';
import {
  BUILTIN_PROVIDER_TYPES,
  getProviderConfig,
  getProviderDefaultModel,
  getProviderEnvVar,
  getProviderEnvVars,
} from '@electron/utils/provider-registry';
import { getProviderDefaultModel as getCatalogDefaultModel } from '@electron/shared/providers/registry';
import bundledProviders from '../../resources/config/providers.json';
import { OPENCLAW_API_PROTOCOLS } from '@electron/shared/providers/types';

describe('provider metadata', () => {
  it('includes ark in the frontend provider registry', () => {
    expect(PROVIDER_TYPES).toContain('ark');

    expect(PROVIDER_TYPE_INFO).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'ark',
          name: 'ByteDance Ark',
          requiresApiKey: true,
          defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
          showBaseUrl: true,
          showModelId: true,
          codePlanPresetBaseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
          codePlanPresetModelId: 'ark-code-latest',
          codePlanDocsUrl: 'https://www.volcengine.com/docs/82379/1928261?lang=zh',
        }),
      ])
    );
  });

  it('includes TokenDance OAuth with ClawX request attribution', () => {
    expect(PROVIDER_TYPES).toContain('tokendance');
    expect(BUILTIN_PROVIDER_TYPES).toContain('tokendance');
    expect(PROVIDER_TYPE_INFO).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'tokendance',
        name: 'TokenDance',
        isOAuth: true,
        supportsApiKey: true,
        defaultBaseUrl: 'https://tokendance.space/gateway/v1',
        defaultModelId: 'qwen3.8-max',
        availableInLanguages: ['zh'],
      }),
    ]));
    expect(getProviderIconUrl('tokendance')).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(shouldInvertInDark('tokendance')).toBe(false);
    expect(getProviderEnvVar('tokendance')).toBe('TOKENDANCE_API_KEY');
    expect(getProviderConfig('tokendance')).toEqual({
      baseUrl: 'https://tokendance.space/gateway/v1',
      api: 'openai-completions',
      apiKeyEnv: 'TOKENDANCE_API_KEY',
      headers: { 'X-App-URL': 'https://clawx.com.cn' },
    });
  });

  it('limits TokenDance discovery to Chinese interface locales', () => {
    const tokenDance = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'tokendance');
    const openAi = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'openai');

    expect(tokenDance).toBeDefined();
    expect(isProviderAvailableForLanguage(tokenDance!, 'zh')).toBe(true);
    expect(isProviderAvailableForLanguage(tokenDance!, 'zh-CN')).toBe(true);
    expect(isProviderAvailableForLanguage(tokenDance!, 'en')).toBe(false);
    expect(isProviderAvailableForLanguage(tokenDance!, 'ja')).toBe(false);
    expect(isProviderAvailableForLanguage(tokenDance!, 'ru')).toBe(false);
    expect(isProviderAvailableForLanguage(tokenDance!, 'unsupported')).toBe(false);
    expect(isProviderAvailableForLanguage(openAi!, 'en')).toBe(true);
  });

  it('includes ark in the backend provider registry', () => {
    expect(BUILTIN_PROVIDER_TYPES).toContain('ark');
    expect(getProviderEnvVar('ark')).toBe('ARK_API_KEY');
    expect(getProviderConfig('ark')).toEqual({
      baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
      api: 'openai-completions',
      apiKeyEnv: 'ARK_API_KEY',
    });
  });

  // Skipped: the YYClaw fork ships its own customized providers.json (GLM
  // providers such as glm52/glm51) and intentionally does NOT include upstream's
  // standard `zai`/`zai-global` entries. Kept (not deleted) so this coverage
  // returns automatically if upstream's Z.AI Coding-Plan provider is later added.
  it.skip('includes Z.AI CN and Global with OpenClaw-aligned endpoints and glm-5.2 default', () => {
    expect(PROVIDER_TYPES).toEqual(expect.arrayContaining(['zai', 'zai-global']));
    expect(BUILTIN_PROVIDER_TYPES).toEqual(expect.arrayContaining(['zai', 'zai-global']));

    expect(PROVIDER_TYPE_INFO).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'zai',
          name: 'Z.AI (CN)',
          defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
          defaultModelId: 'glm-5.3-flash',
          showBaseUrl: true,
          showModelId: true,
          codePlanPresetBaseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
          codePlanPresetModelId: 'glm-5.3-flash',
          codePlanDocsUrl: 'https://docs.bigmodel.cn/cn/coding-plan/quick-start',
        }),
        expect.objectContaining({
          id: 'zai-global',
          name: 'Z.AI (Global)',
          defaultBaseUrl: 'https://api.z.ai/api/paas/v4',
          defaultModelId: 'glm-5.3-flash',
          showBaseUrl: true,
          showModelId: true,
          codePlanPresetBaseUrl: 'https://api.z.ai/api/coding/paas/v4',
          codePlanPresetModelId: 'glm-5.3-flash',
          codePlanDocsUrl: 'https://docs.z.ai/devpack/quick-start',
        }),
      ]),
    );

    expect(getProviderEnvVar('zai')).toBe('ZAI_API_KEY');
    expect(getProviderEnvVar('zai-global')).toBe('ZAI_API_KEY');
    expect(getProviderConfig('zai')).toEqual(
      expect.objectContaining({
        baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
        api: 'openai-completions',
        apiKeyEnv: 'ZAI_API_KEY',
      }),
    );
    expect(getProviderConfig('zai-global')).toEqual(
      expect.objectContaining({
        baseUrl: 'https://api.z.ai/api/paas/v4',
        api: 'openai-completions',
        apiKeyEnv: 'ZAI_API_KEY',
      }),
    );
  });

  it('uses a single canonical env key for moonshot provider', () => {
    expect(getProviderEnvVar('moonshot')).toBe('MOONSHOT_API_KEY');
    expect(getProviderEnvVars('moonshot')).toEqual(['MOONSHOT_API_KEY']);
    expect(getProviderConfig('moonshot')).toEqual(
      expect.objectContaining({
        baseUrl: 'https://api.moonshot.cn/v1',
        apiKeyEnv: 'MOONSHOT_API_KEY',
      })
    );
  });

  it('ships matching default models in the renderer and Main registries', () => {
    for (const provider of PROVIDER_TYPE_INFO) {
      if (provider.id === 'custom') continue;
      expect(
        { id: provider.id, defaultModelId: getProviderDefaultModel(provider.id) },
        `renderer/Main default model drift for ${provider.id}`,
      ).toEqual({ id: provider.id, defaultModelId: Array.isArray(provider.defaultModelId) ? provider.defaultModelId[0] : provider.defaultModelId });
      expect(getCatalogDefaultModel(provider.id)).toEqual(provider.defaultModelId);
    }
  });

  it('preserves local backend model metadata instead of replacing it with upstream models', () => {
    for (const provider of bundledProviders) {
      if ('backendModels' in provider && provider.backendModels) {
        expect(getProviderConfig(provider.id)?.models).toEqual(provider.backendModels);
      }
    }
    expect(getProviderConfig('moonshot')?.models).toContainEqual(expect.objectContaining({
      id: 'kimi-k2.6', contextWindow: 256_000, input: ['text'],
    }));
  });

  it('gives the approved provider integrations their backend connection presets', () => {
    for (const type of ['anthropic', 'google', 'tokendance']) {
      const config = getProviderConfig(type);
      expect(config?.baseUrl, `${type} has no providerConfig.baseUrl`).toBeTruthy();
      expect(OPENCLAW_API_PROTOCOLS, `${type} declares an api OpenClaw rejects`).toContain(
        config?.api,
      );
    }
  });

  it('registers Anthropic and Google against their official endpoints', () => {
    expect(getProviderConfig('anthropic')).toEqual({
      baseUrl: 'https://api.anthropic.com/v1',
      api: 'anthropic-messages',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
    });
    expect(getProviderConfig('google')).toEqual({
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      api: 'google-generative-ai',
      apiKeyEnv: 'GEMINI_API_KEY',
    });
  });

  it('keeps builtin provider sources in sync', () => {
    expect(BUILTIN_PROVIDER_TYPES).toEqual(
      expect.arrayContaining(['anthropic', 'openai', 'google', 'openrouter', 'tokendance', 'ark', 'moonshot', 'siliconflow', 'minimax-portal', 'minimax-portal-cn', 'zai', 'zai-global', 'modelstudio', 'ollama'])
    );
  });

  it('uses OpenAI-compatible Ollama default base URL', () => {
    expect(PROVIDER_TYPE_INFO).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'ollama',
          defaultBaseUrl: 'http://localhost:11434/v1',
          requiresApiKey: false,
          showBaseUrl: true,
          showModelId: true,
        }),
      ])
    );
  });

  it('exposes provider documentation links', () => {
    const anthropic = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'anthropic');
    const openrouter = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'openrouter');
    const moonshot = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'moonshot');
    const siliconflow = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'siliconflow');
    const ark = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'ark');
    const custom = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'custom');

    expect(anthropic).toMatchObject({
      docsUrl: 'https://platform.claude.com/docs/en/api/overview',
    });
    expect(getProviderDocsUrl(anthropic, 'en')).toBe('https://platform.claude.com/docs/en/api/overview');
    expect(getProviderDocsUrl(openrouter, 'en')).toBe('https://openrouter.ai/models');
    expect(getProviderDocsUrl(moonshot, 'en')).toBe('https://platform.moonshot.cn/');
    expect(getProviderDocsUrl(siliconflow, 'en')).toBe('https://docs.siliconflow.cn/cn/userguide/introduction');
    expect(getProviderDocsUrl(ark, 'en')).toBe('https://www.volcengine.com/');
    if (custom?.docsUrl) {
      expect(getProviderDocsUrl(custom, 'en')).toBe(custom.docsUrl);
      expect(getProviderDocsUrl(custom, 'zh-CN')).toBe(custom.docsUrlZh ?? custom.docsUrl);
    }
  });

  it('exposes editable model id with default for built-in providers, mirroring OpenRouter', () => {
    const anthropic = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'anthropic');
    const openrouter = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'openrouter');
    const siliconflow = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'siliconflow');
    const deepseek = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'deepseek');
    const moonshot = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'moonshot');
    const moonshotGlobal = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'moonshot-global');

    expect(anthropic).toMatchObject({
      showModelId: true,
      defaultModelId: ['claude-opus-4-8', 'claude-opus-4-8'],
    });
    expect(openrouter).toMatchObject({
      showModelId: true,
      defaultModelId: ['', '', '', '', ''],
    });
    expect(siliconflow).toMatchObject({
      showModelId: true,
      defaultModelId: [
        'deepseek-ai/DeepSeek-V4-Flash',
        'Qwen/Qwen3.6-35B-A3B',
        'Qwen/Qwen-Image',
        'Wan-AI/Wan2.2-I2V-A14B',
      ],
    });
    expect(deepseek).toMatchObject({
      showModelId: true,
      defaultModelId: ['deepseek-v4-pro'],
    });
    expect(moonshot).toMatchObject({
      showModelId: true,
      defaultModelId: ['kimi-k2.6', 'kimi-k2.6'],
    });
    expect(moonshotGlobal).toMatchObject({
      showModelId: true,
      defaultModelId: ['kimi-k2.6', 'kimi-k2.6'],
    });

    for (const provider of [anthropic, openrouter, siliconflow, deepseek, moonshot, moonshotGlobal]) {
      expect(provider?.showModelIdInDevModeOnly).toBeUndefined();
      expect(shouldShowProviderModelId(provider, false)).toBe(true);
      expect(shouldShowProviderModelId(provider, true)).toBe(true);
    }
  });

  it('shows OAuth-capable provider model overrides regardless of dev mode and preserves defaults', () => {
    const openai = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'openai');
    const google = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'google');
    const minimax = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'minimax-portal');
    const minimaxCn = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'minimax-portal-cn');

    expect(openai).toMatchObject({
      showModelId: true,
      defaultModelId: ['gpt-5.6-sol', 'gpt-5.6-sol', 'gpt-image-2', 'gpt-4o-mini-tts', 'gpt-4o-transcribe', 'gpt-realtime-2'],
      isOAuth: true,
      supportsApiKey: true,
    });
    expect(google).toMatchObject({
      showModelId: true,
      defaultModelId: [
        'gemini-3.1-pro-preview',
        'gemini-3.1-pro-preview',
        'gemini-3.1-flash-image-preview',
        'lyria-3-pro-preview',
        'veo-3.1-generate-preview',
      ],
    });
    expect(minimax).toMatchObject({ showModelId: true, defaultModelId: 'MiniMax-M3' });
    expect(minimaxCn).toMatchObject({
      showModelId: true,
      defaultModelId: ['MiniMax-M3', 'image-01', 'music-2.6', 'MiniMax-Hailuo-2.3', 'speech-2.8-hd'],
    });

    for (const provider of [openai, google, minimax, minimaxCn]) {
      expect(provider?.showModelIdInDevModeOnly).toBeUndefined();
      expect(shouldShowProviderModelId(provider, false)).toBe(true);
      expect(shouldShowProviderModelId(provider, true)).toBe(true);
    }

    expect(resolveProviderModelForSave('openai', openai, '   ', false)).toEqual(openai?.defaultModelId);
    expect(resolveProviderModelForSave('google', google, '   ', false)).toEqual(google?.defaultModelId);
    expect(resolveProviderModelForSave('minimax-portal', minimax, '   ', false)).toBe('MiniMax-M3');
    expect(resolveProviderModelForSave('minimax-portal-cn', minimaxCn, '   ', false)).toEqual(minimaxCn?.defaultModelId);
  });

  it('keeps hidden Model Studio flagged for dev mode (legacy hidden provider)', () => {
    const qwen = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'modelstudio');

    expect(qwen).toMatchObject({
      hidden: true,
      showModelId: true,
      showModelIdInDevModeOnly: true,
      defaultModelId: [
        'qwen3.6-plus',
        'qwen3.6-plus',
        'wan2.7-image-pro',
        'fun-music-v1',
        'happyhorse-1.0-t2v',
      ],
    });
    // Multi-model providers always expose per-kind model fields when configuring accounts.
    expect(shouldShowProviderModelId(qwen, false)).toBe(true);
    expect(shouldShowProviderModelId(qwen, true)).toBe(true);
  });

  it('saves user-entered or default model overrides for built-in providers without dev mode', () => {
    const openrouter = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'openrouter');
    const siliconflow = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'siliconflow');
    const anthropic = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'anthropic');
    const ark = PROVIDER_TYPE_INFO.find((provider) => provider.id === 'ark');

    expect(resolveProviderModelForSave('openrouter', openrouter, 'openai/gpt-5', false)).toBe('openai/gpt-5');
    expect(resolveProviderModelForSave('siliconflow', siliconflow, 'Qwen/Qwen3-Coder-480B-A35B-Instruct', false))
      .toBe('Qwen/Qwen3-Coder-480B-A35B-Instruct');
    expect(resolveProviderModelForSave('anthropic', anthropic, 'claude-sonnet-4-5', false)).toBe('claude-sonnet-4-5');

    expect(resolveProviderModelForSave('openrouter', openrouter, '   ', false)).toEqual(openrouter?.defaultModelId);
    expect(resolveProviderModelForSave('siliconflow', siliconflow, '   ', false)).toEqual(siliconflow?.defaultModelId);
    expect(resolveProviderModelForSave('anthropic', anthropic, '   ', false)).toEqual(anthropic?.defaultModelId);
    expect(resolveProviderModelForSave('ark', ark, '  ep-custom-model  ', false)).toBe('ep-custom-model');
  });

  it('tolerates undefined/sparse model id slots without throwing (kind-swap leftovers)', () => {
    // A custom multi-kind provider; switching the model-kind <select> can leave
    // `undefined`/holes in the modelIds array. resolveProviderModelForSave must not crash.
    const customMultiKind = {
      defaultModelId: 'fallback-model',
      showModelId: true,
      showModelIdInDevModeOnly: false,
      modelType: ['text', 'image_generate'],
    } as const;

    // Array containing an explicit undefined slot.
    expect(() =>
      resolveProviderModelForSave('custom', customMultiKind, ['gpt-4', undefined as unknown as string], true),
    ).not.toThrow();
    expect(
      resolveProviderModelForSave('custom', customMultiKind, ['gpt-4', undefined as unknown as string], true),
    ).toContain('gpt-4');

    // Sparse array (a hole at index 1) materialized by spread elsewhere.
    const sparse: string[] = [];
    sparse[0] = 'sora-2';
    sparse[2] = 'gpt-image-1';
    expect(() => resolveProviderModelForSave('custom', customMultiKind, [...sparse], true)).not.toThrow();

    // All-empty (after coalescing) falls back to the provider default.
    expect(
      resolveProviderModelForSave('custom', customMultiKind, [undefined as unknown as string, ''], true),
    ).toBe('fallback-model');
  });

  it('normalizes provider API keys for save flow', () => {
    expect(normalizeProviderApiKeyInput('  sk-test \n')).toBe('sk-test');
    expect(resolveProviderApiKeyForSave('ollama', '')).toBe('ollama-local');
    expect(resolveProviderApiKeyForSave('ollama', '   ')).toBe('ollama-local');
    expect(resolveProviderApiKeyForSave('ollama', 'real-key')).toBe('real-key');
    expect(resolveProviderApiKeyForSave('openai', '')).toBeUndefined();
    expect(resolveProviderApiKeyForSave('openai', ' sk-test ')).toBe('sk-test');
  });
});
