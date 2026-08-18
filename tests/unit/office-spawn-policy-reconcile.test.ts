import { beforeEach, describe, expect, it, vi } from 'vitest';

const { writeOpenClawConfig, readOpenClawConfig } = vi.hoisted(() => ({
  writeOpenClawConfig: vi.fn(),
  readOpenClawConfig: vi.fn(),
}));

vi.mock('@electron/utils/config-mutex', () => ({
  withConfigLock: async (fn: () => Promise<unknown>) => fn(),
}));

vi.mock('@electron/utils/channel-config', () => ({
  readOpenClawConfig,
  writeOpenClawConfig,
}));

vi.mock('@electron/services/office/store', () => ({
  listTempProjects: vi.fn(),
}));

vi.mock('@electron/services/office/office-workflow-log', () => ({
  officeWorkflowLog: vi.fn(),
}));

import { OFFICE_SPAWN_TOOL_DENY } from '@electron/services/office/office-spawn-policy';
import {
  getOfficeSpawnPolicyActiveProjectsForTest,
  getOfficeSpawnPolicyAgentDenyRefForTest,
  prepareOfficeSpawnDenyBeforeRun,
  rebuildOfficeSpawnPolicyRefsFromStore,
  reconcileOfficeSpawnToolPolicy,
  releaseOfficeSpawnDenyAfterRun,
  resetOfficeSpawnPolicyReconcileForTest,
} from '@electron/services/office/office-spawn-policy-reconcile';
import { listTempProjects } from '@electron/services/office/store';

function mockOpenClawAgents(
  agents: Array<{ id: string; tools?: Record<string, unknown> }>,
): void {
  readOpenClawConfig.mockResolvedValue({
    agents: { list: agents },
  });
}

function toolsFromLastWrite(agentIndex = 0): Record<string, unknown> | undefined {
  const saved = writeOpenClawConfig.mock.calls.at(-1)?.[0] as {
    agents?: { list?: Array<{ tools?: Record<string, unknown> }> };
  };
  return saved?.agents?.list?.[agentIndex]?.tools;
}

