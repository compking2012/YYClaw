import { beforeEach, describe, expect, it, vi } from 'vitest';

const { waitTickMock } = vi.hoisted(() => ({
  waitTickMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../electron/services/office/office-sync-runtime', () => ({
  waitForOfficeUnifiedPollTick: (...args: unknown[]) => waitTickMock(...args),
}));

describe('waitForNextMentionPoll', () => {
  beforeEach(() => {
    vi.resetModules();
    waitTickMock.mockClear();
    waitTickMock.mockResolvedValue(undefined);
  });

  it('waits on the unified poll tick when explicit wait equals the poll interval', async () => {
    const { waitForNextMentionPoll, MENTION_CONTENT_DETECT_POLL_MS } = await import(
      '../../electron/services/office/mention-run-settled'
    );

    const result = await waitForNextMentionPoll(
      Date.now() + 60_000,
      undefined,
      undefined,
      MENTION_CONTENT_DETECT_POLL_MS,
    );

    expect(result).toBe('ok');
    expect(waitTickMock).toHaveBeenCalledTimes(1);
  });

  it('returns immediately when shouldWake is already true', async () => {
    const { waitForNextMentionPoll } = await import(
      '../../electron/services/office/mention-run-settled'
    );

    const result = await waitForNextMentionPoll(Date.now() + 60_000, undefined, () => true);

    expect(result).toBe('ok');
    expect(waitTickMock).not.toHaveBeenCalled();
  });

  it('uses a short explicit sleep for sub-interval waits', async () => {
    const { waitForNextMentionPoll } = await import(
      '../../electron/services/office/mention-run-settled'
    );

    const startedAt = Date.now();
    const result = await waitForNextMentionPoll(Date.now() + 60_000, undefined, undefined, 50);
    const elapsedMs = Date.now() - startedAt;

    expect(result).toBe('ok');
    expect(waitTickMock).not.toHaveBeenCalled();
    expect(elapsedMs).toBeGreaterThanOrEqual(40);
  });
});
