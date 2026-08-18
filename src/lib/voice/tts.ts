/**
 * Text-to-speech playback for chat replies.
 *
 * Calls the Main-process voice route, which invokes the kernel's `tts.convert`
 * and returns the synthesized audio bytes (base64). The renderer plays them via
 * a Blob URL. Used by the per-message play button and the optional auto-read.
 */
import { hostApi } from '@/lib/host-api';

interface TtsAudioResponse {
  success: boolean;
  base64?: string;
  mimeType?: string;
  error?: string;
}

export interface TtsPlaybackHandle {
  stop: () => void;
  done: Promise<void>;
}

/** Strip markdown noise that reads poorly aloud and cap very long text. */
export function sanitizeForTts(text: string, maxChars = 4000): string {
  let out = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_#>~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (out.length > maxChars) out = out.slice(0, maxChars);
  return out;
}

export async function synthesizeAndPlay(params: {
  text: string;
  provider?: string;
  voiceId?: string;
  modelId?: string;
}): Promise<TtsPlaybackHandle> {
  const res = await hostApi.voice.ttsAudio({
    text: params.text,
    provider: params.provider,
    voiceId: params.voiceId,
    modelId: params.modelId,
  }) as TtsAudioResponse;
  if (!res.success || !res.base64) {
    throw new Error(res.error || 'TTS synthesis failed');
  }

  const binary = atob(res.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: res.mimeType || 'audio/mpeg' });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);

  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const cleanup = () => {
    URL.revokeObjectURL(url);
    resolveDone();
  };
  audio.onended = cleanup;
  audio.onerror = cleanup;

  await audio.play().catch((error) => {
    cleanup();
    throw error instanceof Error ? error : new Error(String(error));
  });

  return {
    stop: () => {
      audio.pause();
      audio.currentTime = 0;
      cleanup();
    },
    done,
  };
}
