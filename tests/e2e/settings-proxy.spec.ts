import type { Locator, Page } from '@playwright/test';
import { completeSetup, expect, test } from './fixtures/electron';

async function ensureSwitchState(toggle: Locator, checked: boolean): Promise<void> {
  const currentState = await toggle.getAttribute('data-state');
  const isChecked = currentState === 'checked';
  if (isChecked !== checked) {
    await toggle.click();
  }
}

// Developer mode is unlocked by tapping the version string in the About tab five
// times in quick succession, then enabling the revealed Developer Mode switch.
async function unlockDeveloperMode(page: Page): Promise<void> {
  await page.getByTestId('settings-tab-about').click();
  const version = page.getByTestId('about-version');
  await expect(version).toBeVisible();
  for (let i = 0; i < 5; i += 1) {
    await version.click();
  }
  const toggle = page.getByTestId('settings-dev-mode-switch');
  await expect(toggle).toBeVisible();
  await ensureSwitchState(toggle, true);
}

async function readProxyEnabled(page: Page): Promise<boolean> {
  return await page.evaluate(async () => {
    const settings = await window.electron.ipcRenderer.invoke('settings:getAll');
    return Boolean(settings?.proxyEnabled);
  });
}

async function readPromptOptimizationEnabled(page: Page): Promise<boolean> {
  return await page.evaluate(async () => {
    const settings = await window.electron.ipcRenderer.invoke('settings:getAll');
    return Boolean(settings?.promptOptimizationEnabled);
  });
}

test.describe('ClawX developer proxy settings', () => {
  test('keeps proxy save available when disabling proxy in developer mode', async ({ page }) => {
    await completeSetup(page);

    await page.getByTestId('sidebar-nav-settings').click();
    await expect(page.getByTestId('settings-tab')).toBeVisible();

    await unlockDeveloperMode(page);
    await page.getByTestId('settings-tab-developer').click();

    const proxySection = page.getByTestId('settings-proxy-section');
    const proxyToggle = page.getByTestId('settings-proxy-toggle');
    const proxySaveButton = page.getByTestId('settings-proxy-save-button');

    await expect(proxySection).toBeVisible();
    await expect(proxyToggle).toBeVisible();
    await expect(proxySaveButton).toBeVisible();

    await ensureSwitchState(proxyToggle, true);
    await expect(proxySaveButton).toBeEnabled();
    await proxySaveButton.click();
    await expect.poll(async () => await readProxyEnabled(page)).toBe(true);

    await ensureSwitchState(proxyToggle, false);
    await expect(proxySaveButton).toBeVisible();
    await expect(proxySaveButton).toBeEnabled();
    await proxySaveButton.click();
    await expect.poll(async () => await readProxyEnabled(page)).toBe(false);
  });

  test('persists prompt optimization toggle', async ({ page }) => {
    await completeSetup(page);

    await page.getByTestId('sidebar-nav-settings').click();
    await expect(page.getByTestId('settings-tab')).toBeVisible();
    await page.getByTestId('settings-tab-gateway').click();

    const promptOptimizationToggle = page.getByTestId('settings-prompt-optimization-switch');
    await expect(promptOptimizationToggle).toBeVisible();

    await ensureSwitchState(promptOptimizationToggle, true);
    await expect.poll(async () => await readPromptOptimizationEnabled(page)).toBe(true);

    await ensureSwitchState(promptOptimizationToggle, false);
    await expect.poll(async () => await readPromptOptimizationEnabled(page)).toBe(false);
  });
});
