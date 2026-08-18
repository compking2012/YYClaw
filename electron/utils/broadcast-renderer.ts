import { BrowserWindow, type WebContents } from 'electron';
import { logger } from './logger';

const RENDERER_SKIP_LOG_INTERVAL_MS = 5_000;

let rendererSkipLogAt = 0;
let rendererSkipSuppressed = 0;

function logRendererSendSkipped(channel: string, reason: string): void {
  const now = Date.now();
  if (now - rendererSkipLogAt < RENDERER_SKIP_LOG_INTERVAL_MS) {
    rendererSkipSuppressed += 1;
    return;
  }
  const extra =
    rendererSkipSuppressed > 0
      ? ` (+${rendererSkipSuppressed} more skipped in last ${RENDERER_SKIP_LOG_INTERVAL_MS}ms)`
      : '';
  rendererSkipLogAt = now;
  rendererSkipSuppressed = 0;
  logger.debug(`[renderer-ipc] skipped ${channel}: ${reason}${extra}`);
}

/** @internal test helper */
export function resetRendererSendSkipLogForTest(): void {
  rendererSkipLogAt = 0;
  rendererSkipSuppressed = 0;
}

function getWebContentsSendBlockReason(contents: WebContents): string | null {
  if (contents.isDestroyed()) return 'webContents destroyed';
  try {
    const frame = contents.mainFrame;
    if (!frame) return 'mainFrame unavailable';
    if (frame.isDestroyed()) return 'mainFrame disposed';
    return null;
  } catch {
    return 'mainFrame inaccessible';
  }
}

/**
 * True when `webContents.send` can reach a live main frame.
 * During Vite HMR / navigation the window may exist while the frame is disposed;
 * calling `send` then spams Electron stderr ("Render frame was disposed...").
 */
export function canSendToWebContents(contents: WebContents): boolean {
  return getWebContentsSendBlockReason(contents) === null;
}

export function sendToWebContents(
  contents: WebContents,
  channel: string,
  payload: unknown,
): void {
  const blockReason = getWebContentsSendBlockReason(contents);
  if (blockReason) {
    logRendererSendSkipped(channel, blockReason);
    return;
  }
  try {
    contents.send(channel, payload);
  } catch {
    logRendererSendSkipped(channel, 'mainFrame disposed before send (navigation race)');
  }
}

export function sendToMainWindow(
  win: BrowserWindow | null | undefined,
  channel: string,
  payload: unknown,
): void {
  if (!win || win.isDestroyed()) {
    logRendererSendSkipped(channel, 'main window destroyed');
    return;
  }
  sendToWebContents(win.webContents, channel, payload);
}

/** Notify all renderer windows (e.g. after Manager-driven provider sync). */
export function broadcastToRenderer(channel: string, payload: unknown = {}): void {
  if (typeof BrowserWindow?.getAllWindows !== 'function') {
    return;
  }
  for (const win of BrowserWindow.getAllWindows()) {
    sendToMainWindow(win, channel, payload);
  }
}
