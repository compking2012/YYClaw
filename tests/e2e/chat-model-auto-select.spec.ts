import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const configuredModelRef = 'custom-alpha123/model-alpha';

type Scenario = {
  /** Seeds the agent's `autoSelectModel.model` flag (the Agents-page setting). */
  autoSelectModel: boolean;
};

/**
 * Boot the chat composer with one agent and two provider accounts, recording
 * every `agents.updateAutoSelect` call so tests can assert what the picker
 * persisted.
 */
async function renderComposerWithScenario(
  launchElectronApp: (options?: { skipSetup?: boolean }) => Promise<ElectronApplication>,
  scenario: Scenario,
): Promise<ElectronApplication> {
  const app = await launchElectronApp({ skipSetup: true });

  await app.evaluate(async ({ app: _app }, refs) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    const now = new Date().toISOString();
    const autoSelectCalls: unknown[] = [];
    let autoSelectOn = refs.scenario.autoSelectModel;
    const makeResponse = (id: unknown, data: unknown) => ({
      id: typeof id === 'string' ? id : undefined,
      ok: true,
      data,
    });

    ipcMain.removeHandler('gateway:status');
    ipcMain.handle('gateway:status', async () => ({ state: 'running', port: 18789, pid: 12345 }));

    ipcMain.removeHandler('gateway:rpc');
    ipcMain.handle('gateway:rpc', async (_event: unknown, method: string) => {
      if (method === 'sessions.list') {
        return { success: true, result: { sessions: [{ key: 'agent:main:main', displayName: 'main' }] } };
      }
      if (method === 'chat.history') {
        return { success: true, result: { messages: [] } };
      }
      return { success: true, result: {} };
    });

    const agentsSnapshot = () => ({
      success: true,
      agents: [{
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: 'model-alpha',
        modelRef: refs.configuredModelRef,
        overrideModelRef: refs.configuredModelRef,
        inheritedModel: false,
        autoSelectModel: { model: autoSelectOn },
        workspace: '~/.openclaw/workspace',
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: 'agent:main:main',
        channelTypes: [],
      }],
      defaultAgentId: 'main',
      defaultModelRef: refs.configuredModelRef,
      configuredChannelTypes: [],
      channelOwners: {},
      channelAccountOwners: {},
    });

    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (_event: unknown, request: {
      id?: string;
      module?: string;
      action?: string;
      payload?: Record<string, unknown>;
    }) => {
      if (request?.module === 'gateway' && request.action === 'status') {
        return makeResponse(request.id, { state: 'running', port: 18789, pid: 12345, gatewayReady: true });
      }
      if (request?.module === 'gateway' && request.action === 'rpc') {
        const method = typeof request.payload?.method === 'string' ? request.payload.method : '';
        if (method === 'sessions.list') {
          return makeResponse(request.id, { success: true, result: { sessions: [{ key: 'agent:main:main', displayName: 'main' }] } });
        }
        if (method === 'chat.history') {
          return makeResponse(request.id, { success: true, result: { messages: [] } });
        }
        return makeResponse(request.id, { success: true, result: {} });
      }
      if (request?.module === 'agents' && request.action === 'list') {
        return makeResponse(request.id, agentsSnapshot());
      }
      if (request?.module === 'agents' && request.action === 'updateAutoSelect') {
        autoSelectCalls.push(request.payload);
        const next = (request.payload?.autoSelectModel as { model?: boolean } | undefined)?.model;
        if (typeof next === 'boolean') autoSelectOn = next;
        return makeResponse(request.id, agentsSnapshot());
      }
      if (request?.module === 'usage' && request.action === 'recentTokenHistory') {
        return makeResponse(request.id, []);
      }
      if (request?.module === 'providers' && request.action === 'accounts') {
        return makeResponse(request.id, [
          {
            id: 'alpha123',
            vendorId: 'custom',
            label: 'Alpha',
            authMode: 'api_key',
            baseUrl: 'http://127.0.0.1:1111/v1',
            model: 'model-alpha',
            enabled: true,
            isDefault: true,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'beta5678',
            vendorId: 'custom',
            label: 'Beta',
            authMode: 'api_key',
            baseUrl: 'http://127.0.0.1:2222/v1',
            model: 'model-beta',
            enabled: true,
            isDefault: false,
            createdAt: now,
            updatedAt: now,
          },
        ]);
      }
      if (request?.module === 'providers' && request.action === 'list') {
        return makeResponse(request.id, [
          { id: 'alpha123', type: 'custom', name: 'Alpha', enabled: true, hasKey: true, keyMasked: 'sk-***', createdAt: now, updatedAt: now },
          { id: 'beta5678', type: 'custom', name: 'Beta', enabled: true, hasKey: true, keyMasked: 'sk-***', createdAt: now, updatedAt: now },
        ]);
      }
      if (request?.module === 'providers' && request.action === 'accountKeyInfo') {
        return makeResponse(request.id, [
          { accountId: 'alpha123', hasKey: true, keyMasked: 'sk-***' },
          { accountId: 'beta5678', hasKey: true, keyMasked: 'sk-***' },
        ]);
      }
      if (request?.module === 'providers' && request.action === 'vendors') {
        return makeResponse(request.id, []);
      }
      if (request?.module === 'providers' && request.action === 'getDefaultAccount') {
        return makeResponse(request.id, { accountId: 'alpha123' });
      }

      return makeResponse(request?.id, {});
    });

    (globalThis as typeof globalThis & { __autoSelectCalls?: unknown[] }).__autoSelectCalls = autoSelectCalls;
  }, { configuredModelRef, scenario });

  const page = await getStableWindow(app);
  await page.reload();
  await expect(page.getByTestId('main-layout')).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.webContents.send('gateway:status-changed', { state: 'running', port: 18789, pid: 12345, gatewayReady: true });
  });

  return app;
}

