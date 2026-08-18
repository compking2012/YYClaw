import { describe, expect, it } from 'vitest';
import { getWorkflowReviewStatus } from '../../electron/services/office/workflow-review';
import type { OfficeTempProject } from '../../electron/services/office/types';

function project(overrides: Partial<OfficeTempProject> = {}): OfficeTempProject {
  return {
    id: 'p1',
    title: 't',
    origin: 'standalone',
    agentIds: ['a1'],
    coordinatorAgentId: 'a1',
    lifecycle: 'active',
    status: 'running',
    featureDescription: '',
    description: '',
    executionMode: 'workflow',
    workflow: { mode: 'dag', nodes: [], edges: [] },
    nodeRuns: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as OfficeTempProject;
}

describe('workflow-review status', () => {
  it('getWorkflowReviewStatus exposes phase and batch', () => {
    const batch = {
      batchId: 'b1',
      nodeId: 'n1',
      updatedAt: Date.now(),
      items: [],
    };
    const status = getWorkflowReviewStatus(
      project({
        workflowReviewBatch: batch as OfficeTempProject['workflowReviewBatch'],
      }),
    );
    expect(typeof status.enabled).toBe('boolean');
    expect(status.batch).toEqual(batch);
    expect(status.phase).toBeTruthy();
  });
});
