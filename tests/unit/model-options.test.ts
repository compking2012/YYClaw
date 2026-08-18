import { describe, expect, it } from 'vitest';
import {
  buildConfiguredModelOptions,
  formatConfiguredModelLabel,
  formatModelRefLabel,
  formatProviderDisplayName,
  isConfiguredModelRefAvailable,
  normalizeModelIdForRuntimeProvider,
  resolveConfiguredModelRef,
  resolveRuntimeProviderKey,
} from '../../src/lib/model-options';
import type { ProviderAccount, ProviderVendorInfo, ProviderWithKeyInfo } from '../../src/lib/providers';

const now = '2026-04-28T00:00:00.000Z';

function account(overrides: Partial<ProviderAccount>): ProviderAccount {
  return {
    id: 'custom-alpha1234',
    vendorId: 'custom',
    label: 'Alpha',
    authMode: 'api_key',
    model: 'model-alpha',
    enabled: true,
    isDefault: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as ProviderAccount;
}

function status(id: string, hasKey = true): ProviderWithKeyInfo {
  return {
    id,
    type: 'custom',
    name: id,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    hasKey,
    keyMasked: hasKey ? 'sk-***' : null,
  } as ProviderWithKeyInfo;
}

const vendors: ProviderVendorInfo[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    icon: '💚',
    placeholder: 'sk-proj-...',
    model: 'GPT',
    requiresApiKey: true,
    category: 'official',
    supportedAuthModes: ['api_key', 'oauth_browser'],
    defaultAuthMode: 'api_key',
    supportsMultipleAccounts: true,
  },
];

