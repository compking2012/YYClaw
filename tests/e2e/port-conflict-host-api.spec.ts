import {
  completeSetup,
  expect,
  getRecordedHostInvocations,
  getRecordedLegacyIpcInvocations,
  installIpcMocks,
  test,
} from './fixtures/electron';

test.describe('Port conflict host API routing', () => {
  for (const forceKill of [true, false]) {
    test(`routes ${forceKill ? 'force-kill consent' : 'quit without killing'} through host API`, async ({ electronApp, page }) => {
      await completeSetup(page);
      await installIpcMocks(electronApp, {
        recordHostInvocations: true,
        recordLegacyIpcInvocations: true,
        hostApi: {
          '["gateway","resolvePortConflict",{"forceKill":true}]': null,
          '["gateway","resolvePortConflict",{"forceKill":false}]': null,
          '["app","quit",null]': null,
        },
      });
      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send('gateway:port-conflict', {
          port: 18789, externalPids: ['123'],
        });
      });
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.getByRole('button', { name: forceKill ? 'Force Kill' : 'Quit App', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect.poll(async () => (await getRecordedHostInvocations(electronApp))
        .filter((request) => request.action === 'resolvePortConflict' || request.action === 'quit'))
        .toEqual(forceKill
          ? [{ module: 'gateway', action: 'resolvePortConflict', payload: { forceKill: true } }]
          : [
            { module: 'gateway', action: 'resolvePortConflict', payload: { forceKill: false } },
            { module: 'app', action: 'quit' },
          ]);
      expect((await getRecordedLegacyIpcInvocations(electronApp))
        .filter((request) => ['gateway:resolve-conflict', 'app:quit'].includes(request.channel)))
        .toEqual([]);
    });
  }
});
