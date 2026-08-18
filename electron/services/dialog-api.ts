import type { BrowserWindow } from 'electron';
import type { MessageBoxOptions, OpenDialogOptions } from 'electron';
import type { CompleteHostServiceRegistry } from '../main/ipc/host-contract';
import { showMessageBoxWithParent, showOpenDialogWithParent } from '../utils/dialog-parent';

export function createDialogApi(mainWindow: BrowserWindow): CompleteHostServiceRegistry['dialog'] {
  return {
    open: (payload) => showOpenDialogWithParent(mainWindow, payload as OpenDialogOptions),
    message: (payload) => showMessageBoxWithParent(mainWindow, payload as MessageBoxOptions),
  };
}
