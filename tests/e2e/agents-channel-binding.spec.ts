import { completeSetup, expect, test } from './fixtures/electron';

// Channel-account binding now lives on the Agents page: each agent card has a
// "Bind Channels" button that opens a modal listing every channel account with a
// toggle. Binding an account owned by another agent reassigns it (1:1 constraint),
// with an inline hint showing the current owner.
test.describe('Agents channel binding', () => {
  test('binds an unbound account and reassigns one owned by another agent', async ({ electronApp, page }) => {
    await electronApp.evaluate(({ ipcMain }) => {
      const state = {
        bindingSaves: [] as Array<{ channelType: string; accountId: string; agentId: string }>,
        agents: [
          { id: 'main', name: 'Main Agent', isDefault: true, skills: [], channelTypes: ['feishu'] },
          { id: 'code', name: 'Code Agent', isDefault: false, skills: [], channelTypes: [] },
        ],
        channels: [
          {
            channelType: 'feishu',
            defaultAccountId: 'default',
            status: 'connected',
            accounts: [
              { accountId: 'default', name: 'Primary Account', configured: true, status: 'connected', isDefault: true, agentId: 'main' },
              { accountId: 'feishu-x', name: 'Sales Bot', configured: true, status: 'connected', isDefault: false },
            ],
          },
        ],
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).__clawxE2eAgentBinding = state;

      const originalHostInvoke = (ipcMain as unknown as {
        _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
      })._invokeHandlers?.get('host:invoke');
      const respond = (id: unknown, data: unknown) => ({ id: typeof id === 'string' ? id : undefined, ok: true, data });

      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event, request: { id?: string; module?: string; action?: string; payload?: Record<string, unknown> }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const current = (globalThis as any).__clawxE2eAgentBinding as typeof state;

        if (request?.module === 'agents' && request.action === 'list') {
          return respond(request.id, { success: true, agents: current.agents, defaultAgentId: 'main' });
        }
        if (request?.module === 'channels' && request.action === 'accounts') {
          return respond(request.id, { success: true, channels: current.channels });
        }
        if (request?.module === 'channels' && request.action === 'bindingSave') {
          const body = (request.payload ?? {}) as { channelType: string; accountId: string; agentId: string };
          current.bindingSaves.push({ channelType: body.channelType, accountId: body.accountId, agentId: body.agentId });
          const group = current.channels.find((entry) => entry.channelType === body.channelType);
          const account = group?.accounts.find((entry) => entry.accountId === body.accountId);
          if (account) account.agentId = body.agentId;
          return respond(request.id, { success: true });
        }
        if (request?.module === 'channels' && request.action === 'bindingDelete') {
          return respond(request.id, { success: true });
        }
        if (request?.module === 'voice' && request.action === 'selections') {
          return respond(request.id, { success: true, selections: {} });
        }

        return originalHostInvoke?.(event, request) ?? respond(request?.id, { success: true });
      });

      ipcMain.removeHandler('hostapi:fetch');
      ipcMain.handle('hostapi:fetch', async (_event, request: { path?: string; method?: string }) => {
        if (request?.path === '/api/skills/local' && (request?.method ?? 'GET') === 'GET') {
          return { ok: true, data: { status: 200, ok: true, json: { success: true, skills: [] } } };
        }
        return { ok: true, data: { status: 200, ok: true, json: { success: true } } };
      });
    });

    await completeSetup(page);
    await page.getByTestId('sidebar-nav-agents').click();
    await expect(page.getByTestId('agents-page')).toBeVisible();

    // Open the Code Agent's channel-binding modal.
    await page.getByTestId('agent-card-bind-channels-code').click();
    await expect(page.getByTestId('agent-channel-binding-content')).toBeVisible();

    const unboundToggle = page.getByTestId('agent-channel-binding-toggle-feishu-feishu-x');
    const defaultToggle = page.getByTestId('agent-channel-binding-toggle-feishu-default');

    // Neither account belongs to Code Agent yet.
    await expect(unboundToggle).toHaveAttribute('data-state', 'unchecked');
    await expect(defaultToggle).toHaveAttribute('data-state', 'unchecked');

    // The default account is owned by Main Agent → owner hint is shown.
    const defaultRow = page.getByTestId('agent-channel-binding-account-feishu-default');
    await expect(defaultRow).toContainText('Main Agent');

    // Bind the previously-unbound account.
    await unboundToggle.click();
    await expect(unboundToggle).toHaveAttribute('data-state', 'checked');

    // Reassign the account currently owned by Main Agent.
    await defaultToggle.click();
    await expect(defaultToggle).toHaveAttribute('data-state', 'checked');

    const saves = await electronApp.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return ((globalThis as any).__clawxE2eAgentBinding as { bindingSaves: Array<{ channelType: string; accountId: string; agentId: string }> }).bindingSaves;
    });
    expect(saves).toContainEqual({ channelType: 'feishu', accountId: 'feishu-x', agentId: 'code' });
    expect(saves).toContainEqual({ channelType: 'feishu', accountId: 'default', agentId: 'code' });
  });
});