test.describe('ClawX chat composer auto-select model', () => {
  test('no longer prints the model name in the composer footer', async ({ launchElectronApp }) => {
    const app = await renderComposerWithScenario(launchElectronApp, { autoSelectModel: false });

    try {
      const page = await getStableWindow(app);
      // The picker button is the single place the current model is shown.
      await expect(page.getByTestId('chat-model-picker-button')).toBeVisible();
      await expect(page.getByTestId('chat-composer-model-indicator')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('offers auto-select in the model picker and persists it on the agent', async ({ launchElectronApp }) => {
    const app = await renderComposerWithScenario(launchElectronApp, { autoSelectModel: false });

    try {
      const page = await getStableWindow(app);
      await page.getByTestId('chat-model-picker-button').click();
      const autoOption = page.getByTestId('chat-model-picker-option-auto');
      await expect(autoOption).toBeVisible();
      await autoOption.click();

      // Same host route the Agents page uses for its auto-select toggle.
      await expect.poll(async () => app.evaluate(() => (
        (globalThis as typeof globalThis & { __autoSelectCalls?: unknown[] }).__autoSelectCalls ?? []
      ))).toEqual([{ id: 'main', autoSelectModel: { model: true } }]);

      // Button switches from the model name to the auto label.
      await expect(page.getByTestId('chat-model-picker-button')).toContainText('Auto');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('reflects an already-on agent auto-select setting', async ({ launchElectronApp }) => {
    const app = await renderComposerWithScenario(launchElectronApp, { autoSelectModel: true });

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('chat-model-picker-button')).toContainText('Auto');

      await page.getByTestId('chat-model-picker-button').click();
      // Auto is the selected row, so no concrete model is marked as current.
      await expect(page.getByTestId('chat-model-picker-option-auto')).toHaveClass(/bg-primary\/10/);
      await expect(page.getByTestId('chat-model-picker-option-Alpha')).not.toHaveClass(/bg-primary\/10/);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('turns auto-select off when a concrete model is picked', async ({ launchElectronApp }) => {
    const app = await renderComposerWithScenario(launchElectronApp, { autoSelectModel: true });

    try {
      const page = await getStableWindow(app);
      await page.getByTestId('chat-model-picker-button').click();
      await page.getByTestId('chat-model-picker-option-Beta').click();

      await expect.poll(async () => app.evaluate(() => (
        (globalThis as typeof globalThis & { __autoSelectCalls?: unknown[] }).__autoSelectCalls ?? []
      ))).toEqual([{ id: 'main', autoSelectModel: { model: false } }]);
    } finally {
      await closeElectronApp(app);
    }
  });
});
