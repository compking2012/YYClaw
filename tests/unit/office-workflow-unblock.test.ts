import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayManager } from '../../electron/gateway/manager';
import type { OfficeFixedGroup, OfficeTempProject } from '../../electron/services/office/types';

const storeMocks = vi.hoisted(() => ({
  getTempProject: vi.fn(),
  upsertTempProject: vi.fn(),
}));

const runMocks = vi.hoisted(() => ({
  runOfficeProject: vi.fn(async () => undefined),
}));

const checkpointMocks = vi.hoisted(() => ({
  isUserCheckpointEnabled: vi.fn(() => false),
  isWorkflowReviewActive: vi.fn(() => false),
}));

vi.mock('../../electron/services/office/store', () => storeMocks);
vi.mock('../../electron/services/office/task-run', () => runMocks);
vi.mock('../../src/lib/office-workflow-user-checkpoint', () => checkpointMocks);

import { unblockWorkflowProject } from '../../electron/services/office/workflow-unblock';

const group: OfficeFixedGroup = {
  id: 'g1',
  name: '组',
  agentIds: ['a1'],
  coordinatorAgentId: 'a1',
  executionMode: 'workflow',
  workflow: { mode: 'dag', nodes: [], edges: [] },
  sequence: 1,
  createdAt: 1,
  updatedAt: 1,
};

function blockedProject(overrides: Partial<OfficeTempProject> = {}): OfficeTempProject {
  return {
    id: 'p1',
    title: 'blocked',
    origin: 'fixed_group',
    parentGroupId: 'g1',
    agentIds: ['a1'],
    coordinatorAgentId: 'a1',
    lifecycle: 'active',
    status: 'blocked',
    featureDescription: '',
    description: '',
    executionMode: 'workflow',
    workflow: { mode: 'dag', nodes: [], edges: [] },
    nodeRuns: [
      { nodeId: 'n1', agentId: 'a1', status: 'pending', error: 'workflow stalled waiting upstream' },
    ],
    workflowStall: { reason: 'stall' },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as OfficeTempProject;
}

describe('workflow-unblock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkpointMocks.isUserCheckpointEnabled.mockReturnValue(false);
    checkpointMocks.isWorkflowReviewActive.mockReturnValue(false);
  });

  it('throws when project missing or not blocked', async () => {
    storeMocks.getTempProject.mockResolvedValue(undefined);
    await expect(
      unblockWorkflowProject({} as GatewayManager, blockedProject(), group),
    ).rejects.toThrow(/not found/i);

    storeMocks.getTempProject.mockResolvedValue(blockedProject({ status: 'running' }));
    await expect(
      unblockWorkflowProject({} as GatewayManager, blockedProject(), group),
    ).rejects.toThrow(/not blocked/i);
  });

  it('throws when user review checkpoint is active', async () => {
    checkpointMocks.isUserCheckpointEnabled.mockReturnValue(true);
    checkpointMocks.isWorkflowReviewActive.mockReturnValue(true);
    storeMocks.getTempProject.mockResolvedValue(blockedProject());
    await expect(
      unblockWorkflowProject({} as GatewayManager, blockedProject(), group),
    ).rejects.toThrow(/review/i);
  });

  it('clears stall pending errors and continues run', async () => {
    const fresh = blockedProject();
    const unlocked = { ...fresh, status: 'running' as const, workflowStall: undefined };
    storeMocks.getTempProject.mockResolvedValue(fresh);
    storeMocks.upsertTempProject.mockResolvedValue(unlocked);

    const result = await unblockWorkflowProject({} as GatewayManager, fresh, group);

    expect(result.status).toBe('running');
    expect(storeMocks.upsertTempProject).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'running',
        nodeRuns: [expect.objectContaining({ error: undefined })],
      }),
    );
    expect(runMocks.runOfficeProject).toHaveBeenCalledWith(
      expect.anything(),
      unlocked,
      group,
      { mode: 'continue' },
    );
  });
});
