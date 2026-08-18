import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const DEFAULT_WORKSPACE_SEGMENT = '~%2F.openclaw%2Fworkspace';
const SESSIONS_LIST_PAYLOAD = {
  includeDerivedTitles: true,
  includeLastMessage: true,
};

function defaultWorkspaceSessionGroupTestId(): string {
  return `workspace-session-group-${DEFAULT_WORKSPACE_SEGMENT}`;
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('ClawX chat startup lands on a fresh conversation', () => {
  test('shows an empty new conversation while keeping history sessions in the sidebar', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const nowMs = Date.now();
    // Deliberately omit the boot-default `agent:main:main` ghost session so the
    // startup selection logic hits the fresh-conversation mint path instead of
    // resurrecting one of these historical sessions.
    const recentKey = `agent:main:session-${nowMs - 1000}`;
    const olderKey = `agent:main:session-${nowMs - 2000}`;
    const sessions = [
      { key: recentKey, displayName: 'Recent conversation', updatedAt: nowMs - 1000 },
      { key: olderKey, displayName: 'Older conversation', updatedAt: nowMs - 2000 },
    ];

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, connectedAt: nowMs },
        gatewayRpc: {
          [stableStringify(['sessions.list', SESSIONS_LIST_PAYLOAD])]: {
            success: true,
            result: { ts: nowMs, sessions },
          },
          [stableStringify(['chat.history', null])]: {
            success: true,
            result: { messages: [] },
          },
        },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345, connectedAt: nowMs },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'Main' }] },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();
      const workspaceGroup = page.getByTestId(defaultWorkspaceSessionGroupTestId());
      await expect(workspaceGroup).toBeVisible({ timeout: 30_000 });

      // The chat pane lands on a brand-new empty conversation rather than an old
      // session's transcript.
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible();
      await expect(page.getByTestId('chat-composer-input')).toHaveValue('');

      // Existing history sessions remain listed in the sidebar and none of them
      // has been resurrected as the active conversation.
      await expect(workspaceGroup.getByText('Recent conversation')).toBeVisible();
      await expect(workspaceGroup.getByText('Older conversation')).toBeVisible();
      await expect(page.getByTestId(`sidebar-session-${recentKey}`)).not.toHaveAttribute('aria-current', 'page');
      await expect(page.getByTestId(`sidebar-session-${olderKey}`)).not.toHaveAttribute('aria-current', 'page');
    } finally {
      await closeElectronApp(app);
    }
  });

  test('mints a fresh conversation instead of landing on the agent main session', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    const nowMs = Date.now();
    // The agent's persistent `:main` session exists and the boot-default ghost
    // retargets to it — the exact case that used to strand the user on an old
    // conversation. A real (non-`main`) agent id keeps `agent:main:main` a pure
    // boot-default ghost, distinct from any real session.
    const mainKey = 'agent:assistant:main';
    const historyKey = `agent:assistant:session-${nowMs - 1000}`;
    const sessions = [
      { key: mainKey, displayName: 'Main conversation', updatedAt: nowMs },
      { key: historyKey, displayName: 'Older conversation', updatedAt: nowMs - 1000 },
    ];

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, connectedAt: nowMs },
        gatewayRpc: {
          [stableStringify(['sessions.list', SESSIONS_LIST_PAYLOAD])]: {
            success: true,
            result: { ts: nowMs, sessions },
          },
          [stableStringify(['chat.history', null])]: {
            success: true,
            result: { messages: [] },
          },
        },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345, connectedAt: nowMs },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'assistant', name: 'Assistant' }] },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();
      const workspaceGroup = page.getByTestId(defaultWorkspaceSessionGroupTestId());
      await expect(workspaceGroup).toBeVisible({ timeout: 30_000 });

      // Lands on a fresh empty conversation, not the agent's `:main` session.
      await expect(page.getByTestId('acp-chat-empty-state')).toBeVisible();
      await expect(page.getByTestId(`sidebar-session-${mainKey}`)).not.toHaveAttribute('aria-current', 'page');
      await expect(page.getByTestId(`sidebar-session-${historyKey}`)).not.toHaveAttribute('aria-current', 'page');
      await expect(workspaceGroup.getByText('Main conversation')).toBeVisible();
      await expect(workspaceGroup.getByText('Older conversation')).toBeVisible();
    } finally {
      await closeElectronApp(app);
    }
  });
});
