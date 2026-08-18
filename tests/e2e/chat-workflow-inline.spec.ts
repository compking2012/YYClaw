import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

const MAIN_SESSION_KEY = 'agent:main:main';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

const RUN_ID = 'dyn-e2e-1';
const FINAL_TEXT = '已完成抓取、汇总与校验，综合结论如下。';

// A terminal run returned synchronously by the mocked start-dynamic endpoint, so
// the inline card settles into `done` and surfaces the synthesized reply without
// needing live progress events.
const doneRun = {
  runId: RUN_ID,
  defId: RUN_ID,
  version: 1,
  title: '抓取汇总校验',
  status: 'done',
  currentState: 'done',
  trace: [
    { state: 'fetch', stepKind: 'agent', status: 'completed', at: Date.now() },
    { state: 'summarize', stepKind: 'agent', status: 'completed', at: Date.now() },
    { state: 'synthesize', stepKind: 'model', status: 'completed', at: Date.now() },
  ],
  result: FINAL_TEXT,
  startedAt: Date.now(),
  updatedAt: Date.now(),
};

function buildWorkflowMocks() {
  return {
    gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
    gatewayRpc: {
      [stableStringify(['sessions.list', {}])]: {
        success: true,
        result: { sessions: [{ key: MAIN_SESSION_KEY, displayName: 'main' }] },
      },
    },
    hostApi: {
      [stableStringify(['/api/gateway/status', 'GET'])]: {
        ok: true,
        data: { status: 200, ok: true, json: { state: 'running', port: 18789, pid: 12345 } },
      },
      [stableStringify(['/api/chat/sessions', 'GET'])]: {
        ok: true,
        data: {
          status: 200,
          ok: true,
          json: {
            success: true,
            result: {
              sessions: [
                { key: MAIN_SESSION_KEY, displayName: 'main' },
                // An internal workflow sub-session the Gateway still lists —
                // it must be filtered out of the user's session list.
                { key: `wf:${RUN_ID}:fetch`, displayName: 'WF_CHILD_LEAK_MARKER', updatedAt: Date.now() },
              ],
            },
          },
        },
      },
      [stableStringify(['/api/chat/history', 'POST'])]: {
        ok: true,
        data: { status: 200, ok: true, json: { success: true, result: { messages: [] } } },
      },
      [stableStringify(['/api/workflow/start-dynamic', 'POST'])]: {
        ok: true,
        data: {
          status: 200,
          ok: true,
          json: {
            success: true,
            routed: true,
            runId: RUN_ID,
            title: '抓取汇总校验',
            steps: [
              { id: 'fetch', title: '抓取', kind: 'agent' },
              { id: 'summarize', title: '汇总', kind: 'agent', inputsFrom: ['fetch'] },
              { id: 'synthesize', title: '汇总', kind: 'model', inputsFrom: ['fetch', 'summarize'] },
            ],
            run: doneRun,
          },
        },
      },
    },
  };
}

