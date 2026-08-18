import type { BrowserWindow } from 'electron';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { syncMacTrafficLightPosition } from '../main/traffic-light-layout';

export function createWindowApi(mainWindow: BrowserWindow): CompleteHostServiceRegistry['window'] {
  return {
    syncTrafficLightPosition: (payload) => {
      syncMacTrafficLightPosition(mainWindow, payload.sidebarCollapsed);
    },
    minimize: () => {
      mainWindow.minimize();
    },
    maximize: () => {
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow.maximize();
      }
    },
    close: () => {
      mainWindow.close();
    },
    isMaximized: () => mainWindow.isMaximized(),
    ensureKeyboardFocus: () => {
      // Win32-only repair for modal-unmount document.hasFocus() desync.
      // Only when our HWND is already the OS focus owner — never steal from
      // another app / macOS first-responder.
      if (process.platform !== 'win32' || mainWindow.isDestroyed()) return false;
      if (!mainWindow.isFocused()) return false;
      // Already-focused HWND: focus() alone is a no-op for Chromium; blur→focus
      // forces a real OS focus transition so document.hasFocus() recovers.
      if (mainWindow.webContents.isFocused()) {
        mainWindow.blur();
      }
      mainWindow.focus();
      mainWindow.webContents.focus();
      return mainWindow.isFocused() && mainWindow.webContents.isFocused();
    },
  };
}
