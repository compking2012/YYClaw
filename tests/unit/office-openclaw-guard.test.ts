import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@electron/services/office/office-sync-runtime', () => ({
  isOfficeProjectExecutionActiveInMemory: vi.fn(() => false),
}));

vi.mock('@electron/services/office/store', () => ({
  listTempProjects: vi.fn(),
}));

import { isOfficeProjectExecutionActiveInMemory } from '@electron/services/office/office-sync-runtime';
import { listTempProjects } from '@electron/services/office/store';
import {
  assertOfficeOpenClawWriteAllowed,
  isAnyOfficeProjectExecuting,
  OfficeOpenClawWriteFrozenError,
} from '@electron/services/office/office-openclaw-guard';

describe('office-openclaw-guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isOfficeProjectExecutionActiveInMemory).mockReturnValue(false);
    vi.mocked(listTempProjects).mockResolvedValue([]);
  });

  it('blocks writes when an in-memory project run is active', async () => {
    vi.mocked(isOfficeProjectExecutionActiveInMemory).mockReturnValue(true);

    await expect(assertOfficeOpenClawWriteAllowed('test')).rejects.toBeInstanceOf(
      OfficeOpenClawWriteFrozenError,
    );
    expect(await isAnyOfficeProjectExecuting()).toBe(true);
  });

  it('blocks writes when store reports an executing project', async () => {
    vi.mocked(listTempProjects).mockResolvedValue([
      {
        id: 'p1',
        title: 'Demo',
        lifecycle: 'active',
        status: 'running',
        nodeRuns: [],
        agentIds: ['a1'],
        coordinatorAgentId: 'a1',
        origin: 'standalone',
        featureDescription: '',
        executionMode: 'workflow',
        workflow: { mode: 'dag', nodes: [], edges: [] },
        createdAt: 1,
        updatedAt: 1,
      },
    ] as never);

    await expect(assertOfficeOpenClawWriteAllowed('establish')).rejects.toMatchObject({
      code: 'OFFICE_OPENCLAW_WRITE_FROZEN',
      executingProjectIds: ['p1'],
    });
  });

  it('allows writes when no project is executing', async () => {
    vi.mocked(listTempProjects).mockResolvedValue([
      {
        id: 'p1',
        title: 'Demo',
        lifecycle: 'active',
        status: 'pending',
        nodeRuns: [],
        agentIds: ['a1'],
        coordinatorAgentId: 'a1',
        origin: 'standalone',
        featureDescription: '',
        executionMode: 'workflow',
        workflow: { mode: 'dag', nodes: [], edges: [] },
        createdAt: 1,
        updatedAt: 1,
      },
    ] as never);

    await expect(assertOfficeOpenClawWriteAllowed('establish')).resolves.toBeUndefined();
    expect(await isAnyOfficeProjectExecuting()).toBe(false);
  });
});
