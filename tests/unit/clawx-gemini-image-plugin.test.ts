import http from 'node:http';
import { Buffer } from 'node:buffer';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// The native image processor can't decode in the test sandbox, so mock the
// transcode surface to keep the JPEG-output wiring deterministic.
vi.mock('openclaw/plugin-sdk/media-runtime', () => ({
  resizeToJpeg: vi.fn(async () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x6a, 0x70])),
}));

// eslint-disable-next-line import/first
import { resizeToJpeg } from 'openclaw/plugin-sdk/media-runtime';

const resizeToJpegMock = vi.mocked(resizeToJpeg);

beforeEach(() => {
  resizeToJpegMock.mockClear();
  resizeToJpegMock.mockImplementation(async () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x6a, 0x70]));
});

type GeneratedImage = { buffer: Buffer; mimeType: string; fileName: string };
type Provider = {
  id: string;
  aliases?: string[];
  models?: string[];
  defaultModel: string;
  generateImage: (req: Record<string, unknown>) => Promise<{ images: GeneratedImage[]; model: string }>;
};

async function registerProvider(config?: Record<string, unknown>): Promise<Provider> {
  const plugin = await import('../../resources/openclaw-plugins/clawx-gemini-image/index.mjs');
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

type Capture = { url: string; body: string; authorization?: string; googApiKey?: string };

async function withRelay(
  respond: (capture: Capture) => { status?: number; payload: unknown },
  run: (provider: Provider, port: number, captures: Capture[]) => Promise<void>,
): Promise<void> {
  const captures: Capture[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const capture: Capture = {
        url: req.url ?? '',
        body: Buffer.concat(chunks).toString('utf8'),
        authorization: req.headers.authorization,
        googApiKey: req.headers['x-goog-api-key'] as string | undefined,
      };
      captures.push(capture);
      const { status = 200, payload } = respond(capture);
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Test server failed to bind to a port');

    const plugin = await import('../../resources/openclaw-plugins/clawx-gemini-image/index.mjs');
    let provider: Provider | undefined;
    plugin.default.register({
      registerImageGenerationProvider(nextProvider: Provider) {
        provider = nextProvider;
      },
    });
    if (!provider) throw new Error('Plugin did not register an image generation provider');

    await run(provider, address.port, captures);
  } finally {
    server.close();
  }
}

function buildRequest(port: number, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider: 'clawx-gemini-image',
    model: 'gemini-3.1-flash-image',
    prompt: 'a watercolour tabby cat on a windowsill',
    cfg: {
      models: {
        providers: {
          'clawx-gemini-image': {
            apiKey: 'relay-key',
            // ClawX stores the same base URL for both image relays; the plugin
            // must rewrite the OpenAI-style `/v1` suffix to `/v1beta`.
            baseUrl: `http://127.0.0.1:${port}/v1`,
            request: { allowPrivateNetwork: true },
          },
        },
      },
    },
    agentDir: '/tmp/clawx-gemini-image-test-agent',
    ssrfPolicy: { dangerouslyAllowPrivateNetwork: true },
    ...overrides,
  };
}

const INLINE_IMAGE_PAYLOAD = {
  candidates: [
    {
      finishReason: 'STOP',
      content: {
        role: 'model',
        parts: [
          { text: 'here you go' },
          {
            inlineData: {
              mimeType: 'image/png',
              data: Buffer.from('fake-gemini-image').toString('base64'),
            },
          },
        ],
      },
    },
  ],
  modelVersion: 'gemini-3.1-flash-image',
};

