import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GatewayManager } from '../../electron/gateway/manager';
import { fetchChatHistory } from '../../electron/services/office/gateway-rpc';
import { waitForSessionFreshUserTurn } from '../../electron/services/office/run-completion';

vi.mock('../../electron/services/office/gateway-rpc', () => ({
  fetchChatHistory: vi.fn(),
}));

describe('mention session turn gate', () => {
  const gateway = {} as GatewayManager;

  beforeEach(() => {
    vi.mocked(fetchChatHistory).mockReset();
  });

  it('waitForSessionFreshUserTurn resolves true when fresh user turn appears', async () => {
    const sendAt = Date.now();
    vi.mocked(fetchChatHistory).mockResolvedValue({
      messages: [{ role: 'user', content: 'member report', timestamp: sendAt + 50 }],
    });

    await expect(
      waitForSessionFreshUserTurn(gateway, 'agent:test:session', sendAt, {
        deadlineMs: 2_000,
        pollMs: 50,
      }),
    ).resolves.toMatchObject({ opened: true });
    expect(fetchChatHistory).toHaveBeenCalledTimes(1);
    expect(fetchChatHistory).toHaveBeenCalledWith(
      gateway,
      'agent:test:session',
      80,
      { urgent: true },
    );
  });

  it('uses urgent only on the first turn-gate poll', async () => {
    vi.mocked(fetchChatHistory).mockResolvedValue({
      messages: [{ role: 'user', content: 'old', timestamp: 1_000 }],
    });

    await expect(
      waitForSessionFreshUserTurn(gateway, 'agent:test:session', Date.now(), {
        deadlineMs: 250,
        pollMs: 40,
      }),
    ).resolves.toMatchObject({ opened: false });

    expect(vi.mocked(fetchChatHistory).mock.calls.length).toBeGreaterThan(1);
    expect(vi.mocked(fetchChatHistory).mock.calls[0]?.[3]).toEqual({ urgent: true });
    for (const call of vi.mocked(fetchChatHistory).mock.calls.slice(1)) {
      expect(call[3]?.urgent).toBeFalsy();
    }
  });

  it('waitForSessionFreshUserTurn resolves false when only stale turns exist', async () => {
    vi.mocked(fetchChatHistory).mockResolvedValue({
      messages: [
        { role: 'user', content: 'old', timestamp: 1_000 },
        { role: 'assistant', content: 'done', timestamp: 2_000 },
      ],
    });

    await expect(
      waitForSessionFreshUserTurn(gateway, 'agent:test:session', Date.now(), {
        deadlineMs: 120,
        pollMs: 40,
      }),
    ).resolves.toMatchObject({ opened: false });
  });

  it('does not treat a recent prior user turn as opened when content differs', async () => {
    const sendAt = Date.now();
    vi.mocked(fetchChatHistory).mockResolvedValue({
      messages: [
        { role: 'user', content: 'batch A prompt', timestamp: sendAt - 100 },
        { role: 'assistant', content: 'done', timestamp: sendAt - 50 },
      ],
    });

    await expect(
      waitForSessionFreshUserTurn(gateway, 'agent:test:session', sendAt, {
        deadlineMs: 120,
        pollMs: 40,
        expectedMessage: 'batch B prompt',
      }),
    ).resolves.toMatchObject({ opened: false });
  });

  it('allows undated history only when the user turn matches the sent message', async () => {
    const sendAt = Date.now();
    vi.mocked(fetchChatHistory).mockResolvedValue({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'batch B prompt' }] }],
    });

    await expect(
      waitForSessionFreshUserTurn(gateway, 'agent:test:session', sendAt, {
        deadlineMs: 120,
        pollMs: 40,
        expectedMessage: 'batch B prompt',
      }),
    ).resolves.toMatchObject({ opened: true, acceptedBy: 'undated_match' });
  });

  it('accepts a matching user turn from the first attempt window during retry', async () => {
    const firstSendAt = Date.now();
    const retrySendAt = firstSendAt + 50_000;
    vi.mocked(fetchChatHistory).mockResolvedValue({
      messages: [
        { role: 'user', content: 'batch B prompt', timestamp: firstSendAt + 100 },
        { role: 'assistant', content: 'done', timestamp: firstSendAt + 2_000 },
      ],
    });

    await expect(
      waitForSessionFreshUserTurn(gateway, 'agent:test:session', retrySendAt, {
        deadlineMs: 120,
        pollMs: 40,
        expectedMessage: 'batch B prompt',
        earliestAcceptedUserTurnAtMs: firstSendAt,
      }),
    ).resolves.toMatchObject({
      opened: true,
      acceptedBy: 'send_group',
      userTurnTs: firstSendAt + 100,
    });
  });
});
