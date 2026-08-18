export type ModelKind = 'text' | 'image' | 'image_generate' | 'music_generate' | 'video_generate' | 'tts' | 'transcription' | 'realtime';

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

/** Voice capability kinds, parallel to OpenClaw's speech/streaming/realtime config sections. */
export const VOICE_MODEL_KINDS: ModelKind[] = ['tts', 'transcription', 'realtime'];

/** True when a single kind is a voice capability (tts / transcription / realtime). */
export function isVoiceKind(kind: string): kind is 'tts' | 'transcription' | 'realtime' {
  return (VOICE_MODEL_KINDS as string[]).includes(kind);
}

/** Extra per-kind model params (currently voice kinds), keyed by ModelKind. */
export type ModelParamsByKind = Partial<Record<ModelKind, Record<string, string | number | boolean>>>;

/**
 * Normalizes an unknown modelType array into an array of ModelKind.
 * Ensures the result is unique, valid, and at least contains 'text'.
 */
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

  // Fallback to text if nothing is valid or the array was empty of valid types
  if (result.size === 0) {
    result.add('text');
  } else if (!result.has('text')) {
    // Requirements: Ensure at least contains 'text'
    // "保证至少含 text（若业务上希望「仅生图不含 text」可再议；当前按「缺省=纯文本」语义，空/缺省为 `['text']`"
    // Actually, maybe we only want to inject 'text' if they want a fallback. The plan says: "校验非法值、去重、保证至少含 text... 当前按缺省=纯文本语义，空/缺省为 ['text']". 
    // Let's add 'text' for all models for now to be safe, as text is universally assumed unless specified otherwise, but wait. If it explicitly only provides 'image_generate', we might want to keep it as only 'image_generate'.
    // The plan: "保证至少含 text（若业务上希望「仅生图不含 text」可再议；当前按「缺省=纯文本」语义，空/缺省为 `['text']`）" -> it implies empty/missing defaults to text. But if it's explicitly ['image_generate'], should it add 'text'?
    // Let's just always add 'text' if we want to ensure text is present, but maybe it's better to just use what's valid. If it has 'image_generate', it may not be a 'text' model. Let's strictly follow "保证至少含 text" as instructed.
    result.add('text');
  }

  return Array.from(result);
}
