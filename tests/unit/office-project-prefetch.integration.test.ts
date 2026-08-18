import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfficeTempProject } from '@/types/office';

const officeState = {
  tempProjects: [] as OfficeTempProject[],
  roomMessagesByProject: {} as Record<string, unknown[]>,
  fetchProjectProgress: vi.fn(async () => {}),
  fetchRoomMessages: vi.fn(async () => {}),
};

const agentsState = {
  agents: [{ id: 'a1', name: 'Agent 1' }],
  loading: false,
  fetchAgents: vi.fn(async () => {}),
};

vi.mock('@/stores/office', () => ({
  useOfficeStore: {
    getState: () => officeState,
  },
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: {
    getState: () => agentsState,
  },
}));

import {
  resetOfficeDisplayCacheForTest,
  bumpOfficeDisplayCacheGeneration,
  isOfficeDisplayCacheGatewayInitialPrefetchUiActive,
} from '@/lib/office-display-cache';
import {
  applyOfficePrefetchAfterSnapshot,
  beginGatewayInitialPrefetchPass,
  buildOfficeAsyncPrefetchProjectOrder,
  ensureProjectCardOnExpand,
  ensureProjectExpandDataImmediate,
  getProjectPrefetchState,
  invalidateProjectCardPrefetch,
  invalidateProjectRoomPrefetch,
  isProjectCardPrefetchReady,
  isProjectFullyPrefetched,
  isProjectLeftPanelReady,
  isProjectRoomPrefetchReady,
  notifyProjectCardSynced,
  notifyProjectRoomFetched,
  resetOfficeProjectPrefetchForTest,
  scheduleOfficeProjectPrefetch,
  prepareProjectExpandPrefetch,
  scheduleProjectRoomOnExpand,
  shouldShowProjectCardPrefetchLoading,
  shouldShowProjectRoomPrefetchLoading,
  syncIdleProjectCardPrefetch,
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
    sequence: Number(id.replace(/\D/g, '')) || 1,
    ...overrides,
  } as OfficeTempProject;
}

