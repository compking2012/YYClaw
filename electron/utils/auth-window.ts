import { BrowserWindow } from 'electron';

let authWindow: BrowserWindow | null = null;

/**
 * Optional behaviour for the Feishu developer-console (baseinfo) page, which is
 * shared by two flows: copying the App Secret, and disabling/deleting the app.
 * Both open the same URL but want the page scrolled to a different spot.
 */
export type AuthWindowIntent = 'feishu-credentials' | 'feishu-delete';

export interface OpenAuthWindowOptions {
  url: string;
  title?: string;
  width?: number;
  height?: number;
  parent?: BrowserWindow;
  intent?: AuthWindowIntent;
}

// The window is a singleton; these track the behaviour requested by the latest
// open call so the (once-attached) listeners can act on the current intent.
let currentIntent: AuthWindowIntent | undefined;
let currentAppPath: string | undefined;

/** Extract the `/app/<appId>` path prefix from a Feishu console URL, if present. */
function extractAppPath(url: string): string | undefined {
  const m = url.match(/\/app\/[^/?#]+/);
  return m ? m[0] : undefined;
}

/**
 * Page script injected into the Feishu console (baseinfo) page. Best-effort:
 * polls for the target element (the SPA loads async), scrolls it into view, and
 * silently gives up after a timeout. Never throws into the page.
 */
function buildInjectionScript(intent: AuthWindowIntent): string {
  const scrollToDelete = `
    var btns = Array.prototype.slice.call(document.querySelectorAll('button, a, [role="button"]'));
    var matches = btns.filter(function (b) {
      var t = (b.textContent || '').trim();
      return /删除应用|删除|delete app|delete/i.test(t) && t.length <= 12;
    });
    if (!matches.length) return false;
    // The dangerous-zone delete button sits near the bottom of the page.
    matches.sort(function (a, b) {
      return b.getBoundingClientRect().top - a.getBoundingClientRect().top;
    });
    matches[0].scrollIntoView({ block: 'center', inline: 'center' });
    return true;
  `;
  const scrollToSecret = `
    var all = Array.prototype.slice.call(document.querySelectorAll('span, label, div, td, th'));
    var label = all.find(function (el) {
      if (el.childElementCount > 0) return false;
      return /app\\s*secret|应用\\s*secret|应用密钥/i.test((el.textContent || '').trim());
    });
    if (!label) return false;
    var row = label.closest('tr, [class*="row"], [class*="item"], div') || label;
    // The App Secret value + copy button sit at the far right of the row, often
    // inside a horizontally-scrollable container. Find the copy control itself
    // and scroll *it* into view so the user can click it without dragging right.
    var controls = Array.prototype.slice.call(
      row.querySelectorAll('button, a, [role="button"]')
    );
    var copyBtn = controls.find(function (b) {
      var text = (b.textContent || '').trim();
      var meta = ((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '')).trim();
      if (/复制|copy/i.test(text) && text.length <= 12) return true;
      if (/复制|copy/i.test(meta)) return true;
      // Icon-only copy buttons: detect a nested element whose class hints "copy".
      return !!b.querySelector('[class*="copy" i], [class*="Copy"]');
    });
    if (copyBtn) {
      copyBtn.scrollIntoView({ block: 'center', inline: 'end' });
    } else {
      // Fallback: scroll the whole row to its right edge.
      row.scrollIntoView({ block: 'center', inline: 'end' });
    }
    return true;
  `;
  const body = intent === 'feishu-delete' ? scrollToDelete : scrollToSecret;
  return `(function () {
    try {
      var deadline = Date.now() + 15000;
      var attempt = function () {
        try {
          var done = (function () { ${body} })();
          if (done) return;
        } catch (e) { /* ignore and retry */ }
        if (Date.now() < deadline) setTimeout(attempt, 500);
      };
      attempt();
    } catch (e) { /* never break the page */ }
  })();`;
}

function runInjection(): void {
  if (!authWindow || authWindow.isDestroyed() || !currentIntent) return;
  authWindow.webContents
    .executeJavaScript(buildInjectionScript(currentIntent), true)
    .catch(() => {
      /* injection is best-effort */
    });
}

function attachWindowBehaviour(win: BrowserWindow): void {
  // (Re)apply the scroll helper after every load (covers reuse + SPA reloads).
  win.webContents.on('did-finish-load', runInjection);

  // Surface load failures instead of leaving a mysterious white screen. -3 is
  // ERR_ABORTED, which fires on benign client-side redirects, so ignore it.
  win.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    console.error(`[auth-window] load failed: [${errorCode}] ${errorDescription} ${validatedURL}`);
  });

  // For the delete flow, treat "navigated away from this app's pages" as the
  // deletion-complete signal and close the window instead of leaving the user
  // on the app list. In-app tab switches keep `/app/<id>` so they don't trigger.
  const maybeCloseAfterDelete = (navUrl: string) => {
    if (
      currentIntent === 'feishu-delete' &&
      currentAppPath &&
      !navUrl.includes(currentAppPath)
    ) {
      closeAuthWindow();
    }
  };
  win.webContents.on('will-navigate', (_e, navUrl) => maybeCloseAfterDelete(navUrl));
  win.webContents.on('did-navigate-in-page', (_e, navUrl) => maybeCloseAfterDelete(navUrl));
}

export function openAuthWindow(options: OpenAuthWindowOptions): BrowserWindow {
  currentIntent = options.intent;
  currentAppPath = extractAppPath(options.url);

  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.loadURL(options.url);
    authWindow.show();
    authWindow.focus();
    return authWindow;
  }

  // Float the auth window in front of the main window by making it a child.
  // Resolve the parent lazily here to avoid a circular import with main/index.
  const parent =
    options.parent ??
    BrowserWindow.getAllWindows().find((w) => w !== authWindow && !w.isDestroyed());

  authWindow = new BrowserWindow({
    width: options.width || 800,
    height: options.height || 700,
    title: options.title || 'Authorization',
    center: true,
    autoHideMenuBar: true,
    parent,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  authWindow.setMenu(null);
  attachWindowBehaviour(authWindow);
  authWindow.loadURL(options.url);

  authWindow.once('ready-to-show', () => {
    authWindow?.show();
    authWindow?.focus();
  });

  authWindow.on('closed', () => {
    authWindow = null;
    currentIntent = undefined;
    currentAppPath = undefined;
  });

  return authWindow;
}

export function closeAuthWindow(): void {
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.close();
  }
  authWindow = null;
  currentIntent = undefined;
  currentAppPath = undefined;
}
