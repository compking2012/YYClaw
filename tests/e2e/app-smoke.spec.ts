import { closeElectronApp, expect, test } from './fixtures/electron';

test.describe('ClawX Electron smoke flows', () => {
  test('shows the setup wizard on a fresh profile', async ({ page }) => {
    await expect(page.getByTestId('setup-page')).toBeVisible();
    await expect(page.getByTestId('setup-welcome-step')).toBeVisible();
    await expect(page.getByTestId('setup-skip-button')).toBeVisible();
  });

  test('can skip setup and navigate to the models page', async ({ page }) => {
    await expect(page.getByTestId('setup-page')).toBeVisible();
    await page.getByTestId('setup-skip-button').click();

    await expect(page.getByTestId('main-layout')).toBeVisible();
    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-tab-models').click();
    await expect(page.getByTestId('models-tab')).toBeVisible();
    await expect(page.getByTestId('providers-settings')).toBeVisible();
  });

  test('persists skipped setup across relaunch for the same isolated profile', async ({ electronApp, launchElectronApp }) => {
    const firstWindow = await electronApp.firstWindow();
    await firstWindow.waitForLoadState('domcontentloaded');
    await firstWindow.getByTestId('setup-skip-button').click();
    await expect(firstWindow.getByTestId('main-layout')).toBeVisible();

    await closeElectronApp(electronApp);

    const relaunchedApp = await launchElectronApp();
    try {
      const relaunchedWindow = await relaunchedApp.firstWindow();
      await relaunchedWindow.waitForLoadState('domcontentloaded');

      await expect(relaunchedWindow.getByTestId('main-layout')).toBeVisible();
      await expect(relaunchedWindow.getByTestId('setup-page')).toHaveCount(0);
    } finally {
      await closeElectronApp(relaunchedApp);
    }
  });

  test('finishes renderer startup and registers backend handlers before exposing the launcher', async ({ launchElectronApp }) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const app = await launchElectronApp({ skipSetup: true });
      try {
        const page = app.windows().at(-1);
        expect(page).toBeDefined();
        await expect(page!.getByTestId('main-layout')).toBeVisible();
        const handlersReady = await app.evaluate(() => {
          const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
          const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, unknown> })._invokeHandlers;
          return ['host:invoke', 'gateway:status', 'gateway:rpc'].every((name) => handlers?.has(name));
        });
        expect(handlersReady).toBe(true);
      } finally {
        await closeElectronApp(app);
      }
    }
  });
});
