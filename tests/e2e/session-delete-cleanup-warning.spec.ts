import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SESSION_KEY = 'agent:main:session-cleanup-warning';
const WORKSPACE = '/tmp/session-delete-workspace';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(',')}}`;
}

test('closes successful session deletion and shows a non-fatal cleanup warning', async ({ launchElectronApp }) => {
  const app = await launchElectronApp({ skipSetup: true });
  try {
    await installIpcMocks(app, {
      gatewayStatus: { state: 'running', gatewayReady: true, port: 18789, pid: 42, connectedAt: 1 },
      gatewayRpc: {
        [stableStringify(['sessions.subscribe', {}])]: { success: true, result: {} },
        [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
          success: true,
          result: { ts: 100, sessions: [{ key: SESSION_KEY, derivedTitle: 'Cleanup warning conversation', workspacePath: WORKSPACE }] },
        },
      },
      hostApi: {
        [stableStringify(['settings', 'getAll', null])]: {
          language: 'en', setupComplete: true, chatWorkspacePath: WORKSPACE, recentWorkspacePaths: [WORKSPACE],
        },
        [stableStringify(['agents', 'list', null])]: {
          success: true, agents: [{ id: 'main', name: 'Main', workspace: WORKSPACE }], defaultAgentId: 'main',
        },
        [stableStringify(['channels', 'accounts', null])]: { success: true, channels: [] },
        [stableStringify(['providers', 'accounts', null])]: [],
        [stableStringify(['providers', 'accountKeyInfo', null])]: [],
        [stableStringify(['sessions', 'delete', { id: SESSION_KEY }])]: { success: true, warnings: ['snapshot locked'] },
      },
    });
    const page = await getStableWindow(app);
    try {
      await page.reload();
    } catch (error) {
      if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
    }
    await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 30_000 });
    const sessionRow = page.getByTestId(`sidebar-session-${SESSION_KEY}`);
    await expect(sessionRow).toBeVisible({ timeout: 30_000 });
    await sessionRow.hover();
    await page.getByTestId(`sidebar-session-delete-${SESSION_KEY}`).click();
    await page.getByTestId('confirm-dialog-confirm-button').click();
    await expect(sessionRow).toHaveCount(0);
    await expect(page.getByTestId('confirm-dialog-confirm-button')).toHaveCount(0);
    await expect(page.getByText('Conversation deleted, but some workflow or transcript data could not be cleaned up. Remaining data has been kept.')).toBeVisible();
  } finally {
    await closeElectronApp(app);
  }
});
