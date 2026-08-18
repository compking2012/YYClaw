import http from 'node:http';
import { Buffer } from 'node:buffer';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();

type Provider = {
  id: string;
  aliases?: string[];
  models?: string[];
  generateImage: (req: Record<string, unknown>) => Promise<{ images: unknown[] }>;
};

async function registerProvider(config?: Record<string, unknown>): Promise<Provider> {
  const plugin = await import('../../resources/openclaw-plugins/clawx-openai-image/index.mjs');
  let provider: Provider | undefined;
  plugin.default.register({
    config,
    registerImageGenerationProvider(nextProvider: Provider) {
      provider = nextProvider;
    },
  });
  if (!provider) throw new Error('Plugin did not register an image generation provider');
  return provider;
}

describe('ClawX OpenAI image plugin request shape', () => {
  it('does not force deprecated OpenAI Images response_format', async () => {
    const pluginSource = await readFile(
      join(repoRoot, 'resources/openclaw-plugins/clawx-openai-image/index.mjs'),
      'utf8',
    );
    const packageJson = await readFile(join(repoRoot, 'package.json'), 'utf8');
    const bundleScript = await readFile(join(repoRoot, 'scripts/bundle-openclaw.mjs'), 'utf8');

    expect(pluginSource).not.toContain('response_format');
    expect(packageJson).not.toContain('patch-openclaw-image-b64-json');
    expect(bundleScript).not.toContain('response_format: "b64_json"');
  });

  it('omits response_format from generated OpenAI-compatible requests', async () => {
    let requestBody = '';
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        requestBody = Buffer.concat(chunks).toString('utf8');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          data: [{ b64_json: Buffer.from('fake-image').toString('base64') }],
        }));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const plugin = await import('../../resources/openclaw-plugins/clawx-openai-image/index.mjs');
      let provider: { generateImage: (req: Record<string, unknown>) => Promise<{ images: unknown[] }> } | undefined;
      plugin.default.register({
        registerImageGenerationProvider(nextProvider: typeof provider) {
          provider = nextProvider;
        },
      });

      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server failed to bind to a port');

      const result = await provider?.generateImage({
        provider: 'clawx-openai-image',
        model: 'gpt-image-2',
        prompt: 'paint a fox',
        quality: 'high',
        outputFormat: 'png',
        background: 'opaque',
        providerOptions: {
          openai: {
            background: 'opaque',
            moderation: 'auto',
            outputCompression: 90,
            user: 'webchat-user',
          },
        },
        cfg: {
          models: {
            providers: {
              'clawx-openai-image': {
                apiKey: 'test-key',
                baseUrl: `http://127.0.0.1:${address.port}/v1`,
              },
            },
          },
        },
        agentDir: '/tmp/clawx-openai-image-test-agent',
        ssrfPolicy: { dangerouslyAllowPrivateNetwork: true },
      });

      expect(result?.images).toHaveLength(1);
      expect(JSON.parse(requestBody)).toEqual({
        model: 'gpt-image-2',
        prompt: 'paint a fox',
        n: 1,
        size: '1024x1024',
        quality: 'high',
        output_format: 'png',
        background: 'opaque',
      });
    } finally {
      server.close();
    }
  }, 15_000);

  it('keeps the request body minimal when no output knobs are provided', async () => {
    let requestBody = '';
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        requestBody = Buffer.concat(chunks).toString('utf8');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          data: [{ b64_json: Buffer.from('fake-image').toString('base64') }],
        }));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const plugin = await import('../../resources/openclaw-plugins/clawx-openai-image/index.mjs');
      let provider: { generateImage: (req: Record<string, unknown>) => Promise<{ images: unknown[] }> } | undefined;
      plugin.default.register({
        registerImageGenerationProvider(nextProvider: typeof provider) {
          provider = nextProvider;
        },
      });

      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server failed to bind to a port');

      const result = await provider?.generateImage({
        provider: 'clawx-openai-image',
        model: 'gpt-image-2',
        prompt: 'paint a fox',
        cfg: {
          models: {
            providers: {
              'clawx-openai-image': {
                apiKey: 'test-key',
                baseUrl: `http://127.0.0.1:${address.port}/v1`,
              },
            },
          },
        },
        agentDir: '/tmp/clawx-openai-image-test-agent',
        ssrfPolicy: { dangerouslyAllowPrivateNetwork: true },
      });

      expect(result?.images).toHaveLength(1);
      expect(JSON.parse(requestBody)).toEqual({
        model: 'gpt-image-2',
        prompt: 'paint a fox',
        n: 1,
        size: '1024x1024',
      });
    } finally {
      server.close();
    }
  }, 15_000);
});

