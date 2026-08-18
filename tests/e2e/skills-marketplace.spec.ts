import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('Skills server marketplace sheet', () => {
  test('opens server install sheet from Skills page', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);

      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-nav-settings').click();

      await page.getByTestId('settings-tab-skills').click();
      await expect(page.getByTestId('skills-tab')).toBeVisible();

      await expect(page.getByTestId('skills-publish-button')).toBeVisible();

      await page.getByTestId('skills-install-button').click();

      await expect(page.getByTestId('skills-server-install-sheet')).toBeVisible();
      await expect(page.getByTestId('skills-server-install-search')).toBeVisible();
      await expect(page.getByTestId('skills-install-source-select')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
