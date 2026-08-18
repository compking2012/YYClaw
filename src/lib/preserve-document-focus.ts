/**
 * Windows Electron: unmounting a focused Office modal (or dismissing
 * window.confirm) can leave `document.hasFocus() === false` while the
 * BrowserWindow stays focused — caret shows, keys do not.
 *
 * All entry points are no-ops outside win32 so macOS / other platforms
 * are unchanged. Native recovery never activates a background window.
 */

function isWindowsDesktop(): boolean {
  return typeof window !== 'undefined' && window.electron?.platform === 'win32';
}

/** Move DOM focus to <body> without calling window.focus() (avoids OS focus steal). */
function focusBody(): void {
  if (typeof document === 'undefined') return;

  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) {
    active.blur();
  }

  const body = document.body;
  if (!body) return;

  if (!body.hasAttribute('tabindex')) {
    body.setAttribute('tabindex', '-1');
  }
  try {
    body.focus({ preventScroll: true });
  } catch {
    // ignore
  }
}

/** Move focus off a dying node before React unmounts it. Win32 only. */
export function preserveDocumentFocus(): void {
  if (!isWindowsDesktop()) return;
  focusBody();
}

/** Close an Office modal with Win32 focus handoff (no-op on other platforms). */
export function closeOfficeModalWithFocusHandoff(close: () => void): void {
  preserveDocumentFocus();
  close();
  recoverDocumentFocusAfterModalClose();
}

/**
 * Delayed recovery after modal / native confirm teardown. Win32 only.
 * Desync often lands after React commit, so we retry on rAF / short timers.
 * Skips when the document is hidden, or when our BrowserWindow is no longer
 * the OS focus owner (so Alt-Tab / other apps are never yanked back).
 */
export function recoverDocumentFocusAfterModalClose(): void {
  if (typeof document === 'undefined') return;
  if (!isWindowsDesktop()) return;

  let nativeAttempts = 0;
  const tryRecover = () => {
    if (document.visibilityState !== 'visible') return;
    if (document.hasFocus()) return;
    if (nativeAttempts >= 2) return;
    nativeAttempts += 1;

    void (async () => {
      let restored = false;
      try {
        const { hostApi } = await import('@/lib/host-api');
        restored = Boolean(await hostApi.window.ensureKeyboardFocus());
      } catch {
        // ignore
      }
      if (
        restored
        && document.visibilityState === 'visible'
        && !document.hasFocus()
      ) {
        focusBody();
      }
    })();
  };

  tryRecover();
  requestAnimationFrame(() => {
    tryRecover();
    window.setTimeout(tryRecover, 50);
    window.setTimeout(tryRecover, 200);
  });
}