describe('ClawX Gemini image plugin', () => {
  it('posts generateContent against /v1beta and maps size to imageConfig', async () => {
    await withRelay(() => ({ payload: INLINE_IMAGE_PAYLOAD }), async (provider, port, captures) => {
      await provider.generateImage(buildRequest(port, { size: '1792x1024' }));

      expect(captures).toHaveLength(1);
      expect(captures[0].url).toBe('/v1beta/models/gemini-3.1-flash-image:generateContent');
      expect(captures[0].authorization).toBe('Bearer relay-key');
      expect(captures[0].googApiKey).toBe('relay-key');
      expect(JSON.parse(captures[0].body)).toEqual({
        contents: [{ role: 'user', parts: [{ text: 'a watercolour tabby cat on a windowsill' }] }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: { aspectRatio: '16:9', imageSize: '2K' },
        },
      });
    });
  }, 15_000);

  it('parses inlineData parts into generated images', async () => {
    await withRelay(() => ({ payload: INLINE_IMAGE_PAYLOAD }), async (provider, port) => {
      const result = await provider.generateImage(buildRequest(port));

      expect(result.model).toBe('gemini-3.1-flash-image');
      expect(result.images).toHaveLength(1);
      expect(result.images[0].mimeType).toBe('image/png');
      expect(result.images[0].buffer.toString('utf8')).toBe('fake-gemini-image');
    });
  }, 15_000);

  it('sends reference images as inlineData parts before the prompt', async () => {
    await withRelay(() => ({ payload: INLINE_IMAGE_PAYLOAD }), async (provider, port, captures) => {
      await provider.generateImage(buildRequest(port, {
        inputImages: [{ buffer: Buffer.from('reference'), mimeType: 'image/jpeg' }],
      }));

      expect(JSON.parse(captures[0].body).contents[0].parts).toEqual([
        { inlineData: { mimeType: 'image/jpeg', data: Buffer.from('reference').toString('base64') } },
        { text: 'a watercolour tabby cat on a windowsill' },
      ]);
    });
  }, 15_000);

  it('reaches a private-network relay using only the provider request policy', async () => {
    // Internal relays (e.g. an on-prem gateway on 10.x) are blocked by the SSRF
    // guard unless the provider entry carries allowPrivateNetwork, which is what
    // syncOpenAiCompatibleImageRelay writes. No request-level ssrfPolicy here.
    await withRelay(() => ({ payload: INLINE_IMAGE_PAYLOAD }), async (provider, port) => {
      const req = buildRequest(port);
      delete req.ssrfPolicy;
      const result = await provider.generateImage(req);
      expect(result.images).toHaveLength(1);
    });
  }, 15_000);

  it('surfaces the Gemini finish reason when a refusal carries no image parts', async () => {
    const refusal = {
      candidates: [
        {
          content: { role: 'model' },
          finishReason: 'IMAGE_RECITATION',
          finishMessage: 'Unable to show the generated image. Try rephrasing the prompt.',
        },
      ],
    };

    await withRelay(() => ({ payload: refusal }), async (provider, port) => {
      await expect(provider.generateImage(buildRequest(port))).rejects.toThrow(
        /IMAGE_RECITATION: Unable to show the generated image/,
      );
    });
  }, 15_000);

  it('lets an explicit aspectRatio and resolution override the size-derived values', async () => {
    await withRelay(() => ({ payload: INLINE_IMAGE_PAYLOAD }), async (provider, port, captures) => {
      await provider.generateImage(buildRequest(port, {
        size: '1792x1024', // would derive aspectRatio 16:9 + imageSize 2K
        aspectRatio: '1:1',
        resolution: '4K',
      }));

      expect(JSON.parse(captures[0].body).generationConfig.imageConfig).toEqual({
        aspectRatio: '1:1',
        imageSize: '4K',
      });
    });
  }, 15_000);
});

