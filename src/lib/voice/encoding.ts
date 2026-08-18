/**
 * Audio encoding helpers for voice capture/playback.
 *
 * The OpenClaw Talk gateway-relay expects specific input encodings:
 *  - transcription (STT): G.711 µ-law, 8 kHz, mono
 *  - realtime: typically PCM16, 24 kHz, mono
 * (the session-create response carries the authoritative `audio.inputEncoding`
 * and `inputSampleRateHz`).
 *
 * Browsers capture Float32 PCM at the AudioContext sample rate (usually 48 kHz),
 * so we downsample and re-encode here. All functions are pure and unit-tested.
 */

export type VoiceEncoding = 'g711_ulaw' | 'pcm16';

/** Linear-interpolation downsample of mono Float32 PCM from inRate to outRate. */
export function downsampleFloat32(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (outRate >= inRate || input.length === 0) {
    return input;
  }
  const ratio = inRate / outRate;
  const outLength = Math.floor(input.length / ratio);
  const output = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const srcPos = i * ratio;
    const left = Math.floor(srcPos);
    const right = Math.min(left + 1, input.length - 1);
    const frac = srcPos - left;
    output[i] = input[left] * (1 - frac) + input[right] * frac;
  }
  return output;
}

/** Convert Float32 [-1, 1] PCM to signed 16-bit little-endian bytes. */
export function floatToPcm16Bytes(input: Float32Array): Uint8Array {
  const out = new Uint8Array(input.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < input.length; i += 1) {
    let s = input[i];
    s = s < -1 ? -1 : s > 1 ? 1 : s;
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return out;
}

const ULAW_BIAS = 0x84;
const ULAW_CLIP = 32635;

/** Encode a single 16-bit PCM sample to a G.711 µ-law byte. */
export function pcm16SampleToUlaw(sample: number): number {
  let sign = (sample >> 8) & 0x80;
  if (sign !== 0) sample = -sample;
  if (sample > ULAW_CLIP) sample = ULAW_CLIP;
  sample += ULAW_BIAS;

  let exponent = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exponent > 0; mask >>= 1) {
    exponent -= 1;
  }
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  const ulaw = ~(sign | (exponent << 4) | mantissa);
  return ulaw & 0xff;
}

/** Convert Float32 [-1, 1] PCM to G.711 µ-law bytes. */
export function floatToUlawBytes(input: Float32Array): Uint8Array {
  const out = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    let s = input[i];
    s = s < -1 ? -1 : s > 1 ? 1 : s;
    const pcm = s < 0 ? s * 0x8000 : s * 0x7fff;
    out[i] = pcm16SampleToUlaw(pcm | 0);
  }
  return out;
}

/** Downsample + encode a Float32 mono frame to the wire bytes for `encoding`. */
export function encodeFrame(
  frame: Float32Array,
  inRate: number,
  outRate: number,
  encoding: VoiceEncoding,
): Uint8Array {
  const resampled = downsampleFloat32(frame, inRate, outRate);
  return encoding === 'g711_ulaw' ? floatToUlawBytes(resampled) : floatToPcm16Bytes(resampled);
}

/** Root-mean-square level of a Float32 frame (0..1), for mic-level UI. */
export function frameRms(frame: Float32Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) {
    sum += frame[i] * frame[i];
  }
  return Math.sqrt(sum / frame.length);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Decode signed 16-bit little-endian PCM bytes to Float32 [-1, 1]. */
export function pcm16BytesToFloat32(bytes: Uint8Array): Float32Array {
  const sampleCount = Math.floor(bytes.length / 2);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Float32Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    out[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return out;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
}

/**
 * Encode mono Float32 PCM as a 16-bit WAV file (RIFF) at `targetRate`,
 * downsampling from `inputRate` first. A WAV header carries an explicit sample
 * count, so servers can read the clip duration without a full container parser
 * (unlike MediaRecorder's webm, which lacks duration metadata).
 */
export function encodeWav(input: Float32Array, inputRate: number, targetRate = 16000): Uint8Array {
  const samples = downsampleFloat32(input, inputRate, targetRate);
  const rate = targetRate >= inputRate ? inputRate : targetRate;
  const pcm = floatToPcm16Bytes(samples);
  const dataSize = pcm.length;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, 1, true); // channels = mono
  view.setUint32(24, rate, true); // sample rate
  view.setUint32(28, rate * 2, true); // byte rate = rate * blockAlign
  view.setUint16(32, 2, true); // block align = channels * bytesPerSample
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, 44).set(pcm);
  return new Uint8Array(buffer);
}

