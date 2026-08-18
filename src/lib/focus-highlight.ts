/**
 * Scroll a not-yet-guaranteed-rendered element into view once it appears.
 *
 * Tag-click navigation sets a focus target, then the destination page/tab
 * mounts asynchronously (route transition, Radix Dialog open animation, list
 * render after a data fetch). Two problems make a naive one-shot scroll fail:
 *
 * 1. A single requestAnimationFrame often fires before the target element is
 *    painted, so the querySelector misses and the scroll silently no-ops. We
 *    poll across a few animation frames until the element exists.
 * 2. Even once the element exists, the destination may still be settling — the
 *    Radix Dialog is mid open-animation (~100ms) or the list reflows as data
 *    finishes loading — which strands a single smooth scroll at a stale offset
 *    or lets a later reflow reset it. We scroll immediately (instant, so it
 *    can't be interrupted), then re-apply a couple of corrective scrolls across
 *    a short settle window so the item reliably ends up in place.
 *
 * `block` defaults to 'center' so the target lands prominently in view rather
 * than barely peeking at the container edge ('nearest').
 */
export function scrollTestIdIntoView(
  testId: string,
  onFound?: () => void,
  options: { timeoutMs?: number; block?: ScrollLogicalPosition } = {},
): () => void {
  const timeoutMs = options.timeoutMs ?? 1500;
  const block = options.block ?? 'center';
  const selector = `[data-testid="${testId}"]`;
  const start = Date.now();
  let rafId = 0;
  let cancelled = false;
  const timers: number[] = [];

  const scrollNow = (behavior: ScrollBehavior) => {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) el.scrollIntoView({ block, inline: 'nearest', behavior });
  };

  const tick = () => {
    if (cancelled) return;
    const el = document.querySelector<HTMLElement>(selector);
    if (el) {
      el.scrollIntoView({ block, inline: 'nearest', behavior: 'auto' });
      onFound?.();
      // Corrective re-scrolls: cover the Dialog open animation and any list
      // reflow that happens right after the destination mounts.
      timers.push(window.setTimeout(() => scrollNow('auto'), 140));
      timers.push(window.setTimeout(() => scrollNow('smooth'), 280));
      return;
    }
    if (Date.now() - start >= timeoutMs) return;
    rafId = requestAnimationFrame(tick);
  };

  rafId = requestAnimationFrame(tick);

  return () => {
    cancelled = true;
    if (rafId) cancelAnimationFrame(rafId);
    timers.forEach((id) => clearTimeout(id));
  };
}
