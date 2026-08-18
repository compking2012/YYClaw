import { describe, expect, it } from 'vitest';
import { linkStandaloneProjectToFixedGroupSpawn } from '@/lib/office-standalone-group-link';
import type { OfficeFixedGroup, OfficeTempProject } from '@/types/office';

function standaloneProject(overrides: Partial<OfficeTempProject> = {}): OfficeTempProject {
  return {
    id: 'proj-1',
    title: '五子棋开发',
    origin: 'standalone',
    agentIds: ['agent-a', 'agent-b'],
    coordinatorAgentId: 'agent-b',
    lifecycle: 'active',
    status: 'completed',
    featureDescription: '功能描述',
    description: '工作流描述',
    executionMode: 'workflow',
    workflowEngine: 'dag',
    workflow: { mode: 'dag', nodes: [{ id: 'n1', agentId: 'agent-a', label: 'step' }], edges: [] },
    nodeRuns: [{ nodeId: 'n1', agentId: 'agent-a', status: 'completed' }],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

function fixedGroup(overrides: Partial<OfficeFixedGroup> = {}): OfficeFixedGroup {
  return {
    id: 'group-1',
    name: '研发团队',
    description: '组描述',
    agentIds: ['agent-a', 'agent-b'],
    coordinatorAgentId: 'agent-b',
    executionMode: 'workflow',
    workflowOrchestrationMode: 'heuristic',
    workflowDescription: '组工作流描述',
    workflow: { mode: 'dag', nodes: [{ id: 'gn1', agentId: 'agent-a', label: 'group-step' }], edges: [] },
    createdAt: 10,
    updatedAt: 11,
    ...overrides,
  };
}

describe('linkStandaloneProjectToFixedGroupSpawn', () => {
  it('binds completed standalone project as fixed-group spawn while keeping history', () => {
    const linked = linkStandaloneProjectToFixedGroupSpawn(standaloneProject(), fixedGroup());
    expect(linked.id).toBe('proj-1');
    expect(linked.title).toBe('五子棋开发');
    expect(linked.origin).toBe('fixed_group');
    expect(linked.parentGroupId).toBe('group-1');
    expect(linked.lifecycle).toBe('completed');
    expect(linked.status).toBe('completed');
    expect(linked.nodeRuns).toHaveLength(1);
    expect(linked.upgradedToGroupId).toBeUndefined();
    expect(linked.inheritsGroupTemplate).toBe(true);
    expect(linked.workflow.nodes).toHaveLength(0);
    expect(linked.description).toBe('组工作流描述');
  });

  it('reactivates dissolved standalone project and links as spawn', () => {
    const linked = linkStandaloneProjectToFixedGroupSpawn(
      standaloneProject({ lifecycle: 'dissolved', status: 'aborted' }),
      fixedGroup(),
    );
    expect(linked.origin).toBe('fixed_group');
    expect(linked.parentGroupId).toBe('group-1');
    expect(linked.lifecycle).toBe('active');
    expect(linked.status).toBe('aborted');
  });

  it('uses smart group execution mode without template inheritance flag', () => {
    const linked = linkStandaloneProjectToFixedGroupSpawn(
      standaloneProject({ executionMode: 'smart' }),
      fixedGroup({ executionMode: 'smart', workflow: { mode: 'dag', nodes: [], edges: [] } }),
    );
    expect(linked.executionMode).toBe('smart');
    expect(linked.inheritsGroupTemplate).toBe(false);
    expect(linked.workflow.nodes).toHaveLength(0);
  });
});
