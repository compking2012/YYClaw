import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Guards the workflow model-resolution contract: the direct-REST path
 * (`callModelOnce`, used by dynamic-workflow generation and `model` steps) must
 * resolve its provider + model from the SAME source the OpenClaw gateway uses —
 * `agents.defaults.model.primary` in openclaw.json — and send the bare model id
 * (ref prefix stripped). There is NO silent fallback: a missing / unresolvable
 * primary throws, exactly like the gateway fails when it isn't configured.
 */

const proxyAwareFetch = vi.fn();
vi.mock('@electron/utils/proxy-fetch', () => ({ proxyAwareFetch }));

const getApiKey = vi.fn();
const getProvider = vi.fn();
vi.mock('@electron/utils/secure-storage', () => ({
  getApiKey: (id: string) => getApiKey(id),
  getProvider: (id: string) => getProvider(id),
}));

vi.mock('@electron/utils/provider-registry', () => ({
  getProviderConfig: () => ({ api: 'openai-completions', baseUrl: '' }),
}));

const getOpenClawProvidersConfig = vi.fn();
vi.mock('@electron/utils/openclaw-auth', () => ({
  getOpenClawProvidersConfig: () => getOpenClawProvidersConfig(),
}));

const listProviderAccounts = vi.fn();
vi.mock('@electron/services/providers/provider-store', () => ({
  listProviderAccounts: () => listProviderAccounts(),
}));

// `resolveDefaultModelProviderAccountId` and `getOpenClawProviderKeyForType` run
// for real (pure functions) so the ref→account→bare-model resolution is verified
// end-to-end rather than stubbed.

// A claw-x account whose stored model is a `provider/model` ref, matching the
// real default provider config. Its runtime key is `glm52-glm52d32`.
const GLM_ACCOUNT = {
  id: 'glm52-d3236e56-a3e3-4c19-a9a2-c20d9e44ebd6',
  vendorId: 'glm52',
  label: 'glm52',
  enabled: true,
  isDefault: true,
  baseUrl: 'https://claw-x.com/v1',
  model: 'glm52-glm52d32/glm-5.2',
  apiProtocol: 'openai-completions',
  authMode: 'api_key',
  createdAt: '',
  updatedAt: '',
};

const GLM_CONFIG = {
  id: GLM_ACCOUNT.id,
  name: GLM_ACCOUNT.label,
  type: GLM_ACCOUNT.vendorId,
  enabled: true,
  baseUrl: GLM_ACCOUNT.baseUrl,
  model: GLM_ACCOUNT.model,
  apiProtocol: GLM_ACCOUNT.apiProtocol,
  createdAt: '',
  updatedAt: '',
};

beforeEach(() => {
  proxyAwareFetch.mockReset();
  getApiKey.mockReset();
  getProvider.mockReset();
  getOpenClawProvidersConfig.mockReset();
  listProviderAccounts.mockReset();

  proxyAwareFetch.mockResolvedValue(
    new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  getProvider.mockImplementation((id: string) => (id === GLM_CONFIG.id ? GLM_CONFIG : null));
  getApiKey.mockImplementation((id: string) => (id === GLM_ACCOUNT.id ? 'sk-glm' : ''));
});

describe('callModelOnce provider resolution', () => {
  it('resolves the account + model from agents.defaults.model.primary and sends the bare model id', async () => {
    getOpenClawProvidersConfig.mockResolvedValue({ providers: {}, defaultModel: 'glm52-glm52d32/glm-5.2' });
    listProviderAccounts.mockResolvedValue([GLM_ACCOUNT]);

    const { callModelOnce } = await import('@electron/workflow/model-client');
    const res = await callModelOnce({ system: 's', input: 'i' });

    expect(res.text).toBe('{"ok":true}');
    expect(proxyAwareFetch).toHaveBeenCalledTimes(1);
    const [url, init] = proxyAwareFetch.mock.calls[0];
    // Uses the primary model's account (base URL + key), not some "first" provider.
    expect(url).toBe('https://claw-x.com/v1/chat/completions');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer sk-glm' });
    // The composite `glm52-glm52d32/glm-5.2` ref is stripped to the bare model id
    // the server expects — exactly what the gateway's extractModelId produces.
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('glm-5.2');
  });

  it('throws (no fallback) when agents.defaults.model.primary is not configured', async () => {
    getOpenClawProvidersConfig.mockResolvedValue({ providers: {}, defaultModel: undefined });
    listProviderAccounts.mockResolvedValue([GLM_ACCOUNT]);

    const { callModelOnce } = await import('@electron/workflow/model-client');
    await expect(callModelOnce({ system: 's', input: 'i' })).rejects.toThrow(/No default model configured/);
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });

  it('throws when the primary model has no matching provider account', async () => {
    getOpenClawProvidersConfig.mockResolvedValue({ providers: {}, defaultModel: 'glm52-glm52d32/glm-5.2' });
    listProviderAccounts.mockResolvedValue([]); // no account matches the ref prefix

    const { callModelOnce } = await import('@electron/workflow/model-client');
    await expect(callModelOnce({ system: 's', input: 'i' })).rejects.toThrow(/Cannot resolve a provider account/);
    expect(proxyAwareFetch).not.toHaveBeenCalled();
  });

  it('honors an explicit providerId override without consulting the primary', async () => {
    // Override path: use the account's own model (still prefix-stripped) and never
    // touch agents.defaults.model.primary.
    getProvider.mockImplementation((id: string) =>
      id === 'p-override'
        ? { id, name: 'o', type: 'openai', enabled: true, baseUrl: 'https://override.example/v1', model: 'gpt-x', apiProtocol: 'openai-completions', createdAt: '', updatedAt: '' }
        : null,
    );
    getApiKey.mockImplementation((id: string) => (id === 'p-override' ? 'sk-o' : ''));

    const { callModelOnce } = await import('@electron/workflow/model-client');
    await callModelOnce({ system: 's', input: 'i', providerId: 'p-override' });

    expect(getOpenClawProvidersConfig).not.toHaveBeenCalled();
    const [url, init] = proxyAwareFetch.mock.calls[0];
    expect(url).toBe('https://override.example/v1/chat/completions');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('gpt-x');
  });
});
