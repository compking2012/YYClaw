import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, test } from './fixtures/electron';

const chatModelRef = 'custom-chat1234/model-chat';

/** Boot the app with three provider accounts so the composer renders its full action row. */
async function launchComposer(
  launchElectronApp: (options?: { skipSetup?: boolean }) => Promise<ElectronApplication>,
): Promise<ElectronApplication> {
  const app = await launchElectronApp({ skipSetup: true });

  await app.evaluate(async ({ app: _app }, refs) => {
        const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
        const now = new Date().toISOString();
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
            return makeResponse(request.id, {
              success: true,
              agents: [{
                id: 'main',
                name: 'Main',
                isDefault: true,
                modelDisplay: 'model-chat',
                modelRef: refs.chatModelRef,
                overrideModelRef: refs.chatModelRef,
                inheritedModel: false,
                workspace: '~/.openclaw/workspace',
                agentDir: '~/.openclaw/agents/main/agent',
                mainSessionKey: 'agent:main:main',
                channelTypes: [],
              }],
              defaultAgentId: 'main',
              defaultModelRef: refs.chatModelRef,
              configuredChannelTypes: [],
              channelOwners: {},
              channelAccountOwners: {},
            });
          }
          if (request?.module === 'usage' && request.action === 'recentTokenHistory') {
            return makeResponse(request.id, []);
          }
          if (request?.module === 'providers' && request.action === 'accounts') {
            return makeResponse(request.id, [
              {
                id: 'chat1234',
                vendorId: 'custom',
                label: 'ChatOnly',
                authMode: 'api_key',
                baseUrl: 'http://127.0.0.1:1111/v1',
                modelType: ['text'],
                model: 'model-chat',
                enabled: true,
                isDefault: true,
                createdAt: now,
                updatedAt: now,
              },
              {
                id: 'vision56',
                vendorId: 'custom',
                label: 'VisionChat',
                authMode: 'api_key',
                baseUrl: 'http://127.0.0.1:2222/v1',
                // Chat model that also accepts image input — the picker used to
                // drop these because their kind set wasn't exactly ['text'].
                modelType: ['text', 'image'],
                model: 'model-vision,model-vision',
                enabled: true,
                isDefault: false,
                createdAt: now,
                updatedAt: now,
              },
              {
                id: 'painter9',
                vendorId: 'custom',
                label: 'Painter',
                authMode: 'api_key',
                baseUrl: 'http://127.0.0.1:3333/v1',
                modelType: ['image_generate'],
                model: 'model-image',
                enabled: true,
                isDefault: false,
                createdAt: now,
                updatedAt: now,
              },
            ]);
          }
          if (request?.module === 'providers' && request.action === 'list') {
            return makeResponse(request.id, [
              { id: 'chat1234', type: 'custom', name: 'ChatOnly', enabled: true, hasKey: true, keyMasked: 'sk-***', createdAt: now, updatedAt: now },
              { id: 'vision56', type: 'custom', name: 'VisionChat', enabled: true, hasKey: true, keyMasked: 'sk-***', createdAt: now, updatedAt: now },
              { id: 'painter9', type: 'custom', name: 'Painter', enabled: true, hasKey: true, keyMasked: 'sk-***', createdAt: now, updatedAt: now },
            ]);
          }
          if (request?.module === 'providers' && request.action === 'accountKeyInfo') {
            return makeResponse(request.id, [
              { accountId: 'chat1234', hasKey: true, keyMasked: 'sk-***' },
              { accountId: 'vision56', hasKey: true, keyMasked: 'sk-***' },
              { accountId: 'painter9', hasKey: true, keyMasked: 'sk-***' },
            ]);
          }
          if (request?.module === 'providers' && request.action === 'vendors') {
            return makeResponse(request.id, []);
          }
          if (request?.module === 'providers' && request.action === 'getDefaultAccount') {
            return makeResponse(request.id, { accountId: 'chat1234' });
          }

          return makeResponse(request?.id, {});
        });
  }, { chatModelRef });

  const page = await getStableWindow(app);
  await page.reload();
  await expect(page.getByTestId('main-layout')).toBeVisible();
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.webContents.send('gateway:status-changed', { state: 'running', port: 18789, pid: 12345, gatewayReady: true });
  });

  return app;
}

