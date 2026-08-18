import { definePluginEntry } from 'openclaw/plugin-sdk/core';
import { isProviderApiKeyConfigured } from 'openclaw/plugin-sdk/provider-auth';
import { resolveApiKeyForProvider } from 'openclaw/plugin-sdk/provider-auth-runtime';
import {
  assertOkOrThrowHttpError,
  postJsonRequest,
  readProviderJsonResponse,
  resolveProviderHttpRequestConfig,
  sanitizeConfiguredModelProviderRequest,
} from 'openclaw/plugin-sdk/provider-http';
import {
  generatedImageAssetFromBase64,
  resolveInlineImageJsonResponseMaxBytes,
} from 'openclaw/plugin-sdk/image-generation';
import { resizeToJpeg } from 'openclaw/plugin-sdk/media-runtime';

const PROVIDER_ID = 'clawx-gemini-image';
const FALLBACK_MODEL = 'gemini-3.1-flash-image';
const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_OUTPUT_MIME = 'image/png';
const MAX_IMAGE_RESULTS = 4;
const MAX_INPUT_IMAGES = 5;
const DEFAULT_TIMEOUT_MS = 180_000;
const FALLBACK_MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MB = 1024 * 1024;

/**
 * Gemini's `generateContent` returns lossless PNG only — it has no request-side
 * output-format/compression control. When the caller asks for JPEG via natural
 * language (`req.outputFormat`), we transcode the returned PNG locally so the
 * saved file honors the request (and stays far smaller at 2K/4K). `maxSide` is
 * set huge so we only re-encode, never downscale — resolution stays as asked.
 */
const NO_RESIZE_MAX_SIDE = 100_000;
const JPEG_QUALITY_BY_ENUM = { low: 60, medium: 80, high: 92, auto: 85 };

function normalizeOutputFormat(value) {
  const v = trimmedString(value)?.toLowerCase();
  return v === 'png' || v === 'jpeg' || v === 'webp' ? v : undefined;
}

function jpegQualityFromRequest(quality) {
  const key = trimmedString(quality)?.toLowerCase();
  return (key && JPEG_QUALITY_BY_ENUM[key]) || JPEG_QUALITY_BY_ENUM.auto;
}

function replaceFileExtension(fileName, ext) {
  const base = trimmedString(fileName) ?? `clawx-gemini-image.${ext}`;
  return base.includes('.') ? base.replace(/\.[^.]+$/u, `.${ext}`) : `${base}.${ext}`;
}

/** Re-encodes generated PNGs to JPEG, preserving resolution. Re-encoding is
 * best-effort: if the local image processor can't decode/encode the bytes for
 * any reason, we keep the original PNG rather than fail an otherwise-successful
 * generation. */
async function encodeImagesToJpeg(images, quality) {
  const encoded = [];
  for (const image of images) {
    try {
      const buffer = await resizeToJpeg({ buffer: image.buffer, maxSide: NO_RESIZE_MAX_SIDE, quality });
      encoded.push({
        ...image,
        buffer,
        mimeType: 'image/jpeg',
        fileName: replaceFileExtension(image.fileName, 'jpg'),
      });
    } catch {
      encoded.push(image);
    }
  }
  return encoded;
}

/**
 * OpenClaw provider ids that already register an image-generation provider.
 * Never claim these as aliases — doing so would shadow the native providers.
 * Keep in sync with `NATIVE_IMAGE_GENERATION_PROVIDER_IDS` in
 * `electron/utils/openclaw-image-relay-constants.ts` (a unit test asserts this).
 */
const NATIVE_IMAGE_GENERATION_PROVIDER_IDS = new Set([
  'openai',
  'google',
  'minimax',
  'minimax-portal',
  'litellm',
  'comfy',
  'fal',
  'openrouter',
  'vydra',
  'xai',
  'microsoft-foundry',
]);

/**
 * This plugin owns exactly one model family. The model that runs is already
 * fixed by `imageGenerationModel.primary`, so the model id alone decides the
 * wire protocol — nothing is probed. Other families (minimax `image-01`,
 * Google `imagen-*`, …) are left to OpenClaw's built-in image providers.
 *
 * Keep in sync with `isGeminiImageModel` in
 * `electron/utils/openclaw-image-relay-constants.ts`.
 */
