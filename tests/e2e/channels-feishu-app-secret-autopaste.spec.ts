import { completeSetup, expect, test } from './fixtures/electron';

/**
 * Covers the Feishu App Secret auto-paste UX:
 *  - After the user clicks "Get Secret" (which opens the Feishu console to copy
 *    the App Secret), focusing the App Secret input auto-fills it from the OS
 *    clipboard — no manual paste needed.
 *  - A clipboard value that doesn't look like a secret is NOT pasted, and the
 *    field is never read before the user opted in via "Get Secret".
 */

const VALID_SECRET = 'AbCdEf1234567890GhIjKl7890';

const baseResponses = {
  channelsAccounts: {
    success: true,
    channels: [
      {
        channelType: 'feishu',
        defaultAccountId: 'default',
        status: 'connected',
        accounts: [
          { accountId: 'default', name: 'Primary Account', configured: true, status: 'connected', isDefault: true },
        ],
      },
    ],
  },
  agents: { success: true, agents: [] },
};

async function installMocks(
  electronApp: import('@playwright/test').ElectronApplication,
  clipboardText: string,
) {
  await electronApp.evaluate(({ ipcMain }, payload) => {
    ipcMain.removeHandler('hostapi:fetch');
    ipcMain.handle('hostapi:fetch', async (_event, request: { path?: string; method?: string }) => {
      const method = request?.method ?? 'GET';
      const path = request?.path ?? '';
      const ok = (json: unknown) => ({ ok: true, data: { status: 200, ok: true, json } });

      if (path === '/api/channels/accounts' && method === 'GET') return ok(payload.responses.channelsAccounts);
      if (path === '/api/agents' && method === 'GET') return ok(payload.responses.agents);
      if (path.startsWith('/api/channels/config/') && method === 'GET') return ok({ success: true, values: {} });
      return { ok: false, error: { message: `Unexpected hostapi:fetch request: ${method} ${path}` } };
    });

    // Stub the auth window so clicking "Get Secret" never spawns a real BrowserWindow.
    ipcMain.removeHandler('shell:openAuthWindow');
    ipcMain.handle('shell:openAuthWindow', async () => undefined);

    // Pretend the user already copied a value to the OS clipboard.
    ipcMain.removeHandler('clipboard:readText');
    ipcMain.handle('clipboard:readText', async () => payload.clipboardText);
  }, { responses: baseResponses, clipboardText });
}

async function openFeishuConfig(page: import('@playwright/test').Page) {
  await page.getByTestId('sidebar-nav-settings').click();
  await page.getByTestId('settings-tab-channels').click();
  await expect(page.getByTestId('channels-tab')).toBeVisible();
  await page.getByRole('button', { name: /Add Account|account\.add/i }).click();
  await expect(page.getByText(/Configure Feishu \/ Lark|dialog\.configureTitle/)).toBeVisible();
  // Filling the App ID reveals the inline "Get Secret" button next to App Secret.
  await page.locator('#appId').fill('cli_e2e_demo');
}

test.describe('Feishu App Secret auto-paste', () => {
  test('auto-fills the App Secret from the clipboard after Get Secret + focus', async ({ electronApp, page }) => {
    await installMocks(electronApp, VALID_SECRET);
    await completeSetup(page);
    await openFeishuConfig(page);

    // Before opting in, focusing the field must NOT read/paste the clipboard.
    await page.locator('#appSecret').focus();
    await expect(page.locator('#appSecret')).toHaveValue('');

    // Opt in, then focus the field — it should auto-paste the copied secret.
    await page.getByRole('button', { name: /Get Secret|autoCreateFeishu\.getSecret/i }).click();
    await page.locator('#appId').focus();
    await page.locator('#appSecret').focus();

    await expect(page.locator('#appSecret')).toHaveValue(VALID_SECRET);
  });

  test('does not paste clipboard content that does not look like a secret', async ({ electronApp, page }) => {
    await installMocks(electronApp, 'hello world this is not a secret');
    await completeSetup(page);
    await openFeishuConfig(page);

    await page.getByRole('button', { name: /Get Secret|autoCreateFeishu\.getSecret/i }).click();
    await page.locator('#appId').focus();
    await page.locator('#appSecret').focus();

    // Implausible clipboard text is rejected; the field stays empty.
    await expect(page.locator('#appSecret')).toHaveValue('');
  });
});
