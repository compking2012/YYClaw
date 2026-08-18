import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayManager } from '../../electron/gateway/manager';
import { fetchChatHistory } from '../../electron/services/office/gateway-rpc';
import {
  clearOfficeSessionTranscriptCachesForTests,
  fetchWorkflowSettleChatHistory,
  loadOfficeSessionTranscriptMessages,
  mergeLocalPrefixWithGatewayTail,
  selectWorkflowSettleHistory,
  transcriptHasDispatchUserTurn,
  transcriptHasWorkflowJsonAfter,
  transcriptTailLooksInFlight,
} from '../../electron/services/office/office-session-transcript';
import { hasTriggeringUserTurnAfter } from '../../electron/services/office/run-completion';

const testOpenClawDir = mkdtempSync(join(tmpdir(), 'office-session-transcript-'));

vi.mock('../../electron/utils/paths', () => ({
  getOpenClawConfigDir: () => testOpenClawDir,
  resolveOpenClawStateDir: () => testOpenClawDir,
}));

vi.mock('../../electron/services/office/gateway-rpc', () => ({
  fetchChatHistory: vi.fn(),
}));

const SESSION_KEY = 'agent:xy:office:task:demo:role:xy:node:gen-6:run:run-1';
/** Use real millisecond epoch so timestamp normalize does not treat values as seconds. */
const STARTED_AT = 1_785_389_326_723;

const FINAL_JSON =
  '```json\n{"role":"软件测试","step":{"index":7,"total":9,"title":"功能测试"},"inputValidation":{"status":"pass"},"execution":{"status":"done"},"outputValidation":{"status":"pass"},"deliverable":{"path":"a.md"},"rollback":{"needed":false}}\n```';

function writeTranscriptFixture(options?: {
  messageCount?: number;
  omitFinal?: boolean;
  endOnToolResult?: boolean;
}): void {
  clearOfficeSessionTranscriptCachesForTests();
  const messageCount = options?.messageCount ?? 120;
  const sessionsDir = join(testOpenClawDir, 'agents', 'xy', 'sessions');
  mkdirSync(sessionsDir, { recursive: true });
  const sessionId = 'b13c6af1-280c-4a5b-bba9-47dcdc0fd75d';
  writeFileSync(
    join(sessionsDir, 'sessions.json'),
    JSON.stringify({
      [SESSION_KEY]: { id: sessionId, sessionFile: join(sessionsDir, `${sessionId}.jsonl`) },
    }),
    'utf8',
  );

  const lines: string[] = [];
  lines.push(JSON.stringify({
    type: 'message',
    message: {
      role: 'user',
      content: [{ type: 'text', text: '/new' }],
      timestamp: STARTED_AT + 2,
    },
  }));
  lines.push(JSON.stringify({
    type: 'message',
    message: {
      role: 'user',
      content: [{ type: 'text', text: '【Workflow 模式】当前角色：软件测试' }],
      timestamp: STARTED_AT + 10,
    },
  }));
  for (let i = 0; i < messageCount; i++) {
    const toolId = `tool-${i}`;
    lines.push(JSON.stringify({
      type: 'message',
      message: {
        role: 'assistant',
        content: [{ type: 'toolUse', id: toolId, name: 'exec', input: {} }],
        timestamp: STARTED_AT + 100 + i * 2,
        stopReason: 'toolUse',
      },
    }));
    lines.push(JSON.stringify({
      type: 'message',
      message: {
        role: 'toolResult',
        toolCallId: toolId,
        content: [{ type: 'text', text: `out-${i}` }],
        timestamp: STARTED_AT + 101 + i * 2,
      },
    }));
  }
  if (!options?.omitFinal && !options?.endOnToolResult) {
    lines.push(JSON.stringify({
      type: 'message',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: FINAL_JSON }],
        timestamp: STARTED_AT + 50_000,
        stopReason: 'stop',
      },
    }));
  }
  writeFileSync(join(sessionsDir, `${sessionId}.jsonl`), `${lines.join('\n')}\n`, 'utf8');
}

