import type { Locator, Page } from '@playwright/test';
import { closeElectronApp, completeSetup, expect, getStableWindow, test } from './fixtures/electron';
import {
  STALE_OFFICE_SNAPSHOT_TITLE,
  armOfficeMissingAgentInjection,
  armOfficeSnapshotStaleGate,
  armPreferredRoomMocks,
  createStandaloneProject,
  enableOfficeCollaboration,
  installGatewayReadyForOffice,
  readOfficeProjectIdByTitle,
  releaseOfficeSnapshotStaleGate,
  waitForOfficeCacheIdle,
} from './office-cache';

async function pickFirstAvailableAgent(form: Locator) {
  const availableAgent = form.locator('[data-testid^="office-agent-pool-"][data-bound="false"]').first();
  await expect(availableAgent).toBeVisible();
  await availableAgent.click();
}

async function createFixedGroup(page: Page, label: string) {
  await page.getByTestId('office-new-group').click();
  const wizard = page.getByTestId('office-group-form');
  await expect(wizard).toBeVisible();
  await wizard.locator('#office-group-name').fill(label);
  await pickFirstAvailableAgent(wizard);
  await wizard.getByRole('button', { name: /保存|Save/i }).click();
  await expect(wizard).toHaveCount(0);
}

test.describe('Office workspace', () => {
  test('manages agents inside the fixed group create dialog', async ({ launchElectronApp }) => {
    const app = await launchElectronApp();

    try {
      const page = await getStableWindow(app);
      await completeSetup(page);

      await page.getByTestId('sidebar-nav-office').click();
      await expect(page.getByTestId('office-page')).toBeVisible();
      await expect
        .poll(async () => page.getByTestId('office-refresh').getAttribute('data-gateway-initial-prefetch'))
        .toBe('false');
      await expect(page.getByTestId('office-fixed-groups-section')).toBeVisible();
      await expect(page.getByTestId('office-scenario-panel')).toBeVisible();
      await expect(page.getByTestId('office-workspace')).toBeVisible();
      await expect(page.getByTestId('office-roster-section')).toHaveCount(0);
      await expect(page.getByRole('link', { name: /协作|Office Collaboration/i })).toBeVisible();

      await page.getByTestId('office-new-group').click();
      const wizard = page.getByTestId('office-group-form');
      await expect(wizard).toBeVisible();
      await wizard.locator('#office-group-name').fill(`E2E团队-${Date.now()}`);

      await expect(wizard.getByTestId('office-agent-pool-picker')).toBeVisible();
      await expect(wizard.getByTestId('office-agent-pool-split')).toBeVisible();
      await pickFirstAvailableAgent(wizard);

      await wizard.getByTestId('office-group-heuristic-workflow-desc').fill('Review requirements then implement');
      const previewBtn = wizard.getByTestId('office-workflow-preview');
      await expect(previewBtn).toBeVisible();
      await expect(previewBtn).toContainText(/预览工作流|Preview workflow|プレビュー|Предпросмотр/i);

      await wizard.getByRole('button', { name: /保存|Save/i }).click();
      await expect(wizard).toHaveCount(0);

      await page.getByTestId('office-new-temp-project').click();
      const taskDialog = page.getByTestId('office-task-create-dialog');
      await expect(taskDialog).toBeVisible();
      await expect(taskDialog.getByTestId('office-task-runner-mode')).toBeVisible();
      await expect(taskDialog.getByTestId('office-task-runner-dag')).toBeChecked();
      const langGraphEnabled = process.env.VITE_ENABLE_LANGGRAPH === 'true';
      if (langGraphEnabled) {
        await taskDialog.getByTestId('office-task-runner-langgraph').check();
        await expect(taskDialog.getByTestId('office-task-runner-langgraph')).toBeChecked();
        await expect(taskDialog.getByTestId('office-task-create-description')).toHaveCount(0);
        await expect(taskDialog.getByTestId('office-langgraph-custom-editor')).toBeVisible();
        await expect(taskDialog.getByTestId('office-langgraph-custom-orchestration-title')).toBeVisible();
        await expect(taskDialog.getByTestId('office-langgraph-custom-validate')).toBeVisible();
        await expect(taskDialog.getByTestId('office-langgraph-custom-json-tips')).toBeVisible();
        await expect(taskDialog.getByTestId('office-langgraph-custom-template')).toHaveCount(0);
      } else {
        await expect(taskDialog.getByTestId('office-task-runner-langgraph')).toHaveCount(0);
      }
    } finally {
      await closeElectronApp(app);
    }
  });

  test('reorders team cards by dragging horizontally', async ({ launchElectronApp }) => {
    const app = await launchElectronApp();

    try {
      const page = await getStableWindow(app);
      await completeSetup(page);
      await page.getByTestId('sidebar-nav-office').click();
      await expect(page.getByTestId('office-fixed-groups-section')).toBeVisible();

      const stamp = Date.now();
      await createFixedGroup(page, `团队甲-${stamp}`);
      await createFixedGroup(page, `团队乙-${stamp}`);

      const orderStrip = page.getByTestId('office-team-card-order');
      const slots = orderStrip.locator('[data-scenario-id]');
      await expect(slots).toHaveCount(2);

      const firstId = await slots.nth(0).getAttribute('data-scenario-id');
      const secondId = await slots.nth(1).getAttribute('data-scenario-id');
      expect(firstId).toBeTruthy();
      expect(secondId).toBeTruthy();

      await expect(page.getByTestId(`office-team-card-drag-${firstId}`)).toBeVisible();
      await expect(page.getByTestId(`office-team-card-drag-${secondId}`)).toBeVisible();

      await page.getByTestId(`office-team-card-drag-${secondId}`).dragTo(
        page.getByTestId(`office-team-card-drag-${firstId}`),
      );

      await expect
        .poll(async () => {
          const ids = await orderStrip.locator('[data-scenario-id]').evaluateAll((els) =>
            els.map((el) => el.getAttribute('data-scenario-id')),
          );
          return ids.join(',');
        })
        .toBe(`${secondId},${firstId}`);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('structured workflow step draft exposes user review and runtime stepper', async ({
    launchElectronApp,
  }) => {
    const app = await launchElectronApp();

    try {
      const page = await getStableWindow(app);
      await completeSetup(page);
      await page.getByTestId('sidebar-nav-office').click();

      await createFixedGroup(page, `E2E编排-${Date.now()}`);

      await page.getByTestId('office-new-temp-project').click();
      const taskDialog = page.getByTestId('office-task-create-dialog');
      await taskDialog.getByTestId('office-task-runner-dag').check();
      await pickFirstAvailableAgent(taskDialog);
      await taskDialog.getByTestId('office-workflow-orchestration-rule').check();

      const runtimeValue = taskDialog.getByTestId('office-workflow-step-drafts-runtime-1-value');
      await expect(runtimeValue).toHaveText('30');

      await taskDialog.getByTestId('office-workflow-step-drafts-runtime-1-increment').click();
      await expect(runtimeValue).toHaveText('40');

      // 首节点只能串行：不展示「编排」控件；第 2 节点仍可编排。
      await expect(taskDialog.getByTestId('office-workflow-step-drafts-flow-1')).toHaveCount(0);
      await expect(taskDialog.getByTestId('office-workflow-step-drafts-link-1')).toHaveCount(0);
      await expect(taskDialog.getByTestId('office-workflow-step-drafts-flow-2')).toBeVisible();
      await expect(taskDialog.getByTestId('office-workflow-step-drafts-link-2')).toBeVisible();

      const checkpoint = taskDialog.getByTestId('office-workflow-step-drafts-user-checkpoint-1');
      await expect(checkpoint).not.toBeChecked();
      await checkpoint.check();
      await expect(checkpoint).toBeChecked();
    } finally {
      await closeElectronApp(app);
    }
  });

  test('manual refresh wins over stale gateway prefetch snapshot', async ({
    launchElectronApp,
    userDataDir,
  }) => {
    await enableOfficeCollaboration(userDataDir);
    const app = await launchElectronApp();

    try {
      const page = await getStableWindow(app);
      await completeSetup(page);
      await page.getByTestId('sidebar-nav-office').click();
      await expect(page.getByTestId('office-page')).toBeVisible();

      const projectTitle = `Real-Project-${Date.now()}`;
      await createStandaloneProject(page, projectTitle);

      await installGatewayReadyForOffice(app);
      await armOfficeSnapshotStaleGate(app);
      await app.evaluate(({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows()[0];
        win?.webContents.send('gateway:status-changed', {
          state: 'running',
          port: 18789,
          gatewayReady: true,
          pid: 4242,
          connectedAt: Date.now(),
        });
      });

      await page.waitForTimeout(300);
      await releaseOfficeSnapshotStaleGate(app);
      await waitForOfficeCacheIdle(page);

      await page.getByTestId('office-refresh').click();
      await waitForOfficeCacheIdle(page);

      await expect(page.getByText(projectTitle)).toBeVisible();
      await expect(page.getByText(STALE_OFFICE_SNAPSHOT_TITLE)).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('preferred switch shows running project room messages', async ({
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
      const idleTitle = `Idle-A-${stamp}`;
      const runningTitle = `Running-B-${stamp}`;
      await createStandaloneProject(page, idleTitle);
      await createStandaloneProject(page, runningTitle);

      const runningMarker = `E2E-PREFERRED-RUNNING-${stamp}`;
      const idleMarker = `E2E-PREFERRED-IDLE-${stamp}`;

      const idleProjectId = await readOfficeProjectIdByTitle(page, idleTitle);
      const runningProjectId = await readOfficeProjectIdByTitle(page, runningTitle);

      await armPreferredRoomMocks(app, {
        runningProjectId,
        idleProjectId,
        runningMarker,
        idleMarker,
      });

      await page.getByTestId('office-refresh').click();
      await waitForOfficeCacheIdle(page);

      const roomMessages = page.getByTestId('office-room-messages');
      await expect(roomMessages).toBeVisible({ timeout: 20_000 });
      await expect(roomMessages).toContainText(runningMarker);
      await expect(roomMessages).not.toContainText(idleMarker);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('marks missing agents on group cards and blocks spawn while edit shows red roster', async ({
    launchElectronApp,
  }) => {
    const app = await launchElectronApp();

    try {
      const page = await getStableWindow(app);
      await completeSetup(page);
      await installGatewayReadyForOffice(app);
      await page.getByTestId('sidebar-nav-office').click();
      await expect(page.getByTestId('office-fixed-groups-section')).toBeVisible();

      const stamp = Date.now();
      const groupName = `缺失组-${stamp}`;
      await createFixedGroup(page, groupName);

      await armOfficeMissingAgentInjection(app, { groupNameIncludes: groupName });
      await page.getByTestId('office-refresh').click();
      await waitForOfficeCacheIdle(page);

      const card = page.locator('[data-testid^="office-team-card-"]').filter({ hasText: groupName }).first();
      await expect(card).toBeVisible();
      await expect(card).toHaveClass(/border-destructive/);

      const badge = page.getByTestId(/office-team-missing-agent-/);
      await expect(badge.first()).toBeVisible();
      await expect(badge.first()).toContainText(/智能体缺失|Missing agents|エージェント不足|Агенты отсутствуют/i);

      const spawnBtn = page.locator('[data-testid^="office-team-card-spawn-"]').first();
      await expect(spawnBtn).toBeDisabled();

      await card.click();
      const form = page.getByTestId('office-group-form');
      await expect(form).toBeVisible();
      await expect(form.getByTestId('office-agent-pool-picker')).toHaveAttribute(
        'data-missing-agents',
        'true',
      );
      await expect(form.getByTestId('office-agent-pool-missing-label')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(form).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('active project with missing agents disables run; archived restart confirms then allows', async ({
    launchElectronApp,
  }) => {
    const app = await launchElectronApp();

    try {
      const page = await getStableWindow(app);
      await completeSetup(page);
      await installGatewayReadyForOffice(app);
      await page.getByTestId('sidebar-nav-office').click();
      await expect(page.getByTestId('office-scenario-panel')).toBeVisible();

      const stamp = Date.now();
      const activeTitle = `缺失活跃-${stamp}`;
      await createStandaloneProject(page, activeTitle);

      await armOfficeMissingAgentInjection(app, { projectTitleIncludes: activeTitle });
      await page.getByTestId('office-refresh').click();
      await waitForOfficeCacheIdle(page);

      const activeCard = page.getByTestId(/office-task-card-/).filter({ hasText: activeTitle }).first();
      await expect(activeCard).toBeVisible();
      await expect(activeCard.getByTestId(/office-task-missing-agent-/)).toBeVisible();
      if (!(await activeCard.getByTestId('office-task-run-actions').count())) {
        await activeCard.click();
      }
      await expect(activeCard.getByTestId('office-task-run-actions')).toBeVisible();
      await expect(activeCard.getByTestId('office-task-run')).toBeDisabled();

      const archivedTitle = `缺失归档-${stamp}`;
      await createStandaloneProject(page, archivedTitle);
      await armOfficeMissingAgentInjection(app, {
        projectTitleIncludes: archivedTitle,
        markArchived: true,
      });
      await page.getByTestId('office-refresh').click();
      await waitForOfficeCacheIdle(page);

      const archivedCard = page.getByTestId(/office-task-card-/).filter({ hasText: archivedTitle }).first();
      await expect(archivedCard).toBeVisible();
      const restartBtn = archivedCard.getByTestId(/office-task-restart/).first();
      await expect(restartBtn).toBeEnabled();

      page.once('dialog', async (dialog) => {
        expect(dialog.message()).toMatch(/缺失|missing|不足|отсутств/i);
        await dialog.dismiss();
      });
      await restartBtn.click();
      await expect(restartBtn).toBeEnabled();

      page.once('dialog', async (dialog) => {
        await dialog.accept();
      });
      await restartBtn.click();
      await waitForOfficeCacheIdle(page);
    } finally {
      await closeElectronApp(app);
    }
  });
});
