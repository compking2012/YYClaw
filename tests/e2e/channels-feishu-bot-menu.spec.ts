import { completeSetup, expect, test } from './fixtures/electron';

/**
 * Covers the read-only bot quick-command menu notice shown inside the Feishu
 * one-click create/edit panel. Creating a Feishu app auto-configures a "Quick
 * Commands" bot menu; the panel tells the user which slash commands it installs
 * (/new /stop /reset /status /compact) so the behaviour is discoverable before
 * the app is provisioned.
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

async function installFeishuMocks(electronApp: import('@playwright/test').ElectronApplication) {
  await electronApp.evaluate(({ ipcMain }, payload) => {
    ipcMain.removeHandler('hostapi:fetch');
    ipcMain.handle('hostapi:fetch', async (_event, request: { path?: string; method?: string }) => {
      const method = request?.method ?? 'GET';
      const path = request?.path ?? '';
      const ok = (json: unknown) => ({ ok: true, data: { status: 200, ok: true, json } });

      if (path === '/api/channels/accounts' && method === 'GET') return ok(payload.channelsAccounts);
      if (path === '/api/agents' && method === 'GET') return ok(payload.agents);
      if (path === '/api/channels/feishu/candidate-icons' && method === 'GET') return ok(payload.candidateIcons);
      if (path.startsWith('/api/channels/config/') && method === 'GET') return ok({ success: true, values: {} });
      return { ok: false, error: { message: `Unexpected hostapi:fetch request: ${method} ${path}` } };
    });
  }, baseResponses);
}

test.describe('Feishu bot quick-command menu notice', () => {
  test('lists the auto-configured slash commands in the create panel', async ({ electronApp, page }) => {
    await installFeishuMocks(electronApp);
    await completeSetup(page);

    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-tab-channels').click();
    await expect(page.getByTestId('channels-tab')).toBeVisible();
    await page.getByRole('button', { name: /Add Account|account\.add/i }).click();
    await expect(page.getByText(/Configure Feishu \/ Lark|dialog\.configureTitle/)).toBeVisible();
    await page.getByRole('button', { name: /One-click Create Feishu App|autoCreateFeishu\.button/i }).click();

    await expect(
      page.getByText(/Bot quick-command menu|autoCreateFeishu\.botMenu\.title/i).first(),
    ).toBeVisible();
    for (const command of ['/new', '/stop', '/reset', '/status', '/compact']) {
      await expect(page.getByText(command, { exact: true }).first()).toBeVisible();
    }
  });
});
