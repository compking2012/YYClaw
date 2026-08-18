import { closeElectronApp, completeSetup, expect, getStableWindow, test } from './fixtures/electron';
import {
  armOfficeReworkProgressRoomMock,
  enableOfficeCollaboration,
  installGatewayReadyForOffice,
  readOfficeProjectIdByTitle,
  waitForOfficeCacheIdle,
} from './office-cache';

test.describe('Office workflow rework progress bubble', () => {
  test('rework progress card is not red-tinted (business control flow, not hard fail)', async ({
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
      const title = `Rework-Bubble-${stamp}`;

      await page.getByTestId('office-new-temp-project').click();
      const dialog = page.getByTestId('office-task-create-dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByTestId('office-task-create-origin-standalone').check();
      await dialog.getByTestId('office-task-create-origin-continue').click();
      await dialog.getByTestId('office-task-create-title').fill(title);
      await dialog.getByTestId('office-task-create-feature-description').fill(`${title} feature`);
      const availableAgent = dialog.locator('[data-testid^="office-agent-pool-"][data-bound="false"]').first();
      await expect(availableAgent).toBeVisible();
      const agentTestId = await availableAgent.getAttribute('data-testid');
      expect(agentTestId).toBeTruthy();
      const agentId = agentTestId!.replace(/^office-agent-pool-/, '');
      await availableAgent.click();
      await dialog.getByTestId('office-task-create-submit').click();
      await expect(dialog).toHaveCount(0);

      const projectId = await readOfficeProjectIdByTitle(page, title);
      await armOfficeReworkProgressRoomMock(app, {
        projectId,
        agentId,
        progressText: '已回流上游，等待重做',
      });

      await page.getByTestId('office-refresh').click();
      await waitForOfficeCacheIdle(page);

      const card = page.locator(`[data-testid="office-task-card-${projectId}"]`);
      await card.click();

      const roomMessages = page.getByTestId('office-room-messages');
      await expect(roomMessages).toBeVisible({ timeout: 20_000 });
      await expect(roomMessages).toContainText('已回流上游，等待重做');

      const bubble = roomMessages.locator('[data-room-msg-id]').first();
      await expect(bubble).toBeVisible();
      await expect(bubble).toHaveAttribute('data-agent-light', 'pending');
      await expect(bubble).not.toHaveAttribute('data-agent-light', 'failed');
    } finally {
      await closeElectronApp(app);
    }
  });
});