test.describe('ClawX chat composer action row', () => {
  /**
   * Regression guard for the model picker dropping every vision-capable chat
   * model: the picker filters to text-capable accounts, and an account that
   * declares `modelType: ['text', 'image']` (a chat model that also accepts
   * image input) must stay listed. Only accounts with no text capability at
   * all (image-generation / voice) are filtered out.
   */
  test('lists vision-capable chat models and hides non-text accounts', async ({ launchElectronApp }) => {
    const app = await launchComposer(launchElectronApp);

    try {
      const page = await getStableWindow(app);
      await page.getByTestId('chat-model-picker-button').click();
      const menu = page.getByTestId('chat-model-picker-menu');
      await expect(menu).toBeVisible();

      await expect(menu.getByTestId('chat-model-picker-option-ChatOnly')).toBeVisible();
      await expect(menu.getByTestId('chat-model-picker-option-VisionChat')).toBeVisible();
      await expect(menu.getByTestId('chat-model-picker-option-Painter')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  /**
   * The model picker label must read at the same size/weight as the neighbouring
   * skill button. `text-meta` on the button element is dropped by tailwind-merge
   * (a later `text-*` colour class wins its group), so the 13px size only
   * survives when re-applied on the inner label span — a mismatch that is
   * invisible in the JSX class list, hence this computed-style assertion.
   */
  test('renders the model picker label in the same type style as the skill button', async ({ launchElectronApp }) => {
    const app = await launchComposer(launchElectronApp);

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('chat-composer-skill')).toBeVisible();
      await expect(page.getByTestId('chat-model-picker-button')).toBeVisible();

      const typeStyles = await page.evaluate(() => {
        const labelStyle = (selector: string) => {
          const label = document.querySelector(`${selector} span`);
          if (!label) return null;
          const computed = getComputedStyle(label);
          return {
            fontSize: computed.fontSize,
            fontWeight: computed.fontWeight,
            fontFamily: computed.fontFamily,
          };
        };
        return { skill: labelStyle('[data-testid="chat-composer-skill"]'), model: labelStyle('[data-testid="chat-model-picker-button"]') };
      });

      expect(typeStyles.skill).not.toBeNull();
      expect(typeStyles.model).toEqual(typeStyles.skill);
      expect(typeStyles.model?.fontSize).toBe('13px');
    } finally {
      await closeElectronApp(app);
    }
  });

  /**
   * Voice input and enhance-prompt sit with the send button on the right edge,
   * after the skill / model pickers — not next to the attachment button.
   */
  test('groups voice input and enhance prompt on the right, before send', async ({ launchElectronApp }) => {
    const app = await launchComposer(launchElectronApp);

    try {
      const page = await getStableWindow(app);
      await expect(page.getByTestId('chat-composer-send')).toBeVisible();

      const order = await page.evaluate(() => {
        const ids = ['chat-composer-skill', 'chat-composer-mic', 'chat-composer-enhance-prompt', 'chat-composer-send'];
        const nodes = ids.map((id) => document.querySelector(`[data-testid="${id}"]`));
        if (nodes.some((node) => !node)) return null;
        const row = nodes[3]!.parentElement!;
        const children = [...row.children];
        const indexOf = (node: Element) => children.findIndex((child) => child === node || child.contains(node));
        const left = (node: Element) => Math.round(node.getBoundingClientRect().left);
        return {
          domOrder: nodes.map((node) => indexOf(node!)),
          lefts: nodes.map((node) => left(node!)),
        };
      });

      expect(order).not.toBeNull();
      // skill < mic < enhance < send, in both DOM order and on-screen position.
      const { domOrder, lefts } = order!;
      expect(domOrder).toEqual([...domOrder].sort((a, b) => a - b));
      expect(new Set(domOrder).size).toBe(4);
      expect(lefts).toEqual([...lefts].sort((a, b) => a - b));
    } finally {
      await closeElectronApp(app);
    }
  });
});
