import { closeElectronApp, expect, getStableWindow, installIpcMocks, test } from './fixtures/electron';

// Covers "recovered vs blocking failures": a run whose only failure is
// isolated to a closing step (final wrap-up reply, or a lifecycle `error`
// notification) after the agent already produced usable output (a
// successfully completed tool result) must not surface the inline
// `chat-run-error` notice — only a run that produced nothing usable should.
//
// NOTE: Local E2E is currently blocked on Node 26 (Playwright config load);
// this spec is validated in CI (see chat-error-notice.spec.ts for precedent).

const SESSION_KEY = 'agent:main:main';

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}

// A terminal-error assistant turn preceded by a successfully completed tool
// result — the agent already produced usable output before the closing
// step errored (matches the reported "skill installed / deployed fine, but
// the run still reports an error" incidents).
const recoveredHistory = [
  {
    role: 'user',
    content: [{ type: 'text', text: 'deploy this' }],
    timestamp: Date.now(),
  },
  {
    role: 'toolresult',
    id: 'tool-result-1',
    toolCallId: 'call-1',
    toolName: 'lark-cli',
    content: [{ type: 'text', text: 'deployed: https://example.com/app' }],
    timestamp: Date.now(),
  },
  {
    role: 'assistant',
    id: 'run-recovered-turn',
    content: [{ type: 'text', text: 'Deployed! Link: https://example.com/app' }],
    stop_reason: 'error',
    timestamp: Date.now(),
  },
];

test.describe('ClawX chat recovered tool error', () => {
  test('does not surface the bottom run-error banner when a tool already succeeded', async ({ launchElectronApp }) => {
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
            result: { messages: recoveredHistory },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 1000, maxChars: 500000 }])]: {
            success: true,
            result: { messages: recoveredHistory },
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
              json: { success: true, result: { messages: recoveredHistory } },
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
      await expect(page.getByText('Deployed! Link: https://example.com/app')).toBeVisible({ timeout: 30_000 });

      // The agent already produced a usable result (the completed tool
      // call), so the bottom banner must stay hidden even though the
      // closing turn is marked stop_reason=error.
      await expect(page.getByTestId('chat-run-error')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });

  test('clears the composer back to Send after a run.ended error when a tool call already completed', async ({ launchElectronApp }) => {
    const app = await launchElectronApp({ skipSetup: true });

    try {
      await installIpcMocks(app, {
        gatewayStatus: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
        gatewayRpc: {
          [stableStringify(['sessions.list', { includeDerivedTitles: true, includeLastMessage: true }])]: {
            success: true,
            result: {
              sessions: [{ key: SESSION_KEY, displayName: 'main' }],
            },
          },
          [stableStringify(['chat.history', { sessionKey: SESSION_KEY, limit: 200, maxChars: 500000 }])]: {
            success: true,
            result: { messages: [] },
          },
          [stableStringify(['chat.send', null])]: {
            success: true,
            result: { runId: 'run-recovered-e2e' },
          },
        },
        hostApi: {
          [stableStringify(['/api/gateway/status', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { state: 'running', port: 18789, pid: 12345, gatewayReady: true },
            },
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
              json: { success: true, result: { messages: [] } },
            },
          },
          [stableStringify(['/api/chat/send', 'POST'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, result: { runId: 'run-recovered-e2e' } },
            },
          },
          [stableStringify(['/api/agents', 'GET'])]: {
            ok: true,
            data: {
              status: 200,
              ok: true,
              json: { success: true, agents: [{ id: 'main', name: 'Main' }] },
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

      const sendButton = page.getByTestId('chat-composer-send');
      await expect(page.getByTestId('chat-composer-input')).toBeEnabled({ timeout: 30_000 });
      await page.getByTestId('chat-composer-input').fill('deploy this');
      await sendButton.click();
      await expect(sendButton).toHaveAttribute('title', /Stop|停止/);

      await app.evaluate(({ BrowserWindow }) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('chat:runtime-event', {
            type: 'tool.started',
            runId: 'run-recovered-e2e',
            toolCallId: 'call-1',
            name: 'lark-cli',
            args: { command: 'deploy' },
          });
        }
      });

      await app.evaluate(({ BrowserWindow }) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('chat:runtime-event', {
            type: 'tool.completed',
            runId: 'run-recovered-e2e',
            toolCallId: 'call-1',
            name: 'lark-cli',
            result: { summary: 'deployed' },
            isError: false,
          });
        }
      });

      // The closing step errors (e.g. the wrap-up reply failed) even though
      // the actual deploy tool call already succeeded above.
      await app.evaluate(({ BrowserWindow }) => {
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send('chat:runtime-event', {
            type: 'run.ended',
            runId: 'run-recovered-e2e',
            status: 'error',
            error: 'model unavailable after tool call',
            endedAt: Date.now(),
          });
        }
      });

      await expect(sendButton).toHaveAttribute('title', /Send|发送/, { timeout: 30_000 });
      await expect(page.getByTestId('chat-run-error')).toHaveCount(0);
    } finally {
      await closeElectronApp(app);
    }
  });
});
