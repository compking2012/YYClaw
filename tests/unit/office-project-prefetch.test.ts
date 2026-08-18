import { describe, expect, it, beforeEach } from 'vitest';
import {
  resetOfficeDisplayCacheForTest,
} from '@/lib/office-display-cache';
import {
  buildOfficePrefetchProjectOrder,
  getProjectPrefetchState,
  invalidateProjectCardPrefetch,
  invalidateProjectRoomPrefetch,
  isProjectCardPrefetchReady,
  isProjectFullyPrefetched,
  isProjectLeftPanelReady,
  notifyProjectCardSynced,
  notifyProjectRoomFetched,
  preferredPrefetchTargetId,
  projectExecutionStartMs,
  refreshPrefetchOnOfficeEnter,
  resetOfficeProjectPrefetchForTest,
  shouldShowProjectCardPrefetchLoading,
  shouldShowProjectRoomPrefetchLoading,
  syncIdleProjectCardPrefetch,
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
    sequence: Number(id.replace(/\D/g, '')) || 1,
    ...overrides,
  } as OfficeTempProject;
}

describe('office-project-prefetch (pure)', () => {
  beforeEach(() => {
    resetOfficeDisplayCacheForTest();
    resetOfficeProjectPrefetchForTest();
  });

  it('orders prefetch: preferred, then running by start time, then idle by sequence', () => {
    const projects = [
      project('p3', { sequence: 3 }),
      project('p1', {
        sequence: 1,
        status: 'running',
        nodeRuns: [{ nodeId: 'n', agentId: 'a1', status: 'running', startedAt: 200 }],
      }),
      project('p2', {
        sequence: 2,
        status: 'running',
        nodeRuns: [{ nodeId: 'n', agentId: 'a1', status: 'running', startedAt: 100 }],
      }),
    ];
    expect(buildOfficePrefetchProjectOrder(projects, 'p3')).toEqual(['p3', 'p2', 'p1']);
  });

  it('preferred is first even when also running', () => {
    const projects = [
      project('run', {
        sequence: 2,
        status: 'running',
        nodeRuns: [{ nodeId: 'n', agentId: 'a1', status: 'running', startedAt: 50 }],
      }),
    ];
    expect(buildOfficePrefetchProjectOrder(projects, 'run')).toEqual(['run']);
    expect(preferredPrefetchTargetId(projects)).toBe('run');
  });

  it('projectExecutionStartMs uses earliest node run startedAt', () => {
    const started = projectExecutionStartMs({
      status: 'running',
      nodeRuns: [
        { nodeId: 'a', agentId: 'a1', status: 'running', startedAt: 500 },
        { nodeId: 'b', agentId: 'a1', status: 'completed', startedAt: 100 },
      ],
      updatedAt: 999,
    });
    expect(started).toBe(100);
  });

  it('orders archived projects after non-archived', () => {
    const projects = [
      project('active', { sequence: 1 }),
      project('archived', { sequence: 2, lifecycle: 'completed' }),
    ];
    expect(buildOfficePrefetchProjectOrder(projects, null)).toEqual(['active', 'archived']);
  });

  it('orders non-archived: preferred, running, idle, then archived', () => {
    const projects = [
      project('idle-b', { sequence: 3 }),
      project('archived', { sequence: 99, lifecycle: 'completed' }),
      project('run', {
        sequence: 2,
        status: 'running',
        nodeRuns: [{ nodeId: 'n', agentId: 'a1', status: 'running', startedAt: 50 }],
      }),
      project('preferred', { sequence: 1 }),
    ];
    expect(buildOfficePrefetchProjectOrder(projects, 'preferred')).toEqual([
      'preferred',
      'run',
      'idle-b',
      'archived',
    ]);
  });

  it('refreshPrefetchOnOfficeEnter does not invalidate running card when already ready', () => {
    notifyProjectCardSynced('running');
    notifyProjectCardSynced('idle');
    refreshPrefetchOnOfficeEnter([
      project('idle', { sequence: 1 }),
      project('running', {
        sequence: 2,
        status: 'running',
        nodeRuns: [{ nodeId: 'n', agentId: 'a1', status: 'running', startedAt: 1 }],
      }),
    ]);
    expect(isProjectCardPrefetchReady('running')).toBe(true);
    expect(isProjectCardPrefetchReady('idle')).toBe(true);
  });

  it('returns stable object reference when phases are unchanged', () => {
    notifyProjectCardSynced('p1');
    const a = getProjectPrefetchState('p1');
    const b = getProjectPrefetchState('p1');
    expect(a).toBe(b);
    invalidateProjectCardPrefetch('p1');
    const c = getProjectPrefetchState('p1');
    expect(c).not.toBe(a);
  });

  it('isProjectFullyPrefetched requires both slices', () => {
    notifyProjectCardSynced('p1');
    expect(isProjectFullyPrefetched('p1')).toBe(false);
    notifyProjectRoomFetched('p1');
    expect(isProjectFullyPrefetched('p1')).toBe(true);
  });

  it('isProjectLeftPanelReady: workflow only needs card', () => {
    notifyProjectCardSynced('wf');
    expect(isProjectLeftPanelReady('wf', { executionMode: 'workflow' })).toBe(true);
  });

  it('isProjectLeftPanelReady: smart needs card only (room loads async)', () => {
    notifyProjectCardSynced('sm');
    expect(isProjectLeftPanelReady('sm', { executionMode: 'smart' })).toBe(true);
  });

  it('isProjectLeftPanelReady: unknown mode requires room when card ready', () => {
    notifyProjectCardSynced('unknown');
    expect(isProjectLeftPanelReady('unknown')).toBe(false);
    notifyProjectRoomFetched('unknown');
    expect(isProjectLeftPanelReady('unknown')).toBe(true);
  });

  it('invalidateProjectRoomPrefetch resets ready room to idle', () => {
    notifyProjectCardSynced('p1');
    notifyProjectRoomFetched('p1');
    invalidateProjectRoomPrefetch('p1');
    expect(shouldShowProjectRoomPrefetchLoading('p1', false)).toBe(true);
  });

  it('shouldShowProjectRoomPrefetchLoading covers archived projects', () => {
    expect(shouldShowProjectRoomPrefetchLoading('p1', true)).toBe(true);
    notifyProjectRoomFetched('p1');
    expect(shouldShowProjectRoomPrefetchLoading('p1', true)).toBe(false);
  });

  it('shouldShowProjectCardPrefetchLoading only when expanded active project', () => {
    notifyProjectCardSynced('p1');
    expect(shouldShowProjectCardPrefetchLoading('p1', true, false)).toBe(false);
    resetOfficeDisplayCacheForTest();
    resetOfficeProjectPrefetchForTest();
    expect(shouldShowProjectCardPrefetchLoading('p1', true, false, project('p1'))).toBe(false);
    expect(shouldShowProjectCardPrefetchLoading('missing', true, false)).toBe(true);
  });

  it('shouldShowProjectCardPrefetchLoading depends on card slice only', () => {
    notifyProjectCardSynced('sm');
    expect(
      shouldShowProjectCardPrefetchLoading('sm', true, false, { executionMode: 'smart' }),
    ).toBe(false);
    resetOfficeDisplayCacheForTest();
    resetOfficeProjectPrefetchForTest();
    expect(
      shouldShowProjectCardPrefetchLoading('sm', true, false, project('sm', { executionMode: 'smart' })),
    ).toBe(false);
    expect(
      shouldShowProjectCardPrefetchLoading('sm', true, false, { executionMode: 'smart' }),
    ).toBe(true);
  });

  it('syncIdleProjectCardPrefetch marks only non-running active projects', () => {
    syncIdleProjectCardPrefetch([
      project('idle', { sequence: 1 }),
      project('running', {
        sequence: 2,
        status: 'running',
        nodeRuns: [{ nodeId: 'n', agentId: 'a1', status: 'running', startedAt: 1 }],
      }),
      project('archived', { sequence: 3, lifecycle: 'completed' }),
    ]);
    expect(isProjectCardPrefetchReady('idle')).toBe(true);
    expect(isProjectCardPrefetchReady('running')).toBe(false);
    expect(isProjectCardPrefetchReady('archived')).toBe(false);
  });
});
