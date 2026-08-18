/**
 * Application quit state.
 *
 * Exposed as a function accessor (not a bare `export let`) so that every
 * import site reads the *live* value.  With `export let`, bundlers that
 * compile to CJS may snapshot the variable at import time, causing
 * `isQuitting` to stay `false` forever and preventing the window from
 * closing on Windows/Linux.
 */
let _isQuitting = false;

export function isQuitting(): boolean {
  return _isQuitting;
}

export function setQuitting(value = true): void {
  _isQuitting = value;
}

/**
 * macOS auto-update (Squirrel.Mac) requires the first `app.quit()` after
 * `quitAndInstall()` to succeed without `before-quit` calling
 * `preventDefault()`. Set this immediately before `autoUpdater.quitAndInstall()`
 * on darwin only; the main process consumes it in `before-quit`.
 */
let _pendingUpdateInstallQuit = false;

export function setPendingUpdateInstallQuit(value = true): void {
  _pendingUpdateInstallQuit = value;
}

/** Returns whether an update-install quit was pending, and clears the flag. */
export function consumePendingUpdateInstallQuit(): boolean {
  if (!_pendingUpdateInstallQuit) {
    return false;
  }
  _pendingUpdateInstallQuit = false;
  return true;
}
