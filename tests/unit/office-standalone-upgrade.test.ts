import { describe, expect, it } from 'vitest';
import { groupDraftSeedFromStandaloneProject } from '@/lib/office-standalone-upgrade';
import type { OfficeTempProject } from '@/types/office';

function standaloneProject(overrides: Partial<OfficeTempProject> = {}): OfficeTempProject {
  return {
    id: 'proj-1',
    title: '调研项目',
    origin: 'standalone',
    agentIds: ['agent-a', 'agent-b'],
    coordinatorAgentId: 'agent-b',
    lifecycle: 'completed',
    status: 'completed',
    featureDescription: '功能描述',
    description: '工作流描述',
    executionMode: 'smart',
    workflowEngine: 'dag',
    workflow: { mode: 'dag', nodes: [{ id: 'n1', agentId: 'agent-a', label: 'step' }], edges: [] },
    nodeRuns: [],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe('groupDraftSeedFromStandaloneProject', () => {
  const agents = [{ id: 'agent-a' }, { id: 'agent-b' }];

  it('leaves group name and description empty while copying team and execution settings', () => {
    const seed = groupDraftSeedFromStandaloneProject(standaloneProject(), agents);
    expect(seed.name).toBe('');
    expect(seed.description).toBe('');
    expect(seed.agentIds).toEqual(['agent-a', 'agent-b']);
    expect(seed.coordinatorAgentId).toBe('agent-b');
    expect(seed.executionMode).toBe('smart');
    expect(seed.workflow.nodes).toHaveLength(0);
  });

  it('copies workflow template for workflow execution mode', () => {
    const seed = groupDraftSeedFromStandaloneProject(
      standaloneProject({ executionMode: 'workflow' }),
      agents,
    );
    expect(seed.executionMode).toBe('workflow');
    expect(seed.workflowDescription).toBe('工作流描述');
    expect(seed.workflow.nodes).toHaveLength(1);
    expect(seed.workflow.nodes[0]?.id).toBe('n1');
  });
});
