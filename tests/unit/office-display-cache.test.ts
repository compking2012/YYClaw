import { describe, expect, it, beforeEach } from 'vitest';
import {
  bumpOfficeDisplayCacheGeneration,
  getOfficeDisplayCache,
  getOfficeDisplayCacheDataRevision,
  isOfficeDisplayCacheSyncReady,
  markOfficeDisplayCacheSyncHydrated,
  patchOfficeDisplayCacheData,
  removeOfficeDisplayCacheProject,
  resetOfficeDisplayCacheForTest,
  setOfficeDisplayCacheProjectCardPhase,
  setOfficeDisplayCacheRoomPhase,
} from '@/lib/office-display-cache';
import type { OfficeTempProject } from '@/types/office';

describe('office-display-cache', () => {
  beforeEach(() => {
    resetOfficeDisplayCacheForTest();
  });

  it('starts empty and not sync ready', () => {
    expect(isOfficeDisplayCacheSyncReady()).toBe(false);
    expect(getOfficeDisplayCache().generation).toBe(0);
  });

  it('marks sync hydrated with preferred project', () => {
    markOfficeDisplayCacheSyncHydrated('p1', 'complete');
    expect(isOfficeDisplayCacheSyncReady()).toBe(true);
    expect(getOfficeDisplayCache().sync.preferredProjectId).toBe('p1');
  });

  it('bump generation resets sync and async zones', () => {
    setOfficeDisplayCacheProjectCardPhase('p1', 'ready');
    setOfficeDisplayCacheRoomPhase('p1', 'ready');
    markOfficeDisplayCacheSyncHydrated('p1', 'complete');
    const gen = bumpOfficeDisplayCacheGeneration();
    expect(gen).toBe(1);
    expect(isOfficeDisplayCacheSyncReady()).toBe(false);
    expect(getOfficeDisplayCache().sync.projectCards).toEqual({});
    expect(getOfficeDisplayCache().async.rooms).toEqual({});
  });

  it('removeOfficeDisplayCacheProject bumps dataRevision for UI subscribers', () => {
    const project = { id: 'p1', title: 'P1' } as OfficeTempProject;
    markOfficeDisplayCacheSyncHydrated(null, 'complete');
    patchOfficeDisplayCacheData({
      sync: {
        tempProjects: [project],
        projectCards: { p1: { phase: 'ready', project } },
      },
      async: { rooms: { p1: { phase: 'ready', messages: [] } } },
    });
    const revisionBefore = getOfficeDisplayCacheDataRevision();
    removeOfficeDisplayCacheProject('p1');
    expect(getOfficeDisplayCache().sync.tempProjects).toHaveLength(0);
    expect(getOfficeDisplayCacheDataRevision()).toBe(revisionBefore + 1);
  });
});
