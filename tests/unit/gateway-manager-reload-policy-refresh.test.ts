// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockLoadGatewayReloadPolicy } = vi.hoisted(() => ({
  mockLoadGatewayReloadPolicy: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
    isPackaged: false,
  },
  utilityProcess: {
    fork: vi.fn(),
  },
}));

// Must match how `electron/gateway/manager.ts` resolves `./reload-policy` (same file as `@electron/...`).
vi.mock('../../electron/gateway/reload-policy', () => ({
  DEFAULT_GATEWAY_RELOAD_POLICY: { mode: 'hybrid', debounceMs: 1200 },
  parseGatewayReloadPolicy: () => ({ mode: 'hybrid', debounceMs: 1200 }),
  loadGatewayReloadPolicy: (...args: unknown[]) => mockLoadGatewayReloadPolicy(...args),
}));

describe('GatewayManager refreshReloadPolicy', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.resetModules();
  });

  it('deduplicates concurrent refresh calls', async () => {
    const { GatewayManager } = await import('@electron/gateway/manager');
    let resolveLoad: ((value: { mode: 'reload'; debounceMs: number }) => void) | null = null;
    mockLoadGatewayReloadPolicy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );

    const manager = new GatewayManager();
    const refresh = (manager as unknown as { refreshReloadPolicy: (force?: boolean) => Promise<void> })
      .refreshReloadPolicy.bind(manager);

    const p1 = refresh(true);
    const p2 = refresh(true);

    expect(mockLoadGatewayReloadPolicy).toHaveBeenCalledTimes(1);

    resolveLoad?.({ mode: 'reload', debounceMs: 1300 });
    await Promise.all([p1, p2]);

    expect((manager as unknown as { reloadPolicy: { mode: string; debounceMs: number } }).reloadPolicy).toEqual({
      mode: 'reload',
      debounceMs: 1300,
    });
  });

  it('hits TTL cache and skips refresh within window', async () => {
    let now = Date.parse('2026-03-15T00:00:00.000Z');
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    const { GatewayManager } = await import('@electron/gateway/manager');
    mockLoadGatewayReloadPolicy.mockResolvedValueOnce({ mode: 'restart', debounceMs: 2200 });

    const manager = new GatewayManager();
    const refresh = (manager as unknown as { refreshReloadPolicy: (force?: boolean) => Promise<void> })
      .refreshReloadPolicy.bind(manager);

    await refresh();
    expect(mockLoadGatewayReloadPolicy).toHaveBeenCalledTimes(1);

    now += 10_000;
    await refresh();

    expect(mockLoadGatewayReloadPolicy).toHaveBeenCalledTimes(1);
  });

  it('refreshes immediately when force=true even within TTL', async () => {
    let now = Date.parse('2026-03-15T00:00:00.000Z');
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    const { GatewayManager } = await import('@electron/gateway/manager');
    mockLoadGatewayReloadPolicy
      .mockResolvedValueOnce({ mode: 'hybrid', debounceMs: 1200 })
      .mockResolvedValueOnce({ mode: 'off', debounceMs: 9000 });

    const manager = new GatewayManager();
    const refresh = (manager as unknown as { refreshReloadPolicy: (force?: boolean) => Promise<void> })
      .refreshReloadPolicy.bind(manager);

    await refresh();
    expect(mockLoadGatewayReloadPolicy).toHaveBeenCalledTimes(1);

    now += 5000;
    await refresh(true);

    expect(mockLoadGatewayReloadPolicy).toHaveBeenCalledTimes(2);
    expect((manager as unknown as { reloadPolicy: { mode: string; debounceMs: number } }).reloadPolicy).toEqual({
      mode: 'off',
      debounceMs: 9000,
    });
  });
});
