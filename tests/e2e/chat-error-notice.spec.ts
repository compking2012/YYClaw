import { closeElectronApp, expect, test } from './fixtures/electron';
import { installAcpErrorScenario, openAcpErrorSession } from './fixtures/acp-errors';

test.describe('ClawX chat error notice', () => {
  test('shows one actionable terminal ACP failure without duplicate legacy notices', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });
    try {
      await installAcpErrorScenario(app, { error: 'ECONNREFUSED' });
      const page = await openAcpErrorSession(app);
      await page.getByTestId('chat-composer-input').fill('hi');
      await page.getByTestId('chat-composer-send').click();

      const error = page.getByTestId('acp-error-banner');
      await expect(error).toHaveCount(1);
      await expect(error).toBeVisible();
      await expect(error).toContainText('Failed to send prompt');
      await expect(error).toContainText('ECONNREFUSED');
      await expect(page.getByTestId('chat-inline-run-error')).toHaveCount(0);
      await expect(page.getByTestId('chat-run-error')).toHaveCount(0);
      await expect(page.getByTestId('chat-composer-send')).toHaveAttribute('title', /Send|发送/);

      await error.getByRole('button', { name: 'Dismiss' }).click();
      await expect(error).toHaveCount(0);
      await expect(page.getByTestId('chat-composer-input')).toBeEnabled();
    } finally {
      await closeElectronApp(app);
    }
  });
});
