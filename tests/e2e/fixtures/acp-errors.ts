import type { ElectronApplication, Page } from '@playwright/test';
import { expect, getStableWindow, installIpcMocks } from './electron';

type AcpSessionUpdate = Record<string, unknown> & { sessionUpdate: string };

export const ERROR_SESSION_KEY = 'agent:main:main';
const WORKSPACE = '/workspace/acp-errors';

export async function installAcpErrorScenario(app: ElectronApplication, scenario: {
  history?: AcpSessionUpdate[];
  live?: AcpSessionUpdate[];
  error?: string;
}) {
  await installIpcMocks(app, {
    gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
    gatewayRpc: {
      '["sessions.list",{}]': {
        success: true,
        result: { sessions: [{ key: ERROR_SESSION_KEY, displayName: 'main', workspacePath: WORKSPACE }] },
      },
    },
    hostApi: {
      '["settings","getAll",null]': {
        language: 'en', setupComplete: true, devModeUnlocked: true,
        chatWorkspacePath: WORKSPACE, recentWorkspacePaths: [WORKSPACE],
      },
      '["agents","list",null]': {
        success: true,
        agents: [{ id: 'main', name: 'main', workspace: WORKSPACE, mainSessionKey: ERROR_SESSION_KEY }],
      },
    },
  });
  await app.evaluate(({ BrowserWindow }, input) => {
    const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
    type Request = { id?: string; module?: string; action?: string; payload?: Record<string, unknown> };
    const original = (ipcMain as unknown as {
      _invokeHandlers?: Map<string, (event: unknown, request: Request) => Promise<unknown>>;
    })._invokeHandlers?.get('host:invoke');
    let replay = input.scenario.history ?? [];
    ipcMain.removeHandler('host:invoke');
    ipcMain.handle('host:invoke', async (event: unknown, request: Request) => {
      if (request.module === 'chat' && request.action === 'loadAcpSession') {
        return {
          id: request.id, ok: true,
          data: {
            success: true, generation: 1,
            sessionUpdates: replay.map((update) => ({
              sessionKey: input.sessionKey, generation: 1, historical: true,
              notification: { sessionId: input.sessionKey, update },
            })),
          },
        };
      }
      if (request.module === 'chat' && request.action === 'sendAcpPrompt') {
        const updates = input.scenario.live ?? [];
        for (const update of updates) {
          for (const window of BrowserWindow.getAllWindows()) {
            window.webContents.send('chat:acp-session-update', {
              sessionKey: input.sessionKey, generation: 1,
              notification: { sessionId: input.sessionKey, update },
            });
          }
        }
        await new Promise((resolvePrompt) => setTimeout(resolvePrompt, 500));
        replay = [
          ...replay,
          {
            sessionUpdate: 'user_message_chunk',
            messageId: String(request.payload?.messageId),
            content: { type: 'text', text: String(request.payload?.message) },
          },
          ...updates,
        ];
        return {
          id: request.id, ok: true,
          data: input.scenario.error
            ? { success: false, generation: 1, error: input.scenario.error }
            : { success: true, generation: 1, stopReason: 'end_turn' },
        };
      }
      return original?.(event, request) ?? { id: request.id, ok: true, data: {} };
    });
  }, { sessionKey: ERROR_SESSION_KEY, scenario });
}

export async function openAcpErrorSession(app: ElectronApplication): Promise<Page> {
  const page = await getStableWindow(app);
  await page.reload();
  await expect(page.getByTestId('main-layout')).toBeVisible();
  const session = page.getByTestId(`sidebar-session-${ERROR_SESSION_KEY}`);
  await session.click();
  await expect(session).toHaveAttribute('aria-current', 'page');
  await expect(page.getByTestId('chat-composer-input')).toBeEnabled();
  return page;
}

export const recoveredToolUpdates: AcpSessionUpdate[] = [
  { sessionUpdate: 'tool_call', toolCallId: 'deploy-call', title: 'lark-cli', kind: 'execute', status: 'in_progress' },
  {
    sessionUpdate: 'tool_call_update', toolCallId: 'deploy-call', status: 'completed',
    content: [{ type: 'content', content: { type: 'text', text: 'deployed: https://example.com/app' } }],
  },
  { sessionUpdate: 'tool_call', toolCallId: 'cleanup-call', title: 'cleanup', kind: 'execute', status: 'in_progress' },
  {
    sessionUpdate: 'tool_call_update', toolCallId: 'cleanup-call', status: 'failed',
    content: [{ type: 'content', content: { type: 'text', text: 'cleanup failed after deployment' } }],
  },
  {
    sessionUpdate: 'agent_message_chunk', messageId: 'deploy-reply',
    content: { type: 'text', text: 'Deployed! Link: https://example.com/app' },
  },
];