export function isGeminiImageModel(modelId) {
  const id = String(modelId ?? '').trim().toLowerCase();
  return id.includes('gemini') && id.includes('image');
}

const SUPPORTED_SIZES = [
  '1024x1024',
  '1024x1536',
  '1536x1024',
  '1024x1792',
  '1792x1024',
];
const SUPPORTED_ASPECT_RATIOS = [
  '1:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
];
const SUPPORTED_RESOLUTIONS = ['1K', '2K', '4K'];
const SIZE_TO_ASPECT_RATIO = new Map([
  ['1024x1024', '1:1'],
  ['1024x1536', '2:3'],
  ['1536x1024', '3:2'],
  ['1024x1792', '9:16'],
  ['1792x1024', '16:9'],
]);

const MALFORMED_RESPONSE = 'ClawX Gemini image generation response malformed';

function trimmedString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Model ids declared by a `models.providers` entry (`string[]` or `{id}[]`). */
export function readModelIds(entry) {
  const models = isRecord(entry) ? entry.models : undefined;
  if (!Array.isArray(models)) return [];
  const ids = [];
  for (const model of models) {
    const id = typeof model === 'string' ? trimmedString(model) : trimmedString(isRecord(model) ? model.id : undefined);
    if (id) ids.push(id);
  }
  return ids;
}

/**
 * Provider keys this plugin serves, discovered from config.
 *
 * The keys themselves are generated by `getOpenClawProviderKeyForType`
 * (e.g. `gptimage2-gptimage`), so a plugin cannot know their names ahead of
 * time and must never parse them. We therefore look the other way round: find
 * the entries that host a model of *our* family. The judgement is on model ids,
 * never on key names.
 */
export function collectClaimedProviderKeys(providers) {
  const claimed = new Map();
  for (const [key, entry] of Object.entries(isRecord(providers) ? providers : {})) {
    if (NATIVE_IMAGE_GENERATION_PROVIDER_IDS.has(key.trim().toLowerCase())) continue;
    const familyModels = readModelIds(entry).filter(isGeminiImageModel);
    if (familyModels.length > 0) claimed.set(key, familyModels);
  }
  return claimed;
}

/**
 * Accepts whatever the account/relay entry holds (`https://host`,
 * `https://host/v1`, `https://host/v1beta`) and always lands on the
 * Gemini-native `/v1beta` surface — ClawX writes one base URL per account and
 * the OpenAI-style `/v1` suffix must be rewritten rather than rejected.
 */
export function normalizeGeminiBaseUrl(value, fallback = DEFAULT_BASE_URL) {
  const trimmed = trimmedString(value) ?? fallback;
  const withoutTrailingSlash = trimmed.replace(/\/+$/u, '');
  if (!withoutTrailingSlash) return DEFAULT_BASE_URL;
  const root = withoutTrailingSlash.replace(/\/v1beta$/u, '').replace(/\/v1$/u, '');
  return `${root || withoutTrailingSlash}/v1beta`;
}

/** Maps an OpenAI-style `WxH` size onto Gemini's `imageConfig`. */
export function mapSizeToImageConfig(size) {
  const trimmed = trimmedString(size);
  if (!trimmed) return undefined;
  const normalized = trimmed.toLowerCase();
  const aspectRatio = SIZE_TO_ASPECT_RATIO.get(normalized);
  const [widthRaw, heightRaw] = normalized.split('x');
  const width = Number.parseInt(widthRaw ?? '', 10);
  const height = Number.parseInt(heightRaw ?? '', 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return aspectRatio ? { aspectRatio } : undefined;
  }
  const longestEdge = Math.max(width, height);
  const imageSize = longestEdge >= 3072 ? '4K' : longestEdge >= 1536 ? '2K' : undefined;
  if (!aspectRatio && !imageSize) return undefined;
  return {
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(imageSize ? { imageSize } : {}),
  };
}

function resolveGeneratedImageMaxBytes(cfg) {
  const configured = cfg?.agents?.defaults?.mediaMaxMb;
  if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured * MB);
  }
  return FALLBACK_MAX_IMAGE_BYTES;
}

function responseCandidates(payload) {
  if (!isRecord(payload)) throw new Error(MALFORMED_RESPONSE);
  const candidates = payload.candidates;
  if (candidates === undefined || candidates === null) return [];
  if (!Array.isArray(candidates)) throw new Error(MALFORMED_RESPONSE);
  return candidates;
}

