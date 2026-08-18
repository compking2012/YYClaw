import { completeSetup, expect, test } from './fixtures/electron';

/**
 * Regression guard for the shared <ModalPortal> wrapper (src/components/ui/modal-portal.tsx).
 *
 * App modals (channel config, add-model/provider, etc.) are portaled to <body>,
 * outside the System Settings Radix dialog. That outer dialog's FocusScope traps
 * focus: when the user clicks an input inside the portaled modal, the focusout of
 * the previously-focused control (a button *inside* the dialog) reaches the
 * FocusScope's document listener, which yanks focus back — so the input never
 * focuses and no caret appears. ModalPortal must neutralise that steal.
 *
 * `.fill()` sets the value directly and would pass even while broken; this test
 * uses a real click + per-key typing so it actually exercises sustained focus.
 */

const responses = {
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

test.describe('ModalPortal input focus', () => {
  test('can click into and type in a portaled modal input while Settings is open', async ({ electronApp, page }) => {
    await electronApp.evaluate(({ ipcMain }, res) => {
      const respond = (id: unknown, data: unknown) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });
      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (_event, request: { id?: string; module?: string; action?: string }) => {
        if (request?.module === 'channels' && request.action === 'accounts') return respond(request.id, res.channelsAccounts);
        if (request?.module === 'agents' && request.action === 'list') return respond(request.id, res.agents);
        if (request?.module === 'channels' && request.action === 'formValues') return respond(request.id, { success: true, values: {} });
        return respond(request?.id, {});
      });
    }, responses);

    await completeSetup(page);

    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-tab-channels').click();
    await expect(page.getByTestId('channels-tab')).toBeVisible();

    // Open the portaled channel-config modal from a button *inside* the Settings dialog.
    await page.getByRole('button', { name: /添加账号|Add Account/i }).first().click();
    await expect(page.getByTestId('channel-config-close')).toBeVisible();

    const input = page.locator('#account-id');
    await expect(input).toBeVisible();

    // Real click to focus (not .fill), then verify focus actually landed and stuck.
    await input.click();
    await expect(input).toBeFocused();

    // Per-key typing requires sustained focus across keystrokes.
    await input.pressSequentially('mybot', { delay: 20 });
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('mybot');
  });
});
