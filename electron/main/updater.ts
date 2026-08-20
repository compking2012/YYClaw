/**
 * Auto-Updater Module
 * Handles automatic application updates using electron-updater
 *
 * The update feed is GitHub Releases, configured once in electron-builder.yml
 * (`publish: provider: github`) and baked into the packaged app — this module no
 * longer overrides it at runtime.
 *
 * Two things the feed depends on:
 * - CI publishes releases with `prerelease: true`, so `allowPrerelease` is set
 *   below. Without it electron-updater only considers the latest *stable*
 *   release and reports "no update" forever.
 * - `autoUpdater.channel` still selects which `{channel}-mac.yml` asset is read,
 *   so it must match `detectChannel` (stable → `latest`, `0.1.8-alpha.0` → `alpha`).
 *
 * `forceUpdate: true` at the **root** of `{channel}-mac.yml` makes the renderer
 * show ForceUpdateModal.
 */
import { autoUpdater, UpdateInfo, ProgressInfo, UpdateDownloadedEvent } from 'electron-updater';
import { getAppDisplayVersion } from '../utils/app-display-version';
import { BrowserWindow, app, ipcMain } from 'electron';
import { logger } from '../utils/logger';
import { EventEmitter } from 'events';
import { setPendingUpdateInstallQuit, setQuitting } from './app-state';

export interface UpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  info?: UpdateInfo;
  progress?: ProgressInfo;
  error?: string;
}

export interface UpdaterEvents {
  'status-changed': (status: UpdateStatus) => void;
  'checking-for-update': () => void;
  'update-available': (info: UpdateInfo) => void;
  'update-not-available': (info: UpdateInfo) => void;
  'download-progress': (progress: ProgressInfo) => void;
  'update-downloaded': (event: UpdateDownloadedEvent) => void;
  'error': (error: Error) => void;
}

/**
 * Detect the update channel from a semver version string.
 * e.g. "0.1.8-alpha.0" → "alpha", "1.0.0-beta.1" → "beta", "1.0.0" → "latest"
 */
function detectChannel(version: string): string {
  const match = version.match(/-([a-zA-Z]+)/);
  return match ? match[1] : 'latest';
}

export class AppUpdater extends EventEmitter {
  private mainWindow: BrowserWindow | null = null;
  private status: UpdateStatus = { status: 'idle' };
  private autoInstallTimer: NodeJS.Timeout | null = null;
  private autoInstallCountdown = 0;

  /** Delay (in seconds) before auto-installing a downloaded update. */
  private static readonly AUTO_INSTALL_DELAY_SECONDS = 5;

  constructor() {
    super();

    // EventEmitter treats an unhandled 'error' event as fatal. Keep a default
    // listener so updater failures surface in logs/UI without terminating main.
    this.on('error', (error: Error) => {
      logger.error('[Updater] AppUpdater emitted error:', error);
    });
    
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    
    autoUpdater.logger = {
      info: (msg: string) => logger.info('[Updater]', msg),
      warn: (msg: string) => logger.warn('[Updater]', msg),
      error: (msg: string) => logger.error('[Updater]', msg),
      debug: (msg: string) => logger.debug('[Updater]', msg),
    };

    const realVersion = app.getVersion();

    // In dev mode, pretend we have an old version so updates trigger
    if (!app.isPackaged) {
      // Override electron-updater currentVersion internally instead of app
      // Because electron-updater parses version in constructor
      const { parse } = require('semver');
      (autoUpdater as unknown as { currentVersion: unknown }).currentVersion = parse('0.0.1');
    }

    const version = app.getVersion();
    const channel = detectChannel(realVersion); // Use real version to determine channel

    logger.info(`[Updater] Version: ${version}, channel: ${channel}, feed: GitHub Releases`);

    // Select which `{channel}-mac.yml` asset to read.
    // e.g. channel "alpha" → alpha-mac.yml, channel "latest" → latest-mac.yml
    autoUpdater.channel = channel;

    // CI publishes GitHub Releases with `prerelease: true`; without this the
    // GitHub provider only looks at the latest stable release and never finds them.
    autoUpdater.allowPrerelease = true;

    // By default, electron-updater skips checking in dev mode. We force it to check.
    if (!app.isPackaged) {
      autoUpdater.forceDevUpdateConfig = true;
    }

    // The feed itself comes from electron-builder.yml `publish` (GitHub Releases)
    // and is baked into app-update.yml at package time — no runtime override.

    this.setupListeners();
  }

  /**
   * Set the main window for sending update events
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window;
  }

  /**
   * Get current update status
   */
  getStatus(): UpdateStatus {
    return this.status;
  }