describe('office-project-prefetch integration', () => {
  beforeEach(() => {
    resetOfficeDisplayCacheForTest();
    resetOfficeProjectPrefetchForTest();
    officeState.tempProjects = [];
    officeState.roomMessagesByProject = {};
    officeState.fetchProjectProgress.mockReset().mockResolvedValue(undefined);
    officeState.fetchRoomMessages.mockReset().mockImplementation(async (projectId: string) => {
      officeState.roomMessagesByProject[projectId] = [{ id: 'm1', content: 'hi' }];
    });
    agentsState.agents = [{ id: 'a1', name: 'Agent 1' }];
    agentsState.loading = false;
    agentsState.fetchAgents.mockImplementation(async () => {
      agentsState.loading = false;
      agentsState.agents = [{ id: 'a1', name: 'Agent 1' }];
    });
  });

  it('prefetches card then room per project in queue order', async () => {
    officeState.tempProjects = [project('p1', { sequence: 1 })];
    scheduleOfficeProjectPrefetch(officeState.tempProjects, null);
    await waitForOfficePrefetchIdleForTest();

    expect(officeState.fetchRoomMessages).toHaveBeenCalledWith('p1', { roomFetchGeneration: 0 });
    expect(isProjectFullyPrefetched('p1')).toBe(true);
    const order = buildOfficeAsyncPrefetchProjectOrder(officeState.tempProjects, null);
    expect(order).toEqual(['p1']);
  });

  it('running project fetches progress before marking card ready', async () => {
    officeState.tempProjects = [
      project('run', {
        status: 'running',
        nodeRuns: [{ nodeId: 'n', agentId: 'a1', status: 'running', startedAt: 1 }],
      }),
    ];
    scheduleOfficeProjectPrefetch(officeState.tempProjects, null);
    await waitForOfficePrefetchIdleForTest();

    expect(officeState.fetchProjectProgress).toHaveBeenCalledWith('run', {
      notifyReview: false,
      silent: true,
    });
    expect(isProjectCardPrefetchReady('run')).toBe(true);
    expect(officeState.fetchRoomMessages).toHaveBeenCalledWith('run', {
      urgent: true,
      roomFetchGeneration: 0,
    });
  });

  it('ensureProjectExpandDataImmediate dedupes with in-flight queue work', async () => {
    officeState.tempProjects = [project('p1', { executionMode: 'smart' })];
    let resolveRoom: (() => void) | undefined;
    officeState.fetchRoomMessages.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRoom = resolve;
        }),
    );

    scheduleOfficeProjectPrefetch(officeState.tempProjects, null);
    ensureProjectExpandDataImmediate('p1', false);

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(getProjectPrefetchState('p1').card).toBe('ready');
    expect(getProjectPrefetchState('p1').room).toBe('loading');

    resolveRoom?.();
    await waitForOfficePrefetchIdleForTest();
    expect(isProjectRoomPrefetchReady('p1')).toBe(true);
    expect(officeState.fetchRoomMessages).toHaveBeenCalledTimes(1);
  });

  it('ensureProjectCardOnExpand does not await room; scheduleProjectRoomOnExpand loads async', async () => {
    officeState.tempProjects = [project('wf', { executionMode: 'workflow' })];
    let resolveRoom: (() => void) | undefined;
    officeState.fetchRoomMessages.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRoom = resolve;
        }),
    );

    await ensureProjectCardOnExpand('wf', false);
    expect(isProjectCardPrefetchReady('wf')).toBe(true);
    expect(officeState.fetchRoomMessages).not.toHaveBeenCalled();

    scheduleProjectRoomOnExpand('wf', false);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(getProjectPrefetchState('wf').room).toBe('loading');

    resolveRoom?.();
    await waitForOfficePrefetchIdleForTest();
    expect(isProjectRoomPrefetchReady('wf')).toBe(true);
  });

  it('workflow expand does not block left panel on room prefetch', async () => {
    officeState.tempProjects = [project('wf', { executionMode: 'workflow' })];
    let resolveRoom: (() => void) | undefined;
    officeState.fetchRoomMessages.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRoom = resolve;
        }),
    );

    await ensureProjectCardOnExpand('wf', false);
    scheduleProjectRoomOnExpand('wf', false);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });

    expect(isProjectCardPrefetchReady('wf')).toBe(true);
    expect(isProjectLeftPanelReady('wf', { executionMode: 'workflow' })).toBe(true);
    expect(getProjectPrefetchState('wf').room).toBe('loading');

    resolveRoom?.();
    await waitForOfficePrefetchIdleForTest();
    expect(isProjectRoomPrefetchReady('wf')).toBe(true);
  });

  it('invalidateProjectCardPrefetch drops stale card fetch generation', async () => {
    officeState.tempProjects = [
      project('run', {
        status: 'running',
        nodeRuns: [{ nodeId: 'n', agentId: 'a1', status: 'running', startedAt: 1 }],
      }),
    ];
    let resolveProgress: (() => void) | undefined;
    officeState.fetchProjectProgress.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveProgress = resolve;
        }),
    );

    scheduleOfficeProjectPrefetch(officeState.tempProjects, null);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
    invalidateProjectCardPrefetch('run');
    resolveProgress?.();
    await waitForOfficePrefetchIdleForTest();

    expect(getProjectPrefetchState('run').card).toBe('idle');
  });

  it('bumpOfficeDisplayCacheGeneration drops in-flight prefetch completion', async () => {
    officeState.tempProjects = [project('p1')];
    let resolveRoom: (() => void) | undefined;
    officeState.fetchRoomMessages.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRoom = resolve;
        }),
    );

    scheduleOfficeProjectPrefetch(officeState.tempProjects, null);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
    bumpOfficeDisplayCacheGeneration();
    resolveRoom?.();
    await waitForOfficePrefetchIdleForTest();

    expect(getProjectPrefetchState('p1').room).not.toBe('ready');
  });

  it('invalidateProjectRoomPrefetch drops stale room fetch generation', async () => {
    officeState.tempProjects = [project('p1')];
    let resolveFirst: (() => void) | undefined;
    officeState.fetchRoomMessages
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockImplementationOnce(async (projectId: string) => {
        officeState.roomMessagesByProject[projectId] = [{ id: 'm2', content: 'fresh' }];
      });

    scheduleOfficeProjectPrefetch(officeState.tempProjects, null);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
    invalidateProjectRoomPrefetch('p1');
    resolveFirst?.();
    await waitForOfficePrefetchIdleForTest();

    expect(isProjectRoomPrefetchReady('p1')).toBe(true);
    expect(officeState.fetchRoomMessages).toHaveBeenCalledTimes(2);
  });

  it('applyOfficePrefetchAfterSnapshot waits for agents before syncing idle cards', async () => {
    agentsState.loading = true;
    agentsState.agents = [];
    officeState.tempProjects = [project('idle')];
    notifyProjectCardSynced('idle');

    const pending = applyOfficePrefetchAfterSnapshot(officeState.tempProjects);
    agentsState.loading = false;
    agentsState.agents = [{ id: 'a1', name: 'Agent 1' }];
    const preferred = await pending;

    expect(preferred).toBe('idle');
    expect(agentsState.fetchAgents).toHaveBeenCalled();
    expect(isProjectCardPrefetchReady('idle')).toBe(true);
  });

  it('syncIdle skips while agents still loading', () => {
    agentsState.loading = true;
    agentsState.fetchAgents.mockImplementation(() => new Promise(() => {}));
    officeState.tempProjects = [project('idle')];
    syncIdleProjectCardPrefetch(officeState.tempProjects);
    expect(isProjectCardPrefetchReady('idle')).toBe(false);
  });

  it('shouldShowProjectCardPrefetchLoading respects expanded/archived', () => {
    expect(shouldShowProjectCardPrefetchLoading('p1', false, false)).toBe(false);
    expect(shouldShowProjectCardPrefetchLoading('p1', true, true)).toBe(false);
    expect(shouldShowProjectCardPrefetchLoading('p1', true, false)).toBe(true);
    expect(shouldShowProjectCardPrefetchLoading('p1', true, false, project('p1'))).toBe(false);
    notifyProjectCardSynced('p1');
    expect(shouldShowProjectCardPrefetchLoading('p1', true, false)).toBe(false);
  });

  it('shouldShowProjectRoomPrefetchLoading waits for card on smart projects', () => {
    expect(shouldShowProjectRoomPrefetchLoading('p1', false, { executionMode: 'smart' })).toBe(false);
    notifyProjectCardSynced('p1');
    expect(shouldShowProjectRoomPrefetchLoading('p1', false, { executionMode: 'smart' })).toBe(true);
    notifyProjectRoomFetched('p1');
    expect(shouldShowProjectRoomPrefetchLoading('p1', false, { executionMode: 'smart' })).toBe(false);
  });

  it('shouldShowProjectRoomPrefetchLoading does not wait for card on workflow projects', () => {
    expect(shouldShowProjectRoomPrefetchLoading('wf', false, { executionMode: 'workflow' })).toBe(true);
    notifyProjectRoomFetched('wf');
    expect(shouldShowProjectRoomPrefetchLoading('wf', false, { executionMode: 'workflow' })).toBe(false);
  });

  it('scheduleProjectRoomOnExpand promotes warm cache for executing projects without blocking UI', async () => {
    officeState.tempProjects = [
      project('run', {
        status: 'running',
        nodeRuns: [{ nodeId: 'n', agentId: 'a1', status: 'running', startedAt: 1 }],
      }),
    ];
    officeState.roomMessagesByProject.run = [{ id: 'm1', content: 'cached' }];

    scheduleProjectRoomOnExpand('run', false);

    expect(isProjectRoomPrefetchReady('run')).toBe(true);
    expect(shouldShowProjectRoomPrefetchLoading('run', false, { executionMode: 'workflow' })).toBe(false);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10);
    });
    expect(officeState.fetchRoomMessages).toHaveBeenCalledWith('run', { urgent: true });
  });

  it('ensureProjectCardOnExpand uses store snapshot for executing projects without sync await', async () => {
    officeState.tempProjects = [
      project('run', {
        status: 'running',
        nodeRuns: [{ nodeId: 'n', agentId: 'a1', status: 'running', startedAt: 1 }],
      }),
    ];
    let resolveProgress: (() => void) | undefined;
    officeState.fetchProjectProgress.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveProgress = resolve;
        }),
    );

    const started = Date.now();
    await ensureProjectCardOnExpand('run', false);
    const elapsed = Date.now() - started;

    expect(isProjectCardPrefetchReady('run')).toBe(true);
    expect(elapsed).toBeLessThan(50);
    expect(officeState.fetchProjectProgress).toHaveBeenCalledTimes(1);
    expect(resolveProgress).toBeDefined();

    resolveProgress?.();
  });

  it('prepareProjectExpandPrefetch promotes warm cache before first paint path', () => {
    officeState.tempProjects = [
      project('run', {
        status: 'running',
        nodeRuns: [{ nodeId: 'n', agentId: 'a1', status: 'running', startedAt: 1 }],
      }),
    ];
    officeState.roomMessagesByProject.run = [{ id: 'm1', content: 'cached' }];

    prepareProjectExpandPrefetch('run', false);

    expect(isProjectCardPrefetchReady('run')).toBe(true);
    expect(isProjectRoomPrefetchReady('run')).toBe(true);
    expect(shouldShowProjectCardPrefetchLoading('run', true, false, officeState.tempProjects[0])).toBe(false);
    expect(shouldShowProjectRoomPrefetchLoading('run', false, { executionMode: 'workflow' })).toBe(false);
  });

  it('archived expand only prefetches room slice', async () => {
    officeState.tempProjects = [project('arch', { lifecycle: 'completed' })];
    ensureProjectExpandDataImmediate('arch', true);
    await waitForOfficePrefetchIdleForTest();

    expect(officeState.fetchProjectProgress).not.toHaveBeenCalled();
    expect(officeState.fetchRoomMessages).toHaveBeenCalledWith('arch', { roomFetchGeneration: 0 });
    expect(isProjectRoomPrefetchReady('arch')).toBe(true);
    expect(isProjectCardPrefetchReady('arch')).toBe(false);
  });

  it('gateway initial prefetch pass toggles green ui until queue idle', async () => {
    officeState.tempProjects = [project('p1', { sequence: 1 })];
    beginGatewayInitialPrefetchPass(['p1']);
    expect(isOfficeDisplayCacheGatewayInitialPrefetchUiActive()).toBe(true);
    scheduleOfficeProjectPrefetch(officeState.tempProjects, null);
    await waitForOfficePrefetchIdleForTest();
    expect(isOfficeDisplayCacheGatewayInitialPrefetchUiActive()).toBe(false);
  });
});