describe('office-session-transcript settle fallback', () => {
  beforeEach(() => {
    vi.mocked(fetchChatHistory).mockReset();
    clearOfficeSessionTranscriptCachesForTests();
  });

  afterEach(() => {
    clearOfficeSessionTranscriptCachesForTests();
    rmSync(testOpenClawDir, { recursive: true, force: true });
    mkdirSync(testOpenClawDir, { recursive: true });
  });

  it('loads full local transcript including early dispatch user', async () => {
    writeTranscriptFixture({ messageCount: 120 });
    const messages = await loadOfficeSessionTranscriptMessages(SESSION_KEY);
    expect(messages).not.toBeNull();
    expect(messages!.length).toBeGreaterThan(200);
    expect(transcriptHasDispatchUserTurn(messages!, STARTED_AT)).toBe(true);
    expect(hasTriggeringUserTurnAfter(messages!, STARTED_AT)).toBe(true);
  });

  it('prefers complete Gateway window over local when Gateway still has the dispatch user', () => {
    const local = [
      {
        role: 'user',
        content: 'dispatch',
        timestamp: STARTED_AT + 10,
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: FINAL_JSON }],
        timestamp: STARTED_AT + 50_000,
      },
    ];
    const gateway = [
      {
        role: 'user',
        content: 'dispatch',
        timestamp: STARTED_AT + 10,
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: FINAL_JSON }],
        timestamp: STARTED_AT + 50_000,
      },
    ];
    const selected = selectWorkflowSettleHistory(local, gateway, STARTED_AT);
    expect(selected.source).toBe('gateway');
    expect(selected.messages).toEqual(gateway);
  });

  it('prefers local .jsonl when Gateway history truncates the dispatch user', async () => {
    writeTranscriptFixture({ messageCount: 120 });
    const local = await loadOfficeSessionTranscriptMessages(SESSION_KEY);
    expect(local).not.toBeNull();
    const truncated = local!.slice(-200);
    expect(hasTriggeringUserTurnAfter(truncated, STARTED_AT)).toBe(false);

    vi.mocked(fetchChatHistory).mockResolvedValue({ messages: truncated });

    const settled = await fetchWorkflowSettleChatHistory(
      {} as GatewayManager,
      SESSION_KEY,
      { urgent: true, startedAtMs: STARTED_AT },
    );
    expect(settled.source).toBe('local');
    expect(hasTriggeringUserTurnAfter(settled.messages, STARTED_AT)).toBe(true);
    expect(transcriptHasWorkflowJsonAfter(settled.messages, STARTED_AT)).toBe(true);
  });

  it('does not treat an older user as fresh when the latest user is before startedAtMs', () => {
    const messages = [
      {
        role: 'user',
        content: 'old dispatch',
        timestamp: STARTED_AT + 10,
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'old reply' }],
        timestamp: STARTED_AT + 20,
      },
      {
        role: 'user',
        content: 'stale later user with clock skew / previous attempt',
        timestamp: STARTED_AT - 5_000,
      },
    ];
    expect(transcriptHasDispatchUserTurn(messages, STARTED_AT)).toBe(false);
    expect(hasTriggeringUserTurnAfter(messages, STARTED_AT)).toBe(false);
  });

  it('merges local prefix with Gateway tail when local lags mid-tool but Gateway has final JSON', () => {
    const localLagging = [
      {
        role: 'user',
        content: [{ type: 'text', text: '【Workflow 模式】' }],
        timestamp: STARTED_AT + 10,
      },
      {
        role: 'assistant',
        content: [{ type: 'toolUse', id: 't1', name: 'exec', input: {} }],
        timestamp: STARTED_AT + 100,
        stopReason: 'toolUse',
      },
      {
        role: 'toolResult',
        toolCallId: 't1',
        content: [{ type: 'text', text: 'out' }],
        timestamp: STARTED_AT + 200,
      },
    ];
    const gatewayTail = [
      {
        role: 'toolResult',
        toolCallId: 't1',
        content: [{ type: 'text', text: 'out' }],
        timestamp: STARTED_AT + 200,
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: FINAL_JSON }],
        timestamp: STARTED_AT + 50_000,
        stopReason: 'stop',
      },
    ];

    expect(transcriptHasDispatchUserTurn(localLagging, STARTED_AT)).toBe(true);
    expect(transcriptTailLooksInFlight(localLagging)).toBe(true);
    expect(transcriptHasWorkflowJsonAfter(localLagging, STARTED_AT)).toBe(false);
    expect(transcriptHasDispatchUserTurn(gatewayTail, STARTED_AT)).toBe(false);
    expect(transcriptHasWorkflowJsonAfter(gatewayTail, STARTED_AT)).toBe(true);

    const selected = selectWorkflowSettleHistory(localLagging, gatewayTail, STARTED_AT);
    expect(selected.source).toBe('merged');
    expect(hasTriggeringUserTurnAfter(selected.messages, STARTED_AT)).toBe(true);
    expect(transcriptHasWorkflowJsonAfter(selected.messages, STARTED_AT)).toBe(true);
    expect(transcriptTailLooksInFlight(selected.messages)).toBe(false);

    const merged = mergeLocalPrefixWithGatewayTail(localLagging, gatewayTail);
    expect(merged[0]?.role).toBe('user');
    expect(merged[merged.length - 1]?.role).toBe('assistant');
  });

  it('does not prefer a longer local transcript when neither side has a fresh user', () => {
    const localOld = Array.from({ length: 50 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `old-${i}`,
      timestamp: STARTED_AT - 100_000 + i,
    }));
    const gatewayFresh = [
      {
        role: 'assistant',
        content: [{ type: 'text', text: FINAL_JSON }],
        timestamp: STARTED_AT + 50_000,
      },
    ];
    const selected = selectWorkflowSettleHistory(localOld, gatewayFresh, STARTED_AT);
    expect(selected.source).toBe('gateway');
    expect(selected.messages).toEqual(gatewayFresh);
  });

  it('normalizes string timestamps from local jsonl', async () => {
    const sessionsDir = join(testOpenClawDir, 'agents', 'xy', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    const sessionId = 'string-ts-session';
    writeFileSync(
      join(sessionsDir, 'sessions.json'),
      JSON.stringify({ [SESSION_KEY]: { id: sessionId } }),
      'utf8',
    );
    writeFileSync(
      join(sessionsDir, `${sessionId}.jsonl`),
      `${JSON.stringify({
        type: 'message',
        message: {
          role: 'user',
          content: 'dispatch',
          timestamp: String(STARTED_AT + 10),
        },
      })}\n${JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: FINAL_JSON }],
          timestamp: String(STARTED_AT + 50_000),
        },
      })}\n`,
      'utf8',
    );

    const messages = await loadOfficeSessionTranscriptMessages(SESSION_KEY);
    expect(messages).not.toBeNull();
    expect(typeof messages![0]!.timestamp).toBe('number');
    expect(transcriptHasDispatchUserTurn(messages!, STARTED_AT)).toBe(true);
  });

  it('caches unchanged transcript content across repeated loads', async () => {
    writeTranscriptFixture({ messageCount: 5 });
    const first = await loadOfficeSessionTranscriptMessages(SESSION_KEY);
    const second = await loadOfficeSessionTranscriptMessages(SESSION_KEY);
    expect(first).not.toBeNull();
    expect(second).toBe(first); // same cached array reference when mtime/size unchanged
  });

  it('returns null when sessions.json points at a missing transcript file', async () => {
    const sessionsDir = join(testOpenClawDir, 'agents', 'xy', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(
      join(sessionsDir, 'sessions.json'),
      JSON.stringify({ [SESSION_KEY]: { id: 'missing-file' } }),
      'utf8',
    );
    await expect(loadOfficeSessionTranscriptMessages(SESSION_KEY)).resolves.toBeNull();
  });

  it('does not crash when sessions.json is null JSON', async () => {
    const sessionsDir = join(testOpenClawDir, 'agents', 'xy', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, 'sessions.json'), 'null', 'utf8');
    await expect(loadOfficeSessionTranscriptMessages(SESSION_KEY)).resolves.toBeNull();
  });

  it('does not crash when sessions.json sessions array contains null entries', async () => {
    const sessionsDir = join(testOpenClawDir, 'agents', 'xy', 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    const sessionId = 'null-entry-session';
    writeFileSync(
      join(sessionsDir, 'sessions.json'),
      JSON.stringify({
        sessions: [null, { key: SESSION_KEY, id: sessionId }],
      }),
      'utf8',
    );
    writeFileSync(
      join(sessionsDir, `${sessionId}.jsonl`),
      `${JSON.stringify({
        type: 'message',
        message: {
          role: 'user',
          content: 'dispatch',
          timestamp: STARTED_AT + 10,
        },
      })}\n`,
      'utf8',
    );
    await expect(loadOfficeSessionTranscriptMessages(SESSION_KEY)).resolves.not.toBeNull();
  });

  it('does not crash when Gateway returns non-array messages', async () => {
    writeTranscriptFixture({ messageCount: 2 });
    vi.mocked(fetchChatHistory).mockResolvedValue({ messages: undefined as unknown as never });
    await expect(
      fetchWorkflowSettleChatHistory({} as GatewayManager, SESSION_KEY, {
        urgent: true,
        startedAtMs: STARTED_AT,
      }),
    ).resolves.toMatchObject({ source: 'local' });
  });

  it('loadSessionHistoryForSettle-equivalent call passes startedAtMs (no ReferenceError)', async () => {
    // Regression: startedAtMs must be an explicit argument — a bare identifier in
    // loadSessionHistoryForSettle was a ReferenceError caught as null history.
    writeTranscriptFixture({ messageCount: 2 });
    const local = await loadOfficeSessionTranscriptMessages(SESSION_KEY);
    expect(local).not.toBeNull();
    vi.mocked(fetchChatHistory).mockResolvedValue({ messages: local!.slice(-2) });
    const result = await fetchWorkflowSettleChatHistory({} as GatewayManager, SESSION_KEY, {
      urgent: true,
      startedAtMs: STARTED_AT,
    });
    expect(result.messages.length).toBeGreaterThan(0);
    expect(transcriptHasDispatchUserTurn(result.messages, STARTED_AT)).toBe(true);
  });

  it('merge retains undated dispatch user when Gateway tail has JSON but no user', () => {
    const localLagging = [
      {
        role: 'user',
        content: [{ type: 'text', text: '【Workflow 模式】undated dispatch' }],
        // no timestamp — undated_match opens the turn on local
      },
      {
        role: 'assistant',
        content: [{ type: 'toolUse', id: 't1', name: 'exec', input: {} }],
        timestamp: STARTED_AT + 100,
        stopReason: 'toolUse',
      },
      {
        role: 'toolResult',
        toolCallId: 't1',
        content: [{ type: 'text', text: 'out' }],
        timestamp: STARTED_AT + 200,
      },
    ];
    const gatewayTail = [
      {
        role: 'toolResult',
        toolCallId: 't1',
        content: [{ type: 'text', text: 'out' }],
        timestamp: STARTED_AT + 200,
      },
      {
        role: 'assistant',
        content: [{ type: 'text', text: FINAL_JSON }],
        timestamp: STARTED_AT + 50_000,
        stopReason: 'stop',
      },
    ];

    expect(transcriptHasDispatchUserTurn(localLagging, STARTED_AT)).toBe(true);
    const selected = selectWorkflowSettleHistory(localLagging, gatewayTail, STARTED_AT);
    expect(selected.source).toBe('merged');
    expect(hasTriggeringUserTurnAfter(selected.messages, STARTED_AT)).toBe(true);
    expect(transcriptHasWorkflowJsonAfter(selected.messages, STARTED_AT)).toBe(true);
  });
});
