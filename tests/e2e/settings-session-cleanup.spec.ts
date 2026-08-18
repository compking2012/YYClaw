import { completeSetup, expect, test } from './fixtures/electron';

// Developer mode is unlocked by tapping the version string in the About tab five
// times in quick succession, then enabling the revealed Developer Mode switch.
async function unlockDeveloperMode(page: import('@playwright/test').Page): Promise<void> {
  await page.getByTestId('settings-tab-about').click();
  const version = page.getByTestId('about-version');
  await expect(version).toBeVisible();
  for (let i = 0; i < 5; i += 1) {
    await version.click();
  }
  const toggle = page.getByTestId('settings-dev-mode-switch');
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('data-state')) !== 'checked') {
    await toggle.click();
  }
}

test.describe('Session auto-cleanup maintenance settings', () => {
  test('saves the maintenance policy and persists it (developer mode)', async ({ page }) => {
    await completeSetup(page);

    await page.getByTestId('sidebar-nav-settings').click();
    await expect(page.getByTestId('settings-tab')).toBeVisible();

    // The policy form only shows once developer mode is enabled, and now lives
    // on the Developer tab.
    await unlockDeveloperMode(page);
    await page.getByTestId('settings-tab-developer').click();

    const form = page.getByTestId('settings-session-maintenance');
    await form.scrollIntoViewIfNeeded();
    await expect(form).toBeVisible();

    await page.getByTestId('settings-maintenance-mode').selectOption('warn');
    await page.getByTestId('settings-maintenance-prune-after').fill('30d');
    await page.getByTestId('settings-maintenance-max-entries').fill('500');
    await page.getByTestId('settings-maintenance-save').click();

    // Navigate away and back so the form reloads its value from disk, proving the
    // save round-tripped through the host API into openclaw.json.
    await page.getByTestId('sidebar-nav-agents').click();
    await page.getByTestId('sidebar-nav-settings').click();
    await expect(page.getByTestId('settings-tab')).toBeVisible();
    await page.getByTestId('settings-tab-developer').click();
    const modeSelect = page.getByTestId('settings-maintenance-mode');
    await modeSelect.scrollIntoViewIfNeeded();
    await expect(modeSelect).toHaveValue('warn');
  });
});
