import { describe, expect, it, vi } from 'vitest';
import {
  awaitAgentRuntimeConvergence,
  awaitChannelRuntimeConvergence,
  noteConfigWatcherRefresh,
} from '@electron/gateway/config-refresh-scheduler';

vi.mock('@electron/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function runningGateway(
  rpc: ReturnType<typeof vi.fn>,
  applyConfigViaRpc: ReturnType<typeof vi.fn> = vi.fn().mockResolvedValue(true),
) {
  return {
    getStatus: vi.fn(() => ({ state: 'running' as const })),
    rpc,
    applyConfigViaRpc,
    debouncedReload: vi.fn(),
    debouncedRestart: vi.fn(),
    restart: vi.fn(),
  };
}

describe('config refresh scheduler', () => {
  it('waits until agents.list exposes the expected live model', async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({
        agents: [{ id: 'main', model: { primary: 'provider/old' } }],
      })
      .mockResolvedValueOnce({
        agents: [{ id: 'main', model: { primary: 'provider/new' } }],
      });
    const gateway = runningGateway(rpc);

    await expect(awaitAgentRuntimeConvergence(
      gateway,
      [{ agentId: 'main', modelRef: 'provider/new' }],
      { intervalMs: 1, timeoutMs: 100 },
    )).resolves.toBeUndefined();

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(gateway.applyConfigViaRpc).not.toHaveBeenCalled();
    expect(gateway.debouncedReload).not.toHaveBeenCalled();
    expect(gateway.debouncedRestart).not.toHaveBeenCalled();
    expect(gateway.restart).not.toHaveBeenCalled();
  });

  it('coalesces concurrent waits for the same target runtime state', async () => {
    let resolveRpc: ((value: unknown) => void) | undefined;
    const rpc = vi.fn(() => new Promise((resolve) => {
      resolveRpc = resolve;
    }));
    const gateway = runningGateway(rpc);
    const expectation = [{ agentId: 'main', modelRef: 'provider/new' }];

    const first = awaitAgentRuntimeConvergence(gateway, expectation, { timeoutMs: 100 });
    const second = awaitAgentRuntimeConvergence(gateway, expectation, { timeoutMs: 100 });
    resolveRpc?.({
      agents: [{ id: 'main', model: { primary: 'provider/new' } }],
    });

    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('escalates via config.apply when the watcher window times out, then converges', async () => {
    let converged = false;
    const rpc = vi.fn(async () => ({
      agents: [{ id: 'main', model: { primary: converged ? 'provider/new' : 'provider/old' } }],
    }));
    // config.apply push is what makes the runtime reflect the new model.
    const applyConfigViaRpc = vi.fn(async () => {
      converged = true;
      return true;
    });
    const gateway = runningGateway(rpc, applyConfigViaRpc);

    await expect(awaitAgentRuntimeConvergence(
      gateway,
      [{ agentId: 'main', modelRef: 'provider/new' }],
      { intervalMs: 1, timeoutMs: 10, escalationTimeoutMs: 100 },
    )).resolves.toBeUndefined();

    expect(applyConfigViaRpc).toHaveBeenCalledTimes(1);
    expect(gateway.debouncedReload).not.toHaveBeenCalled();
    expect(gateway.debouncedRestart).not.toHaveBeenCalled();
    expect(gateway.restart).not.toHaveBeenCalled();
  });

  it('falls back to debouncedReload without erroring when escalation still fails to converge', async () => {
    const rpc = vi.fn().mockResolvedValue({
      agents: [{ id: 'main', model: { primary: 'provider/old' } }],
    });
    const applyConfigViaRpc = vi.fn().mockResolvedValue(false);
    const gateway = runningGateway(rpc, applyConfigViaRpc);

    await expect(awaitAgentRuntimeConvergence(
      gateway,
      [{ agentId: 'main', modelRef: 'provider/new' }],
      { intervalMs: 1, timeoutMs: 10, escalationTimeoutMs: 10 },
    )).resolves.toBeUndefined();

    expect(applyConfigViaRpc).toHaveBeenCalledTimes(1);
    expect(gateway.debouncedReload).toHaveBeenCalledTimes(1);
    expect(gateway.debouncedRestart).not.toHaveBeenCalled();
    expect(gateway.restart).not.toHaveBeenCalled();
  });

  it('skips runtime waits and watcher notices while stopped', async () => {
    const gateway = {
      getStatus: vi.fn(() => ({ state: 'stopped' as const })),
      rpc: vi.fn(),
    };

    noteConfigWatcherRefresh(gateway, 'config changed', { onlyIfRunning: true });
    await expect(awaitAgentRuntimeConvergence(
      gateway,
      [{ agentId: 'main', modelRef: 'provider/new' }],
    )).resolves.toBeUndefined();

    expect(gateway.rpc).not.toHaveBeenCalled();
  });
});

function connectedAccount(accountId = 'default') {
  return { accountId, connected: true, running: true };
}

function erroringAccount(accountId = 'default') {
  return { accountId, running: true, lastError: 'not connected' };
}

describe('awaitChannelRuntimeConvergence', () => {
  it('returns fast when channels.status already reports the account connected', async () => {
    const rpc = vi.fn().mockResolvedValue({
      channelAccounts: { feishu: [connectedAccount()] },
    });
    const gateway = runningGateway(rpc);

    await expect(awaitChannelRuntimeConvergence(
      gateway, 'feishu', 'default', { intervalMs: 1, timeoutMs: 100 },
    )).resolves.toBeUndefined();

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(gateway.applyConfigViaRpc).not.toHaveBeenCalled();
    expect(gateway.debouncedRestart).not.toHaveBeenCalled();
  });

  it('escalates via config.apply when the watcher window times out, then converges', async () => {
    let connected = false;
    const rpc = vi.fn(async () => ({
      channelAccounts: { feishu: [connected ? connectedAccount() : erroringAccount()] },
    }));
    const applyConfigViaRpc = vi.fn(async () => {
      connected = true;
      return true;
    });
    const gateway = runningGateway(rpc, applyConfigViaRpc);

    await expect(awaitChannelRuntimeConvergence(
      gateway, 'feishu', 'default', { intervalMs: 1, timeoutMs: 10, escalationTimeoutMs: 100 },
    )).resolves.toBeUndefined();

    expect(applyConfigViaRpc).toHaveBeenCalledTimes(1);
    expect(gateway.debouncedRestart).not.toHaveBeenCalled();
  });

  it('escalates to debouncedRestart without erroring when the account never connects', async () => {
    // Simulates a newly-installed plugin the running Gateway has not loaded: the
    // account stays erroring / absent until a restart re-scans extensions.
    const rpc = vi.fn().mockResolvedValue({
      channelAccounts: { feishu: [erroringAccount()] },
    });
    const applyConfigViaRpc = vi.fn().mockResolvedValue(false);
    const gateway = runningGateway(rpc, applyConfigViaRpc);

    await expect(awaitChannelRuntimeConvergence(
      gateway, 'feishu', 'default', { intervalMs: 1, timeoutMs: 10, escalationTimeoutMs: 10 },
    )).resolves.toBeUndefined();

    expect(applyConfigViaRpc).toHaveBeenCalledTimes(1);
    expect(gateway.debouncedRestart).toHaveBeenCalledTimes(1);
    expect(gateway.debouncedReload).not.toHaveBeenCalled();
  });

  it('coalesces concurrent waits for the same channel account', async () => {
    let resolveRpc: ((value: unknown) => void) | undefined;
    const rpc = vi.fn(() => new Promise((resolve) => {
      resolveRpc = resolve;
    }));
    const gateway = runningGateway(rpc);

    const first = awaitChannelRuntimeConvergence(gateway, 'feishu', 'default', { timeoutMs: 100 });
    const second = awaitChannelRuntimeConvergence(gateway, 'feishu', 'default', { timeoutMs: 100 });
    resolveRpc?.({ channelAccounts: { feishu: [connectedAccount()] } });

    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('does nothing while the Gateway is stopped', async () => {
    const gateway = {
      getStatus: vi.fn(() => ({ state: 'stopped' as const })),
      rpc: vi.fn(),
      applyConfigViaRpc: vi.fn(),
      debouncedRestart: vi.fn(),
    };

    await expect(awaitChannelRuntimeConvergence(gateway, 'feishu', 'default'))
      .resolves.toBeUndefined();

    expect(gateway.rpc).not.toHaveBeenCalled();
    expect(gateway.applyConfigViaRpc).not.toHaveBeenCalled();
    expect(gateway.debouncedRestart).not.toHaveBeenCalled();
  });
});