describe('ClawX OpenAI image plugin self-detection', () => {
  const MIXED_PROVIDERS = {
    // Runtime-generated keys never carry meaningful names; use a deliberately
    // opaque one to prove the plugin does not parse key names.
    'zzz-9f3a1c0d': { baseUrl: 'https://relay.example.com/v1', models: [{ id: 'gpt-image-2' }] },
    'gemini31flashimage-gemini31': { baseUrl: 'https://relay.example.com/v1', models: [{ id: 'gemini-3.1-flash-image' }] },
    'minimax-portal': { baseUrl: 'https://api.minimaxi.com/anthropic', models: [{ id: 'image-01' }] },
    'someimagen-abc12345': { baseUrl: 'https://relay.example.com/v1', models: [{ id: 'imagen-4' }] },
    // A native image provider id must never be shadowed even if it happened to
    // carry an OpenAI-image model in this config.
    openai: { baseUrl: 'https://api.openai.com/v1', models: [{ id: 'gpt-image-2' }] },
  };

  it('claims only provider keys that host an OpenAI Images model', async () => {
    const provider = await registerProvider({ models: { providers: MIXED_PROVIDERS } });

    expect(provider.aliases).toEqual(['zzz-9f3a1c0d']);
    expect(provider.models).toEqual(['gpt-image-2']);
  });

  it('does not claim Gemini, minimax, or Google-imagen provider keys', async () => {
    const provider = await registerProvider({ models: { providers: MIXED_PROVIDERS } });

    expect(provider.aliases).not.toContain('gemini31flashimage-gemini31');
    expect(provider.aliases).not.toContain('minimax-portal');
    expect(provider.aliases).not.toContain('someimagen-abc12345');
    expect(provider.aliases).not.toContain('openai');
  });

  it('and the Gemini plugin claim disjoint keys from the same config', async () => {
    const geminiPlugin = await import('../../resources/openclaw-plugins/clawx-gemini-image/index.mjs');
    const openaiProvider = await registerProvider({ models: { providers: MIXED_PROVIDERS } });

    let geminiProvider: Provider | undefined;
    geminiPlugin.default.register({
      config: { models: { providers: MIXED_PROVIDERS } },
      registerImageGenerationProvider(nextProvider: Provider) {
        geminiProvider = nextProvider;
      },
    });

    const openaiAliases = new Set(openaiProvider.aliases);
    const geminiAliases = new Set(geminiProvider?.aliases ?? []);
    expect(openaiAliases.size).toBeGreaterThan(0);
    expect(geminiAliases.size).toBeGreaterThan(0);
    for (const key of openaiAliases) expect(geminiAliases.has(key)).toBe(false);
  });

  it('resolves credentials by whatever key req.provider names, ignoring its shape', async () => {
    let requestBody = '';
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        requestBody = Buffer.concat(chunks).toString('utf8');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ b64_json: Buffer.from('fake-image').toString('base64') }] }));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Test server failed to bind to a port');

      const provider = await registerProvider({
        models: { providers: { 'zzz-9f3a1c0d': { baseUrl: `http://127.0.0.1:${address.port}/v1` } } },
      });

      const result = await provider.generateImage({
        provider: 'zzz-9f3a1c0d',
        model: 'gpt-image-2',
        prompt: 'paint a fox',
        cfg: {
          models: {
            providers: {
              'zzz-9f3a1c0d': { apiKey: 'relay-key', baseUrl: `http://127.0.0.1:${address.port}/v1` },
            },
          },
        },
        agentDir: '/tmp/clawx-openai-image-test-agent',
        ssrfPolicy: { dangerouslyAllowPrivateNetwork: true },
      });

      expect(result.images).toHaveLength(1);
      expect(requestBody).toContain('"model":"gpt-image-2"');
    } finally {
      server.close();
    }
  }, 15_000);

  it('registers no aliases when config is unavailable', async () => {
    const provider = await registerProvider(undefined);
    expect(provider.aliases).toEqual([]);
  });
});
