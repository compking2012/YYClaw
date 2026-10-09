import { closeElectronApp, expect, getRecordedHostInvocations, getStableWindow, installIpcMocks, test } from './fixtures/electron';

test.describe('ClawX voice features', () => {
  test('voice model providers are addable as regular providers with inline voice params', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await app.evaluate(async () => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        const makeResponse = (json: unknown, status = 200) => ({
          ok: true,
          data: { status, ok: status >= 200 && status < 300, json },
        });

        ipcMain.removeHandler('gateway:status');
        ipcMain.handle('gateway:status', async () => ({ state: 'running', port: 18789, pid: 12345 }));

        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async (_event: unknown, method: string) => {
          if (method === 'sessions.list') {
            return { success: true, result: { sessions: [{ key: 'agent:main:main', displayName: 'main' }] } };
          }
          return { success: true, result: {} };
        });

        const agentsSnapshot = {
          success: true,
          agents: [{
            id: 'main', name: 'Main', isDefault: true, modelDisplay: 'model-alpha',
            modelRef: 'custom-alpha/model-alpha', inheritedModel: false,
            workspace: '~/.openclaw/workspace', agentDir: '~/.openclaw/agents/main/agent',
            mainSessionKey: 'agent:main:main', channelTypes: [],
          }],
          defaultAgentId: 'main', defaultModelRef: 'custom-alpha/model-alpha',
          configuredChannelTypes: [], channelOwners: {}, channelAccountOwners: {},
        };

        ipcMain.removeHandler('hostapi:fetch');
        ipcMain.handle('hostapi:fetch', async (_event: unknown, request: { path?: string; method?: string }) => {
          const path = request?.path ?? '';
          if (path === '/api/gateway/status') return makeResponse({ state: 'running', port: 18789, pid: 12345, gatewayReady: true });
          if (path === '/api/agents') return makeResponse(agentsSnapshot);
          if (path === '/api/provider-accounts') return makeResponse([]);
          if (path === '/api/providers') return makeResponse([]);
          if (path === '/api/provider-vendors') return makeResponse([]);
          if (path === '/api/provider-accounts/default') return makeResponse({ accountId: null });
          if (path === '/api/voice/catalog') {
            return makeResponse({ success: true, selections: {} });
          }
          if (path === '/api/voice/selections') {
            return makeResponse({ success: true, selections: {} });
          }
          // No voice configured in openclaw.json → all capabilities false.
          if (path === '/api/voice/config-status') {
            return makeResponse({ success: true, tts: false, transcription: false, realtime: false });
          }
          if (path === '/api/voice/selections') {
            return makeResponse({ success: true, selections: {} });
          }
          if (path === '/api/usage/recent-token-history') return makeResponse({ success: true, history: [] });
          return makeResponse({});
        });
      });

      const page = await getStableWindow(app);
      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win?.webContents.send('gateway:status-changed', { state: 'running', port: 18789, pid: 12345, gatewayReady: true });
      });

      // Composer mic button is present but DISABLED — no transcription configured.
      await expect(page.getByTestId('chat-composer-mic')).toBeVisible();
      await expect(page.getByTestId('chat-composer-mic')).toBeDisabled();

      // Voice providers are no longer a separate list/row — they are regular
      // providers added through the Add Provider dialog.
      await page.getByTestId('sidebar-nav-settings').click();
      await page.getByTestId('settings-tab-models').click();
      await expect(page.getByTestId('models-tab')).toBeVisible();

      // Open the add-provider dialog; the voice provider (from providers.json)
      // shows up as a selectable provider type instead of a bespoke row.
      await page.getByTestId('providers-add-button').click();
      await expect(page.getByTestId('add-provider-dialog')).toBeVisible();
      await page.getByTestId('add-provider-type-openai-voice').click();

      // Voice params are built into the runtime now (not user-configurable), so
      // only the model-id row renders — no per-kind voice param editor.
      await expect(page.getByTestId('add-provider-model-id-input-tts')).toBeVisible();
      await expect(page.getByTestId('kind-params-tts')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('mic button is enabled once transcription is configured', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await getStableWindow(app);
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        recordHostInvocations: true,
        gatewayRpc: { '["sessions.list",{}]': { success: true, result: { sessions: [{ key: 'agent:main:main', workspacePath: '/tmp' }] } } },
        hostApi: {
          '["/api/agents","GET"]': { success: true, agents: [{ id: 'main', name: 'Main', isDefault: true, workspace: '/tmp', mainSessionKey: 'agent:main:main' }] },
          '["chat","loadAcpSession",{"cwd":"/tmp","sessionKey":"agent:main:main","workspaceRoot":"/tmp"}]': { success: true, generation: 1 },
          '["voice","configStatus",null]': { success: true, configured: { tts: false, transcription: true, realtime: false } },
        },
      });

      const page = await getStableWindow(app);
      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await page.getByTestId('sidebar-session-agent:main:main').click();
      await expect.poll(async () => (await getRecordedHostInvocations(app)).filter((call) => (
        call.module === 'gateway' && call.action === 'status'
      )).length).toBeGreaterThanOrEqual(2);
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win?.webContents.send('gateway:status-changed', { state: 'running', port: 18789, pid: 12345, gatewayReady: true });
      });

      await expect(page.getByTestId('chat-composer-mic')).toBeEnabled();
      await expect(page.getByTestId('chat-composer-mic')).toHaveCount(1);
      await expect(page.getByTestId('chat-composer-voice')).toHaveCount(0);
      await app.evaluate(({ ipcMain }) => {
        type HostRequest = { id?: string; module?: string; action?: string };
        type HostHandler = (event: unknown, request: HostRequest) => unknown;
        const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, HostHandler> })._invokeHandlers;
        const previous = handlers.get('host:invoke');
        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', (event, request: HostRequest) => {
          if (request.module === 'asr' && request.action === 'getMicrophoneAccess') {
            return { id: request.id, ok: true, data: { platform: 'darwin', status: 'denied', canOpenSettings: true } };
          }
          return previous?.(event, request);
        });
      });
      await page.getByTestId('chat-composer-mic').click();
      await expect(page.getByTestId('microphone-permission-dialog')).toBeVisible();
      await expect(page.getByTestId('chat-composer-mic')).toBeEnabled();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('global speech synthesis uses the unified enable-toggle pattern', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await app.evaluate(async () => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        const makeResponse = (json: unknown, status = 200) => ({
          ok: true,
          data: { status, ok: status >= 200 && status < 300, json },
        });

        ipcMain.removeHandler('gateway:status');
        ipcMain.handle('gateway:status', async () => ({ state: 'running', port: 18789, pid: 12345 }));
        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async () => ({ success: true, result: {} }));

        const agentsSnapshot = {
          success: true,
          agents: [{
            id: 'main', name: 'Main', isDefault: true, modelDisplay: 'model-alpha',
            modelRef: 'custom-alpha/model-alpha', inheritedModel: false,
            workspace: '~/.openclaw/workspace', agentDir: '~/.openclaw/agents/main/agent',
            mainSessionKey: 'agent:main:main', channelTypes: [],
          }],
          defaultAgentId: 'main', defaultModelRef: 'custom-alpha/model-alpha',
          configuredChannelTypes: [], channelOwners: {}, channelAccountOwners: {},
        };

        ipcMain.removeHandler('hostapi:fetch');
        ipcMain.handle('hostapi:fetch', async (_event: unknown, request: { path?: string }) => {
          const path = request?.path ?? '';
          if (path === '/api/gateway/status') return makeResponse({ state: 'running', port: 18789, pid: 12345, gatewayReady: true });
          if (path === '/api/agents') return makeResponse(agentsSnapshot);
          if (path === '/api/provider-accounts') return makeResponse([]);
          if (path === '/api/providers') return makeResponse([]);
          if (path === '/api/provider-vendors') return makeResponse([]);
          if (path === '/api/provider-accounts/default') return makeResponse({ accountId: null });
          // No TTS provider persisted → speech synthesis starts disabled.
          if (path === '/api/voice/catalog') return makeResponse({ success: true, selections: {} });
          if (path === '/api/voice/selections') return makeResponse({ success: true, selections: {} });
          if (path === '/api/usage/recent-token-history') return makeResponse({ success: true, history: [] });
          return makeResponse({});
        });
      });

      const page = await getStableWindow(app);
      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible();

      await page.getByTestId('sidebar-nav-agents').click();
      await expect(page.getByTestId('agents-page')).toBeVisible();

      await page.getByRole('button', { name: 'Global Config' }).click();
      await page.getByRole('button', { name: 'Speech Synthesis' }).click();

      // Speech synthesis now mirrors the other model tabs: an enable toggle that,
      // while off, hides the provider selector behind the shared disabled placeholder.
      const toggle = page.locator('#enable-custom-model');
      await expect(toggle).toBeVisible();
      await expect(page.getByText('This model type is disabled globally.')).toBeVisible();
      await expect(page.locator('#global-tts-provider')).toHaveCount(0);

      await toggle.click();
      await expect(page.locator('#global-tts-provider')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