test.describe('Inline workflow card in chat', () => {
  test('shows a compact link in the transcript, auto-opens the floating panel on first generation, and requires a click to reopen after closing', async ({
    launchElectronApp,
  }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, buildWorkflowMocks());

      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const input = page.getByTestId('chat-composer-input');
      await expect(input).toBeEnabled({ timeout: 30_000 });

      // A clearly multi-step task → routed to a workflow.
      await input.fill('先抓取数据，然后进行汇总，最后校验结果并产出报告');
      await page.getByTestId('chat-composer-send').click();

      // The workflow appears inline only as a compact link, not the full card.
      const link = page.getByTestId('workflow-inline-card');
      await expect(link).toBeVisible({ timeout: 15_000 });

      // First generation auto-opens the floating panel with progress expanded.
      const panel = page.getByTestId('workflow-floating-panel');
      await expect(panel).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('workflow-run-panel')).toBeVisible();

      // The synthesized reply lands in the main conversation.
      await expect(page.getByText(FINAL_TEXT)).toBeVisible({ timeout: 15_000 });

      // Closing the panel does not make it auto-reopen.
      await panel.getByRole('button').last().click();
      await expect(panel).toBeHidden();
      await page.waitForTimeout(300);
      await expect(page.getByTestId('workflow-floating-panel')).toBeHidden();

      // Clicking the link again reopens it with the same progress.
      await link.click();
      await expect(page.getByTestId('workflow-floating-panel')).toBeVisible();
      await expect(page.getByTestId('workflow-run-panel')).toBeVisible();

      // The internal workflow sub-session must NOT leak into the session list.
      await expect(page.getByText('WF_CHILD_LEAK_MARKER')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('shows the query bubble + composer thinking while the server decomposes, then reveals the card', async ({
    launchElectronApp,
  }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const mocks = buildWorkflowMocks();
      // Hold the decomposition response so the provisional window is observable:
      // an engine turn sends no ACP prompt, so without the provisional card the
      // conversation would be blank while the server decomposes ("生成即分诊").
      mocks.hostApiDelayMs = {
        [stableStringify(['/api/workflow/start-dynamic', 'POST'])]: 1500,
      };
      await installIpcMocks(app, mocks);

      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const input = page.getByTestId('chat-composer-input');
      await expect(input).toBeEnabled({ timeout: 30_000 });
      const query = '先抓取数据，然后进行汇总，最后校验结果并产出报告';
      await input.fill(query);
      await page.getByTestId('chat-composer-send').click();

      // During decomposition: the query bubble shows immediately via the
      // provisional card, the composer reuses its normal "thinking" indicator,
      // and NO compact workflow link/panel is shown yet.
      await expect(page.getByTestId('workflow-turn-block')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('workflow-turn-block').getByText(query)).toBeVisible();
      await expect(page.getByTestId('chat-composer-working-indicator')).toBeVisible();
      await expect(page.getByTestId('workflow-inline-card')).toHaveCount(0);
      await expect(page.getByTestId('workflow-floating-panel')).toBeHidden();

      // Once decomposition resolves, the card is promoted in place: the compact
      // link appears with the real title and the panel auto-opens; the composer
      // indicator clears. The query bubble is unchanged.
      const card = page.getByTestId('workflow-inline-card');
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(card.getByText('抓取汇总校验')).toBeVisible();
      await expect(page.getByTestId('workflow-floating-panel')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByTestId('workflow-run-panel')).toBeVisible();
      await expect(page.getByTestId('chat-composer-working-indicator')).toHaveCount(0);
      await expect(page.getByTestId('workflow-turn-block').getByText(query)).toBeVisible();

      // Only the real runId is persisted — the provisional card never is.
      await expect
        .poll(async () => page.evaluate(() => window.localStorage.getItem('clawx:workflow-cards') ?? '{}'))
        .toContain(RUN_ID);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('deleting the session also clears its persisted workflow cards so it cannot resurrect on restart', async ({
    launchElectronApp,
  }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      const mocks = buildWorkflowMocks();
      mocks.hostApi[stableStringify(['/api/sessions/delete', 'POST'])] = {
        ok: true,
        data: { status: 200, ok: true, json: { success: true } },
      };
      mocks.hostApi[stableStringify(['/api/workflow/abort', 'POST'])] = {
        ok: true,
        data: { status: 200, ok: true, json: { success: true, aborted: false, run: null } },
      };
      await installIpcMocks(app, mocks);

      const page = await getStableWindow(app);
      await expect(page.getByTestId('main-layout')).toBeVisible();

      const input = page.getByTestId('chat-composer-input');
      await expect(input).toBeEnabled({ timeout: 30_000 });
      await input.fill('先抓取数据，然后进行汇总，最后校验结果并产出报告');
      await page.getByTestId('chat-composer-send').click();
      await expect(page.getByTestId('workflow-inline-card')).toBeVisible({ timeout: 15_000 });

      // The card is persisted per-session — this is exactly the record that
      // used to resurrect a deleted session via mergeWorkflowParentSessions.
      await expect
        .poll(async () => page.evaluate(() => window.localStorage.getItem('clawx:workflow-cards') ?? '{}'))
        .toContain(RUN_ID);

      // Delete the session from the sidebar (hover row → trash → confirm).
      const sessionRow = page
        .getByTestId('sidebar')
        .locator('div.group', { hasText: 'main' })
        .first();
      await sessionRow.hover();
      await sessionRow.getByLabel('Delete session').click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.getByRole('button').last().click();
      await expect(dialog).toBeHidden();

      // The persisted workflow cards for the session are gone, so the next
      // startup's loadSessions can no longer re-inject the deleted session.
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const raw = window.localStorage.getItem('clawx:workflow-cards') ?? '{}';
            return Object.keys(JSON.parse(raw));
          }),
        )
        .toEqual([]);
    } finally {
      await closeElectronApp(app);
    }
  });
});
