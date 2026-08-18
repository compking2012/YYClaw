import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('reconcileWithOptionalChatRetryForReason', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries once for chat install when the first reconcile pass finds no changes', async () => {
    const { reconcileWithOptionalChatRetryForReason } = await import('@electron/utils/workspace-agent-skills-sync');
    const reconcile = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const pending = reconcileWithOptionalChatRetryForReason('chat-run:chat-zip-media', reconcile);
    await vi.advanceTimersByTimeAsync(1500);
    await expect(pending).resolves.toBe(true);

    expect(reconcile).toHaveBeenCalledTimes(2);
  });

  it('retries multiple times for chat uninstall when disk deletion is delayed', async () => {
    const { reconcileWithOptionalChatRetryForReason, getChatReconcileRetryDelaysMs } = await import('@electron/utils/workspace-agent-skills-sync');
    expect(getChatReconcileRetryDelaysMs('chat-run:chat-skill-uninstall-tool')).toEqual([1500, 3000, 4500]);

    const reconcile = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const pending = reconcileWithOptionalChatRetryForReason('chat-run:chat-skill-uninstall-tool', reconcile);
    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(4500);
    await expect(pending).resolves.toBe(true);

    expect(reconcile).toHaveBeenCalledTimes(4);
  });

  it('does not retry for gateway:ready when the first pass finds no changes', async () => {
    const { reconcileWithOptionalChatRetryForReason } = await import('@electron/utils/workspace-agent-skills-sync');
    const reconcile = vi.fn().mockResolvedValue(false);

    await expect(reconcileWithOptionalChatRetryForReason('gateway:ready', reconcile)).resolves.toBe(false);
    expect(reconcile).toHaveBeenCalledTimes(1);
  });
});

describe('getChatReconcileRetryDelaysMs', () => {
  it('returns longer retry chain for uninstall and filesystem reasons', async () => {
    const { getChatReconcileRetryDelaysMs } = await import('@electron/utils/workspace-agent-skills-sync');
    expect(getChatReconcileRetryDelaysMs('chat-run:chat-skill-filesystem')).toHaveLength(3);
    expect(getChatReconcileRetryDelaysMs('chat-run:chat-zip-media')).toEqual([1500]);
    expect(getChatReconcileRetryDelaysMs('gateway:ready')).toEqual([]);
  });
});