  /**
   * Setup auto-updater event listeners
   */
  private setupListeners(): void {
    autoUpdater.on('checking-for-update', () => {
      this.updateStatus({ status: 'checking' });
      this.emit('checking-for-update');
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      // Dump raw update info to debug custom fields
      // logger.info(`[Updater] Update available raw info: ${JSON.stringify(info, null, 2)}`);
      
      // In dev mode, we might need to cast or ensure forceUpdate is passed explicitly if it exists
      if (info && (info as any).forceUpdate !== undefined) {
          logger.info(`[Updater] explicitly found forceUpdate: ${(info as any).forceUpdate}`);
      }
      
      this.updateStatus({ status: 'available', info });
      this.emit('update-available', info);
    });

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      logger.info(`[Updater] Update not available. Current app version: ${app.getVersion()}, Latest remote version: ${info?.version}, Raw info: ${JSON.stringify(info, null, 2)}`);
      this.updateStatus({ status: 'not-available', info });
      this.emit('update-not-available', info);
    });

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.updateStatus({ status: 'downloading', progress });
      this.emit('download-progress', progress);
    });

    autoUpdater.on('update-downloaded', (event: UpdateDownloadedEvent) => {
      this.updateStatus({ status: 'downloaded', info: event });
      this.emit('update-downloaded', event);

      if (autoUpdater.autoDownload) {
        this.startAutoInstallCountdown();
      }
    });

    autoUpdater.on('error', (error: Error) => {
      this.updateStatus({ status: 'error', error: error.message });
      this.emit('error', error);
    });
  }

  /**
   * Update status and notify renderer.
   * Merge partial updates so e.g. `download-progress` does not wipe `info` (needed for force-update UI).
   */
  private updateStatus(newStatus: Partial<UpdateStatus>): void {
    this.status = {
      status: newStatus.status ?? this.status.status,
      info: 'info' in newStatus ? newStatus.info : this.status.info,
      progress: 'progress' in newStatus ? newStatus.progress : this.status.progress,
      error: 'error' in newStatus ? newStatus.error : this.status.error,
    };
    this.sendToRenderer('update:status-changed', this.status);
  }

  /**
   * Send event to renderer process
   */
  private sendToRenderer(channel: string, data: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, data);
    }
  }

  /**
   * Check for updates.
   * electron-updater automatically tries providers defined in electron-builder.yml in order.
   *
   * In dev mode (not packed), autoUpdater.checkForUpdates() silently returns
   * null without emitting any events, so we must detect this and force a
   * final status so the UI never gets stuck in 'checking'.
   */
  async checkForUpdates(): Promise<UpdateInfo | null> {
    try {
      logger.info(`[Updater] checkForUpdates called. Status before: ${this.status.status}, isPackaged: ${app.isPackaged}`);
      // By default, electron-updater skips checking in dev mode. We force it to check.
      if (!app.isPackaged) {
        autoUpdater.forceDevUpdateConfig = true;
      }
      
      logger.info(`[Updater] About to call autoUpdater.checkForUpdates()`);
      
      // Before check, override electron-updater currentVersion internally 
      // Because electron-updater checks this right before download
      if (!app.isPackaged) {
        const { parse } = require('semver');
        (autoUpdater as unknown as { currentVersion: unknown }).currentVersion = parse('0.0.1');
      }
      
      const result = await autoUpdater.checkForUpdates();
      
      // 添加详细日志来追踪 checkForUpdates 的返回值
      // logger.info(`[Updater] checkForUpdates() result: ${JSON.stringify(result, null, 2)}`);

      // In dev mode (app not packaged), autoUpdater silently returns null
      // without emitting ANY events (not even checking-for-update).
      // Detect this and force an error so the UI never stays silent.
      if (result == null) {
        logger.info(`[Updater] result is null`);
        this.updateStatus({
          status: 'error',
          error: 'Update check skipped (dev mode – app is not packaged)',
        });
        return null;
      }

      // Safety net: if events somehow didn't fire, force a final state.
      if (this.status.status === 'checking' || this.status.status === 'idle') {
        logger.info(`[Updater] Safety net triggered, forcing 'not-available' status. Current status: ${this.status.status}`);
        this.updateStatus({ status: 'not-available' });
      }

      return result.updateInfo || null;
    } catch (error) {
      logger.error('[Updater] Check for updates failed:', error);
      this.updateStatus({ status: 'error', error: (error as Error).message || String(error) });
      throw error;
    }
  }

  /**
   * Download available update
   */
  async downloadUpdate(): Promise<void> {
    try {
      if (!app.isPackaged) {
        logger.info('[Updater] Simulated download in dev mode');
        this.updateStatus({ status: 'downloading', progress: { percent: 50, transferred: 50, total: 100, bytesPerSecond: 1000, delta: 50 } });
        setTimeout(() => {
          this.updateStatus({ status: 'downloaded' });
        }, 2000);
        return;
      }
      await autoUpdater.downloadUpdate();
    } catch (error) {
      logger.error('[Updater] Download update failed:', error);
      throw error;
    }
  }

  /**
   * Install update and restart.
   *
   * On macOS, electron-updater delegates to Squirrel.Mac (ShipIt). The
   * native quitAndInstall() spawns ShipIt then internally calls app.quit().
   * However, the tray close handler in index.ts intercepts window close
   * and hides to tray unless isQuitting is true. Squirrel's internal quit
   * sometimes fails to trigger before-quit in time, so we set isQuitting
   * BEFORE calling quitAndInstall(). This lets the native quit flow close
   * the window cleanly while ShipIt runs independently to replace the app.
   */
  quitAndInstall(): void {
    logger.info('[Updater] quitAndInstall called');
    
    if (!app.isPackaged) {
      logger.info('[Updater] Cannot actually install update in dev mode, simulating restart...');
      setTimeout(() => {
        app.quit();
      }, 1000);
      return;
    }

    setQuitting();
    if (process.platform === 'darwin') {
      setPendingUpdateInstallQuit();
      logger.info('[Updater] macOS: set pending update-install quit so before-quit will not preventDefault');
    }
    autoUpdater.quitAndInstall();
  }

  /**
   * Start a countdown that auto-installs the downloaded update.
   * Sends `update:auto-install-countdown` events to the renderer each second.
   */
  startAutoInstallCountdown(): void {
    this.clearAutoInstallTimer();
    this.autoInstallCountdown = AppUpdater.AUTO_INSTALL_DELAY_SECONDS;
    this.sendToRenderer('update:auto-install-countdown', { seconds: this.autoInstallCountdown });

    this.autoInstallTimer = setInterval(() => {
      this.autoInstallCountdown--;
      this.sendToRenderer('update:auto-install-countdown', { seconds: this.autoInstallCountdown });

      if (this.autoInstallCountdown <= 0) {
        this.clearAutoInstallTimer();
        this.quitAndInstall();
      }
    }, 1000);
  }

  cancelAutoInstall(): void {
    this.clearAutoInstallTimer();
    this.sendToRenderer('update:auto-install-countdown', { seconds: -1, cancelled: true });
  }

  private clearAutoInstallTimer(): void {
    if (this.autoInstallTimer) {
      clearInterval(this.autoInstallTimer);
      this.autoInstallTimer = null;
    }
  }

  /**
   * Set update channel (stable, beta, dev)
   */
  setChannel(channel: 'stable' | 'beta' | 'dev'): void {
    autoUpdater.channel = channel;
  }

  /**
   * Set auto-download preference
   */
  setAutoDownload(enable: boolean): void {
    autoUpdater.autoDownload = enable;
  }

  /**
   * Get current version (CI display stamp when present; else semver).
   */
  getCurrentVersion(): string {
    return getAppDisplayVersion();
  }
}

