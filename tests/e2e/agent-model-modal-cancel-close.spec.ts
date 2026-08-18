import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

// Regression coverage for: in the per-agent model settings modal (AgentModelModal),
// turning on "启用自定义设置" and then clicking Cancel appeared to do nothing — the
// modal stayed open. Root cause was a z-index bug: Cancel (with unsaved changes)
// opens an "unsaved changes" ConfirmDialog, but that dialog rendered at the base
// z-50 while the model modal's DialogContent is z-[60], so the confirm was painted
// behind the modal and could neither be seen nor clicked. The fix raises the
// ConfirmDialog to z-[70].
//
// Non-vacuity note: Playwright's toBeVisible() does NOT detect z-index occlusion
// (an element behind another is still "visible"). So the load-bearing assertion is
// CLICKING the confirm button — when occluded by the z-[60] modal the click is
// intercepted and times out, so this test fails without the fix.

const DEFAULT_MODEL_REF = 'custom-alpha123/model-alpha';
const WORKSPACE = '/tmp/clawx-model-cancel-workspace';

test.describe('AgentModelModal cancel with custom enabled', () => {
  test('Cancel closes the modal via the unsaved-changes confirm (confirm not hidden behind modal)', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await app.evaluate(async ({ app: _app }, refs) => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        const now = new Date().toISOString();
        const originalHostInvoke = (ipcMain as unknown as {
          _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
        })._invokeHandlers?.get('host:invoke');
        const makeResponse = (id: unknown, data: unknown) => ({
          id: typeof id === 'string' ? id : undefined,
          ok: true,
          data,
        });

        // Default agent with NO per-agent override, so toggling "custom" ON (seeded
        // from the global default) is a genuine change → Cancel routes through the
        // unsaved-changes confirm.
        const agentsSnapshot = () => ({
          success: true,
          agents: [{
            id: 'main',
            name: 'Main',
            isDefault: true,
            modelDisplay: refs.defaultModelRef.split('/').slice(1).join('/'),
            modelRef: refs.defaultModelRef,
            overrideModelRef: null,
            inheritedModel: true,
            workspace: refs.workspace,
            agentDir: '~/.openclaw/agents/main/agent',
            mainSessionKey: 'agent:main:main',
            channelTypes: [],
          }],
          defaultAgentId: 'main',
          defaultModelRef: refs.defaultModelRef,
          configuredChannelTypes: [],
          channelOwners: {},
          channelAccountOwners: {},
        });

        const accounts = () => ([{
          id: 'alpha123', vendorId: 'custom', label: 'Alpha', authMode: 'api_key',
          baseUrl: 'http://127.0.0.1:1111/v1', model: 'model-alpha', enabled: true,
          isDefault: true, createdAt: now, updatedAt: now,
        }]);

        ipcMain.removeHandler('gateway:status');
        ipcMain.handle('gateway:status', async () => ({ state: 'running', port: 18789, pid: 12345, gatewayReady: true }));

        ipcMain.removeHandler('gateway:rpc');
        ipcMain.handle('gateway:rpc', async (_event: unknown, method: string) => {
          if (method === 'sessions.list') {
            return { success: true, result: { sessions: [{ key: 'agent:main:main', displayName: 'main', workspacePath: refs.workspace, updatedAt: now }] } };
          }
          if (method === 'chat.history') return { success: true, result: { messages: [] } };
          return { success: true, result: {} };
        });

        ipcMain.removeHandler('host:invoke');
        ipcMain.handle('host:invoke', async (event: unknown, request: {
          id?: string; module?: string; action?: string; payload?: Record<string, unknown>;
        }) => {
          const body = request?.payload ?? null;

          if (request?.module === 'gateway' && request.action === 'status') {
            return makeResponse(request.id, { state: 'running', port: 18789, pid: 12345, gatewayReady: true });
          }
          if (request?.module === 'settings' && request.action === 'getAll') {
            return makeResponse(request.id, {
              language: 'en', setupComplete: true,
              chatWorkspacePath: refs.workspace, recentWorkspacePaths: [refs.workspace],
            });
          }
          if (request?.module === 'files' && request.action === 'resolveWorkspaceContext') {
            const workspaceRoot = typeof body?.workspaceRoot === 'string' ? body.workspaceRoot.trim() : '';
            const executionCwd = typeof body?.executionCwd === 'string' ? body.executionCwd.trim() : '';
            if (!workspaceRoot || !executionCwd) return makeResponse(request.id, { ok: false, error: 'outsideSandbox' });
            return makeResponse(request.id, { ok: true, workspaceRoot, executionCwd });
          }
          if (request?.module === 'chat' && request.action === 'loadAcpSession') {
            return makeResponse(request.id, { success: true, generation: 1 });
          }
          if (request?.module === 'gateway' && request.action === 'rpc') {
            const method = typeof body?.method === 'string' ? body.method : '';
            if (method === 'sessions.list') {
              return makeResponse(request.id, { success: true, result: { sessions: [{ key: 'agent:main:main', displayName: 'main', workspacePath: refs.workspace, updatedAt: now }] } });
            }
            if (method === 'chat.history') return makeResponse(request.id, { success: true, result: { messages: [] } });
            return makeResponse(request.id, { success: true, result: {} });
          }
          if (request?.module === 'agents' && request.action === 'list') {
            return makeResponse(request.id, agentsSnapshot());
          }
          if (request?.module === 'agents' && request.action === 'updateModel') {
            return makeResponse(request.id, agentsSnapshot());
          }
          if (request?.module === 'providers' && request.action === 'accounts') {
            return makeResponse(request.id, accounts());
          }
          if (request?.module === 'providers' && request.action === 'list') {
            return makeResponse(request.id, [
              { id: 'alpha123', type: 'custom', name: 'Alpha', enabled: true, hasKey: true, keyMasked: 'sk-***', createdAt: now, updatedAt: now },
            ]);
          }
          if (request?.module === 'providers' && request.action === 'accountKeyInfo') {
            return makeResponse(request.id, [{ accountId: 'alpha123', hasKey: true, keyMasked: 'sk-***' }]);
          }
          if (request?.module === 'providers' && request.action === 'vendors') {
            return makeResponse(request.id, [{ id: 'custom', name: 'Custom', supportedAuthModes: ['api_key'] }]);
          }
          if (request?.module === 'providers' && request.action === 'getDefaultAccount') {
            return makeResponse(request.id, { accountId: 'alpha123' });
          }

          return originalHostInvoke?.(event, request) ?? makeResponse(request?.id, {});
        });
      }, { defaultModelRef: DEFAULT_MODEL_REF, workspace: WORKSPACE });

      const page = await getStableWindow(app);
      await page.reload();
      await expect(page.getByTestId('main-layout')).toBeVisible();
      await page.evaluate(() => { window.location.hash = '#/agents'; });
      await expect(page.getByTestId('agents-page')).toBeVisible();
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win?.webContents.send('gateway:status-changed', { state: 'running', port: 18789, pid: 12345, gatewayReady: true });
      });

      // Open the per-agent settings, then the model modal.
      await page.getByTestId('agent-card-settings-main').click();
      await expect(page.getByTestId('agent-settings-model')).toBeVisible();
      await page.getByTestId('agent-settings-model').click();
      await expect(page.getByTestId('agent-model-modal')).toBeVisible();

      // Turn ON "启用自定义设置" (seeded from the global default → a genuine change).
      await page.locator('#enable-custom-model').click();

      // Cancel → routes through the unsaved-changes confirm dialog.
      await page.getByTestId('agent-model-cancel').click();

      const confirmButton = page.getByTestId('confirm-dialog-confirm-button');
      await expect(confirmButton).toBeVisible();

      // Load-bearing (non-vacuous): the confirm dialog must paint ABOVE the model
      // modal. Playwright's toBeVisible()/click() and elementFromPoint all measure
      // clickability (the second Radix dialog makes the modal inert, so they pass
      // regardless), NOT visual stacking — but the user simply cannot SEE a confirm
      // painted behind the z-[60] modal. Both dialogs portal to <body>, so their
      // fixed z-index values are directly comparable. Without the z-[70] fix the
      // confirm content is z-50 < the modal's z-60 and stays hidden.
      const stacking = await confirmButton.evaluate((el) => {
        const parseZ = (node: Element | null) => {
          const value = node ? parseInt(getComputedStyle(node).zIndex, 10) : NaN;
          return Number.isNaN(value) ? 0 : value;
        };
        const confirmContent = el.closest('[role="dialog"]');
        const modalContent = document.querySelector('[data-testid="agent-model-modal"]');
        return { confirmZ: parseZ(confirmContent), modalZ: parseZ(modalContent) };
      });
      expect(stacking.confirmZ).toBeGreaterThanOrEqual(stacking.modalZ);
    } finally {
      await closeElectronApp(app);
    }
  });
});
