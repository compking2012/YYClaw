import { closeElectronApp, expect, test } from './fixtures/electron';
import { installAcpErrorScenario, openAcpErrorSession, recoveredToolUpdates } from './fixtures/acp-errors';

test.describe('ClawX chat recovered tool error', () => {
  test('preserves recovered replay output and failed tool evidence without a terminal banner', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installAcpErrorScenario(app, { history: recoveredToolUpdates });
      const page = await openAcpErrorSession(app);
      await expect(page.getByText('Deployed! Link: https://example.com/app')).toBeVisible();
      const group = page.getByTestId('acp-tool-calls-group');
      await expect(group).toHaveAttribute('data-collapsed', 'true');
      await group.click();
      await expect(group).toHaveAttribute('data-collapsed', 'false');
      const tools = page.getByTestId('acp-tool-call-card');
      await expect(tools).toHaveCount(2);
      await expect(tools.filter({ hasText: 'lark-cli' })).toContainText('Completed');
      await expect(tools.filter({ hasText: 'cleanup' })).toContainText('Failed');
      await expect(page.getByTestId('acp-error-banner')).toHaveCount(0);
      await expect(page.getByTestId('chat-run-error')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('settles the composer after a recovered ACP turn and preserves the failed closing step', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installAcpErrorScenario(app, { live: recoveredToolUpdates });
      const page = await openAcpErrorSession(app);
      const sendButton = page.getByTestId('chat-composer-send');
      await page.getByTestId('chat-composer-input').fill('deploy this');
      await sendButton.click();
      await expect(sendButton).toHaveAttribute('title', /Stop|停止/);
      await expect(page.getByText('Deployed! Link: https://example.com/app')).toBeVisible();
      await expect(sendButton).toHaveAttribute('title', /Send|发送/);
      const tools = page.getByTestId('acp-tool-call-card');
      await expect(tools).toHaveCount(2);
      await expect(tools.filter({ hasText: 'lark-cli' })).toContainText('Completed');
      await expect(tools.filter({ hasText: 'cleanup' })).toContainText('Failed');
      await expect(page.getByTestId('acp-error-banner')).toHaveCount(0);
      await expect(page.getByTestId('chat-run-error')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('does not hide a real prompt failure just because a deployment tool succeeded', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installAcpErrorScenario(app, {
        live: recoveredToolUpdates,
        error: 'model unavailable after tool call',
      });
      const page = await openAcpErrorSession(app);
      await page.getByTestId('chat-composer-input').fill('deploy this');
      await page.getByTestId('chat-composer-send').click();
      await expect(page.getByText('Deployed! Link: https://example.com/app')).toBeVisible();
      const error = page.getByTestId('acp-error-banner');
      await expect(error).toHaveCount(1);
      await expect(error).toContainText('model unavailable after tool call');
      await expect(page.getByTestId('chat-composer-send')).toHaveAttribute('title', /Send|发送/);
      await expect(page.getByTestId('chat-run-error')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
