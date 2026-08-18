import { closeElectronApp, completeSetup, expect, getStableWindow, test } from './fixtures/electron';
import {
  armPreferredRoomMocks,
  createStandaloneProject,
  enableOfficeCollaboration,
  installGatewayReadyForOffice,
  readOfficeProjectIdByTitle,
  waitForOfficeCacheIdle,
} from './office-cache';

test.describe('Office abort quiesce', () => {
  test('abort shows stopping state then allows rerun after quiesce clears', async ({
    launchElectronApp,
    userDataDir,
  }) => {
    await enableOfficeCollaboration(userDataDir);
    const app = await launchElectronApp();

    try {
      const page = await getStableWindow(app);
      await completeSetup(page);
      await installGatewayReadyForOffice(app);
      await page.getByTestId('sidebar-nav-office').click();
      await expect(page.getByTestId('office-page')).toBeVisible();

      const stamp = Date.now();
      const title = `Abort-Quiesce-${stamp}`;
      await createStandaloneProject(page, title);
      const projectId = await readOfficeProjectIdByTitle(page, title);

      await armPreferredRoomMocks(app, {
        runningProjectId: projectId,
        idleProjectId: `${projectId}-idle-unused`,
        runningMarker: `E2E-ABORT-RUNNING-${stamp}`,
        idleMarker: `E2E-ABORT-IDLE-${stamp}`,
      });
      await page.getByTestId('office-refresh').click();
      await waitForOfficeCacheIdle(page);

      const card = page.locator(`[data-testid="office-task-card-${projectId}"]`);
      await card.click();
      await expect(page.getByTestId('office-task-run-actions')).toBeVisible({ timeout: 20_000 });
      const abortBtn = page.getByTestId('office-task-abort');
      await expect(abortBtn).toBeVisible();

      await abortBtn.click();
      await expect(page.getByTestId('office-task-abort-quiescing')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByTestId('office-task-run')).toHaveCount(0);
      await expect(page.getByTestId('office-task-abort')).toHaveCount(0);

      // Stop forcing snapshot to "running" so real abortQuiescing / cleared state can surface.
      await armPreferredRoomMocks(app, null);
      await page.getByTestId('office-refresh').click();
      await waitForOfficeCacheIdle(page);

      await expect
        .poll(async () => {
          const quiescing = await page.getByTestId('office-task-abort-quiescing').count();
          const run = await page.getByTestId('office-task-run').count();
          const rerun = await page.getByRole('button', { name: /重跑|Rerun|再実行|Перезапуск/i }).count();
          return quiescing === 0 && (run > 0 || rerun > 0);
        }, { timeout: 30_000 })
        .toBe(true);
    } finally {
      await closeElectronApp(app);
    }
  });
});
