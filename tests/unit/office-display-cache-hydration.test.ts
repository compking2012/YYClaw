import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isOfficeCollaborationPrefetchEnabled,
  isOfficeDisplayCacheHydrationInFlight,
  isOfficeDisplayCachePrefetchActive,
  resetOfficeDisplayCacheHydrationForTest,
  runOfficeDisplayCacheHydration,
} from '@/lib/office-display-cache-hydration';
import {
  markOfficeDisplayCacheSyncHydrated,
  resetOfficeDisplayCacheForTest,
  setOfficeDisplayCacheRoomPhase,
  setOfficeDisplayCacheSyncPhase,
} from '@/lib/office-display-cache';
import {
  isOfficePrefetchWorkloadActive,
  notifyProjectCardSynced,
  notifyProjectRoomFetched,
  resetOfficeProjectPrefetchForTest,
} from '@/lib/office-project-prefetch';
import type { OfficeTempProject } from '@/types/office';

function project(id: string): OfficeTempProject {
  return {
    id,
    title: id,
    origin: 'standalone',
    agentIds: ['a1'],
    coordinatorAgentId: 'a1',
    lifecycle: 'active',
    featureDescription: '',
    description: '',
    status: 'pending',
    nodeRuns: [],
    sequence: 1,
  } as OfficeTempProject;
}

describe('office-display-cache-hydration prefetch active', () => {
  beforeEach(() => {
    resetOfficeDisplayCacheForTest();
    resetOfficeProjectPrefetchForTest();
    resetOfficeDisplayCacheHydrationForTest();
  });

  it('is active while sync is not ready', () => {
    expect(isOfficeDisplayCachePrefetchActive([project('p1')])).toBe(true);
  });

  it('is active while sync phase is loading', () => {
    setOfficeDisplayCacheSyncPhase('loading');
    expect(isOfficeDisplayCachePrefetchActive()).toBe(true);
  });

  it('is active when async room slice is loading', () => {
    markOfficeDisplayCacheSyncHydrated('p1', 'complete');
    setOfficeDisplayCacheRoomPhase('p1', 'loading');
    expect(isOfficeDisplayCachePrefetchActive()).toBe(true);
  });

  it('is inactive when sync ready and all slices ready', () => {
    markOfficeDisplayCacheSyncHydrated('p1', 'complete');
    notifyProjectCardSynced('p1');
    notifyProjectRoomFetched('p1');
    expect(isOfficePrefetchWorkloadActive()).toBe(false);
    expect(isOfficeDisplayCachePrefetchActive([project('p1')])).toBe(false);
  });

  it('runOfficeDisplayCacheHydration delegates to cache prefetch', async () => {
    const prefetchSpy = vi.spyOn(
      await import('@/lib/office-cache-prefetch'),
      'runOfficeCachePrefetch',
    );
    prefetchSpy.mockResolvedValue(undefined);

    await runOfficeDisplayCacheHydration();
    expect(prefetchSpy).toHaveBeenCalledWith({ kind: 'manual-full' });

    await runOfficeDisplayCacheHydration({ gatewayInitialPass: true });
    expect(prefetchSpy).toHaveBeenCalledWith({
      kind: 'gateway-full',
      gatewayInitialPass: true,
    });

    prefetchSpy.mockRestore();
  });

  it('isOfficeCollaborationPrefetchEnabled and hydration in-flight mirror prefetch', async () => {
    expect(typeof isOfficeCollaborationPrefetchEnabled()).toBe('boolean');
    expect(isOfficeDisplayCacheHydrationInFlight()).toBe(false);
  });
});
