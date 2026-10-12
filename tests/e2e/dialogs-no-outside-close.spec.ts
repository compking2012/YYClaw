import { closeElectronApp, completeSetup, expect, getStableWindow, test } from './fixtures/electron';

/**
 * Some popups must not dismiss when the user clicks the blank backdrop/overlay area.
 * Skills marketplace sheets are an exception and close on overlay click.
 */

const channelResponses = {
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

async function installChannelMocks(electronApp: import('@playwright/test').ElectronApplication) {
  await electronApp.evaluate(({ ipcMain }, responses) => {
    const originalHostInvoke = (ipcMain as unknown as {
      _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
    })._invokeHandlers?.get('host:invoke');
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event, request: { id?: string; module?: string; action?: string }) => {
      const respond = (data: unknown) => ({ id: request.id, ok: true, data });
      if (request.module === 'channels' && request.action === 'accounts') return respond(responses.channelsAccounts);
      if (request.module === 'agents' && request.action === 'list') return respond(responses.agents);
      if (request.module === 'channels' && request.action === 'formValues') return respond({ success: true, values: {} });
      if (request.module === 'channels' && request.action === 'feishuCandidateIcons') return respond(responses.candidateIcons);
      if (request.module === 'channels' && request.action === 'saveConfig') return respond({ success: true });
      return originalHostInvoke?.(event, request) ?? respond({});
    });
  }, channelResponses);
}

test.describe('Dialog dismiss behavior', () => {
  test('ChannelConfigModal stays open when the backdrop is clicked, closes via the X button', async ({ electronApp, page }) => {
    await installChannelMocks(electronApp);
    await completeSetup(page);

    await page.getByTestId('sidebar-nav-settings').click();

    await page.getByTestId('settings-tab-channels').click();
    await expect(page.getByTestId('channels-tab')).toBeVisible();
    // The configured feishu group exposes an "Add Account" button (locale: zh -> "添加账号").
    await page.getByRole('button', { name: /添加账号|Add Account/i }).first().click();

    // The modal is open once its close affordance is mounted (locale-independent).
    const closeButton = page.getByTestId('channel-config-close');
    await expect(closeButton).toBeVisible();

    // Click the blank backdrop area to the far left of the centered card.
    const box = await closeButton.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(6, box!.y + 80);

    // The dialog must remain open after clicking the backdrop.
    await expect(closeButton).toBeVisible();

    // The explicit close button still dismisses it.
    await closeButton.click();
    await expect(closeButton).toHaveCount(0);
  });

  test('Skills sheets close via the exit button', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-nav-settings').click();

      await page.getByTestId('settings-tab-skills').click();
      await expect(page.getByTestId('skills-tab')).toBeVisible();
      await page.getByTestId('skills-install-button').click();

      const installSheet = page.getByTestId('skills-server-install-sheet');
      await expect(installSheet).toBeVisible();

      await page.getByTestId('skills-install-sheet-exit').click();
      await expect(installSheet).toHaveCount(0);

      await page.getByTestId('skills-lifecycle-button').click();
      const lifecycleSheet = page.getByTestId('skills-lifecycle-sheet');
      await expect(lifecycleSheet).toBeVisible();

      await page.getByTestId('skills-publish-sheet-exit').click();
      await expect(lifecycleSheet).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('agent selector remains interactive after closing the skills side sheet', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-nav-settings').click();

      await page.getByTestId('settings-tab-skills').click();
      await expect(page.getByTestId('skills-tab')).toBeVisible();
      await expect(page.getByTestId('skill-list-item').first()).toBeVisible();

      await page.getByTestId('skills-install-button').click();
      await expect(page.getByTestId('skills-server-install-sheet')).toBeVisible();
      await page.getByTestId('skills-install-sheet-exit').click();
      await expect(page.getByTestId('skills-server-install-sheet')).toHaveCount(0);

      const skillRow = page.getByTestId('skill-list-item').first();
      await skillRow.getByTestId('skill-agent-assign-button').click();

      await expect(page.getByTestId('skill-agent-selector-dialog')).toBeVisible();
      await expect(page.getByTestId('skill-agent-selector-global-bar')).toBeVisible();
      await expect(
        page.getByTestId('skill-agent-selector-set-global')
          .or(page.getByTestId('skill-agent-selector-remove-global')),
      ).toBeVisible();
      await expect(page.getByTestId('skill-agent-selector-save')).toBeVisible();
      await expect(page.getByTestId('skill-agent-selector-exit')).toBeVisible();

      // Windows frameless titlebar uses -webkit-app-region: drag; without no-drag,
      // Electron steals clicks on the header Save/Exit controls.
      await expect(page.getByTestId('skill-agent-selector-dialog')).toHaveClass(/\bno-drag\b/);
      await expect(page.getByTestId('skill-agent-selector-save')).toHaveClass(/\bno-drag\b/);
      await expect(page.getByTestId('skill-agent-selector-exit')).toHaveClass(/\bno-drag\b/);

      await page.getByTestId('skill-agent-selector-exit').click();
      await expect(page.getByTestId('skill-agent-selector-dialog')).toBeHidden();

      // Closing must not leave an invisible overlay that blocks page clicks.
      await page.getByTestId('skills-install-button').click();
      await expect(page.getByTestId('skills-server-install-sheet')).toBeVisible();
      await page.getByTestId('skills-install-sheet-exit').click();
      await expect(page.getByTestId('skills-server-install-sheet')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
