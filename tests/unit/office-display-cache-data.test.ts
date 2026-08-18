import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getOfficeDisplayCache,
  patchOfficeDisplayCacheData,
  resetOfficeDisplayCacheForTest,
  setOfficeDisplayCacheSyncPhase,
} from '@/lib/office-display-cache';
import { applyOfficeDisplayCacheFromStore, flushOfficeDisplayCacheFromStoreForTest } from '@/lib/office-display-cache-data';
import type { OfficeTempProject } from '@/types/office';

const officeState = {
  fixedGroups: [{ id: 'g1', name: 'Team', agentIds: ['a1'], coordinatorAgentId: 'a1', sequence: 1 }],
  tempProjects: [] as OfficeTempProject[],
  agentBindings: {},
  roomMessagesByProject: {} as Record<string, { id: string; content: string }[]>,
};

const agentsState = {
  agents: [{ id: 'a1', name: 'Agent 1' }],
};

vi.mock('@/stores/office', () => ({
  useOfficeStore: { getState: () => officeState },
}));

vi.mock('@/stores/agents', () => ({
  useAgentsStore: { getState: () => agentsState },
}));

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

describe('office-display-cache-data', () => {
  beforeEach(() => {
    resetOfficeDisplayCacheForTest();
    officeState.tempProjects = [project('p1')];
    officeState.roomMessagesByProject = {};
  });

  it('does not mirror while sync phase is idle', () => {
    applyOfficeDisplayCacheFromStore({ flush: true });
    expect(getOfficeDisplayCache().sync.tempProjects).toHaveLength(0);
  });

  it('mirrors fixed groups, projects, agents and room messages into cache', () => {
    setOfficeDisplayCacheSyncPhase('loading');
    flushOfficeDisplayCacheFromStoreForTest();

    const cache = getOfficeDisplayCache();
    expect(cache.sync.fixedGroups).toHaveLength(1);
    expect(cache.sync.tempProjects).toHaveLength(1);
    expect(cache.sync.tempProjects[0]?.id).toBe('p1');
    expect(cache.sync.archivedCount).toBe(0);
    expect(cache.sync.agents[0]?.name).toBe('Agent 1');
    expect(cache.sync.projectCards.p1?.project?.id).toBe('p1');
    expect(cache.async.rooms.p1?.messages).toBeUndefined();
    expect(cache.sync.dataRevision).toBeGreaterThan(0);
  });

  it('prunes removed room messages from cache', () => {
    setOfficeDisplayCacheSyncPhase('loading');
    flushOfficeDisplayCacheFromStoreForTest();
    patchOfficeDisplayCacheData({
      async: {
        rooms: {
          p1: { phase: 'ready', messages: [{ id: 'm1', content: 'hi' } as never] },
        },
      },
    });
    delete officeState.roomMessagesByProject.p1;
    flushOfficeDisplayCacheFromStoreForTest();
    expect(getOfficeDisplayCache().async.rooms.p1).toBeUndefined();
  });
});
