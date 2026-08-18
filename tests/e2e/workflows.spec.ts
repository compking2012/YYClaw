import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

test.describe('Workflows page', () => {
  test('runs the demo workflow end to end and reaches a terminal state', async ({
    launchElectronApp,
  }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      // Workflows is a developer-mode-only feature; unlock it first.
      await page.getByTestId('sidebar-nav-settings').click();
      await expect(page.getByTestId('settings-tab')).toBeVisible();
      await page.getByTestId('settings-tab-gateway').click();
      await page.getByTestId('settings-dev-mode-switch').click();
      await expect(page.getByTestId('sidebar-nav-workflows')).toBeVisible();
      await page.keyboard.press('Escape');

      // Navigate to the Workflows page.
      await page.getByTestId('sidebar-nav-workflows').click();
      await expect(page.getByTestId('workflows-page')).toBeVisible();

      // The built-in demo workflow should be registered and launchable.
      const startButton = page.getByTestId('workflow-start-demo-report');
      await expect(startButton).toBeVisible();
      await startButton.click();

      // A run card appears and, deterministically, settles into `done`.
      // (Without a provider the model step degrades to a deterministic fallback.)
      const doneCard = page.locator('[data-testid="workflow-run-card"][data-status="done"]');
      await expect(doneCard.first()).toBeVisible({ timeout: 30_000 });
    } finally {
      await closeElectronApp(app);
    }
  });
});
