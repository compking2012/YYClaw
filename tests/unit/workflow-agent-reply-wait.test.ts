import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';

import { waitForAgentReply } from '@electron/workflow/adapter/agent-reply-wait';

/**
 * Guards the "workflow step captured the preamble, not the final reply" bug: the
 * waiter must NOT accept an assistant opening line while tools are still in
 * flight, and must return the FINAL reply once the gateway signals run
 * completion. A conservative idle fallback covers gateways that emit no
 * completion phase; a stuck (forever in-flight) turn times out to null.
 */

type Msg = Record<string, unknown>;

class FakeGateway extends EventEmitter {
  history: Msg[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async rpc(method: string, _params?: unknown): Promise<any> {
    if (method === 'chat.history') return { messages: this.history };
    return {};
  }
}

const FAST = { pollIntervalMs: 5, initialDelayMs: 0 } as const;

describe('waitForAgentReply', () => {
  it('waits past an in-flight tool preamble and returns the final reply on run completion', async () => {
    const gw = new FakeGateway();
    // Opening line with an UNCLOSED tool call — must not be accepted.
    gw.history = [
      { role: 'user', content: 'do step', timestamp: 1000 },
      {
        role: 'assistant',
        timestamp: 1001,
        content: [
          { type: 'text', text: '我先调研一下' },
          { type: 'tool_use', id: 't1', name: 'search' },
        ],
      },
    ];

    // Shortly after: tool closes, the final answer lands, and the run completes.
    setTimeout(() => {
      gw.history.push({ role: 'tool_result', tool_call_id: 't1', content: 'raw results', timestamp: 2000 });
      gw.history.push({ role: 'assistant', content: '最终融资报告正文', timestamp: 2001 });
      gw.emit('notification', {
        method: 'agent',
        params: { sessionKey: 'wf:run1:step1', phase: 'completed', runId: 'r1' },
      });
    }, 25);

    const text = await waitForAgentReply(gw as never, {
      sessionKey: 'wf:run1:step1',
      startedAtMs: 0,
      runId: 'r1',
      timeoutMs: 3000,
      idleFallbackMs: 100_000, // disable fallback: completion event drives acceptance
      ...FAST,
    });
    expect(text).toBe('最终融资报告正文');
  });

  it('matches events even when the gateway namespaces the sessionKey under an agent', async () => {
    const gw = new FakeGateway();
    gw.history = [
      { role: 'user', content: 'do step', timestamp: 1000 },
      { role: 'assistant', content: '答复正文', timestamp: 1001 },
    ];
    setTimeout(() => {
      // Event carries `agent:ceo:` prefix; we sent the bare `wf:...` key.
      gw.emit('chat:message', {
        message: { sessionKey: 'agent:ceo:wf:run1:step1', phase: 'done' },
      });
    }, 15);

    const text = await waitForAgentReply(gw as never, {
      sessionKey: 'wf:run1:step1',
      startedAtMs: 0,
      timeoutMs: 3000,
      idleFallbackMs: 100_000,
      ...FAST,
    });
    expect(text).toBe('答复正文');
  });

  it('falls back to the latest stable reply when no completion phase is ever emitted', async () => {
    const gw = new FakeGateway();
    gw.history = [
      { role: 'user', content: 'do step', timestamp: 1000 },
      { role: 'assistant', content: '直接给出的答案', timestamp: 1001 },
    ];
    const text = await waitForAgentReply(gw as never, {
      sessionKey: 'wf:run2:step1',
      startedAtMs: 0,
      timeoutMs: 3000,
      idleFallbackMs: 30, // no events → accept after brief idle
      ...FAST,
    });
    expect(text).toBe('直接给出的答案');
  });

  it('returns null (fails cleanly) when the turn stays in-flight until the deadline', async () => {
    const gw = new FakeGateway();
    gw.history = [
      { role: 'user', content: 'do step', timestamp: 1000 },
      {
        role: 'assistant',
        timestamp: 1001,
        content: [
          { type: 'text', text: '我先调研一下' },
          { type: 'tool_use', id: 't1', name: 'search' },
        ],
      },
    ];
    const text = await waitForAgentReply(gw as never, {
      sessionKey: 'wf:run3:step1',
      startedAtMs: 0,
      timeoutMs: 60,
      idleFallbackMs: 100_000, // never idle-accept; tool never closes
      ...FAST,
    });
    expect(text).toBeNull();
  });
});