/**
 * Register IPC handlers for update operations
 */
export function registerUpdateHandlers(
  updater: AppUpdater,
  mainWindow: BrowserWindow
): void {
  updater.setMainWindow(mainWindow);

  // Get current update status
  ipcMain.handle('update:status', () => {
    return updater.getStatus();
  });

  // Get current version
  ipcMain.handle('update:version', () => {
    return updater.getCurrentVersion();
  });

  // Check for updates – always return final status so the renderer
  // never gets stuck in 'checking' waiting for a push event.
  ipcMain.handle('update:check', async () => {
    logger.info(`[Updater] IPC 'update:check' received from renderer.`);
    try {
      await updater.checkForUpdates();
      return { success: true, status: updater.getStatus() };
    } catch (error) {
      logger.error(`[Updater] IPC 'update:check' failed:`, error);
      return { success: false, error: String(error), status: updater.getStatus() };
    }
  });

  // Download update
  ipcMain.handle('update:download', async () => {
    try {
      await updater.downloadUpdate();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });

  // Install update and restart
  ipcMain.handle('update:install', () => {
    updater.quitAndInstall();
    return { success: true };
  });

  // Set update channel
  ipcMain.handle('update:setChannel', (_, channel: 'stable' | 'beta' | 'dev') => {
    updater.setChannel(channel);
    return { success: true };
  });

  // Set auto-download preference
  ipcMain.handle('update:setAutoDownload', (_, enable: boolean) => {
    updater.setAutoDownload(enable);
    return { success: true };
  });

  // Cancel pending auto-install countdown
  ipcMain.handle('update:cancelAutoInstall', () => {
    updater.cancelAutoInstall();
    return { success: true };
  });

}

// Export singleton instance
export const appUpdater = new AppUpdater();