describe('office-spawn-policy-reconcile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOfficeSpawnPolicyReconcileForTest();
  });

  it('prepare increments ref and persists spawn deny via openclaw.json', async () => {
    mockOpenClawAgents([{ id: 'dev', tools: { allow: ['read', 'sessions_spawn'] } }]);

    await prepareOfficeSpawnDenyBeforeRun({ id: 'proj-1', agentIds: ['dev'] });

    expect(getOfficeSpawnPolicyAgentDenyRefForTest().get('dev')).toBe(1);
    expect(getOfficeSpawnPolicyActiveProjectsForTest().has('proj-1')).toBe(true);
    expect(writeOpenClawConfig).toHaveBeenCalledOnce();
    expect(toolsFromLastWrite()?.deny).toEqual([...OFFICE_SPAWN_TOOL_DENY]);
    expect(toolsFromLastWrite()?.allow).toEqual(['read']);
  });

  it('idempotent prepare for the same project does not double-increment refs', async () => {
    mockOpenClawAgents([{ id: 'dev', tools: {} }]);

    await prepareOfficeSpawnDenyBeforeRun({ id: 'proj-1', agentIds: ['dev'] });
    await prepareOfficeSpawnDenyBeforeRun({ id: 'proj-1', agentIds: ['dev'] });

    expect(getOfficeSpawnPolicyAgentDenyRefForTest().get('dev')).toBe(1);
  });

  it('keeps deny while overlapping projects share an agent', async () => {
    mockOpenClawAgents([{ id: 'dev', tools: {} }]);

    await prepareOfficeSpawnDenyBeforeRun({ id: 'p1', agentIds: ['dev'] });
    await prepareOfficeSpawnDenyBeforeRun({ id: 'p2', agentIds: ['dev'] });
    expect(getOfficeSpawnPolicyAgentDenyRefForTest().get('dev')).toBe(2);

    await releaseOfficeSpawnDenyAfterRun('p1', ['dev']);
    expect(getOfficeSpawnPolicyAgentDenyRefForTest().get('dev')).toBe(1);
    expect(toolsFromLastWrite()?.deny).toEqual([...OFFICE_SPAWN_TOOL_DENY]);

    await releaseOfficeSpawnDenyAfterRun('p2', ['dev']);
    expect(getOfficeSpawnPolicyAgentDenyRefForTest().has('dev')).toBe(false);
    expect(toolsFromLastWrite()?.deny).toBeUndefined();
  });

  it('release is idempotent when project is not tracked', async () => {
    mockOpenClawAgents([{ id: 'dev', tools: { deny: [...OFFICE_SPAWN_TOOL_DENY] } }]);

    await releaseOfficeSpawnDenyAfterRun('missing', ['dev']);

    expect(writeOpenClawConfig).not.toHaveBeenCalled();
  });

  it('release decrements agents recorded at prepare time even when caller passes a subset', async () => {
    mockOpenClawAgents([
      { id: 'dev', tools: {} },
      { id: 'pm', tools: {} },
    ]);

    await prepareOfficeSpawnDenyBeforeRun({ id: 'proj-1', agentIds: ['dev', 'pm'] });
    writeOpenClawConfig.mockClear();

    await releaseOfficeSpawnDenyAfterRun('proj-1', ['dev']);

    expect(getOfficeSpawnPolicyAgentDenyRefForTest().has('dev')).toBe(false);
    expect(getOfficeSpawnPolicyAgentDenyRefForTest().has('pm')).toBe(false);
    expect(writeOpenClawConfig).toHaveBeenCalledOnce();
    expect(toolsFromLastWrite(0)?.deny).toBeUndefined();
    expect(toolsFromLastWrite(1)?.deny).toBeUndefined();
  });

  it('reconcile is a no-op write when config already matches refs', async () => {
    mockOpenClawAgents([{ id: 'dev', tools: { deny: [...OFFICE_SPAWN_TOOL_DENY] } }]);
    await prepareOfficeSpawnDenyBeforeRun({ id: 'proj-1', agentIds: ['dev'] });
    writeOpenClawConfig.mockClear();

    const changed = await reconcileOfficeSpawnToolPolicy('test-noop');
    expect(changed).toBe(false);
    expect(writeOpenClawConfig).not.toHaveBeenCalled();
  });

  it('rebuildOfficeSpawnPolicyRefsFromStore restores refs from executing projects', async () => {
    vi.mocked(listTempProjects).mockResolvedValue([
      {
        id: 'proj-running',
        title: 'Run',
        lifecycle: 'active',
        status: 'running',
        agentIds: ['dev', 'pm'],
        nodeRuns: [],
        executionMode: 'workflow',
        createdAt: 1,
        updatedAt: 1,
      },
    ] as never);
    mockOpenClawAgents([
      { id: 'dev', tools: {} },
      { id: 'pm', tools: {} },
    ]);

    await rebuildOfficeSpawnPolicyRefsFromStore();

    expect(getOfficeSpawnPolicyActiveProjectsForTest().has('proj-running')).toBe(true);
    expect(getOfficeSpawnPolicyAgentDenyRefForTest().get('dev')).toBe(1);
    expect(getOfficeSpawnPolicyAgentDenyRefForTest().get('pm')).toBe(1);
    expect(writeOpenClawConfig).toHaveBeenCalled();
  });

  it('rebuild preserves in-flight prepare refs before store status becomes running', async () => {
    vi.mocked(listTempProjects).mockResolvedValue([
      {
        id: 'proj-kickoff',
        title: 'Kickoff',
        lifecycle: 'active',
        status: 'pending',
        agentIds: ['dev'],
        nodeRuns: [],
        executionMode: 'smart',
        createdAt: 1,
        updatedAt: 1,
      },
    ] as never);
    mockOpenClawAgents([{ id: 'dev', tools: { deny: [...OFFICE_SPAWN_TOOL_DENY] } }]);

    await prepareOfficeSpawnDenyBeforeRun({ id: 'proj-kickoff', agentIds: ['dev'] });
    writeOpenClawConfig.mockClear();

    await rebuildOfficeSpawnPolicyRefsFromStore();

    expect(getOfficeSpawnPolicyActiveProjectsForTest().has('proj-kickoff')).toBe(true);
    expect(getOfficeSpawnPolicyAgentDenyRefForTest().get('dev')).toBe(1);
    expect(writeOpenClawConfig).not.toHaveBeenCalled();
  });

  it('persists only through writeOpenClawConfig (no gateway debouncedReload hook)', async () => {
    mockOpenClawAgents([{ id: 'dev', tools: {} }]);
    const debouncedReload = vi.fn();

    await prepareOfficeSpawnDenyBeforeRun({ id: 'proj-1', agentIds: ['dev'] });

    expect(writeOpenClawConfig).toHaveBeenCalledOnce();
    expect(debouncedReload).not.toHaveBeenCalled();
  });
});
