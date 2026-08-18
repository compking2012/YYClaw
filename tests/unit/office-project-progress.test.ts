import { describe, expect, it } from 'vitest';
import {
  mergeProjectProgressIntoProject,
  projectProgressFromTempProject,
} from '@/lib/office-project-progress';
import type { OfficeTempProject } from '@/types/office';

function project(overrides: Partial<OfficeTempProject> = {}): OfficeTempProject {
  return {
    id: 'proj-1',
    title: 'Test',
    origin: 'standalone',
    agentIds: ['a1'],
    coordinatorAgentId: 'a1',
    lifecycle: 'active',
    featureDescription: 'feat',
    description: '',
    status: 'running',
    nodeRuns: [{ nodeId: 'n1', agentId: 'a1', status: 'running' }],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe('office-project-progress', () => {
  it('projectProgressFromTempProject keeps execution slice only', () => {
    const full = project({
      workflow: { mode: 'dag', nodes: [{ id: 'n1', agentId: 'a1', execution: 'serial' }], edges: [] },
      featureDescription: 'long description',
    });
    expect(projectProgressFromTempProject(full)).toEqual({
      id: 'proj-1',
      status: 'running',
      nodeRuns: [{ nodeId: 'n1', agentId: 'a1', status: 'running' }],
      workflowReviewBatch: undefined,
      workflowStall: undefined,
      workflowUserIntervention: undefined,
      updatedAt: 2,
    });
  });

  it('mergeProjectProgressIntoProject patches progress fields without dropping workflow', () => {
    const full = project({
      workflow: { mode: 'dag', nodes: [{ id: 'n1', agentId: 'a1', execution: 'serial' }], edges: [] },
    });
    const merged = mergeProjectProgressIntoProject(full, {
      id: 'proj-1',
      status: 'completed',
      nodeRuns: [{ nodeId: 'n1', agentId: 'a1', status: 'completed' }],
      updatedAt: 99,
    });
    expect(merged.status).toBe('completed');
    expect(merged.updatedAt).toBe(99);
    expect(merged.workflow?.nodes).toHaveLength(1);
    expect(merged.featureDescription).toBe('feat');
  });
});