describe('ClawX Gemini image plugin output format', () => {
  it('returns the PNG unchanged when no output format is requested', async () => {
    await withRelay(() => ({ payload: INLINE_IMAGE_PAYLOAD }), async (provider, port) => {
      const result = await provider.generateImage(buildRequest(port));

      expect(resizeToJpegMock).not.toHaveBeenCalled();
      expect(result.images[0].mimeType).toBe('image/png');
      expect(result.images[0].buffer.toString('utf8')).toBe('fake-gemini-image');
    });
  }, 15_000);

  it('transcodes to JPEG when outputFormat=jpeg, mapping quality and preserving resolution', async () => {
    await withRelay(() => ({ payload: INLINE_IMAGE_PAYLOAD }), async (provider, port) => {
      const result = await provider.generateImage(buildRequest(port, {
        outputFormat: 'jpeg',
        quality: 'high',
      }));

      expect(resizeToJpegMock).toHaveBeenCalledTimes(1);
      const call = resizeToJpegMock.mock.calls[0][0] as { buffer: Buffer; maxSide: number; quality: number };
      expect(call.buffer.toString('utf8')).toBe('fake-gemini-image');
      expect(call.quality).toBe(92); // high
      expect(call.maxSide).toBeGreaterThanOrEqual(4096); // never downscales real output
      expect(result.images[0].mimeType).toBe('image/jpeg');
      expect(result.images[0].fileName.endsWith('.jpg')).toBe(true);
      expect(result.images[0].buffer[0]).toBe(0xff);
      expect(result.images[0].buffer[1]).toBe(0xd8);
    });
  }, 15_000);

  it('keeps PNG when jpeg is requested together with a transparent background', async () => {
    await withRelay(() => ({ payload: INLINE_IMAGE_PAYLOAD }), async (provider, port) => {
      const result = await provider.generateImage(buildRequest(port, {
        outputFormat: 'jpeg',
        background: 'transparent',
      }));

      expect(resizeToJpegMock).not.toHaveBeenCalled();
      expect(result.images[0].mimeType).toBe('image/png');
    });
  }, 15_000);

  it('leaves webp requests as PNG (local transcoder cannot emit webp)', async () => {
    await withRelay(() => ({ payload: INLINE_IMAGE_PAYLOAD }), async (provider, port) => {
      const result = await provider.generateImage(buildRequest(port, { outputFormat: 'webp' }));

      expect(resizeToJpegMock).not.toHaveBeenCalled();
      expect(result.images[0].mimeType).toBe('image/png');
    });
  }, 15_000);

  it('falls back to the original PNG when transcoding fails', async () => {
    resizeToJpegMock.mockRejectedValueOnce(new Error('Unable to decode image'));
    await withRelay(() => ({ payload: INLINE_IMAGE_PAYLOAD }), async (provider, port) => {
      const result = await provider.generateImage(buildRequest(port, { outputFormat: 'jpeg' }));

      expect(result.images).toHaveLength(1);
      expect(result.images[0].mimeType).toBe('image/png');
      expect(result.images[0].buffer.toString('utf8')).toBe('fake-gemini-image');
    });
  }, 15_000);
});

describe('ClawX Gemini image plugin self-detection', () => {
  const MIXED_PROVIDERS = {
    // Runtime-generated keys never carry meaningful names; use a deliberately
    // opaque one to prove the plugin does not parse key names.
    'zzz-9f3a1c0d': { baseUrl: 'https://relay.example.com/v1', models: [{ id: 'gemini-3.1-flash-image' }] },
    'gptimage2-gptimage': { baseUrl: 'https://relay.example.com/v1', models: [{ id: 'gpt-image-2' }] },
    'minimax-portal': { baseUrl: 'https://api.minimaxi.com/anthropic', models: [{ id: 'image-01' }] },
    'someimagen-abc12345': { baseUrl: 'https://relay.example.com/v1', models: [{ id: 'imagen-4' }] },
    // A native image provider id must never be shadowed even if it happened to
    // carry a gemini-image model in this config.
    google: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', models: [{ id: 'gemini-3.1-flash-image' }] },
  };

  it('claims only provider keys that host a Gemini image model', async () => {
    const provider = await registerProvider({ models: { providers: MIXED_PROVIDERS } });

    expect(provider.aliases).toEqual(['zzz-9f3a1c0d']);
    expect(provider.models).toEqual(['gemini-3.1-flash-image']);
  });

  it('does not claim OpenAI, minimax, or Google-imagen provider keys', async () => {
    const provider = await registerProvider({ models: { providers: MIXED_PROVIDERS } });

    expect(provider.aliases).not.toContain('gptimage2-gptimage');
    expect(provider.aliases).not.toContain('minimax-portal');
    expect(provider.aliases).not.toContain('someimagen-abc12345');
    expect(provider.aliases).not.toContain('google');
  });

  it('resolves credentials by whatever key req.provider names, ignoring its shape', async () => {
    await withRelay(() => ({ payload: INLINE_IMAGE_PAYLOAD }), async (_provider, port) => {
      const provider = await registerProvider({
        models: { providers: { 'zzz-9f3a1c0d': { baseUrl: `http://127.0.0.1:${port}/v1` } } },
      });

      const result = await provider.generateImage(buildRequest(port, {
        provider: 'zzz-9f3a1c0d',
        cfg: {
          models: {
            providers: {
              'zzz-9f3a1c0d': { apiKey: 'relay-key', baseUrl: `http://127.0.0.1:${port}/v1` },
            },
          },
        },
      }));

      expect(result.images).toHaveLength(1);
    });
  }, 15_000);

  it('registers no aliases when config is unavailable', async () => {
    const provider = await registerProvider(undefined);
    expect(provider.aliases).toEqual([]);
  });
});
