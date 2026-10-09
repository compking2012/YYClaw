import { closeElectronApp, completeSetup, expect, test } from './fixtures/electron';

test.describe('ClawX developer-mode gated UI', () => {
  test.use({ electronApp: async ({ launchElectronApp }, provideApp) => {
    const app = await launchElectronApp({ seedDevMode: false });
    try {
      await provideApp(app);
    } finally {
      await closeElectronApp(app);
    }
  } });
  test('keeps developer-only configuration hidden until dev mode is enabled', async ({ page }) => {
    await completeSetup(page);

    await page.getByTestId('sidebar-nav-settings').click();
    await expect(page.getByTestId('settings-tab')).toBeVisible();
    await page.getByTestId('settings-tab-gateway').click();
    await expect(page.getByTestId('settings-developer-section')).toHaveCount(0);
    await expect(page.getByTestId('settings-tab-developer')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-open-dev-console')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-nav-image-generation')).toHaveCount(0);
    await expect(page.getByTestId('sidebar-nav-computer-use')).toHaveCount(0);

    await page.getByTestId('settings-tab-computer-use').click();
    await expect(page.getByTestId('computer-use-page')).toBeVisible();

    await page.getByTestId('settings-tab-models').click();
    await page.getByTestId('providers-add-button').click();
    await expect(page.getByTestId('add-provider-dialog')).toBeVisible();
    await page.getByTestId('add-provider-type-siliconflow').click();
    await expect(page.getByTestId('add-provider-model-id-input-text')).toBeVisible();
    await page.getByTestId('add-provider-close-button').click();
    await expect(page.getByTestId('add-provider-dialog')).toHaveCount(0);

    await page.getByTestId('settings-tab-about').click();
    for (let clickCount = 0; clickCount < 5; clickCount += 1) {
      await page.getByTestId('about-version').click();
    }
    await page.getByTestId('settings-dev-mode-switch').click();
    await expect(page.getByTestId('settings-dev-mode-switch')).toHaveAttribute('data-state', 'checked');
    await page.getByTestId('settings-tab-developer').click();
    await expect(page.getByTestId('settings-developer-section')).toBeVisible();
    await expect(page.getByTestId('settings-developer-gateway-token')).toBeVisible();
    const compactionReserve = page.getByTestId('settings-developer-compaction-reserve');
    await expect(compactionReserve).toBeVisible();
    await expect(compactionReserve).toContainText('50,000 tokens when none is set');
    await expect(page.getByTestId('sidebar-open-dev-console')).toBeVisible();
    await expect(page.getByTestId('sidebar-nav-image-generation')).toBeVisible();
    await expect(page.getByTestId('sidebar-nav-computer-use')).toHaveCount(0);
    await expect(page.getByTestId('settings-tab-computer-use')).toBeVisible();
    await expect(page.getByTestId('settings-developer-image-generation')).toBeVisible();

    await page.getByTestId('settings-tab-models').click();
    await page.getByTestId('providers-add-button').click();
    await expect(page.getByTestId('add-provider-dialog')).toBeVisible();
    await page.getByTestId('add-provider-type-siliconflow').click();
    await expect(page.getByTestId('add-provider-model-id-input-text')).toBeVisible();
  });
});
