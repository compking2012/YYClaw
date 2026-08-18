import { describe, expect, it, beforeEach } from 'vitest';
import {
  getOfficeDisplayCache,
  markOfficeDisplayCacheSyncHydrated,
  resetOfficeDisplayCacheForTest,
  setOfficeDisplayCacheProjectCardPhase,
  setOfficeDisplayCacheRoomPhase,
} from '@/lib/office-display-cache';
import {
  reconcileOfficeDisplayCacheForProject,
  reconcileOfficeDisplayCacheFromProjects,
} from '@/lib/office-display-cache-sync';
import {
  getProjectPrefetchState,
  resetOfficeProjectPrefetchForTest,
} from '@/lib/office-project-prefetch';
import type { OfficeTempProject } from '@/types/office';

function project(
  id: string,
  overrides: Partial<OfficeTempProject> = {},
): OfficeTempProject {
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
    updatedAt: 1,
    ...overrides,
  } as OfficeTempProject;
}

describe('office-display-cache-sync', () => {
  beforeEach(() => {
    resetOfficeDisplayCacheForTest();
    resetOfficeProjectPrefetchForTest();
  });

  it('prunes deleted projects from card and room cache', () => {
    setOfficeDisplayCacheProjectCardPhase('gone', 'ready');
    setOfficeDisplayCacheRoomPhase('gone', 'ready');
    reconcileOfficeDisplayCacheFromProjects(
      [project('gone'), project('stay')],
      [project('stay')],
    );
    expect(getOfficeDisplayCache().sync.projectCards.gone).toBeUndefined();
    expect(getOfficeDisplayCache().async.rooms.gone).toBeUndefined();
  });

  it('marks new project slices idle', () => {
    reconcileOfficeDisplayCacheFromProjects([], [project('new')]);
    expect(getProjectPrefetchState('new')).toEqual({ card: 'idle', room: 'idle' });
  });

  it('archived project keeps card ready and invalidates room', () => {
    setOfficeDisplayCacheProjectCardPhase('p1', 'ready');
    setOfficeDisplayCacheRoomPhase('p1', 'ready');
    const prev = project('p1', { status: 'completed', lifecycle: 'active' });
    const next = project('p1', { status: 'completed', lifecycle: 'completed' });
    reconcileOfficeDisplayCacheForProject(prev, next);
    expect(getProjectPrefetchState('p1').card).toBe('ready');
    expect(getProjectPrefetchState('p1').room).toBe('idle');
  });

  it('restart from archived invalidates card and room', () => {
    setOfficeDisplayCacheProjectCardPhase('p1', 'ready');
    setOfficeDisplayCacheRoomPhase('p1', 'ready');
    const prev = project('p1', { lifecycle: 'completed', status: 'completed' });
    const next = project('p1', { lifecycle: 'active', status: 'pending', archivedRestartedAt: 2 });
    reconcileOfficeDisplayCacheForProject(prev, next);
    expect(getProjectPrefetchState('p1').card).toBe('idle');
    expect(getProjectPrefetchState('p1').room).toBe('idle');
  });

  it('project starts executing: card and room invalidated', () => {
    setOfficeDisplayCacheProjectCardPhase('p1', 'ready');
    setOfficeDisplayCacheRoomPhase('p1', 'ready');
    const prev = project('p1', { status: 'pending' });
    const next = project('p1', { status: 'running', nodeRuns: [{ nodeId: 'n1', startedAt: 10 }] });
    reconcileOfficeDisplayCacheForProject(prev, next);
    expect(getProjectPrefetchState('p1').card).toBe('idle');
    expect(getProjectPrefetchState('p1').room).toBe('idle');
  });

  it('project stops executing: card ready, room invalidated', () => {
    setOfficeDisplayCacheProjectCardPhase('p1', 'ready');
    setOfficeDisplayCacheRoomPhase('p1', 'ready');
    const prev = project('p1', { status: 'running', nodeRuns: [{ nodeId: 'n1', startedAt: 10 }] });
    const next = project('p1', { status: 'completed', nodeRuns: [{ nodeId: 'n1', startedAt: 10, endedAt: 20 }] });
    reconcileOfficeDisplayCacheForProject(prev, next);
    expect(getProjectPrefetchState('p1').card).toBe('ready');
    expect(getProjectPrefetchState('p1').room).toBe('idle');
  });

  it('idle metadata change keeps card ready', () => {
    setOfficeDisplayCacheProjectCardPhase('p1', 'idle');
    const prev = project('p1', { title: 'old', updatedAt: 1 });
    const next = project('p1', { title: 'new', updatedAt: 2 });
    reconcileOfficeDisplayCacheFromProjects([prev], [next]);
    expect(getProjectPrefetchState('p1').card).toBe('ready');
  });

  it('updates preferred project when sync is ready and preferred target changes', () => {
    markOfficeDisplayCacheSyncHydrated('p1', 'complete');
    reconcileOfficeDisplayCacheFromProjects(
      [project('p1'), project('p2', { sequence: 2, status: 'running', nodeRuns: [{ nodeId: 'n', agentId: 'a1', status: 'running', startedAt: 1 }] })],
      [project('p1'), project('p2', { sequence: 2, status: 'running', nodeRuns: [{ nodeId: 'n', agentId: 'a1', status: 'running', startedAt: 1 }] })],
    );
    expect(getOfficeDisplayCache().sync.preferredProjectId).toBe('p2');
  });
});
