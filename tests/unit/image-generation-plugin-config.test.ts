// @vitest-environment node

import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/clawx-image-plugin-config-${suffix}`,
    testUserData: `/tmp/clawx-image-plugin-config-user-data-${suffix}`,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = { ...actual, homedir: () => testHome };
  return { ...mocked, default: mocked };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => testUserData,
    getVersion: () => '0.0.0-test',
  },
}));

vi.mock('@electron/utils/store', () => ({
  getSetting: vi.fn(),
}));

vi.mock('@electron/utils/paths', async () => {
  const actual = await vi.importActual<typeof import('@electron/utils/paths')>('@electron/utils/paths');
  const resolvedDir = join(testHome, '.openclaw-test-openclaw');
  return {
    ...actual,
    getOpenClawResolvedDir: () => resolvedDir,
    getOpenClawDir: () => resolvedDir,
  };
});

async function writeOpenClawJson(config: unknown): Promise<void> {
  const openclawDir = join(testHome, '.openclaw');
  await mkdir(openclawDir, { recursive: true });
  await writeFile(join(openclawDir, 'openclaw.json'), JSON.stringify(config, null, 2), 'utf8');
}

async function readOpenClawJson(): Promise<Record<string, unknown>> {
  const content = await readFile(join(testHome, '.openclaw', 'openclaw.json'), 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

describe('ensureClawXImagePluginConfig', () => {
  beforeEach(async () => {
    vi.resetModules();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('enables each requested plugin and disables auto provider fallback', async () => {
    await writeOpenClawJson({});

    const { ensureClawXImagePluginConfig } = await import('@electron/gateway/image-generation-plugin-resolution');
    await ensureClawXImagePluginConfig(['clawx-openai-image', 'clawx-gemini-image']);

    const config = await readOpenClawJson();
    const plugins = config.plugins as Record<string, unknown>;
    expect(plugins.enabled).toBe(true);
    expect(plugins.allow).toEqual(['clawx-openai-image', 'clawx-gemini-image']);
    const entries = plugins.entries as Record<string, { enabled: boolean }>;
    expect(entries['clawx-openai-image'].enabled).toBe(true);
    expect(entries['clawx-gemini-image'].enabled).toBe(true);

    const defaults = (config.agents as Record<string, unknown>).defaults as Record<string, unknown>;
    expect(defaults.mediaGenerationAutoProviderFallback).toBe(false);
  });

  it('preserves existing plugin entries and allow-list order', async () => {
    await writeOpenClawJson({
      plugins: {
        allow: ['openclaw-lark'],
        entries: { 'openclaw-lark': { enabled: true } },
      },
    });

    const { ensureClawXImagePluginConfig } = await import('@electron/gateway/image-generation-plugin-resolution');
    await ensureClawXImagePluginConfig(['clawx-openai-image']);

    const config = await readOpenClawJson();
    const plugins = config.plugins as Record<string, unknown>;
    expect(plugins.allow).toEqual(['openclaw-lark', 'clawx-openai-image']);
    const entries = plugins.entries as Record<string, unknown>;
    expect(entries['openclaw-lark']).toEqual({ enabled: true });
    expect(entries['clawx-openai-image']).toEqual({ enabled: true });
  });

  it('does not write anything when no plugin is required', async () => {
    await writeOpenClawJson({ agents: { defaults: { imageGenerationModel: { primary: 'minimax-portal/image-01' } } } });

    const { ensureClawXImagePluginConfig } = await import('@electron/gateway/image-generation-plugin-resolution');
    await ensureClawXImagePluginConfig([]);

    const config = await readOpenClawJson();
    expect(config.plugins).toBeUndefined();
    const defaults = (config.agents as Record<string, unknown>).defaults as Record<string, unknown>;
    expect(defaults.mediaGenerationAutoProviderFallback).toBeUndefined();
  });

  it('grants request.allowPrivateNetwork to the backing provider entries', async () => {
    await writeOpenClawJson({
      models: {
        providers: {
          'gptimage2-gptimage': {
            baseUrl: 'https://aiserver.example.com/v1',
            api: 'openai-completions',
            models: [{ id: 'gpt-image-2' }],
          },
        },
      },
    });

    const { ensureClawXImagePluginConfig } = await import('@electron/gateway/image-generation-plugin-resolution');
    await ensureClawXImagePluginConfig(['clawx-openai-image'], ['gptimage2-gptimage']);

    const config = await readOpenClawJson();
    const providers = (config.models as Record<string, unknown>).providers as Record<string, Record<string, unknown>>;
    expect(providers['gptimage2-gptimage'].request).toEqual({ allowPrivateNetwork: true });
    // Original fields are preserved.
    expect(providers['gptimage2-gptimage'].baseUrl).toBe('https://aiserver.example.com/v1');
  });

  it('preserves an existing request object while adding allowPrivateNetwork', async () => {
    await writeOpenClawJson({
      models: {
        providers: {
          'relay-key': {
            baseUrl: 'https://aiserver.example.com/v1',
            request: { timeoutMs: 5000 },
            models: [{ id: 'gemini-3.1-flash-image' }],
          },
        },
      },
    });

    const { ensureClawXImagePluginConfig } = await import('@electron/gateway/image-generation-plugin-resolution');
    await ensureClawXImagePluginConfig(['clawx-gemini-image'], ['relay-key']);

    const config = await readOpenClawJson();
    const providers = (config.models as Record<string, unknown>).providers as Record<string, Record<string, unknown>>;
    expect(providers['relay-key'].request).toEqual({ timeoutMs: 5000, allowPrivateNetwork: true });
  });
});
