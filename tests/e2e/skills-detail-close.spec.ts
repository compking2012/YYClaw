import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('Skill detail sheet close button', () => {
  test('closes the skill detail sheet via the top-right close button', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);

      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-nav-settings').click();

      await page.getByTestId('settings-tab-skills').click();
      await expect(page.getByTestId('skills-tab')).toBeVisible();

      // Open the first skill's detail sheet.
      await page.getByTestId('skill-list-item').first().click();

      const sheet = page.getByTestId('skill-detail-sheet');
      await expect(sheet).toBeVisible();

      const closeButton = page.getByTestId('skill-detail-close');
      await expect(closeButton).toBeVisible();

      await closeButton.click();

      await expect(sheet).toBeHidden();
    } finally {
      await closeElectronApp(app);
    }
  });
});
