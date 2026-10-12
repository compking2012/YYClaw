import { completeSetup, expect, test } from './fixtures/electron';
import { E2E_EXCLUSIVE_TAG } from './parallel-policy';

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
  await electronApp.evaluate(({ ipcMain, BrowserWindow }, payload) => {
    BrowserWindow.getAllWindows()[0]?.focus();
    const state = globalThis as typeof globalThis & { __feishuShellCalls: string[] };
    state.__feishuShellCalls = [];
    const originalHostInvoke = (ipcMain as unknown as {
      _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
    })._invokeHandlers?.get('host:invoke');
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event, request: { id?: string; module?: string; action?: string }) => {
      const respond = (data: unknown) => ({ id: request.id, ok: true, data });
      if (request.module === 'shell') state.__feishuShellCalls.push(request.action ?? '');
      if (request.module === 'channels' && request.action === 'accounts') return respond(payload.responses.channelsAccounts);
      if (request.module === 'agents' && request.action === 'list') return respond(payload.responses.agents);
      if (request.module === 'channels' && request.action === 'formValues') return respond({ success: true, values: {} });
      if (request.module === 'channels' && request.action === 'saveConfig') return respond({ success: true });
      if (request.module === 'shell' && request.action === 'readClipboardText') return respond(payload.clipboardText);
      if (request.module === 'shell' && request.action === 'openAuthWindow') return respond(undefined);
      return originalHostInvoke?.(event, request) ?? respond({});
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

test.describe('Feishu App Secret auto-paste', { tag: E2E_EXCLUSIVE_TAG }, () => {
  test('auto-fills the App Secret from the clipboard after Get Secret + focus', async ({ electronApp, page }) => {
    await installMocks(electronApp, VALID_SECRET);
    await completeSetup(page);
    await openFeishuConfig(page);

    // Before opting in, focusing the field must NOT read/paste the clipboard.
    await page.locator('#appSecret').click();
    await expect(page.locator('#appSecret')).toHaveValue('');

    // Opt in, then focus the field — it should auto-paste the copied secret.
    await page.getByRole('button', { name: /Get Secret|autoCreateFeishu\.getSecret/i }).click();
    await expect.poll(() => electronApp.evaluate(() => (
      globalThis as typeof globalThis & { __feishuShellCalls: string[] }
    ).__feishuShellCalls)).toContain('openAuthWindow');
    await page.locator('#appId').click();
    await page.locator('#appSecret').click();
    await expect(page.locator('#appSecret')).toBeFocused();
    await expect.poll(() => electronApp.evaluate(() => (
      globalThis as typeof globalThis & { __feishuShellCalls: string[] }
    ).__feishuShellCalls)).toContain('readClipboardText');

    await expect(page.locator('#appSecret')).toHaveValue(VALID_SECRET);
  });

  test('does not paste clipboard content that does not look like a secret', async ({ electronApp, page }) => {
    await installMocks(electronApp, 'hello world this is not a secret');
    await completeSetup(page);
    await openFeishuConfig(page);

    await page.getByRole('button', { name: /Get Secret|autoCreateFeishu\.getSecret/i }).click();
    await page.locator('#appId').click();
    await page.locator('#appSecret').click();

    // Implausible clipboard text is rejected; the field stays empty.
    await expect(page.locator('#appSecret')).toHaveValue('');
  });
});
