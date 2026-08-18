import { beforeEach, describe, expect, it, vi } from 'vitest';

const noteConfigWatcherRefreshMock = vi.fn();

vi.mock('../../electron/gateway/config-refresh-scheduler', () => ({
  noteConfigWatcherRefresh: (...args: unknown[]) => noteConfigWatcherRefreshMock(...args),
}));

describe('withGatewayHotSkillFilesystem', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('keeps an active gateway running around skill filesystem mutations', async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const restart = vi.fn().mockResolvedValue(undefined);
    const applyConfigHotOnly = vi.fn().mockResolvedValue(true);
    const rpc = vi.fn().mockResolvedValue({ skills: [] });
    const getStatus = vi.fn().mockReturnValue({ state: 'running' });
    const gatewayManager = { stop, restart, applyConfigHotOnly, rpc, getStatus };
    const operation = vi.fn().mockResolvedValue('ok');

    const { withGatewayHotSkillFilesystem } = await import(
      '../../electron/services/skills/skill-gateway-fs-guard'
    );
    const result = await withGatewayHotSkillFilesystem(gatewayManager as never, operation);

    expect(result).toBe('ok');
    expect(operation).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
    expect(applyConfigHotOnly).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('skills.status', {}, 5_000);
    expect(noteConfigWatcherRefreshMock).not.toHaveBeenCalled();
  });

  it('falls back to watcher note with a single attempt when hot-only stays false', async () => {
    vi.useFakeTimers();
    try {
      const applyConfigHotOnly = vi.fn().mockResolvedValue(false);
      const rpc = vi.fn().mockResolvedValue({ skills: [] });
      const getStatus = vi.fn().mockReturnValue({ state: 'running' });
      const gatewayManager = { applyConfigHotOnly, rpc, getStatus };

      const { withGatewayHotSkillFilesystem, clearDeferredSkillConfigHotApplyForTests } = await import(
        '../../electron/services/skills/skill-gateway-fs-guard'
      );
      clearDeferredSkillConfigHotApplyForTests();
      const pending = withGatewayHotSkillFilesystem(gatewayManager as never, async () => 'kept');
      await vi.runAllTimersAsync();
      const result = await pending;

      expect(result).toBe('kept');
      // Must NOT burn OpenClaw's control-plane budget (3 writes / 60s) with rapid retries.
      expect(applyConfigHotOnly).toHaveBeenCalledTimes(1);
      expect(noteConfigWatcherRefreshMock).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenCalledWith('skills.status', {}, 5_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('must not chain deferred rate-limit retries through applySkillConfigHotWithFallback', async () => {
    vi.useFakeTimers();
    try {
      const rateLimitError = new Error('rate limit exceeded for config.apply; retry after 60s');
      // Immediate attempt rate-limited; deferred one-shot also rate-limited — must not reschedule forever.
      const applyConfigHotOnly = vi.fn().mockRejectedValue(rateLimitError);
      const rpc = vi.fn().mockResolvedValue({ skills: [] });
      const getStatus = vi.fn().mockReturnValue({ state: 'running' });
      const gatewayManager = { applyConfigHotOnly, rpc, getStatus };

      const {
        withGatewayHotSkillFilesystem,
        clearDeferredSkillConfigHotApplyForTests,
      } = await import('../../electron/services/skills/skill-gateway-fs-guard');
      clearDeferredSkillConfigHotApplyForTests();

      await withGatewayHotSkillFilesystem(gatewayManager as never, async () => 'kept');
      expect(applyConfigHotOnly).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(applyConfigHotOnly).toHaveBeenCalledTimes(2);

      // No second deferred wave.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(applyConfigHotOnly).toHaveBeenCalledTimes(2);
    } finally {
      const { clearDeferredSkillConfigHotApplyForTests } = await import(
        '../../electron/services/skills/skill-gateway-fs-guard'
      );
      clearDeferredSkillConfigHotApplyForTests();
      vi.useRealTimers();
    }
  });

  it('stops retrying on config.apply rate limit and schedules one deferred one-shot', async () => {
    vi.useFakeTimers();
    try {
      const rateLimitError = new Error('rate limit exceeded for config.apply; retry after 60s');
      const applyConfigHotOnly = vi.fn()
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce(true);
      const rpc = vi.fn().mockResolvedValue({ skills: [] });
      const getStatus = vi.fn().mockReturnValue({ state: 'running' });
      const gatewayManager = { applyConfigHotOnly, rpc, getStatus };

      const {
        withGatewayHotSkillFilesystem,
        clearDeferredSkillConfigHotApplyForTests,
      } = await import('../../electron/services/skills/skill-gateway-fs-guard');
      clearDeferredSkillConfigHotApplyForTests();

      const result = await withGatewayHotSkillFilesystem(gatewayManager as never, async () => 'kept');
      expect(result).toBe('kept');
      expect(applyConfigHotOnly).toHaveBeenCalledTimes(1);
      expect(noteConfigWatcherRefreshMock).toHaveBeenCalledWith(
        gatewayManager,
        'Skill mutation committed; config.apply rate-limited',
        { onlyIfRunning: true },
      );

      await vi.advanceTimersByTimeAsync(60_000);
      expect(applyConfigHotOnly).toHaveBeenCalledTimes(2);
    } finally {
      const { clearDeferredSkillConfigHotApplyForTests } = await import(
        '../../electron/services/skills/skill-gateway-fs-guard'
      );
      clearDeferredSkillConfigHotApplyForTests();
      vi.useRealTimers();
    }
  });

  it('parseConfigApplyRateLimit reads retry-after seconds', async () => {
    const { parseConfigApplyRateLimit } = await import(
      '../../electron/services/skills/skill-gateway-fs-guard'
    );
    expect(parseConfigApplyRateLimit(new Error('rate limit exceeded for config.apply; retry after 60s')))
      .toEqual({ retryAfterMs: 60_000 });
    expect(parseConfigApplyRateLimit(new Error('boom'))).toBeNull();
  });

  it('does not roll back when skills.status observation fails', async () => {
    const applyConfigHotOnly = vi.fn().mockResolvedValue(true);
    const rpc = vi.fn().mockRejectedValue(new Error('status timeout'));
    const getStatus = vi.fn().mockReturnValue({ state: 'running' });
    const gatewayManager = { applyConfigHotOnly, rpc, getStatus };

    const { withGatewayHotSkillFilesystem } = await import(
      '../../electron/services/skills/skill-gateway-fs-guard'
    );
    await expect(
      withGatewayHotSkillFilesystem(gatewayManager as never, async () => 'committed'),
    ).resolves.toBe('committed');
  });

  it('skips hot verification when gateway is already stopped', async () => {
    const stop = vi.fn();
    const restart = vi.fn();
    const applyConfigHotOnly = vi.fn();
    const rpc = vi.fn();
    const getStatus = vi.fn().mockReturnValue({ state: 'stopped' });
    const gatewayManager = { stop, restart, applyConfigHotOnly, rpc, getStatus };
    const operation = vi.fn().mockResolvedValue(42);

    const { withGatewayHotSkillFilesystem } = await import(
      '../../electron/services/skills/skill-gateway-fs-guard'
    );
    const result = await withGatewayHotSkillFilesystem(gatewayManager as never, operation);

    expect(result).toBe(42);
    expect(stop).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
    expect(applyConfigHotOnly).not.toHaveBeenCalled();
  });

  it('does not restart the gateway when the filesystem operation fails', async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const restart = vi.fn().mockResolvedValue(undefined);
    const applyConfigHotOnly = vi.fn();
    const rpc = vi.fn();
    const getStatus = vi.fn().mockReturnValue({ state: 'reconnecting' });
    const gatewayManager = { stop, restart, applyConfigHotOnly, rpc, getStatus };
    const operation = vi.fn().mockRejectedValue(new Error('delete failed'));

    const { withGatewayHotSkillFilesystem } = await import(
      '../../electron/services/skills/skill-gateway-fs-guard'
    );

    await expect(
      withGatewayHotSkillFilesystem(gatewayManager as never, operation),
    ).rejects.toThrow('delete failed');
    expect(stop).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
  });
});

describe('withGatewayRestartForSkillFilesystem', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('stops and restarts the gateway around skill filesystem mutations when gateway is active', async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const restart = vi.fn().mockResolvedValue(undefined);
    const getStatus = vi.fn().mockReturnValue({ state: 'running' });
    const gatewayManager = { stop, restart, getStatus };
    const operation = vi.fn().mockResolvedValue('ok');

    const { withGatewayRestartForSkillFilesystem } = await import(
      '../../electron/services/skills/skill-gateway-fs-guard'
    );
    const result = await withGatewayRestartForSkillFilesystem(gatewayManager as never, operation);

    expect(result).toBe('ok');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(restart).toHaveBeenCalledTimes(1);
    expect(stop.mock.invocationCallOrder[0]).toBeLessThan(operation.mock.invocationCallOrder[0]);
    expect(operation.mock.invocationCallOrder[0]).toBeLessThan(restart.mock.invocationCallOrder[0]);
  });

  it('skips gateway stop/restart when gateway is already stopped', async () => {
    const stop = vi.fn();
    const restart = vi.fn();
    const getStatus = vi.fn().mockReturnValue({ state: 'stopped' });
    const gatewayManager = { stop, restart, getStatus };
    const operation = vi.fn().mockResolvedValue(42);

    const { withGatewayRestartForSkillFilesystem } = await import(
      '../../electron/services/skills/skill-gateway-fs-guard'
    );
    const result = await withGatewayRestartForSkillFilesystem(gatewayManager as never, operation);

    expect(result).toBe(42);
    expect(stop).not.toHaveBeenCalled();
    expect(restart).not.toHaveBeenCalled();
  });

  it('still restarts the gateway when the filesystem operation fails', async () => {
    const stop = vi.fn().mockResolvedValue(undefined);
    const restart = vi.fn().mockResolvedValue(undefined);
    const getStatus = vi.fn().mockReturnValue({ state: 'reconnecting' });
    const gatewayManager = { stop, restart, getStatus };
    const operation = vi.fn().mockRejectedValue(new Error('delete failed'));

    const { withGatewayRestartForSkillFilesystem } = await import(
      '../../electron/services/skills/skill-gateway-fs-guard'
    );

    await expect(
      withGatewayRestartForSkillFilesystem(gatewayManager as never, operation),
    ).rejects.toThrow('delete failed');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(restart).toHaveBeenCalledTimes(1);
  });
});