describe('model option helpers', () => {
  it('formats model refs using only the text after the provider prefix', () => {
    expect(formatModelRefLabel('openrouter/openai/gpt-5.5')).toBe('openai/gpt-5.5');
    expect(formatModelRefLabel('custom-alpha1234/model-alpha')).toBe('model-alpha');
    expect(normalizeModelIdForRuntimeProvider('openai/gpt-5.6', 'openai')).toBe('gpt-5.6');
    expect(normalizeModelIdForRuntimeProvider('openrouter/openai/gpt-5.6', 'openrouter'))
      .toBe('openai/gpt-5.6');
  });

  it('formats provider display names using custom labels or vendor names', () => {
    const vendorMap = new Map(vendors.map((vendor) => [vendor.id, vendor]));
    expect(formatProviderDisplayName(account({ vendorId: 'custom', label: 'Alpha' }), vendorMap)).toBe('Alpha');
    expect(formatProviderDisplayName(account({ vendorId: 'openai', label: 'OpenAI' }), vendorMap)).toBe('OpenAI');
    expect(formatConfiguredModelLabel('gpt-5.5', account({ vendorId: 'openai', label: 'OpenAI' }), vendorMap)).toBe('OpenAI');
  });

  it('builds one configured custom model option per account', () => {
    const options = buildConfiguredModelOptions(
      [
        account({ id: 'alpha1234', model: 'model-alpha', updatedAt: '2026-04-03T00:00:00.000Z' }),
        account({ id: 'beta5678', label: 'Beta', model: 'provider/model-beta', updatedAt: '2026-04-02T00:00:00.000Z' }),
      ],
      [status('alpha1234'), status('beta5678')],
      vendors,
      'alpha1234',
    );

    expect(options).toEqual([
      {
        modelRef: 'custom-alpha123/model-alpha',
        label: 'Alpha',
        runtimeProviderKey: 'custom-alpha123',
        accountId: 'alpha1234',
      },
      {
        modelRef: 'custom-beta5678/provider/model-beta',
        label: 'Beta',
        runtimeProviderKey: 'custom-beta5678',
        accountId: 'beta5678',
      },
    ]);
  });

  it('keeps prefixed account models intact and skips accounts without credentials', () => {
    const runtimeKey = resolveRuntimeProviderKey(account({ id: 'gamma9012' }));
    const options = buildConfiguredModelOptions(
      [
        account({ id: 'gamma9012', model: `${runtimeKey}/model-gamma` }),
        account({ id: 'delta3456', label: 'Delta', model: 'model-delta' }),
      ],
      [status('gamma9012'), status('delta3456', false)],
      vendors,
      null,
    );

    expect(options).toHaveLength(1);
    expect(options[0].modelRef).toBe('custom-gamma901/model-gamma');
    expect(options[0].label).toBe('Alpha');
  });

  it('builds multiple configured model options from account metadata custom models', () => {
    const accountId = 'model-hub-01';
    const runtimeKey = resolveRuntimeProviderKey(account({ id: accountId, label: 'Model Hub' }));
    const options = buildConfiguredModelOptions(
      [
        account({
          id: accountId,
          label: 'Model Hub',
          model: 'model-default',
          metadata: { customModels: ['gpt-5.4', 'claude-sonnet-4', 'gpt-5.4'] },
        }),
      ],
      [status(accountId)],
      vendors,
      accountId,
    );

    expect(options).toEqual([
      {
        modelRef: `${runtimeKey}/gpt-5.4`,
        label: 'Model Hub · gpt-5.4',
        runtimeProviderKey: runtimeKey,
        accountId,
      },
      {
        modelRef: `${runtimeKey}/claude-sonnet-4`,
        label: 'Model Hub · claude-sonnet-4',
        runtimeProviderKey: runtimeKey,
        accountId,
      },
    ]);
  });

  it.each([
    ['api_key', 'openai-api-key'],
    ['oauth_device', 'openai-device-oauth'],
    ['oauth_browser', 'openai-browser-oauth'],
  ] as const)('uses only the selected built-in model for %s accounts with stale metadata', (authMode, id) => {
    const openAiAccount = account({
      id,
      vendorId: 'openai',
      label: 'OpenAI',
      authMode,
      model: 'openai/gpt-5.6',
      metadata: { customModels: ['gpt-5.5', 'openai/gpt-5.6'] },
    });

    const options = buildConfiguredModelOptions(
      [openAiAccount],
      authMode === 'api_key' ? [status(id)] : [],
      vendors,
      openAiAccount.id,
    );

    expect(options).toEqual([
      {
        modelRef: 'openai/gpt-5.6',
        label: 'OpenAI',
        runtimeProviderKey: 'openai',
        accountId: id,
      },
    ]);
    expect(resolveConfiguredModelRef('openai/gpt-5.5', 'openai/gpt-5.5', options))
      .toBe('openai/gpt-5.6');
  });

  it('preserves custom runtime keys that are already normalized', () => {
    const runtimeKey = resolveRuntimeProviderKey(account({
      id: 'custom-enterpri',
      label: 'Enterprise',
      model: 'custom-enterpri/gpt-5.4',
      metadata: { customModels: ['gpt-5.4', 'gpt-5.5'] },
    }));

    const options = buildConfiguredModelOptions(
      [
        account({
          id: 'custom-enterpri',
          label: 'Enterprise',
          model: 'custom-enterpri/gpt-5.4',
          metadata: { customModels: ['gpt-5.4', 'gpt-5.5'] },
        }),
      ],
      [status('custom-enterpri')],
      vendors,
      'custom-enterpri',
    );

    expect(runtimeKey).toBe('custom-enterpri');
    expect(options).toEqual([
      {
        modelRef: 'custom-enterpri/gpt-5.4',
        label: 'Enterprise · gpt-5.4',
        runtimeProviderKey: 'custom-enterpri',
        accountId: 'custom-enterpri',
      },
      {
        modelRef: 'custom-enterpri/gpt-5.5',
        label: 'Enterprise · gpt-5.5',
        runtimeProviderKey: 'custom-enterpri',
        accountId: 'custom-enterpri',
      },
    ]);
  });

  it('keeps vision-capable chat models in a text-only picker', () => {
    const visionAccount = account({
      id: 'gpt55-c88ce7d8',
      vendorId: 'openai',
      label: 'GPT-5.5',
      // A vision-capable chat model declares both kinds, and the positional
      // model string repeats the same id once per kind.
      modelType: ['text', 'image'],
      model: 'gpt-5.5,gpt-5.5',
      metadata: { customModels: ['gpt-5.5'] },
    });
    const imageOnlyAccount = account({
      id: 'gptimage2-4d16b51b',
      vendorId: 'openai',
      label: 'GPT Image 2',
      modelType: ['image_generate'],
      model: 'gpt-image-2',
    });

    const options = buildConfiguredModelOptions(
      [visionAccount, imageOnlyAccount],
      [status('gpt55-c88ce7d8'), status('gptimage2-4d16b51b')],
      vendors,
      null,
      { includeKinds: ['text'] },
    );

    // The vision model survives the text filter; the image-generation-only
    // account does not. The comma-joined positional string is split, so the
    // ref is `openai/gpt-5.5` and not `openai/gpt-5.5,gpt-5.5`.
    expect(options).toEqual([
      {
        modelRef: 'openai/gpt-5.5',
        label: 'GPT-5.5',
        runtimeProviderKey: 'openai',
        accountId: 'gpt55-c88ce7d8',
      },
    ]);
  });

  it('picks the positional model id belonging to the requested kind', () => {
    const voiceAccount = account({
      id: 'openai-voice-a8a1ab8b',
      vendorId: 'openai',
      label: 'OpenAI Voice',
      modelType: ['tts', 'transcription', 'realtime'],
      model: 'gpt-4o-mini-tts,gpt-4o-transcribe,gpt-realtime-2',
    });

    expect(
      buildConfiguredModelOptions([voiceAccount], [status('openai-voice-a8a1ab8b')], vendors, null, {
        includeKinds: ['text'],
      }),
    ).toEqual([]);

    // Asking for transcription yields that kind's slot, not index 0's TTS model.
    expect(
      buildConfiguredModelOptions([voiceAccount], [status('openai-voice-a8a1ab8b')], vendors, null, {
        includeKinds: ['transcription'],
      }).map((option) => option.modelRef),
    ).toEqual(['openai/gpt-4o-transcribe']);
  });

  it('never fans a multi-kind account out into non-text models', () => {
    // MiniMax stores only its chat model positionally, but carries every
    // kind's catalog default in `customModels`.
    const miniMax = account({
      id: 'minimax-portal-cn-c202e44f',
      vendorId: 'minimax-portal-cn',
      label: 'MiniMax',
      authMode: 'oauth_device',
      modelType: ['text', 'image_generate', 'music_generate', 'video_generate'],
      model: 'minimax-portal/MiniMax-M3',
      metadata: { customModels: ['MiniMax-M3', 'image-01', 'music-2.6', 'MiniMax-Hailuo-2.3'] },
    });

    const options = buildConfiguredModelOptions([miniMax], [], vendors, null, { includeKinds: ['text'] });

    expect(options.map((option) => option.modelRef)).toEqual(['minimax-portal/MiniMax-M3']);
  });

  it('treats malformed provider snapshots as empty options', () => {
    expect(
      buildConfiguredModelOptions(
        {} as ProviderAccount[],
        {} as ProviderWithKeyInfo[],
        {} as ProviderVendorInfo[],
        null,
      ),
    ).toEqual([]);
  });

  it('falls back to default or first configured model when preferred ref is stale', () => {
    const options = buildConfiguredModelOptions(
      [account({ id: 'alpha1234', model: 'model-alpha' })],
      [status('alpha1234')],
      vendors,
      'alpha1234',
    );

    expect(resolveConfiguredModelRef('custom-deleted/gpt-5.5', 'custom-alpha123/model-alpha', options))
      .toBe('custom-alpha123/model-alpha');
    expect(resolveConfiguredModelRef('custom-deleted/gpt-5.5', null, options))
      .toBe('custom-alpha123/model-alpha');
    expect(isConfiguredModelRefAvailable('custom-deleted/gpt-5.5', options)).toBe(false);
  });
});
