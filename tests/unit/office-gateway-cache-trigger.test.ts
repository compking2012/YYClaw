import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { GatewayStatus } from '@/types/gateway';
import * as officeFeature from '@shared/office-collaboration-feature';
import {
  handleGatewayStatusTransitionForOfficeCache,
  isGatewayReadyForOffice,
} from '@/lib/office-gateway-cache-trigger';

const prefetchMock = vi.fn();

vi.mock('@/lib/office-cache-prefetch', () => ({
  handleGatewayOfficeCachePrefetch: (...args: unknown[]) => prefetchMock(...args),
}));

function status(
  partial: Partial<GatewayStatus> & Pick<GatewayStatus, 'state'>,
): GatewayStatus {
  return { port: 18789, ...partial };
}

describe('office-gateway-cache-trigger', () => {
  beforeEach(() => {
    prefetchMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('isGatewayReadyForOffice requires running and gatewayReady', () => {
    expect(isGatewayReadyForOffice(status({ state: 'running' }))).toBe(true);
    expect(isGatewayReadyForOffice(status({ state: 'running', gatewayReady: false }))).toBe(false);
    expect(isGatewayReadyForOffice(status({ state: 'starting' }))).toBe(false);
  });

  it('prefetches on non-ready → ready transition', () => {
    handleGatewayStatusTransitionForOfficeCache(
      status({ state: 'starting' }),
      status({ state: 'running' }),
    );
    expect(prefetchMock).toHaveBeenCalledWith(true);
  });

  it('does not prefetch when already ready', () => {
    const running = status({ state: 'running' });
    handleGatewayStatusTransitionForOfficeCache(running, running);
    expect(prefetchMock).not.toHaveBeenCalled();
  });

  it('does not prefetch on ready → stopped', () => {
    handleGatewayStatusTransitionForOfficeCache(
      status({ state: 'running' }),
      status({ state: 'stopped' }),
    );
    expect(prefetchMock).not.toHaveBeenCalled();
  });

  it('prefetches when gatewayReady flips false → true while running', () => {
    handleGatewayStatusTransitionForOfficeCache(
      status({ state: 'running', gatewayReady: false }),
      status({ state: 'running', gatewayReady: true }),
    );
    expect(prefetchMock).toHaveBeenCalledWith(true);
  });

  it('does not prefetch when office collaboration is disabled', () => {
    vi.spyOn(officeFeature, 'isOfficeCollaborationEnabled').mockReturnValue(false);
    handleGatewayStatusTransitionForOfficeCache(
      status({ state: 'starting' }),
      status({ state: 'running' }),
    );
    expect(prefetchMock).not.toHaveBeenCalled();
  });
});
