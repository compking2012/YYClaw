/**
 * Built-in voice runtimes for this release.
 *
 * Voice params (tts voice/format/speed, minimax voiceId/vol/pitch …) are no
 * longer configured per-provider in providers.json (`kindParamsSchema`) nor
 * edited in the UI. Instead they are baked in here, keyed by the kernel-side
 * voice provider id (`voiceRuntimeProviderId`). Only `openai` and `minimax`
 * are supported for now. The provider definition only needs to declare which
 * runtime it maps to via `voiceRuntimeProviderId`.
 */
import type { ModelKind } from '../shared/providers/model-kind';

export type VoiceRuntimeId = 'openai' | 'minimax';

/** True when `id` is a voice runtime we ship built-in support for. */
export function isSupportedVoiceRuntime(id: string | null | undefined): id is VoiceRuntimeId {
  return id === 'openai' || id === 'minimax';
}

/**
 * Built-in default voice params per runtime + kind. Values mirror the defaults
 * previously declared in providers.json `kindParamsSchema`, so behavior is
 * unchanged — they are just no longer user-configurable for this release.
 */
const VOICE_RUNTIME_PARAMS: Record<VoiceRuntimeId, Partial<Record<ModelKind, Record<string, string | number>>>> = {
  openai: {
    tts: { voice: 'alloy', responseFormat: 'mp3', speed: 1 },
    transcription: {},
    realtime: { voice: 'alloy' },
  },
  minimax: {
    tts: { voiceId: 'English_expressive_narrator', speed: 1, vol: 1, pitch: 0, format: 'mp3', sampleRate: 32000 },
  },
};

/** Built-in voice params for one runtime + kind (fresh object; safe to spread/mutate). */
export function getVoiceRuntimeParams(runtime: VoiceRuntimeId, kind: ModelKind): Record<string, string | number> {
  return { ...(VOICE_RUNTIME_PARAMS[runtime]?.[kind] ?? {}) };
}
