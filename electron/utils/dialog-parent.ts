import {
  BrowserWindow,
  dialog,
  type MessageBoxOptions,
  type OpenDialogOptions,
} from 'electron';

/** Prefer the main window so modal dialogs stay attached when focus changes. */
export function getDialogParentWindow(preferred?: BrowserWindow | null): BrowserWindow | undefined {
  if (preferred && !preferred.isDestroyed()) {
    return preferred;
  }
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) {
    return focused;
  }
  return BrowserWindow.getAllWindows().find((win) => !win.isDestroyed());
}

export function showOpenDialogWithParent(
  parent: BrowserWindow | null | undefined,
  options: OpenDialogOptions,
) {
  const win = getDialogParentWindow(parent);
  return win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options);
}

export function showMessageBoxWithParent(
  parent: BrowserWindow | null | undefined,
  options: MessageBoxOptions,
) {
  const win = getDialogParentWindow(parent);
  return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
}
