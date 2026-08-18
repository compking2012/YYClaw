/**
 * Dictation (speech-to-text) via batch transcription.
 *
 * Captures mic audio as raw PCM (Web Audio), encodes it to a 16 kHz mono WAV in
 * the renderer, then POSTs it to the Main-process `/api/voice/transcribe` route,
 * which calls the configured provider's HTTP `/v1/audio/transcriptions` endpoint
 * (honors the provider baseUrl, e.g. aiserver).
 *
 * WAV is used rather than MediaRecorder's webm/opus because some
 * OpenAI-compatible servers cannot read a webm clip's duration (no full EBML
 * parser) and reject it with "error getting audio duration". A WAV header
 * carries an explicit sample count, so duration is always parseable.
 *
 * This intentionally does NOT use the OpenClaw realtime Talk transcription path,
 * whose OpenAI provider hardcodes `wss://api.openai.com` and cannot be
 * redirected to a custom base URL.
 */
import { hostApi } from '@/lib/host-api';
import { encodeWav, bytesToBase64 } from './encoding';

export type DictationState = 'recording' | 'transcribing';

export interface DictationCallbacks {
  onState?: (state: DictationState) => void;
  /** Final transcript text (empty string if nothing recognized). */
  onFinal?: (text: string) => void;
  onError?: (error: Error) => void;
  /** Optional BCP-47 language hint (e.g. "zh"). */
  language?: string;
}

export interface DictationHandle {
  /** Stop recording, transcribe, and resolve after onFinal/onError fired. */
  stop: () => Promise<void>;
  /** Abort recording without transcribing. */
  cancel: () => void;
}

const TARGET_SAMPLE_RATE = 16000;

type WebkitAudioWindow = Window & { webkitAudioContext?: typeof AudioContext };

export async function startDictation(callbacks: DictationCallbacks): Promise<DictationHandle> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });

  const Ctor = window.AudioContext || (window as WebkitAudioWindow).webkitAudioContext;
  const audioContext = new Ctor();
  const inputRate = audioContext.sampleRate;
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  // Route through a muted gain so the ScriptProcessor fires without echoing
  // the mic to the speakers.
  const mute = audioContext.createGain();
  mute.gain.value = 0;

  const frames: Float32Array[] = [];
  let totalSamples = 0;
  let cancelled = false;

  processor.onaudioprocess = (event) => {
    const channel = event.inputBuffer.getChannelData(0);
    frames.push(new Float32Array(channel));
    totalSamples += channel.length;
  };

  source.connect(processor);
  processor.connect(mute);
  mute.connect(audioContext.destination);

  const teardown = () => {
    try {
      processor.disconnect();
      source.disconnect();
      mute.disconnect();
    } catch {
      // ignore
    }
    for (const track of stream.getTracks()) track.stop();
    void audioContext.close();
  };

  const stop = async () => {
    processor.onaudioprocess = null;
    teardown();
    if (cancelled) return;
    try {
      if (totalSamples === 0) {
        callbacks.onError?.(new Error('No audio captured'));
        return;
      }
      const merged = new Float32Array(totalSamples);
      let offset = 0;
      for (const frame of frames) {
        merged.set(frame, offset);
        offset += frame.length;
      }
      callbacks.onState?.('transcribing');
      const wav = encodeWav(merged, inputRate, TARGET_SAMPLE_RATE);
      const res = await hostApi.voice.transcribe({
        audioBase64: bytesToBase64(wav),
        mimeType: 'audio/wav',
        language: callbacks.language,
      }) as { success: boolean; text?: string; error?: string };
      if (!res.success) throw new Error(res.error || 'Transcription failed');
      callbacks.onFinal?.((res.text ?? '').trim());
    } catch (error) {
      callbacks.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  };

  callbacks.onState?.('recording');

  return {
    stop,
    cancel: () => {
      cancelled = true;
      processor.onaudioprocess = null;
      teardown();
    },
  };
}
