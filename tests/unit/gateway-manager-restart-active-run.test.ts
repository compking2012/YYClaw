// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    isPackaged: false,
  },
  utilityProcess: {
    fork: vi.fn(),
  },
}));

vi.mock('@electron/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

/**
 * Covers "Gateway restart must not sever an in-flight chat run": a restart
 * triggered while a run is executing (e.g. saving a provider/settings change)
 * should defer until the run ends, mirroring the previous Office-execution
 * deferral, instead of killing the WS connection mid-run.
 */
describe('GatewayManager restart deferral for active chat runs', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('defers restart while a chat run is in flight and does not call stop()/start()', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    const internals = manager as unknown as {
      status: { state: string; port: number };
      startLock: boolean;
    };
    internals.status = { state: 'running', port: 18789 };
    internals.startLock = false;

    const stopSpy = vi.spyOn(manager, 'stop').mockResolvedValue(undefined);
    const startSpy = vi.spyOn(manager, 'start').mockResolvedValue(undefined);

    manager.emit('chat:runtime-event', { type: 'run.started', runId: 'run-a' });
    expect(manager.hasActiveChatRuns()).toBe(true);

    await manager.restart();

    expect(stopSpy).not.toHaveBeenCalled();
    expect(startSpy).not.toHaveBeenCalled();
  });

  it('flushes the deferred restart once the run ends', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    const internals = manager as unknown as {
      status: { state: string; port: number };
      startLock: boolean;
      shouldReconnect: boolean;
    };
    internals.status = { state: 'running', port: 18789 };
    internals.startLock = false;
    internals.shouldReconnect = true;

    const stopSpy = vi.spyOn(manager, 'stop').mockImplementation(async () => {
      internals.status = { state: 'stopped', port: 18789 };
    });
    const startSpy = vi.spyOn(manager, 'start').mockImplementation(async () => {
      internals.status = { state: 'running', port: 18789 };
    });

    manager.emit('chat:runtime-event', { type: 'run.started', runId: 'run-b' });
    await manager.restart();
    expect(stopSpy).not.toHaveBeenCalled();

    manager.emit('chat:runtime-event', { type: 'run.ended', runId: 'run-b', status: 'completed' });
    await vi.waitFor(() => expect(stopSpy).toHaveBeenCalledTimes(1));

    expect(manager.hasActiveChatRuns()).toBe(false);
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it('restarts immediately when no chat run is active', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    const manager = new GatewayManager();
    const internals = manager as unknown as {
      status: { state: string; port: number };
      startLock: boolean;
    };
    internals.status = { state: 'running', port: 18789 };
    internals.startLock = false;

    const stopSpy = vi.spyOn(manager, 'stop').mockResolvedValue(undefined);
    const startSpy = vi.spyOn(manager, 'start').mockResolvedValue(undefined);

    await manager.restart();

    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(startSpy).toHaveBeenCalledTimes(1);
  });
});
