import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import * as officeFeature from '@shared/office-collaboration-feature';
import {
  getOfficeDisplayCache,
  getOfficeDisplayCacheGeneration,
  isOfficeDisplayCacheSyncReady,
  resetOfficeDisplayCacheForTest,
  shouldBlockOfficePageForSyncLoading,
} from '@/lib/office-display-cache';
import {
  handleGatewayOfficeCachePrefetch,
  handleOfficePageEnter,
  isOfficeCacheGatewayAutoComplete,
  resetOfficeCachePrefetchStateForTest,
  runOfficeCachePrefetch,
} from '@/lib/office-cache-prefetch';
import { flushOfficeDisplayCacheFromStoreForTest } from '@/lib/office-display-cache-data';

const officeState = {
  tempProjects: [] as { id: string; lifecycle?: string; status: string; nodeRuns: unknown[]; sequence: number; title: string; origin: string; agentIds: string[]; coordinatorAgentId: string; featureDescription: string; description: string }[],
  roomMessagesByProject: {} as Record<string, unknown[]>,
  fixedGroups: [] as unknown[],
  agentBindings: {} as Record<string, unknown>,
  poolAgentIds: [] as string[],
  fetchSnapshot: vi.fn(async () => {}),
  fetchProjectProgress: vi.fn(async () => {}),
  fetchRoomMessages: vi.fn(async () => {}),
  fetchAgentPool: vi.fn(async () => {
    officeState.poolAgentIds = ['a1'];
  }),
};

const { fetchAgentsMock } = vi.hoisted(() => ({
  fetchAgentsMock: vi.fn(async () => {}),
}));

vi.mock('@/stores/office', () => ({
  useOfficeStore: { getState: () => officeState },
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: {
    getState: () => ({
      agents: [{ id: 'a1', name: 'A' }],
      fetchAgents: fetchAgentsMock,
    }),
  },
}));

vi.mock('@/stores/gateway', () => ({
  useGatewayStore: {
    getState: () => ({ status: { state: 'starting', gatewayReady: false } }),
  },
}));

describe('office-cache-prefetch', () => {
  beforeEach(() => {
    resetOfficeDisplayCacheForTest();
    resetOfficeCachePrefetchStateForTest();
    fetchAgentsMock.mockClear();
    officeState.fetchSnapshot.mockImplementation(async () => {
      officeState.tempProjects = [
        {
          id: 'p1',
          title: 'p1',
          origin: 'standalone',
          agentIds: ['a1'],
          coordinatorAgentId: 'a1',
          lifecycle: 'active',
          featureDescription: '',
          description: '',
          status: 'pending',
          nodeRuns: [],
          sequence: 1,
        },
      ];
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips prefetch when office collaboration is disabled', async () => {
    vi.spyOn(officeFeature, 'isOfficeCollaborationEnabled').mockReturnValue(false);
    await runOfficeCachePrefetch({ kind: 'manual-full' });
    expect(officeState.fetchSnapshot).not.toHaveBeenCalled();
    handleGatewayOfficeCachePrefetch(true);
    expect(officeState.fetchSnapshot).not.toHaveBeenCalled();
  });

  it('enter-persisted hydrates sync without complete level', async () => {
    await runOfficeCachePrefetch({ kind: 'enter-persisted' });
    expect(isOfficeDisplayCacheSyncReady()).toBe(true);
    expect(getOfficeDisplayCache().sync.hydrationLevel).toBe('persisted');
    expect(isOfficeCacheGatewayAutoComplete()).toBe(false);
  });

  it('handleOfficePageEnter triggers enter-persisted when gateway not ready', async () => {
    handleOfficePageEnter();
    await new Promise((r) => setTimeout(r, 20));
    expect(getOfficeDisplayCache().sync.hydrationLevel).toBe('persisted');
  });

  it('gateway restart after complete triggers full prefetch again', async () => {
    await runOfficeCachePrefetch({ kind: 'enter-persisted' });
    await runOfficeCachePrefetch({ kind: 'gateway-supplement', gatewayInitialPass: true });
    expect(isOfficeCacheGatewayAutoComplete()).toBe(true);

    handleGatewayOfficeCachePrefetch(true);
    await new Promise((r) => setTimeout(r, 30));
    expect(getOfficeDisplayCache().sync.hydrationLevel).toBe('complete');
  });

  it('manual-full awaits in-flight prefetch and ignores stale generation writes', async () => {
    let resolveSnapshot: (() => void) | undefined;
    const snapshotGate = new Promise<void>((resolve) => {
      resolveSnapshot = resolve;
    });
    officeState.fetchSnapshot.mockImplementation(async () => {
      await snapshotGate;
      officeState.tempProjects = [
        {
          id: 'stale',
          title: 'stale',
          origin: 'standalone',
          agentIds: ['a1'],
          coordinatorAgentId: 'a1',
          lifecycle: 'active',
          featureDescription: '',
          description: '',
          status: 'pending',
          nodeRuns: [],
          sequence: 1,
        },
      ];
    });

    const staleFlight = runOfficeCachePrefetch({ kind: 'gateway-full', gatewayInitialPass: false });
    await new Promise((r) => setTimeout(r, 5));

    officeState.fetchSnapshot.mockImplementation(async () => {
      officeState.tempProjects = [
        {
          id: 'fresh',
          title: 'fresh',
          origin: 'standalone',
          agentIds: ['a1'],
          coordinatorAgentId: 'a1',
          lifecycle: 'active',
          featureDescription: '',
          description: '',
          status: 'pending',
          nodeRuns: [],
          sequence: 1,
        },
      ];
    });
    const manualFlight = runOfficeCachePrefetch({ kind: 'manual-full' });
    resolveSnapshot?.();
    await Promise.all([staleFlight, manualFlight]);
    flushOfficeDisplayCacheFromStoreForTest();

    expect(getOfficeDisplayCache().sync.tempProjects[0]?.id).toBe('fresh');
    expect(isOfficeCacheGatewayAutoComplete()).toBe(true);
  });

  it('manual-full fetches agents read-only without reconcile', async () => {
    await runOfficeCachePrefetch({ kind: 'manual-full' });
    expect(fetchAgentsMock).toHaveBeenCalledWith({ silent: false, reconcile: false });
  });

  it('recovers sync phase when prefetch fails', async () => {
    officeState.fetchSnapshot.mockRejectedValueOnce(new Error('network'));
    await runOfficeCachePrefetch({ kind: 'enter-persisted' });
    expect(getOfficeDisplayCache().sync.phase).toBe('idle');
    expect(shouldBlockOfficePageForSyncLoading()).toBe(false);
  });

  it('recovers supplement failure back to persisted ready', async () => {
    await runOfficeCachePrefetch({ kind: 'enter-persisted' });
    const genBefore = getOfficeDisplayCacheGeneration();
    officeState.fetchSnapshot.mockRejectedValueOnce(new Error('network'));
    await runOfficeCachePrefetch({ kind: 'gateway-supplement', gatewayInitialPass: false });
    expect(getOfficeDisplayCacheGeneration()).toBe(genBefore);
    expect(getOfficeDisplayCache().sync.phase).toBe('ready');
    expect(getOfficeDisplayCache().sync.hydrationLevel).toBe('persisted');
  });
});
