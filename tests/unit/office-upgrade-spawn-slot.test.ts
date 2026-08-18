import { describe, expect, it } from 'vitest';
import { linkStandaloneProjectToFixedGroupSpawn } from '@/lib/office-standalone-group-link';
import { activeChildProjectForGroup, assertGroupCanSpawnProject } from '../../electron/services/office/agent-binding';
import type { OfficeFixedGroup, OfficeTempProject } from '@/types/office';

function standaloneCompleted(): OfficeTempProject {
  return {
    id: 'proj-up',
    title: '升级样板',
    origin: 'standalone',
    agentIds: ['a1'],
    coordinatorAgentId: 'a1',
    lifecycle: 'active',
    status: 'completed',
    featureDescription: 'desc',
    description: 'desc',
    executionMode: 'workflow',
    nodeRuns: [{ nodeId: 'n1', agentId: 'a1', status: 'completed' }],
    createdAt: 1,
    updatedAt: 2,
  };
}

const group: OfficeFixedGroup = {
  id: 'group-up',
  name: '组',
  agentIds: ['a1'],
  coordinatorAgentId: 'a1',
  executionMode: 'workflow',
  createdAt: 1,
  updatedAt: 2,
};

describe('standalone upgrade spawn slot', () => {
  it('archives completed template on link so group can spawn again', () => {
    const linked = linkStandaloneProjectToFixedGroupSpawn(standaloneCompleted(), group);
    expect(linked.lifecycle).toBe('completed');
    expect(linked.parentGroupId).toBe('group-up');
    expect(() =>
      assertGroupCanSpawnProject('group-up', [linked as OfficeTempProject]),
    ).not.toThrow();
    expect(activeChildProjectForGroup('group-up', [linked as OfficeTempProject])).toBeUndefined();
  });
});
