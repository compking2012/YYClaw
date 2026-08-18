import { completeSetup, expect, installIpcMocks, test } from './fixtures/electron';

const DEMO_SKILL = {
  id: 'demo-skill',
  slug: 'demo-skill',
  name: 'Demo Skill',
  description: 'Managed skill used for uninstall loading-state e2e',
  enabled: true,
  source: 'openclaw-managed',
  baseDir: '/tmp/.openclaw/skills/demo-skill',
};

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

test.describe('Skill detail uninstall loading state', () => {
  test('shows 卸载中... while uninstall runs, survives reopen, then removes the skill', async ({
    electronApp,
    page,
  }) => {
    await completeSetup(page);

    const uninstallKey = stableStringify(['skills', 'marketplaceUninstall', { slug: 'demo-skill' }]);
    const uninstallKeyWithUndefinedBaseDir = stableStringify([
      'skills',
      'marketplaceUninstall',
      { slug: 'demo-skill', baseDir: undefined },
    ]);

    await installIpcMocks(electronApp, {
      gatewayStatus: { state: 'stopped', port: 18789 },
      gatewayRpc: {
        '["skills.status",null]': { success: false, error: 'Gateway not connected' },
      },
      hostApi: {
        '["skills","status",null]': { skills: [] },
        '["skills","clawhubCapability",null]': {
          success: true,
          capability: { canSearch: false, canInstall: false },
        },
        '["skills","local",null]': {
          success: true,
          skills: [DEMO_SKILL],
        },
        [uninstallKey]: { success: true },
        [uninstallKeyWithUndefinedBaseDir]: { success: true },
      },
      hostApiDelayMs: {
        [uninstallKey]: 2500,
        [uninstallKeyWithUndefinedBaseDir]: 2500,
      },
    });

    // After uninstall succeeds, subsequent local scans must not resurrect the skill.
    await electronApp.evaluate(() => {
      const { ipcMain } = process.mainModule!.require('electron') as typeof import('electron');
      type HostHandler = (event: unknown, request: unknown) => Promise<unknown>;
      const getHandler = (): HostHandler | undefined =>
        (ipcMain as unknown as { _invokeHandlers?: Map<string, HostHandler> })._invokeHandlers?.get('host:invoke');
      const current = getHandler();
      if (!current) throw new Error('host:invoke handler missing; call installIpcMocks first');

      let uninstalled = false;
      ipcMain.removeHandler('host:invoke');
      ipcMain.handle('host:invoke', async (event, request) => {
        const record = request as { module?: string; action?: string };
        if (record.module === 'skills' && record.action === 'marketplaceUninstall') {
          uninstalled = true;
        }
        const response = await current(event, request);
        if (
          uninstalled
          && record.module === 'skills'
          && record.action === 'local'
          && response
          && typeof response === 'object'
          && (response as { ok?: boolean }).ok
        ) {
          return {
            ...(response as Record<string, unknown>),
            data: { success: true, skills: [] },
          };
        }
        return response;
      });
    });

    await page.getByTestId('sidebar-nav-settings').click();
    await page.getByTestId('settings-tab-skills').click();
    await expect(page.getByTestId('skills-tab')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Demo Skill' })).toBeVisible();

    await page.getByRole('heading', { name: 'Demo Skill' }).click();
    const sheet = page.getByTestId('skill-detail-sheet');
    await expect(sheet).toBeVisible();

    const uninstallButton = page.getByTestId('skill-detail-uninstall');
    await expect(uninstallButton).toBeVisible();
    await expect(uninstallButton).toBeEnabled();
    await expect(uninstallButton).toHaveText(/卸载|Uninstall|アンインストール|Удалить/);

    await uninstallButton.click();

    await expect(uninstallButton).toBeDisabled();
    await expect(uninstallButton).toHaveText(/卸载中|Uninstalling|アンインストール中|Удаление/);
    // Sheet stays open unless the user closes it.
    await expect(sheet).toBeVisible();

    await page.getByTestId('skill-detail-close').click();
    await expect(sheet).toBeHidden();

    // Re-enter detail before uninstall finishes — still shows in-flight state.
    await page.getByRole('heading', { name: 'Demo Skill' }).click();
    await expect(sheet).toBeVisible();
    const reopenedButton = page.getByTestId('skill-detail-uninstall');
    await expect(reopenedButton).toBeDisabled();
    await expect(reopenedButton).toHaveText(/卸载中|Uninstalling|アンインストール中|Удаление/);

    await expect(page.getByRole('heading', { name: 'Demo Skill' })).toHaveCount(0, { timeout: 10_000 });
    await expect(sheet).toBeHidden({ timeout: 10_000 });
  });
});
