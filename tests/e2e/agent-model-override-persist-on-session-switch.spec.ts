import type { ElectronApplication, Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

// Regression coverage for: a saved per-agent plain-text model override being
// silently wiped (reverted to the global default) after clicking "New chat".
//
// Root cause (now fixed): ChatInput had a "self-heal" effect that called
// `updateAgentModel(id, null)` whenever the agent's `overrideModelRef` was not an
// EXACT member of the renderer-computed `modelOptions`. Because the per-agent
// model id is free-text, an override could reference a model id that
// `buildConfiguredModelOptions` never enumerates — so the effect wiped a perfectly
// valid override every time "New chat" re-targeted the default agent and re-ran it.
// The effect was removed entirely; stale overrides (whose PROVIDER was deleted) are
// pruned authoritatively by the backend on reconcile instead.
//
// This spec pins that behavior: with the override's model id absent from
// `modelOptions` (but its provider account present), clicking "New chat" must NOT
// issue any `agents.updateModel` null-write and must leave the override intact.

const OVERRIDE_MODEL_REF = 'custom-alpha123/unlisted-model'; // provider configured, model id NOT enumerated
const GLOBAL_DEFAULT_MODEL_REF = 'custom-alpha123/model-alpha';
const MAIN_SESSION_KEY = 'agent:main:main';
const WORKSPACE = '/tmp/clawx-override-persist-workspace';

async function installMocks(app: ElectronApplication) {
  await app.evaluate(async ({ app: _app }, refs) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');

    let overrideModelRef: string | null = refs.overrideModelRef;
    const globals = globalThis as unknown as {
      __nullOverrideWriteCount?: number;
      __currentOverrideRef?: () => string | null;
    };
    globals.__nullOverrideWriteCount = 0;
    globals.__currentOverrideRef = () => overrideModelRef;

    const now = new Date().toISOString();
    const originalHostInvoke = (ipcMain as unknown as {
      _invokeHandlers?: Map<string, (event: unknown, request: unknown) => Promise<unknown>>;
    })._invokeHandlers?.get('host:invoke');
    const makeResponse = (id: unknown, data: unknown) => ({
      id: typeof id === 'string' ? id : undefined,
      ok: true,
      data,
    });

    const agentsSnapshot = () => ({
      success: true,
      agents: [{
        id: 'main',
        name: 'Main',
        isDefault: true,
        modelDisplay: (overrideModelRef ?? refs.globalDefaultModelRef).split('/').slice(1).join('/'),
        modelRef: overrideModelRef ?? refs.globalDefaultModelRef,
        overrideModelRef,
        inheritedModel: !overrideModelRef,
        workspace: refs.workspace,
        agentDir: '~/.openclaw/agents/main/agent',
        mainSessionKey: refs.mainSessionKey,
        channelTypes: [],
      }],
      defaultAgentId: 'main',
      defaultModelRef: refs.globalDefaultModelRef,
      configuredChannelTypes: [],
      channelOwners: {},
      channelAccountOwners: {},
    });

    // alpha123 is configured with `model-alpha` only, so `modelOptions` contains
    // `custom-alpha123/model-alpha` but NOT the override's `.../unlisted-model`.
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
        return { success: true, result: { sessions: [{ key: refs.mainSessionKey, displayName: 'main', workspacePath: refs.workspace, updatedAt: now }] } };
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
          return makeResponse(request.id, { success: true, result: { sessions: [{ key: refs.mainSessionKey, displayName: 'main', workspacePath: refs.workspace, updatedAt: now }] } });
        }
        if (method === 'chat.history') return makeResponse(request.id, { success: true, result: { messages: [] } });
        return makeResponse(request.id, { success: true, result: {} });
      }
      if (request?.module === 'agents' && request.action === 'list') {
        return makeResponse(request.id, agentsSnapshot());
      }
      if (request?.module === 'agents' && request.action === 'updateModel') {
        overrideModelRef = typeof body?.modelRef === 'string' ? body.modelRef : null;
        if (overrideModelRef === null) {
          globals.__nullOverrideWriteCount = (globals.__nullOverrideWriteCount ?? 0) + 1;
        }
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
  }, {
    overrideModelRef: OVERRIDE_MODEL_REF,
    globalDefaultModelRef: GLOBAL_DEFAULT_MODEL_REF,
    workspace: WORKSPACE,
    mainSessionKey: MAIN_SESSION_KEY,
  });
}

async function nullOverrideWriteCount(app: ElectronApplication): Promise<number> {
  return app.evaluate(() => (globalThis as unknown as { __nullOverrideWriteCount?: number }).__nullOverrideWriteCount ?? 0);
}

async function currentOverrideRef(app: ElectronApplication): Promise<string | null> {
  return app.evaluate(() => (globalThis as unknown as { __currentOverrideRef?: () => string | null }).__currentOverrideRef?.() ?? null);
}

async function openChat(app: ElectronApplication): Promise<Page> {
  const page = await getStableWindow(app);
  await page.reload();
  await expect(page.getByTestId('main-layout')).toBeVisible();
  await expect(page.getByTestId('chat-page')).toBeVisible();
  return page;
}

test.describe('Chat per-agent model override persistence', () => {
  test('does not wipe the override on "New chat" when its model id is absent from modelOptions', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installMocks(app);
      const page = await openChat(app);
      await page.waitForTimeout(1200);

      // Baseline: even though the override's model id is not in modelOptions, its
      // provider account exists, so the override must not be cleared.
      expect(await nullOverrideWriteCount(app)).toBe(0);
      expect(await currentOverrideRef(app)).toBe(OVERRIDE_MODEL_REF);

      // Click "New chat": re-targets the default agent and remounts ChatInput —
      // the exact trigger that used to revert the model.
      await page.getByTestId('sidebar-new-chat').click();
      await page.waitForTimeout(1200);

      expect(await nullOverrideWriteCount(app)).toBe(0);
      expect(await currentOverrideRef(app)).toBe(OVERRIDE_MODEL_REF);
    } finally {
      await closeElectronApp(app);
    }
  });
});
