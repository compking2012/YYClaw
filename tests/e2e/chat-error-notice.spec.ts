import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

// Covers the client-side error-notice styling and dedup:
//  - terminal-error assistant messages render as a collapsed, low-key inline
//    pill (`chat-inline-run-error`) instead of bare markdown, expandable on
//    click to reveal the full detail card — not a big destructive-red block;
//  - the run-level notice (`chat-run-error`) is suppressed entirely when the
//    latest message already renders its own inline error card for the same
//    failure, so the same event never surfaces as two differently-titled
//    notices at once.
//
// NOTE: Local E2E is currently blocked on Node 26 (Playwright config load); this
// spec is validated in CI.

const SESSION_KEY = 'agent:main:main';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

// A terminated run: an assistant message carrying `stop_reason: 'error'` and
// its own `errorMessage` field. History load preserves both fields (see
// chat/history-actions.ts), so ChatMessage routes it through the collapsible
// inline error notice — and, per the dedup fix, the store-level `runError`
// derived from this same message must NOT also render a second notice.
const errorHistory = [
  {
    role: 'user',
    content: [{ type: 'text', text: 'hi' }],
    timestamp: Date.now(),
  },
  {
    role: 'assistant',
    id: 'run-error-turn',
    content: [{ type: 'text', text: 'The agent run failed before producing a reply.' }],
    stop_reason: 'error',
    errorMessage: 'ECONNREFUSED',
    timestamp: Date.now(),
  },
];

test.describe('ClawX chat error notice', () => {
  test('renders only the inline error pill for a terminal run — no duplicate run-level notice', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345 },
        gatewayRpc: {
          [stableStringify(['sessions.list', {}])]: {
            success: true,
            result: {
              sessions: [{ key: SESSION_KEY, displayName: 'main' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: errorHistory },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: errorHistory },
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
                result: { sessions: [{ key: SESSION_KEY, displayName: 'main' }] },
              },
            },
          },
          [stableStringify(['/api/chat/history', 'POST'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, result: { messages: errorHistory } },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'main' }] },
            },
          },
        },
      });

      const page = await getStableWindow(app);
      try {
        await page.reload();
      } catch (error) {
        if (!String(error).includes('ERR_FILE_NOT_FOUND')) {
          throw error;
        }
      }

      await expect(page.getByTestId('main-layout')).toBeVisible();

      // Inline error notice replaces bare markdown for the terminated turn —
      // collapsed to a low-key pill by default, no detail card yet.
      const inlineError = page.getByTestId('chat-inline-run-error');
      await expect(inlineError).toBeVisible({ timeout: 30_000 });
      await expect(inlineError.locator('.rounded-xl')).toHaveCount(0);

      // The run-level notice must NOT also appear for this same failure —
      // otherwise the user sees two differently-titled notices at once
      // (classified from the message's `errorMessage` vs `content` fields).
      await expect(page.getByTestId('chat-run-error')).toHaveCount(0);

      // Clicking the collapsed pill expands the full detail card in place.
      await inlineError.locator('button').first().click();
      await expect(inlineError.locator('.rounded-xl')).toHaveCount(1);
    } finally {
      await closeElectronApp(app);
    }
  });
});
