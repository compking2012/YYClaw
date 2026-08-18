/**
 * Microphone capture pipeline shared by dictation (STT) and realtime conversation.
 *
 * Uses an AudioContext + ScriptProcessorNode to obtain raw Float32 PCM, then
 * downsamples and encodes each frame to the wire format the Talk session
 * requested (`g711_ulaw`/8 kHz for transcription, `pcm16`/24 kHz for realtime),
 * emitting ~`chunkMs` base64 chunks.
 *
 * ScriptProcessorNode is used (rather than AudioWorklet) for simplicity and
 * reliable behavior inside the Electron/Chromium renderer without a separately
 * bundled worklet module.
 */
import { encodeFrame, frameRms, bytesToBase64, type VoiceEncoding } from './encoding';

export interface CaptureOptions {
  encoding: VoiceEncoding;
  targetSampleRate: number;
  /** Approximate emit interval in ms (default 100). */
  chunkMs?: number;
  onChunk: (base64: string) => void;
  onLevel?: (rms: number) => void;
  onError?: (error: Error) => void;
}

export interface CaptureHandle {
  stop: () => void;
  /** Mute uplink (stops emitting chunks) without tearing down the mic. */
  setMuted: (muted: boolean) => void;
}

export async function startCapture(opts: CaptureOptions): Promise<CaptureHandle> {
  const chunkMs = opts.chunkMs ?? 100;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });

  type WebkitAudioWindow = Window & { webkitAudioContext?: typeof AudioContext };
  const Ctor = window.AudioContext || (window as WebkitAudioWindow).webkitAudioContext;
  const audioContext = new Ctor();
  const inRate = audioContext.sampleRate;
  const source = audioContext.createMediaStreamSource(stream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);

  let muted = false;
  let pending: Float32Array[] = [];
  let pendingSamples = 0;
  const samplesPerChunk = Math.round((inRate * chunkMs) / 1000);

  const flush = () => {
    if (pendingSamples === 0) return;
    const merged = new Float32Array(pendingSamples);
    let offset = 0;
    for (const part of pending) {
      merged.set(part, offset);
      offset += part.length;
    }
    pending = [];
    pendingSamples = 0;
    try {
      const bytes = encodeFrame(merged, inRate, opts.targetSampleRate, opts.encoding);
      opts.onChunk(bytesToBase64(bytes));
    } catch (error) {
      opts.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  };

  processor.onaudioprocess = (event: AudioProcessingEvent) => {
    const channel = event.inputBuffer.getChannelData(0);
    if (opts.onLevel) opts.onLevel(frameRms(channel));
    if (muted) return;
    pending.push(new Float32Array(channel));
    pendingSamples += channel.length;
    if (pendingSamples >= samplesPerChunk) {
      flush();
    }
  };

  source.connect(processor);
  // ScriptProcessorNode only fires while connected to a destination.
  processor.connect(audioContext.destination);

  const stop = () => {
    try {
      processor.disconnect();
      source.disconnect();
    } catch {
      // ignore
    }
    for (const track of stream.getTracks()) track.stop();
    void audioContext.close();
  };

  return {
    stop,
    setMuted: (m: boolean) => {
      muted = m;
    },
  };
}
