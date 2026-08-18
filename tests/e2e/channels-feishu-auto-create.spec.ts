import { completeSetup, expect, test } from './fixtures/electron';

/**
 * Covers the Feishu one-click app-creation UX after the create/edit refactor:
 *  - When the app is created but the (optional) Lark CLI sign-in is still
 *    pending, the user sees a success toast plus a non-blocking "pending" notice
 *    — never a hard error, and never the old double-prefixed "Error: Error:" text.
 *  - When creation fails after the app was provisioned, the user sees a friendly
 *    message pointing to the Feishu console (the app was auto-disabled), not a raw
 *    error dump.
 */

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
  candidateIcons: { success: true, candidates: [] },
};

async function installFeishuMocks(
  electronApp: import('@playwright/test').ElectronApplication,
  autoCreateResponse: Record<string, unknown>,
  responses: typeof baseResponses,
) {
  await electronApp.evaluate(({ ipcMain }, payload) => {
    ipcMain.removeHandler('hostapi:fetch');
    ipcMain.handle('hostapi:fetch', async (_event, request: { path?: string; method?: string }) => {
      const method = request?.method ?? 'GET';
      const path = request?.path ?? '';
      const ok = (json: unknown) => ({ ok: true, data: { status: 200, ok: true, json } });

      if (path === '/api/channels/accounts' && method === 'GET') return ok(payload.responses.channelsAccounts);
      if (path === '/api/agents' && method === 'GET') return ok(payload.responses.agents);
      if (path === '/api/channels/feishu/candidate-icons' && method === 'GET') return ok(payload.responses.candidateIcons);
      if (path === '/api/channels/feishu/auto-create' && method === 'POST') return ok(payload.autoCreateResponse);
      if (path.startsWith('/api/channels/config/') && method === 'GET') return ok({ success: true, values: {} });
      if (path === '/api/channels/config' && method === 'POST') return ok({ success: true });
      return { ok: false, error: { message: `Unexpected hostapi:fetch request: ${method} ${path}` } };
    });
  }, { autoCreateResponse, responses });
}

async function openAutoCreatePanel(page: import('@playwright/test').Page) {
  await page.getByTestId('sidebar-nav-settings').click();
  await page.getByTestId('settings-tab-channels').click();
  await expect(page.getByTestId('channels-tab')).toBeVisible();
  await page.getByRole('button', { name: /Add Account|account\.add/i }).click();
  await expect(page.getByText(/Configure Feishu \/ Lark|dialog\.configureTitle/)).toBeVisible();
  // Open the one-click create panel, then confirm.
  await page.getByRole('button', { name: /One-click Create Feishu App|autoCreateFeishu\.button/i }).click();
  await page.getByRole('button', { name: /Confirm Creation|autoCreateFeishu\.confirm/i }).click();
}

test.describe('Feishu one-click app creation UX', () => {
  test('shows a success toast and a non-error pending notice when Lark CLI sign-in is not ready', async ({ electronApp, page }) => {
    await installFeishuMocks(
      electronApp,
      { success: true, app_id: 'cli_e2e_demo', app_secret: 'secret_e2e_demo', larkCliReady: false },
      baseResponses,
    );
    await completeSetup(page);
    await openAutoCreatePanel(page);

    await expect(page.getByText(/Feishu app created successfully|autoCreateFeishu\.success/i).first()).toBeVisible();
    await expect(page.getByText(/Lark CLI sign-in is still pending|autoCreateFeishu\.larkCliPending/i).first()).toBeVisible();
    // The old contradictory "continuing anyway" hard error must not surface.
    await expect(page.getByText(/Error: Error:|continuing anyway/i)).toHaveCount(0);
  });

  test('shows a friendly console-pointing message when creation fails after provisioning', async ({ electronApp, page }) => {
    await installFeishuMocks(
      electronApp,
      { success: false, error: 'Failed to publish app: [99991] internal', disabledAppId: 'cli_e2e_fail', manageUrl: 'https://open.feishu.cn/app/cli_e2e_fail/baseinfo?lang=zh_cn' },
      baseResponses,
    );
    await completeSetup(page);
    await openAutoCreatePanel(page);

    await expect(page.getByText(/the app was disabled|autoCreateFeishu\.createFailedDisabled/i).first()).toBeVisible();
    await expect(page.getByText(/Error: Error:/)).toHaveCount(0);
  });
});
