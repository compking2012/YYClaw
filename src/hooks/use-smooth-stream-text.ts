import { useEffect, useRef, useState } from 'react';

/**
 * Smooth "typewriter" reveal for streaming text.
 *
 * The problem it solves: streaming replies arrive as bursty, unevenly-spaced
 * chunks (one `assistant.delta` → one IPC event → one store update → one
 * render), so text appears to jump-then-pause-then-jump. This hook decouples
 * the *display* rate from the *arrival* rate: it holds the full accumulated
 * text and reveals it character-by-character on a requestAnimationFrame loop at
 * a steady, backlog-adaptive rate — the same technique Claude Code / Codex use
 * to make output flow continuously.
 *
 * When `enabled` is false (finalized history messages, reduced-motion) the full
 * text is returned immediately with no animation.
 */

// Floor reveal speed so even a 1-char backlog drips at a readable pace.
const MIN_CPS = 120;
// Target time (seconds) to drain the current backlog. Larger backlogs reveal
// proportionally faster so the display stays caught up and the stream's final
// chunk lands with the typewriter already at (or very near) the end.
const CATCHUP_SECONDS = 0.3;
// Clamp per-frame delta so a long pause (e.g. backgrounded tab) doesn't dump a
// huge jump on the next frame.
const MAX_DT_SECONDS = 0.05;

/**
 * How many characters should be revealed after advancing one frame.
 * Pure + side-effect free so it can be unit-tested without rAF/jsdom.
 */
export function advanceRevealed(params: {
  revealed: number;
  targetLen: number;
  dtSeconds: number;
  minCps?: number;
  catchupSeconds?: number;
}): number {
  const {
    revealed,
    targetLen,
    dtSeconds,
    minCps = MIN_CPS,
    catchupSeconds = CATCHUP_SECONDS,
  } = params;
  const backlog = targetLen - revealed;
  if (backlog <= 0) return revealed;
  const dt = Math.max(0, Math.min(dtSeconds, MAX_DT_SECONDS));
  const cps = Math.max(minCps, backlog / catchupSeconds);
  // ceil → always make ≥1 char of progress per frame while there is backlog.
  const next = revealed + Math.ceil(cps * dt);
  return Math.min(targetLen, next);
}

/**
 * Resolve the revealed count when the source text changes.
 * - disabled → snap to full (no animation).
 * - pure append (new text extends what we've already shown) → keep revealed.
 * - prefix mismatch or shrink (a `replace` snapshot / session switch) → snap to
 *   full so stale characters never linger.
 * Pure + side-effect free for unit testing.
 */
export function resolveRevealedOnTextChange(params: {
  prevText: string;
  prevRevealed: number;
  nextText: string;
  enabled: boolean;
}): number {
  const { prevText, prevRevealed, nextText, enabled } = params;
  if (!enabled) return nextText.length;
  const displayedPrefix = prevText.slice(0, prevRevealed);
  if (nextText.startsWith(displayedPrefix)) {
    return Math.min(prevRevealed, nextText.length);
  }
  return nextText.length;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return reduced;
}

export function useSmoothStreamText(fullText: string, enabled: boolean): string {
  const prefersReducedMotion = usePrefersReducedMotion();
  const animate = enabled && !prefersReducedMotion;

  // `revealedRef` is the source of truth driven by the rAF loop; `revealed`
  // state exists only to trigger re-renders. We never sync ref ← state on
  // render (that would clobber the loop's progress).
  const [revealed, setRevealed] = useState(() => (animate ? 0 : fullText.length));
  const revealedRef = useRef(revealed);
  const fullTextRef = useRef(fullText);
  const prevTextRef = useRef(fullText);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  // Stable across renders: only touches refs + the stable setRevealed.
  const tickRef = useRef<(ts: number) => void>(() => {});
  const ensureLoopRef = useRef<() => void>(() => {});

  useEffect(() => {
    const tick = (ts: number) => {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;

      const targetLen = fullTextRef.current.length;
      const next = advanceRevealed({ revealed: revealedRef.current, targetLen, dtSeconds: dt });
      if (next !== revealedRef.current) {
        revealedRef.current = next;
        setRevealed(next);
      }

      if (revealedRef.current < fullTextRef.current.length) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        lastTsRef.current = null;
      }
    };
    tickRef.current = tick;
    ensureLoopRef.current = () => {
      if (rafRef.current == null && revealedRef.current < fullTextRef.current.length) {
        lastTsRef.current = null;
        rafRef.current = requestAnimationFrame(tick);
      }
    };
  }, []);

  // React to text / enablement changes.
  useEffect(() => {
    fullTextRef.current = fullText;

    if (!animate) {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
        lastTsRef.current = null;
      }
      revealedRef.current = fullText.length;
      prevTextRef.current = fullText;
      setRevealed(fullText.length);
      return;
    }

    const resolved = resolveRevealedOnTextChange({
      prevText: prevTextRef.current,
      prevRevealed: revealedRef.current,
      nextText: fullText,
      enabled: true,
    });
    prevTextRef.current = fullText;
    if (resolved !== revealedRef.current) {
      revealedRef.current = resolved;
      setRevealed(resolved);
    }
    ensureLoopRef.current();
  }, [fullText, animate]);

  // Cancel any in-flight frame on unmount.
  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  // Guard the return so a disabled/reduced-motion frame never shows a partial
  // slice before the effect above has snapped `revealed` to the full length.
  if (!animate) return fullText;
  return fullText.slice(0, revealed);
}
