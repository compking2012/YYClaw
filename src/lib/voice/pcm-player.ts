/**
 * Streaming PCM16 player for realtime Talk output audio.
 *
 * The gateway-relay realtime session streams assistant audio back as base64
 * PCM16 chunks (`output.audio.delta` events) at the session's output sample
 * rate. This schedules each chunk back-to-back on a single AudioContext
 * timeline so playback is gapless, and supports an immediate `clear()` for
 * barge-in (user interrupts the assistant).
 */
import { base64ToBytes, pcm16BytesToFloat32 } from './encoding';

export class PcmStreamPlayer {
  private audioContext: AudioContext | null = null;
  private readonly sampleRate: number;
  private nextStartTime = 0;
  private active = new Set<AudioBufferSourceNode>();

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  private ensureContext(): AudioContext {
    if (!this.audioContext) {
      type WebkitAudioWindow = Window & { webkitAudioContext?: typeof AudioContext };
      const Ctor = window.AudioContext || (window as WebkitAudioWindow).webkitAudioContext;
      this.audioContext = new Ctor({ sampleRate: this.sampleRate });
    }
    return this.audioContext;
  }

  /** Enqueue a base64 PCM16 chunk for gapless playback. */
  enqueue(base64: string): void {
    const ctx = this.ensureContext();
    const float = pcm16BytesToFloat32(base64ToBytes(base64));
    if (float.length === 0) return;

    const buffer = ctx.createBuffer(1, float.length, this.sampleRate);
    buffer.getChannelData(0).set(float);
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(ctx.destination);

    const now = ctx.currentTime;
    const startAt = Math.max(now, this.nextStartTime);
    node.start(startAt);
    this.nextStartTime = startAt + buffer.duration;

    this.active.add(node);
    node.onended = () => this.active.delete(node);
  }

  /** Stop and discard all queued audio immediately (barge-in). */
  clear(): void {
    for (const node of this.active) {
      try {
        node.onended = null;
        node.stop();
        node.disconnect();
      } catch {
        // ignore
      }
    }
    this.active.clear();
    this.nextStartTime = this.audioContext?.currentTime ?? 0;
  }

  /** Tear down the player entirely. */
  dispose(): void {
    this.clear();
    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }
  }
}
