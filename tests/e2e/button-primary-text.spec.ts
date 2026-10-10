import { completeSetup, expect, test } from './fixtures/electron';

test('purple primary buttons use white text in light and dark themes', async ({ page }) => {
  const next = page.getByTestId('setup-next-button');
  await expect(next).toBeVisible();
  for (const dark of [false, true]) {
    await page.evaluate((enabled) => document.documentElement.classList.toggle('dark', enabled), dark);
    await expect(next).toHaveCSS('color', 'rgb(255, 255, 255)');
    const background = await next.evaluate((button) => getComputedStyle(button).backgroundColor);
    expect(background).not.toBe('rgba(0, 0, 0, 0)');
  }
  await completeSetup(page);
  await page.getByTestId('sidebar-nav-settings').click();
  await page.getByTestId('settings-tab-models').click();
  const add = page.getByTestId('providers-add-button');
  for (const dark of [false, true]) {
    await page.evaluate((enabled) => document.documentElement.classList.toggle('dark', enabled), dark);
    await expect(add).toHaveCSS('color', 'rgb(255, 255, 255)');
  }
});
