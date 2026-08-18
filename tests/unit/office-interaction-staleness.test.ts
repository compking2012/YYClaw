/**
 * 温缓存命中：展示层纯判断 + 仅展开时提升 phase；后台预取仍走网络。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfficeTempProject } from '@/types/office';

const officeState = {
  tempProjects: [] as OfficeTempProject[],
  roomMessagesByProject: {} as Record<string, { id: string; content: string }[]>,
  fixedGroups: [] as unknown[],
  agentBindings: {} as Record<string, unknown>,
  poolAgentIds: [] as string[],
  fetchProjectProgress: vi.fn(async () => {}),
  fetchRoomMessages: vi.fn(async (projectId: string) => {
    officeState.roomMessagesByProject[projectId] = officeState.roomMessagesByProject[projectId] ?? [
      { id: 'fetched', content: 'network' },
    ];
  }),
  fetchAgentPool: vi.fn(async () => {
    officeState.poolAgentIds = ['a1', 'a2'];
  }),
};

const agentsState = {
  agents: [{ id: 'a1', name: 'Agent 1' }],
  loading: false,
  fetchAgents: vi.fn(async () => {}),
};

vi.mock('@/stores/office', () => ({
  useOfficeStore: { getState: () => officeState },
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: { getState: () => agentsState },
}));

import {
  getOfficeDisplayCache,
  markOfficeDisplayCacheSyncHydrated,
  patchOfficeDisplayCacheData,
  resetOfficeDisplayCacheForTest,
} from '@/lib/office-display-cache';
import { applyOfficeDisplayCacheFromStore } from '@/lib/office-display-cache-data';
import {
  ensureProjectCardOnExpand,
  invalidateProjectRoomPrefetch,
  isProjectLeftPanelReady,
  isProjectRoomPrefetchReady,
  isRoomPrefetchSatisfied,
  notifyProjectCardSynced,
  notifyProjectRoomFetched,
  prefetchEditContext,
  resetOfficeProjectPrefetchForTest,
  resolveOfficeDraftFormBootstrap,
  scheduleOfficeProjectPrefetch,
  scheduleProjectRoomOnExpand,
  shouldShowProjectRoomPrefetchLoading,
  waitForOfficePrefetchIdleForTest,
} from '@/lib/office-project-prefetch';

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
    roomSessionKey: 'room-session',
    ...overrides,
  } as OfficeTempProject;
}

describe('office interaction cache-first', () => {
  beforeEach(() => {
    resetOfficeDisplayCacheForTest();
    resetOfficeProjectPrefetchForTest();
    officeState.tempProjects = [];
    officeState.roomMessagesByProject = {};
    officeState.poolAgentIds = [];
    officeState.fetchRoomMessages.mockReset().mockImplementation(async (projectId: string) => {
      officeState.roomMessagesByProject[projectId] = officeState.roomMessagesByProject[projectId] ?? [
        { id: 'fetched', content: 'network' },
      ];
    });
    officeState.fetchAgentPool.mockReset().mockImplementation(async () => {
      officeState.poolAgentIds = ['a1', 'a2'];
    });
    agentsState.fetchAgents.mockClear();
    agentsState.agents = [{ id: 'a1', name: 'Agent 1' }];
    agentsState.loading = false;
  });

  it('mirror does not promote phase; expand uses warm cache without network', async () => {
    officeState.tempProjects = [project('p1', { executionMode: 'workflow' })];
    officeState.roomMessagesByProject.p1 = [{ id: 'cached', content: 'from-store' }];

    markOfficeDisplayCacheSyncHydrated(null, 'complete');
    notifyProjectCardSynced('p1');
    applyOfficeDisplayCacheFromStore({ flush: true });

    expect(getOfficeDisplayCache().async.rooms.p1?.phase).toBe('idle');
    expect(isRoomPrefetchSatisfied('p1')).toBe(true);
    expect(
      shouldShowProjectRoomPrefetchLoading('p1', false, { executionMode: 'workflow' }),
    ).toBe(false);

    ensureProjectCardOnExpand('p1', false);
    scheduleProjectRoomOnExpand('p1', false);
    await waitForOfficePrefetchIdleForTest();

    expect(getOfficeDisplayCache().async.rooms.p1?.phase).toBe('ready');
    expect(officeState.fetchRoomMessages).not.toHaveBeenCalled();
  });

  it('preferred warm cache satisfies display without async.rooms phase', () => {
    const pref = project('pref', { executionMode: 'workflow', sequence: 1 });
    officeState.roomMessagesByProject.pref = [{ id: 'm1', content: 'preferred-cache' }];
    patchOfficeDisplayCacheData({
      sync: {
        preferredProjectId: 'pref',
        preferred: {
          project: pref,
          roomMessages: [{ id: 'm1', content: 'preferred-cache' } as never],
        },
        projectCards: {
          pref: { phase: 'ready', project: pref },
        },
      },
    });
    notifyProjectCardSynced('pref');

    expect(isProjectRoomPrefetchReady('pref')).toBe(false);
    expect(isRoomPrefetchSatisfied('pref')).toBe(true);
    expect(isProjectLeftPanelReady('pref', { executionMode: 'workflow' })).toBe(true);
    expect(
      shouldShowProjectRoomPrefetchLoading('pref', false, { executionMode: 'workflow' }),
    ).toBe(false);
  });

  it('background prefetch queue still refreshes room over network', async () => {
    officeState.tempProjects = [project('p1')];
    officeState.roomMessagesByProject.p1 = [{ id: 'warm', content: 'already-here' }];

    scheduleOfficeProjectPrefetch(officeState.tempProjects, null);
    await waitForOfficePrefetchIdleForTest();

    expect(officeState.fetchRoomMessages).toHaveBeenCalled();
    expect(isProjectRoomPrefetchReady('p1')).toBe(true);
  });

  it('does not satisfy room after invalidateProjectRoomPrefetch', async () => {
    officeState.tempProjects = [project('p1')];
    officeState.roomMessagesByProject.p1 = [{ id: 'stale', content: 'old' }];
    notifyProjectCardSynced('p1');
    notifyProjectRoomFetched('p1');

    invalidateProjectRoomPrefetch('p1');
    expect(isRoomPrefetchSatisfied('p1')).toBe(false);
    expect(isProjectRoomPrefetchReady('p1')).toBe(false);

    scheduleOfficeProjectPrefetch(officeState.tempProjects, null);
    await waitForOfficePrefetchIdleForTest();

    expect(officeState.fetchRoomMessages).toHaveBeenCalled();
  });

  it('resolveOfficeDraftFormBootstrap skips warm editContext and agents', async () => {
    await prefetchEditContext();
    expect(resolveOfficeDraftFormBootstrap()).toEqual({
      fetchAgentPool: false,
      fetchAgents: false,
    });
  });

  it('resolveOfficeDraftFormBootstrap still fetches when editContext not ready', () => {
    expect(resolveOfficeDraftFormBootstrap()).toEqual({
      fetchAgentPool: true,
      fetchAgents: false,
    });
  });
});