function candidateParts(candidate) {
  if (!isRecord(candidate)) throw new Error(MALFORMED_RESPONSE);
  const content = candidate.content;
  if (content === undefined || content === null) return [];
  if (!isRecord(content)) throw new Error(MALFORMED_RESPONSE);
  const parts = content.parts;
  if (parts === undefined || parts === null) return [];
  if (!Array.isArray(parts)) throw new Error(MALFORMED_RESPONSE);
  return parts;
}

function inlineDataFromPart(part) {
  if (!isRecord(part)) throw new Error(MALFORMED_RESPONSE);
  const inline = part.inlineData ?? part.inline_data;
  if (inline === undefined || inline === null) return undefined;
  if (!isRecord(inline)) throw new Error(MALFORMED_RESPONSE);
  return inline;
}

/**
 * Gemini answers a refused image with HTTP 200, an empty `content`, and a
 * `finishReason` such as `IMAGE_RECITATION`. Surfacing that beats the generic
 * "missing image data" error the built-in provider reports.
 */
export function describeMissingImageFailure(payload) {
  const details = [];
  for (const candidate of isRecord(payload) && Array.isArray(payload.candidates) ? payload.candidates : []) {
    if (!isRecord(candidate)) continue;
    const detail = [trimmedString(candidate.finishReason), trimmedString(candidate.finishMessage)]
      .filter(Boolean)
      .join(': ');
    if (detail) details.push(detail);
  }
  const blockReason = isRecord(payload) && isRecord(payload.promptFeedback)
    ? trimmedString(payload.promptFeedback.blockReason)
    : undefined;
  if (blockReason) details.push(`blockReason: ${blockReason}`);
  return details.length > 0
    ? `ClawX Gemini image generation returned no image (${details.join('; ')})`
    : 'ClawX Gemini image generation response missing image data';
}

