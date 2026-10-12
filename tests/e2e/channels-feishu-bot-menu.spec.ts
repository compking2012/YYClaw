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
    const originalHostInvoke = (ipcMain as unknown as {
      _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
    })._invokeHandlers?.get('host:invoke');
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event, request: { id?: string; module?: string; action?: string }) => {
      const respond = (data: unknown) => ({ id: request.id, ok: true, data });
      if (request.module === 'channels' && request.action === 'accounts') return respond(payload.channelsAccounts);
      if (request.module === 'agents' && request.action === 'list') return respond(payload.agents);
      if (request.module === 'channels' && request.action === 'formValues') return respond({ success: true, values: {} });
      if (request.module === 'channels' && request.action === 'feishuCandidateIcons') return respond(payload.candidateIcons);
      if (request.module === 'channels' && request.action === 'saveConfig') return respond({ success: true });
      return originalHostInvoke?.(event, request) ?? respond({});
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
