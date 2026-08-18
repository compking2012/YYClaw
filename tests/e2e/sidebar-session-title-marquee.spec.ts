import type { ElectronApplication, Page } from '@playwright/test';
import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const SHORT_SESSION_KEY = 'agent:main:main';
const LONG_SESSION_KEY = 'agent:main:long-title';
const WORKSPACE = '/workspace';
const LIST_TS = 1_753_000_000_000;
const GATEWAY_CONNECTED_AT = 1_752_999_000_000;
const SESSIONS_LIST_PAYLOAD = { includeDerivedTitles: true, includeLastMessage: true };

const SHORT_TITLE = 'Short one';
const LONG_TITLE = 'Refactor the gateway transport fallback chain so websocket failures degrade to HTTP before IPC without dropping queued deliveries';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

function acpLoadResponse(sessionKey: string) {
  return {
    [stableStringify(['chat', 'loadAcpSession', {
      sessionKey,
      workspaceRoot: WORKSPACE,
      cwd: WORKSPACE,
    }])]: { success: true, generation: 1 },
    [stableStringify(['chat', 'loadAcpSession', {
      sessionKey,
      workspaceRoot: WORKSPACE,
      cwd: WORKSPACE,
      createIfMissing: true,
    }])]: { success: true, generation: 1 },
  };
}

async function installSessionTitleMocks(app: ElectronApplication): Promise<void> {
  const sessions = [
    {
      key: SHORT_SESSION_KEY,
      displayName: SHORT_TITLE,
      derivedTitle: SHORT_TITLE,
      workspacePath: WORKSPACE,
      updatedAt: LIST_TS - 1_000,
      status: 'done',
      hasActiveRun: false,
    },
    {
      key: LONG_SESSION_KEY,
      displayName: LONG_TITLE,
      derivedTitle: LONG_TITLE,
      workspacePath: WORKSPACE,
      updatedAt: LIST_TS - 2_000,
      status: 'done',
      hasActiveRun: false,
    },
  ];
  const sessionsList = { success: true, result: { ts: LIST_TS, sessions } };
  const gatewayStatus = {
    state: 'running',
    gatewayReady: true,
    port: 18789,
    pid: 4242,
    connectedAt: GATEWAY_CONNECTED_AT,
  };
  const sessionKeys = sessions.map((session) => session.key);

  await installIpcMocks(app, {
    gatewayStatus,
    gatewayRpc: {
      [stableStringify(['sessions.subscribe', {}])]: { success: true, result: {} },
      [stableStringify(['sessions.list', SESSIONS_LIST_PAYLOAD])]: sessionsList,
      [stableStringify(['sessions.list', {}])]: sessionsList,
      ...Object.fromEntries(sessionKeys.flatMap((sessionKey) => [
        [stableStringify(['chat.history', { sessionKey, limit: 200, maxChars: 500000 }]), {
          success: true,
          result: { messages: [] },
        }],
        [stableStringify(['chat.history', { sessionKey, limit: 1000, maxChars: 500000 }]), {
          success: true,
          result: { messages: [] },
        }],
      ])),
    },
    hostApi: {
      [stableStringify(['settings', 'getAll', null])]: {
        language: 'en',
        setupComplete: true,
        chatWorkspacePath: WORKSPACE,
        recentWorkspacePaths: [WORKSPACE],
      },
      [stableStringify(['agents', 'list', null])]: {
        success: true,
        agents: [{
          id: 'main',
          name: 'Main',
          workspace: WORKSPACE,
          mainSessionKey: SHORT_SESSION_KEY,
        }],
        defaultAgentId: 'main',
      },
      [stableStringify(['sessions', 'summaries', { sessionKeys }])]: {
        success: true,
        summaries: sessions.map((session) => ({
          sessionKey: session.key,
          firstUserText: session.displayName,
          lastTimestamp: session.updatedAt,
          workspacePath: WORKSPACE,
        })),
      },
      [stableStringify(['files', 'resolveWorkspaceContext', {
        workspaceRoot: WORKSPACE,
        executionCwd: WORKSPACE,
      }])]: { ok: true, workspaceRoot: WORKSPACE, executionCwd: WORKSPACE },
      ...acpLoadResponse(SHORT_SESSION_KEY),
      ...acpLoadResponse(LONG_SESSION_KEY),
    },
  });
}

async function reloadStableWindow(app: ElectronApplication): Promise<Page> {
  const page = await getStableWindow(app);
  try {
    await page.reload();
  } catch (error) {
    if (!String(error).includes('ERR_FILE_NOT_FOUND')) throw error;
  }
  await expect(page.getByTestId('main-layout')).toBeVisible({ timeout: 30_000 });
  return page;
}

test.describe('ClawX sidebar session title marquee', () => {
  test('scrolls overflowing session titles on hover and leaves short ones alone', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installSessionTitleMocks(app);
      const page = await reloadStableWindow(app);

      const longTitle = page.getByTestId(`sidebar-session-title-${LONG_SESSION_KEY}`);
      const shortTitle = page.getByTestId(`sidebar-session-title-${SHORT_SESSION_KEY}`);
      await expect(longTitle).toBeVisible();
      await expect(shortTitle).toBeVisible();

      // Idle: both truncate, nothing animates.
      await expect(longTitle).toHaveAttribute('data-marquee', 'off');
      await expect(shortTitle).toHaveAttribute('data-marquee', 'off');
      const idleOverflow = await longTitle.evaluate((el) => {
        const track = el.firstElementChild as HTMLElement;
        return {
          scrollWidth: track.scrollWidth,
          clientWidth: track.clientWidth,
          textOverflow: getComputedStyle(track).textOverflow,
        };
      });
      expect(idleOverflow.scrollWidth).toBeGreaterThan(idleOverflow.clientWidth + 2);
      expect(idleOverflow.textOverflow).toBe('ellipsis');

      // Hovering an overflowing title starts the marquee with a negative shift.
      await longTitle.hover();
      await expect(longTitle).toHaveAttribute('data-marquee', 'on');
      const active = await longTitle.evaluate((el) => {
        const track = el.firstElementChild as HTMLElement;
        const style = getComputedStyle(track);
        return {
          shift: el.style.getPropertyValue('--clawx-marquee-shift'),
          duration: el.style.getPropertyValue('--clawx-marquee-duration'),
          animationName: style.animationName,
          textOverflow: style.textOverflow,
        };
      });
      expect(active.shift.startsWith('-')).toBe(true);
      expect(Number.parseFloat(active.shift.replace('-', ''))).toBeGreaterThan(2);
      expect(Number.parseFloat(active.duration)).toBeGreaterThan(0);
      expect(active.animationName).toBe('clawx-marquee-shift');
      expect(active.textOverflow).toBe('clip');

      // Moving away stops it and restores the ellipsis.
      await shortTitle.hover();
      await expect(longTitle).toHaveAttribute('data-marquee', 'off');
      const afterLeave = await longTitle.evaluate((el) => {
        const style = getComputedStyle(el.firstElementChild as HTMLElement);
        return { animationName: style.animationName, textOverflow: style.textOverflow };
      });
      expect(afterLeave.animationName).toBe('none');
      expect(afterLeave.textOverflow).toBe('ellipsis');

      // A title that fits never animates, even while hovered.
      await expect(shortTitle).toHaveAttribute('data-marquee', 'off');
      const shortAnimation = await shortTitle.evaluate(
        (el) => getComputedStyle(el.firstElementChild as HTMLElement).animationName,
      );
      expect(shortAnimation).toBe('none');
    } finally {
      await closeElectronApp(app);
    }
  });
});
