import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { completeSetup, expect, test } from './fixtures/electron';

const TEST_AGENT_ID = 'agent';
const ZERO_TOKEN_SESSION_ID = 'agent-session-zero-token';
const NONZERO_TOKEN_SESSION_ID = 'agent-session-nonzero-token';
const GATEWAY_INJECTED_SESSION_ID = 'agent-session-gateway-injected';
const DELIVERY_MIRROR_SESSION_ID = 'agent-session-delivery-mirror';
// A model that is NOT in any configured provider account — the Models page
// (renderer-side) must hide its usage, while the backend must still surface it.
const UNCONFIGURED_MODEL = 'ghost-model-xyz';
const UNCONFIGURED_MODEL_SESSION_ID = 'agent-session-unconfigured-model';

async function seedTokenUsageTranscripts(homeDir: string): Promise<void> {
  const sessionDir = join(homeDir, '.openclaw', 'agents', TEST_AGENT_ID, 'sessions');
  const now = new Date();
  const zeroTimestamp = new Date(now.getTime() - 20_000).toISOString();
  const nonzeroTimestamp = now.toISOString();
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    join(sessionDir, `${ZERO_TOKEN_SESSION_ID}.jsonl`),
    [
      JSON.stringify({
        type: 'message',
        timestamp: zeroTimestamp,
        message: {
          role: 'assistant',
          model: 'kimi-k2.6',
          provider: 'kimi',
          usage: {
            total_tokens: 0,
            input_tokens: 0,
            output_tokens: 0,
          },
        },
      }),
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(sessionDir, `${NONZERO_TOKEN_SESSION_ID}.jsonl`),
    [
      JSON.stringify({
        type: 'message',
        timestamp: nonzeroTimestamp,
        message: {
          role: 'assistant',
          model: 'kimi-k2.6',
          provider: 'kimi',
          usage: {
            total_tokens: 27,
            input_tokens: 20,
            output_tokens: 7,
          },
        },
      }),
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(sessionDir, `${GATEWAY_INJECTED_SESSION_ID}.jsonl`),
    [
      JSON.stringify({
        type: 'message',
        timestamp: new Date(now.getTime() - 10_000).toISOString(),
        message: {
          role: 'assistant',
          model: 'gateway-injected',
          usage: {
            total_tokens: 0,
            input_tokens: 0,
            output_tokens: 0,
          },
        },
      }),
      '',
    ].join('\n'),
    'utf8',
  );
  await writeFile(
    join(sessionDir, `${DELIVERY_MIRROR_SESSION_ID}.jsonl`),
    [
      JSON.stringify({
        type: 'message',
        timestamp: new Date(now.getTime() - 5_000).toISOString(),
        message: {
          role: 'assistant',
          model: 'delivery-mirror',
          usage: {
            total_tokens: 0,
            input_tokens: 0,
            output_tokens: 0,
          },
        },
      }),
      '',
    ].join('\n'),
    'utf8',
  );
  // Non-zero usage attributed to a model no longer in any provider account.
  await writeFile(
    join(sessionDir, `${UNCONFIGURED_MODEL_SESSION_ID}.jsonl`),
    [
      JSON.stringify({
        type: 'message',
        timestamp: new Date(now.getTime() - 3_000).toISOString(),
        message: {
          role: 'assistant',
          model: UNCONFIGURED_MODEL,
          provider: 'kimi',
          usage: {
            total_tokens: 42,
            input_tokens: 30,
            output_tokens: 12,
          },
        },
      }),
      '',
    ].join('\n'),
    'utf8',
  );
}

test.describe('ClawX token usage history', () => {

  async function validateUsageHistory(page: Page): Promise<void> {
    const usageHistory = await page.evaluate(async () => {
      return window.electron.ipcRenderer.invoke('usage:recentTokenHistory', 20);
    });
    if (!Array.isArray(usageHistory) || usageHistory.length === 0) {
      throw new Error('No usage history found in IPC usage:recentTokenHistory');
    }

    const hasSeededEntries = usageHistory.some((entry) =>
      typeof entry?.sessionId === 'string' && (
        entry.sessionId === ZERO_TOKEN_SESSION_ID
        || entry.sessionId === NONZERO_TOKEN_SESSION_ID
      ),
    );
    if (!hasSeededEntries) {
      throw new Error('Seeded transcript session IDs were not found in IPC usage history');
    }
  }

  test('displays assistant usage for agent directory with zero and non-zero tokens', async ({ page, homeDir }) => {
    await seedTokenUsageTranscripts(homeDir);
    await completeSetup(page);
    await validateUsageHistory(page);

    const usageHistory = await page.evaluate(async () => {
      return window.electron.ipcRenderer.invoke('usage:recentTokenHistory', 20);
    });

    const zeroEntry = usageHistory.find((entry) => entry?.sessionId === ZERO_TOKEN_SESSION_ID);
    const nonzeroEntry = usageHistory.find((entry) => entry?.sessionId === NONZERO_TOKEN_SESSION_ID);
    expect(zeroEntry).toBeTruthy();
    expect(nonzeroEntry).toBeTruthy();
    expect(nonzeroEntry?.totalTokens).toBe(27);
    expect(zeroEntry?.totalTokens).toBe(0);
    expect(zeroEntry?.agentId).toBe(TEST_AGENT_ID);
    expect(nonzeroEntry?.agentId).toBe(TEST_AGENT_ID);
    expect(zeroEntry?.provider).toBe('kimi');
    expect(nonzeroEntry?.provider).toBe('kimi');

    // Regression guard: the backend must still surface usage for models that are
    // no longer configured — the configured-model filter is renderer-side only
    // (see usage-history.ts `isUnconfiguredModelEntry`). If this ever moves to
    // the backend, the "re-add → re-count" contract breaks.
    const unconfiguredEntry = usageHistory.find((entry) => entry?.sessionId === UNCONFIGURED_MODEL_SESSION_ID);
    expect(unconfiguredEntry).toBeTruthy();
    expect(unconfiguredEntry?.model).toBe(UNCONFIGURED_MODEL);
    expect(unconfiguredEntry?.totalTokens).toBe(42);
  });

  // TODO: This test needs a reliable way to inject mocked gateway status into
  // the renderer's Zustand store in CI (where no real OpenClaw runtime exists).
  // The IPC mock + page.reload approach fails because the reload
  // re-triggers setup flow. Skipping until we add an E2E-aware store hook.
  test.skip('hides gateway internal usage rows from the usage list overview', async ({ page, homeDir }) => {
    await seedTokenUsageTranscripts(homeDir);
    await completeSetup(page);
    await validateUsageHistory(page);

    await page.getByTestId('sidebar-nav-settings').click();

    await page.getByTestId('settings-tab-models').click();
    await expect(page.getByTestId('models-tab')).toBeVisible();

    const usageEntryRows = page.getByTestId('token-usage-entry');
    await expect.poll(async () => await usageEntryRows.count()).toBe(2);

    await expect(page.locator('[data-testid="token-usage-entry"]', { hasText: GATEWAY_INJECTED_SESSION_ID })).toHaveCount(0);
    await expect(page.locator('[data-testid="token-usage-entry"]', { hasText: DELIVERY_MIRROR_SESSION_ID })).toHaveCount(0);
  });

  // Configured-model filter contract: usage attributed to a model that is no
  // longer in any provider account must NOT appear in the Models page list,
  // while a still-configured model (`kimi-k2.6`) must. The filter itself is
  // covered by `tests/unit/usage-history-configured-filter.test.ts`; this spec
  // exercises the wired UI. Skipped for the same reason as the gateway-injected
  // test above — the renderer only renders usage while `gatewayStatus.state ===
  // 'running'`, and the hostapi:fetch / gateway:status mock + reload approach
  // re-triggers the setup flow. Re-enable once an E2E-aware store hook lands.
  test.skip('hides token usage for models no longer configured', async ({ page, homeDir }) => {
    await seedTokenUsageTranscripts(homeDir);
    await completeSetup(page);

    await page.getByTestId('sidebar-nav-settings').click();

    await page.getByTestId('settings-tab-models').click();
    await expect(page.getByTestId('models-tab')).toBeVisible();

    // Configured model's usage is visible; the unconfigured model's is hidden.
    await expect.poll(async () => page.getByTestId('token-usage-entry').count()).toBeGreaterThan(0);
    await expect(page.locator('[data-testid="token-usage-entry"]', { hasText: NONZERO_TOKEN_SESSION_ID })).toHaveCount(1);
    await expect(page.locator('[data-testid="token-usage-entry"]', { hasText: UNCONFIGURED_MODEL_SESSION_ID })).toHaveCount(0);
  });
});