function buildProvider(claimed) {
  const aliases = [...claimed.keys()];
  const models = [...new Set([...claimed.values()].flat())];

  return {
    id: PROVIDER_ID,
    aliases,
    label: 'ClawX Gemini Image',
    defaultModel: models[0] ?? FALLBACK_MODEL,
    models: models.length > 0 ? models : [FALLBACK_MODEL],
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
    isConfigured: ({ agentDir }) => aliases.some((key) => isProviderApiKeyConfigured({
      provider: key,
      agentDir,
    })),
    capabilities: {
      generate: {
        maxCount: MAX_IMAGE_RESULTS,
        supportsSize: true,
        supportsAspectRatio: true,
        supportsResolution: true,
      },
      edit: {
        enabled: true,
        maxCount: MAX_IMAGE_RESULTS,
        maxInputImages: MAX_INPUT_IMAGES,
        supportsSize: true,
        supportsAspectRatio: true,
        supportsResolution: true,
      },
      geometry: {
        sizes: [...SUPPORTED_SIZES],
        aspectRatios: [...SUPPORTED_ASPECT_RATIOS],
        resolutions: [...SUPPORTED_RESOLUTIONS],
      },
    },
    async generateImage(req) {
      const inputImages = req.inputImages ?? [];
      const isEdit = inputImages.length > 0;
      if (isEdit && inputImages.length > MAX_INPUT_IMAGES) {
        throw new Error(
          `ClawX Gemini image editing supports up to ${MAX_INPUT_IMAGES} reference images.`,
        );
      }

      // The requested provider key — whatever it is called. Everything below is
      // derived from it, so a regenerated or renamed key needs no code change.
      const providerKey = trimmedString(req.provider) ?? PROVIDER_ID;
      const providerConfig = req.cfg?.models?.providers?.[providerKey];
      if (!isRecord(providerConfig)) {
        throw new Error(
          `ClawX Gemini image generation has no models.providers entry for "${providerKey}"`,
        );
      }

      const auth = await resolveApiKeyForProvider({
        provider: providerKey,
        cfg: req.cfg,
        agentDir: req.agentDir,
        store: req.authStore,
      });
      if (!auth?.apiKey) throw new Error(`ClawX Gemini image API key missing for "${providerKey}"`);

      const request = sanitizeConfiguredModelProviderRequest(providerConfig.request);
      const { baseUrl, allowPrivateNetwork, headers, dispatcherPolicy } = resolveProviderHttpRequestConfig({
        baseUrl: normalizeGeminiBaseUrl(providerConfig.baseUrl),
        defaultBaseUrl: DEFAULT_BASE_URL,
        // On-prem relays resolve to private IPs; without this the SSRF guard
        // rejects the request outright.
        allowPrivateNetwork: request?.allowPrivateNetwork,
        request,
        // Relays accept either header; sending both also keeps the provider
        // usable against the official Gemini endpoint.
        defaultHeaders: {
          Authorization: `Bearer ${auth.apiKey}`,
          'x-goog-api-key': auth.apiKey,
        },
        provider: providerKey,
        capability: 'image',
        transport: 'http',
      });
      headers.set('Content-Type', 'application/json');

      const model = trimmedString(req.model) ?? FALLBACK_MODEL;
      const imageConfig = {
        ...(mapSizeToImageConfig(req.size) ?? {}),
        ...(trimmedString(req.aspectRatio) ? { aspectRatio: trimmedString(req.aspectRatio) } : {}),
        ...(req.resolution ? { imageSize: req.resolution } : {}),
      };
      const parts = [
        ...inputImages.map((image) => ({
          inlineData: {
            mimeType: image.mimeType || DEFAULT_OUTPUT_MIME,
            data: image.buffer.toString('base64'),
          },
        })),
        { text: req.prompt },
      ];

      const { response, release } = await postJsonRequest({
        url: `${baseUrl}/models/${model}:generateContent`,
        headers,
        body: {
          contents: [{ role: 'user', parts }],
          generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            ...(Object.keys(imageConfig).length > 0 ? { imageConfig } : {}),
          },
        },
        timeoutMs: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        fetchFn: fetch,
        pinDns: false,
        allowPrivateNetwork,
        ssrfPolicy: req.ssrfPolicy,
        dispatcherPolicy,
      });

      try {
        await assertOkOrThrowHttpError(
          response,
          isEdit ? 'ClawX Gemini image edit failed' : 'ClawX Gemini image generation failed',
        );
        const payload = await readProviderJsonResponse(response, `${PROVIDER_ID}.image-generation`, {
          maxBytes: resolveInlineImageJsonResponseMaxBytes(
            MAX_IMAGE_RESULTS,
            resolveGeneratedImageMaxBytes(req.cfg),
          ),
        });

        const images = [];
        for (const candidate of responseCandidates(payload)) {
          for (const part of candidateParts(candidate)) {
            const inline = inlineDataFromPart(part);
            if (!inline) continue;
            const data = trimmedString(inline.data);
            if (!data) throw new Error(MALFORMED_RESPONSE);
            const image = generatedImageAssetFromBase64({
              base64: data,
              index: images.length,
              mimeType: trimmedString(inline.mimeType)
                ?? trimmedString(inline.mime_type)
                ?? DEFAULT_OUTPUT_MIME,
              fileNamePrefix: 'clawx-gemini-image',
            });
            if (!image) throw new Error(MALFORMED_RESPONSE);
            images.push(image);
          }
        }

        if (images.length === 0) throw new Error(describeMissingImageFailure(payload));

        // Gemini only emits PNG. Honor an explicit `outputFormat: 'jpeg'` by
        // transcoding locally. `webp` isn't supported by the local processor, so
        // it falls through as PNG. Never transcode to JPEG when transparency is
        // requested — JPEG has no alpha channel.
        const outputFormat = normalizeOutputFormat(req.outputFormat);
        const wantsTransparent = trimmedString(req.background)?.toLowerCase() === 'transparent';
        const finalImages = outputFormat === 'jpeg' && !wantsTransparent
          ? await encodeImagesToJpeg(images, jpegQualityFromRequest(req.quality))
          : images;

        return { images: finalImages, model };
      } finally {
        await release();
      }
    },
  };
}

export const pluginEntry = definePluginEntry({
  id: PROVIDER_ID,
  name: 'ClawX Gemini Image',
  description: 'Gemini-native (generateContent) image generation for ClawX-configured relays.',
  register(api) {
    api.registerImageGenerationProvider(buildProvider(collectClaimedProviderKeys(api.config?.models?.providers)));
  },
});

export default pluginEntry;
