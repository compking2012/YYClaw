import type { ElectronApplication } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

// Regression coverage for the session-switch flicker: the visible transcript is
// driven by the singleton ACP session store, and switching sessions defers the
// new session's load behind an async workspace-context resolution. During that
// window `currentSessionKey` is already the new session while `acpTimeline`
// still belongs to the previous one and `acpLoading` is still false. The
// render-time sessionId guard must treat that mismatch as loading so the
// previous session's messages are never painted under the new session's key.

const MAIN_SESSION_KEY = 'agent:main:main';
const MAIN_WORKSPACE = '/workspace';
const REVIEWER_SESSION_KEY = 'agent:reviewer:main';
const REVIEWER_WORKSPACE = '/workspace/reviewer';

type AcpSessionUpdate = Record<string, unknown> & { sessionUpdate: string };

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

function historyUpdates(userText: string, assistantText: string): AcpSessionUpdate[] {
  return [
    {
      sessionUpdate: 'user_message',
      messageId: `${userText}-user`,
      content: [{ type: 'text', text: userText }],
    },
    {
      sessionUpdate: 'agent_message',
      messageId: `${assistantText}-assistant`,
      content: [{ type: 'text', text: assistantText }],
    },
  ];
}

// Install a host:invoke override that (a) replays distinct historical timelines
// per session and (b) holds the reviewer workspace-context resolution open until
// the test releases it, giving a STABLE stale-window to assert against.
async function installSwitchMocks(app: ElectronApplication) {
  await app.evaluate(
    async ({ app: _app }, payload) => {
      const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
      type HostInvokeRequest = {
        id?: string;
        module?: string;
        action?: string;
        payload?: Record<string, unknown>;
        args?: unknown[];
      };
      type IpcInvokeHandler = (event: unknown, request: HostInvokeRequest) => Promise<unknown>;
      const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, IpcInvokeHandler> })._invokeHandlers;
      const originalHostInvoke = handlers?.get('host:invoke');
      const globals = globalThis as unknown as {
        __releaseReviewerContext?: () => void;
        __reviewerContextReleased?: boolean;
        __pendingReviewerResolvers?: Array<() => void>;
      };
      globals.__reviewerContextReleased = false;
      globals.__pendingReviewerResolvers = [];
      globals.__releaseReviewerContext = () => {
        globals.__reviewerContextReleased = true;
        for (const resolve of globals.__pendingReviewerResolvers ?? []) resolve();
        globals.__pendingReviewerResolvers = [];
      };

      const buildLoadResult = (sessionKey: string) => {
        const updates = sessionKey === payload.reviewerSessionKey
          ? payload.reviewerUpdates
          : payload.mainUpdates;
        return {
          success: true,
          generation: 1,
          sessionUpdates: (updates as Array<Record<string, unknown>>).map((update) => ({
            sessionKey,
            generation: 1,
            historical: true,
            notification: { sessionId: sessionKey, update },
          })),
        };
      };

      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event: unknown, request: HostInvokeRequest) => {
        const requestPayload = request.payload ?? (Array.isArray(request.args) ? request.args[0] as Record<string, unknown> : undefined);

        if (request?.module === 'chat' && request.action === 'loadAcpSession') {
          const sessionKey = String(requestPayload?.sessionKey ?? '');
          return { id: request.id, ok: true, data: buildLoadResult(sessionKey) };
        }

        if (request?.module === 'files' && request.action === 'resolveWorkspaceContext') {
          const workspaceRoot = String(requestPayload?.workspaceRoot ?? '').trim();
          const executionCwd = String(requestPayload?.executionCwd ?? '').trim();
          const isReviewer = workspaceRoot.includes('reviewer') || executionCwd.includes('reviewer');
          if (isReviewer && !globals.__reviewerContextReleased) {
            await new Promise<void>((resolve) => {
              globals.__pendingReviewerResolvers?.push(resolve);
            });
          }
          return { id: request.id, ok: true, data: { ok: true, workspaceRoot, executionCwd } };
        }

        return originalHostInvoke?.(event, request) ?? { id: request?.id, ok: true, data: {} };
      });
    },
    {
      reviewerSessionKey: REVIEWER_SESSION_KEY,
      mainUpdates: historyUpdates('Alpha session question', 'Alpha session answer'),
      reviewerUpdates: historyUpdates('Bravo session question', 'Bravo session answer'),
    },
  );
}

async function releaseReviewerContext(app: ElectronApplication) {
  await app.evaluate(async ({ app: _app }) => {
    (globalThis as unknown as { __releaseReviewerContext?: () => void }).__releaseReviewerContext?.();
  });
}

async function openChat(app: ElectronApplication) {
  const page = await getStableWindow(app);
  try {
    await page.reload();
  } catch (error) {
    if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
  }
  await expect(page.getByTestId('main-layout')).toBeVisible();
  await expect(page.getByTestId('chat-page')).toBeVisible();
  return page;
}

test.describe('Chat session-switch stale-content guard', () => {
  test('never paints the previous session transcript under the newly selected session', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const updatedAt = new Date().toISOString();

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [
                { key: MAIN_SESSION_KEY, displayName: 'main', workspacePath: MAIN_WORKSPACE, lastMessagePreview: 'Alpha session question', updatedAt },
                { key: REVIEWER_SESSION_KEY, displayName: 'reviewer', workspacePath: REVIEWER_WORKSPACE, lastMessagePreview: 'Bravo session question', updatedAt },
              ],
            },
          },
        },
        hostApi: {
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: {
                success: true,
                agents: [
                  { id: 'main', name: 'main', workspace: MAIN_WORKSPACE, mainSessionKey: MAIN_SESSION_KEY },
                  { id: 'reviewer', name: 'reviewer', workspace: REVIEWER_WORKSPACE, mainSessionKey: REVIEWER_SESSION_KEY },
                ],
              },
            },
          },
        },
      });
      await installSwitchMocks(app);

      const page = await openChat(app);

      // Select the main session and confirm it shows its own transcript. (Do not
      // rely on startup auto-selection, which may open a fresh empty chat.)
      await page.getByTestId(`sidebar-session-${MAIN_SESSION_KEY}`).click();
      await expect(page.getByText('Alpha session answer')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('acp-chat-timeline')).toBeVisible();

      // Switch to the reviewer session; its workspace-context resolution is held
      // open, so we sit in the stale window with a stable, assertable state.
      await page.getByTestId(`sidebar-session-${REVIEWER_SESSION_KEY}`).click();

      // Guard invariant: the previous session's answer must NOT bleed through, and
      // the transcript shows the loading state instead.
      await expect(page.getByTestId('acp-chat-loading')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Alpha session answer')).toHaveCount(0);
      await expect(page.getByText('Bravo session answer')).toHaveCount(0);

      // Release the workspace-context resolution; the reviewer transcript loads.
      await releaseReviewerContext(app);
      await expect(page.getByText('Bravo session answer')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText('Alpha session answer')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
