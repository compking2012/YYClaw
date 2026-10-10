import { beforeEach, describe, expect, it, vi } from 'vitest';

const { electronApp, updater } = vi.hoisted(() => ({
  electronApp: { isPackaged: false, getVersion: vi.fn(() => '0.6.0') },
  updater: {
    on: vi.fn(),
    checkForUpdates: vi.fn(),
    forceDevUpdateConfig: false,
    currentVersion: '0.6.0',
  },
}));

vi.mock('electron', () => ({ app: electronApp, ipcMain: { handle: vi.fn() } }));
vi.mock('electron-updater', () => ({ autoUpdater: updater, default: { autoUpdater: updater } }));
vi.mock('@electron/utils/logger', () => ({ logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

describe('application update checks', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    electronApp.isPackaged = false;
    updater.forceDevUpdateConfig = false;
    updater.currentVersion = '0.6.0';
  });

  it('skips development update checks without a feed or version spoofing', async () => {
    const { appUpdater } = await import('@electron/main/updater');
    await expect(appUpdater.checkForUpdates()).resolves.toBeNull();
    expect(appUpdater.getStatus()).toEqual({ status: 'idle' });
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    expect(updater.forceDevUpdateConfig).toBe(false);
    expect(updater.currentVersion).toBe('0.6.0');
  });

  it('keeps real update checks enabled for packaged applications', async () => {
    electronApp.isPackaged = true;
    const updateInfo = { version: '0.7.0' };
    updater.checkForUpdates.mockResolvedValue({ updateInfo });
    const { appUpdater } = await import('@electron/main/updater');
    await expect(appUpdater.checkForUpdates()).resolves.toEqual(updateInfo);
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
  });
});
