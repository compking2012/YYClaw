import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  advanceRevealed,
  resolveRevealedOnTextChange,
  useSmoothStreamText,
} from '@/hooks/use-smooth-stream-text';

describe('smooth stream hook lifecycle', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('preserves disabled text, replacement updates and cleanup', () => {
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frameId += 1;
      frames.set(frameId, callback);
      return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (identifier: number) => frames.delete(identifier));
    const advanceFrame = (timestamp: number) => act(() => {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) callback(timestamp);
    });
    const { result, rerender, unmount } = renderHook(
      ({ text, enabled }) => useSmoothStreamText(text, enabled),
      { initialProps: { text: 'Initial text', enabled: false } },
    );
    expect(result.current).toBe('Initial text');
    rerender({ text: 'Disabled replacement', enabled: false });
    expect(result.current).toBe('Disabled replacement');
    advanceFrame(16);
    rerender({ text: 'Disabled replacement', enabled: true });
    expect(result.current).toBe('Disabled replacement');
    rerender({ text: 'Different content', enabled: true });
    advanceFrame(32);
    expect(result.current).toBe('Different content');
    rerender({ text: 'Different content with an appended tail', enabled: true });
    expect(result.current).toBe('Different content');
    advanceFrame(48);
    advanceFrame(64);
    expect(result.current.length).toBeGreaterThan('Different content'.length);
    unmount();
    expect(frames.size).toBe(0);
  });
});

describe('advanceRevealed', () => {
  it('makes no progress when already caught up', () => {
    expect(advanceRevealed({ revealed: 10, targetLen: 10, dtSeconds: 0.016 })).toBe(10);
    expect(advanceRevealed({ revealed: 12, targetLen: 10, dtSeconds: 0.016 })).toBe(12);
  });

  it('never exceeds the target', () => {
    const next = advanceRevealed({ revealed: 0, targetLen: 3, dtSeconds: 1 });
    expect(next).toBe(3);
  });

  it('advances at least one char per frame while backlog remains', () => {
    const next = advanceRevealed({ revealed: 0, targetLen: 5000, dtSeconds: 0.0001 });
    expect(next).toBeGreaterThanOrEqual(1);
  });

  it('drains a large backlog faster than a small one (rate scales with backlog)', () => {
    const dt = 0.016;
    const big = advanceRevealed({ revealed: 0, targetLen: 5000, dtSeconds: dt }) - 0;
    const small = advanceRevealed({ revealed: 0, targetLen: 5, dtSeconds: dt }) - 0;
    expect(big).toBeGreaterThan(small);
  });

  it('clamps a huge dt so a long pause does not overshoot the target', () => {
    // With MAX_DT clamping, a 10s gap still cannot exceed the target.
    expect(advanceRevealed({ revealed: 0, targetLen: 4, dtSeconds: 10 })).toBe(4);
  });

  it('converges to the target over successive frames and is monotonic', () => {
    const target = 'The quick brown fox jumps over the lazy dog.'.length;
    let revealed = 0;
    let prev = -1;
    for (let i = 0; i < 200 && revealed < target; i++) {
      revealed = advanceRevealed({ revealed, targetLen: target, dtSeconds: 0.016 });
      expect(revealed).toBeGreaterThan(prev);
      expect(revealed).toBeLessThanOrEqual(target);
      prev = revealed;
    }
    expect(revealed).toBe(target);
  });
});

describe('resolveRevealedOnTextChange', () => {
  it('snaps to full length when disabled', () => {
    expect(
      resolveRevealedOnTextChange({ prevText: 'ab', prevRevealed: 1, nextText: 'abcdef', enabled: false }),
    ).toBe(6);
  });

  it('keeps revealed count on a pure append (extension of shown prefix)', () => {
    expect(
      resolveRevealedOnTextChange({ prevText: 'abc', prevRevealed: 2, nextText: 'abcdef', enabled: true }),
    ).toBe(2);
  });

  it('keeps revealed count when text is unchanged', () => {
    expect(
      resolveRevealedOnTextChange({ prevText: 'abc', prevRevealed: 1, nextText: 'abc', enabled: true }),
    ).toBe(1);
  });

  it('snaps to full when the new text does not extend the shown prefix (replace)', () => {
    expect(
      resolveRevealedOnTextChange({ prevText: 'abc', prevRevealed: 2, nextText: 'xyz', enabled: true }),
    ).toBe(3);
  });

  it('snaps to full when the text shrinks below what was shown', () => {
    expect(
      resolveRevealedOnTextChange({ prevText: 'abcdef', prevRevealed: 5, nextText: 'ab', enabled: true }),
    ).toBe(2);
  });
});
