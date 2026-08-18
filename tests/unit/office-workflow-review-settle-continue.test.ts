/**
 * @vitest-environment node
 *
 * Regression coverage for the review-settle continuation path.
 *
 * `runOfficeProject` returns `Promise<void>`, so the previous
 * `return runOfficeProject(...)` inside `continueWorkflowAfterReviewSettle`
 * made `settleWorkflowReviewBatch` resolve to `{ project: undefined }`
 * whenever a settle needed a continuation run. This locks in that the
 * settled project is returned intact and the continuation is fired
 * (fire-and-forget), matching every other `runOfficeProject` call site.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  NodeRunRecord,
  OfficeFixedGroup,
  OfficeTempProject,
  WorkflowEdge,
  WorkflowNode,
} from '@/types/office';
import { SERIAL_REVIEW_GROUP } from '@/lib/office-workflow-user-checkpoint';

const runOfficeProjectMock = vi.fn(async () => {});
const upsertTempProjectMock = vi.fn(async () => {});
let storedProject: OfficeTempProject;

vi.mock('../../electron/services/office/store', () => ({
  getTempProject: vi.fn(async () => storedProject),
  upsertTempProject: (project: OfficeTempProject) => {
    storedProject = project;
    return upsertTempProjectMock(project);
  },
}));

vi.mock('../../electron/services/office/task-run', () => ({
  runOfficeProject: (...args: unknown[]) => runOfficeProjectMock(...args),
}));

vi.mock('../../electron/services/office/workflow-run-registry', () => ({
  isWorkflowTaskRunnerActive: () => false,
}));

const nodes: WorkflowNode[] = [
  { id: 'n1', agentId: 'a1', execution: 'serial', userCheckpoint: true },
  { id: 'n2', agentId: 'a1', execution: 'serial' },
];
const edges: WorkflowEdge[] = [{ from: 'n1', to: 'n2', when: 'on_success' }];

vi.mock('../../electron/services/office/workflow-graph', () => ({
  workflowForProject: () => ({ nodes, edges }),
}));

import { settleWorkflowReviewBatch } from '../../electron/services/office/workflow-review';

function run(nodeId: string, status: NodeRunRecord['status']): NodeRunRecord {
  return { nodeId, agentId: 'a1', status };
}

function projectWithReadyBatch(): OfficeTempProject {
  return {
    id: 't-review',
    title: 'Review',
    origin: 'standalone',
    agentIds: ['a1'],
    coordinatorAgentId: 'a1',
    lifecycle: 'active',
    featureDescription: '',
    description: '',
    status: 'running',
    executionMode: 'workflow',
    workflowEngine: 'dag',
    nodeRuns: [run('n1', 'completed'), run('n2', 'pending')],
    createdAt: 1,
    updatedAt: 1,
    workflowReviewBatch: {
      id: 'b1',
      settleGeneration: 0,
      parallelGroup: SERIAL_REVIEW_GROUP,
      expectedNodeIds: ['n1'],
      phase: 'ready_to_settle',
      items: {
        n1: {
          nodeId: 'n1',
          state: 'submitted',
          decision: { kind: 'redo', comment: 'fix it' },
        },
      },
      createdAt: 1,
      updatedAt: 1,
    },
  } as OfficeTempProject;
}

describe('settleWorkflowReviewBatch continuation', () => {
  beforeEach(() => {
    (globalThis as { __OFFICE_USER_CHECKPOINT__?: boolean }).__OFFICE_USER_CHECKPOINT__ = true;
    runOfficeProjectMock.mockClear();
    upsertTempProjectMock.mockClear();
    storedProject = projectWithReadyBatch();
  });

  afterEach(() => {
    delete (globalThis as { __OFFICE_USER_CHECKPOINT__?: boolean }).__OFFICE_USER_CHECKPOINT__;
  });

  it('returns the settled project (not undefined) and fires the continuation run', async () => {
    const gateway = {} as never;
    const group = { id: 'g1', agentIds: ['a1'] } as unknown as OfficeFixedGroup;

    const result = await settleWorkflowReviewBatch(gateway, storedProject, group, 0);

    // Regression: project must be a defined OfficeTempProject, never undefined.
    expect(result.error).toBeUndefined();
    expect(result.project).toBeDefined();
    expect(result.project.id).toBe('t-review');
    expect(result.project.status).toBe('running');

    // Continuation is fire-and-forget via runOfficeProject(..., { mode: 'continue', userIntervention }).
    expect(runOfficeProjectMock).toHaveBeenCalledTimes(1);
    expect(runOfficeProjectMock.mock.calls[0]?.[3]).toEqual({
      mode: 'continue',
      userIntervention: {
        nodeId: 'n1',
        request: expect.stringContaining('【人工审查意见】'),
      },
    });
    expect(runOfficeProjectMock.mock.calls[0]?.[3]?.userIntervention?.request).toContain('fix it');
  });
});
