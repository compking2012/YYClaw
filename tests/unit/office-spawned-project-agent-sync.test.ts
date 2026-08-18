import { describe, expect, it } from 'vitest';
import {
  buildSpawnedProjectAgentSyncNotice,
  describeSpawnedProjectAgentDrift,
  syncSpawnedProjectAgentsWithGroup,
} from '@/lib/office-spawned-project-agent-sync';
import type { OfficeFixedGroup, OfficeTempProject } from '@/types/office';

const now = Date.now();

function group(overrides: Partial<OfficeFixedGroup> = {}): OfficeFixedGroup {
  return {
    id: 'group-1',
    name: '研发团队',
    agentIds: ['agent-a', 'agent-b'],
    coordinatorAgentId: 'agent-a',
    workflow: { mode: 'dag', nodes: [], edges: [] },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function project(overrides: Partial<OfficeTempProject> = {}): OfficeTempProject {
  return {
    id: 'proj-1',
    title: '派出项目',
    origin: 'fixed_group',
    parentGroupId: 'group-1',
    agentIds: ['agent-a'],
    coordinatorAgentId: 'agent-a',
    lifecycle: 'completed',
    featureDescription: 'feat',
    description: '',
    status: 'completed',
    workflow: { mode: 'dag', nodes: [], edges: [] },
    nodeRuns: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('office-spawned-project-agent-sync', () => {
  it('describeSpawnedProjectAgentDrift detects added and removed agents', () => {
    const drift = describeSpawnedProjectAgentDrift(
      project({ agentIds: ['agent-a', 'agent-old'] }),
      group({ agentIds: ['agent-a', 'agent-b'] }),
    );
    expect(drift.addedAgentIds).toEqual(['agent-b']);
    expect(drift.removedAgentIds).toEqual(['agent-old']);
    expect(drift.changed).toBe(true);
  });

  it('syncSpawnedProjectAgentsWithGroup aligns project team with group', () => {
    const synced = syncSpawnedProjectAgentsWithGroup(project(), group());
    expect(synced.agentIds).toEqual(['agent-a', 'agent-b']);
    expect(synced.coordinatorAgentId).toBe('agent-a');
  });

  it('buildSpawnedProjectAgentSyncNotice returns null when team already matches', () => {
    const notice = buildSpawnedProjectAgentSyncNotice(
      project({ agentIds: ['agent-a', 'agent-b'] }),
      group(),
    );
    expect(notice).toBeNull();
  });

  it('buildSpawnedProjectAgentSyncNotice includes group metadata when drift exists', () => {
    const notice = buildSpawnedProjectAgentSyncNotice(project(), group());
    expect(notice).toMatchObject({
      groupId: 'group-1',
      groupName: '研发团队',
      addedAgentIds: ['agent-b'],
      removedAgentIds: [],
      changed: true,
    });
  });
});
