import { beforeEach, describe, expect, it, vi } from 'vitest';

const showOpenDialogMock = vi.fn();
const showMessageBoxMock = vi.fn();
const getFocusedWindowMock = vi.fn();
const getAllWindowsMock = vi.fn();

vi.mock('electron', () => ({
  BrowserWindow: {
    getFocusedWindow: () => getFocusedWindowMock(),
    getAllWindows: () => getAllWindowsMock(),
  },
  dialog: {
    showOpenDialog: (...args: unknown[]) => showOpenDialogMock(...args),
    showMessageBox: (...args: unknown[]) => showMessageBoxMock(...args),
  },
}));

import {
  getDialogParentWindow,
  showMessageBoxWithParent,
  showOpenDialogWithParent,
} from '@electron/utils/dialog-parent';

describe('dialog-parent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFocusedWindowMock.mockReturnValue(null);
    getAllWindowsMock.mockReturnValue([]);
    showOpenDialogMock.mockResolvedValue({ canceled: true, filePaths: [] });
    showMessageBoxMock.mockResolvedValue({ response: 0 });
  });

  it('prefers the provided parent window when it is still alive', () => {
    const mainWindow = { isDestroyed: () => false };
    expect(getDialogParentWindow(mainWindow as never)).toBe(mainWindow);
  });

  it('falls back to focused window when preferred parent is destroyed', () => {
    const focused = { isDestroyed: () => false };
    getFocusedWindowMock.mockReturnValue(focused);
    expect(getDialogParentWindow({ isDestroyed: () => true } as never)).toBe(focused);
  });

  it('attaches open dialogs to the parent window', async () => {
    const mainWindow = { isDestroyed: () => false };
    const options = { properties: ['openFile'] };

    await showOpenDialogWithParent(mainWindow as never, options);

    expect(showOpenDialogMock).toHaveBeenCalledWith(mainWindow, options);
  });

  it('attaches message boxes to the parent window', async () => {
    const mainWindow = { isDestroyed: () => false };
    const options = { message: 'hello' };

    await showMessageBoxWithParent(mainWindow as never, options);

    expect(showMessageBoxMock).toHaveBeenCalledWith(mainWindow, options);
  });
});
