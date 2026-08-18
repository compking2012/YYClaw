import { describe, expect, it } from 'vitest';
import {
  downsampleFloat32,
  floatToPcm16Bytes,
  pcm16SampleToUlaw,
  floatToUlawBytes,
  encodeFrame,
  frameRms,
  bytesToBase64,
  base64ToBytes,
  pcm16BytesToFloat32,
  encodeWav,
} from '@/lib/voice/encoding';

describe('voice/encoding', () => {
  it('downsamples 48k to 8k by ~1/6 length', () => {
    const input = new Float32Array(48);
    const out = downsampleFloat32(input, 48000, 8000);
    expect(out.length).toBe(8);
  });

  it('returns input unchanged when target rate >= input rate', () => {
    const input = new Float32Array([0.1, 0.2]);
    expect(downsampleFloat32(input, 8000, 16000)).toBe(input);
  });

  it('encodes Float32 to PCM16 little-endian bytes', () => {
    const bytes = floatToPcm16Bytes(new Float32Array([0, 1, -1]));
    expect(bytes.length).toBe(6);
    const view = new DataView(bytes.buffer);
    expect(view.getInt16(0, true)).toBe(0);
    expect(view.getInt16(2, true)).toBe(0x7fff);
    expect(view.getInt16(4, true)).toBe(-0x8000);
  });

  it('mu-law encodes silence to 0xFF', () => {
    expect(pcm16SampleToUlaw(0)).toBe(0xff);
  });

  it('mu-law encodes one byte per sample', () => {
    const bytes = floatToUlawBytes(new Float32Array([0, 0.5, -0.5, 1, -1]));
    expect(bytes.length).toBe(5);
    bytes.forEach((b) => expect(b).toBeGreaterThanOrEqual(0));
    bytes.forEach((b) => expect(b).toBeLessThanOrEqual(255));
  });

  it('encodeFrame produces ulaw (1 byte/sample) and pcm16 (2 bytes/sample)', () => {
    const frame = new Float32Array(48);
    expect(encodeFrame(frame, 48000, 8000, 'g711_ulaw').length).toBe(8);
    expect(encodeFrame(frame, 48000, 24000, 'pcm16').length).toBe(48 / 2 * 2);
  });

  it('computes RMS', () => {
    expect(frameRms(new Float32Array([]))).toBe(0);
    expect(frameRms(new Float32Array([1, 1, 1]))).toBeCloseTo(1);
    expect(frameRms(new Float32Array([0, 0]))).toBe(0);
  });

  it('round-trips base64', () => {
    const bytes = new Uint8Array([0, 1, 2, 254, 255]);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual([0, 1, 2, 254, 255]);
  });

  it('round-trips PCM16 bytes -> Float32 within tolerance', () => {
    const original = new Float32Array([0, 0.5, -0.5]);
    const restored = pcm16BytesToFloat32(floatToPcm16Bytes(original));
    expect(restored.length).toBe(3);
    expect(restored[0]).toBeCloseTo(0, 3);
    expect(restored[1]).toBeCloseTo(0.5, 2);
    expect(restored[2]).toBeCloseTo(-0.5, 2);
  });

  it('encodeWav writes a parseable RIFF/WAVE header with explicit data size', () => {
    const input = new Float32Array(48000); // 1s @ 48k
    const wav = encodeWav(input, 48000, 16000);
    const ascii = (o: number, n: number) => String.fromCharCode(...wav.subarray(o, o + n));
    expect(ascii(0, 4)).toBe('RIFF');
    expect(ascii(8, 4)).toBe('WAVE');
    expect(ascii(36, 4)).toBe('data');
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000); // sample rate (downsampled)
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    const dataSize = view.getUint32(40, true);
    expect(dataSize).toBe(16000 * 2); // 1s of 16k mono 16-bit
    expect(wav.length).toBe(44 + dataSize);
  });
});
