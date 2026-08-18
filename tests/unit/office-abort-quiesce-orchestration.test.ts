import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayManager } from '@electron/gateway/manager';
import type { OfficeTempProject } from '@electron/services/office/types';
import {
  getAbortQuiesceLock,
  resetAbortQuiesceLocksForTests,
} from '@electron/services/office/project-abort-quiesce';
import {
  registerOfficeInflightLlm,
  resetOfficeInflightLlmRegistryForTests,
} from '@electron/services/office/office-inflight-llm-registry';

const getTempProject = vi.hoisted(() => vi.fn());
const upsertTempProject = vi.hoisted(() => vi.fn());
const abortTaskRun = vi.hoisted(() => vi.fn());
const abortSmartTaskRun = vi.hoisted(() => vi.fn());

vi.mock('@electron/services/office/store', () => ({
  getTempProject,
  upsertTempProject,
  listTempProjects: vi.fn().mockResolvedValue([]),
  listFixedGroups: vi.fn().mockResolvedValue([]),
  getRoomMessages: vi.fn().mockResolvedValue([]),
  appendRoomMessage: vi.fn(async (msg: unknown) => msg),
}));

vi.mock('@electron/services/office/workflow-runner', () => ({
  runTaskWorkflow: vi.fn(),
  abortTaskRun,
}));

vi.mock('@electron/services/office/smart-task-runner', () => ({
  runSmartTask: vi.fn(),
  abortSmartTaskRun,
}));

vi.mock('@electron/services/office/office-spawn-policy-reconcile', () => ({
  prepareOfficeSpawnDenyBeforeRun: vi.fn(),
  releaseOfficeSpawnDenyAfterRun: vi.fn(),
  releaseOfficeSpawnDenyForOrphanedProjectAbort: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@electron/services/office/office-sync-runtime', () => ({
  notifyOfficeProjectRunStarted: vi.fn(),
  notifyOfficeProjectRunStopped: vi.fn(),
  isOfficeProjectRunLifecycleActive: vi.fn(() => false),
}));

import { abortOfficeTaskRun, runOfficeProject } from '@electron/services/office/task-run';

function runningProject(partial: Partial<OfficeTempProject> = {}): OfficeTempProject {
  return {
    id: 'proj-1',
    title: 't',
    status: 'running',
    lifecycle: 'active',
    executionMode: 'workflow',
    agentIds: ['a1'],
    nodeRuns: [
      {
        nodeId: 'n1',
        agentId: 'a1',
        status: 'running',
        sessionKey: 'agent:a1:task:proj-1:role:dev',
      },
    ],
    workflow: {
      mode: 'dag',
      nodes: [{ id: 'n1', agentId: 'a1', title: 'Step', execution: 'serial' }],
      edges: [],
    },
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  } as OfficeTempProject;
}

describe('abortOfficeTaskRun quiesce orchestration', () => {
  beforeEach(() => {
    resetAbortQuiesceLocksForTests();
    resetOfficeInflightLlmRegistryForTests();
    vi.clearAllMocks();
    abortTaskRun.mockImplementation(async (id: string, options?: { abortQuiesce?: unknown }) =>
      runningProject({
        id,
        status: 'aborted',
        abortQuiescing: Boolean(options?.abortQuiesce),
        abortGeneration: (options as { abortQuiesce?: { generation: number } } | undefined)?.abortQuiesce
          ?.generation,
        abortQuiesceStartedAt: (options as { abortQuiesce?: { startedAt: number } } | undefined)
          ?.abortQuiesce?.startedAt,
        nodeRuns: [
          {
            nodeId: 'n1',
            agentId: 'a1',
            status: 'failed',
            error: '用户已手动中止本项目',
            sessionKey: 'agent:a1:task:proj-1:role:dev',
          },
        ],
      }),
    );
    getTempProject.mockImplementation(async (id: string) =>
      runningProject({
        id,
        status: 'aborted',
        abortQuiescing: true,
        abortGeneration: 1,
      }),
    );
  });

  it('persists local abort with quiesce without awaiting gateway rpc', async () => {
    getTempProject.mockResolvedValueOnce(runningProject());
    registerOfficeInflightLlm({
      projectId: 'proj-1',
      sessionKey: 'agent:a1:task-room:proj-1',
    });

    let releaseList!: (value: { sessions: unknown[] }) => void;
    const listGate = new Promise<{ sessions: unknown[] }>((resolve) => {
      releaseList = resolve;
    });
    const rpc = vi.fn().mockImplementation(async (method: string) => {
      if (method === 'chat.abort') return {};
      if (method === 'sessions.list') return listGate;
      throw new Error(`unexpected ${method}`);
    });
    const gateway = {
      isConnected: () => true,
      rpc,
      getStatus: () => ({ state: 'running' }),
    } as unknown as GatewayManager;

    const saved = await abortOfficeTaskRun('proj-1', { gateway });
    expect(saved?.status).toBe('aborted');
    expect(saved?.abortQuiescing).toBe(true);
    expect(saved?.abortGeneration).toBe(1);
    expect(abortTaskRun).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({
        skipSpawnRelease: true,
        abortQuiesce: expect.objectContaining({ generation: 1 }),
      }),
    );
    expect(getAbortQuiesceLock('proj-1')?.generation).toBe(1);
    // Abort HTTP returned while gateway confirm still blocked on sessions.list
    expect(rpc).toHaveBeenCalledWith(
      'chat.abort',
      expect.objectContaining({ sessionKey: 'agent:a1:task-room:proj-1' }),
      expect.any(Number),
    );
    expect(rpc).toHaveBeenCalledWith(
      'chat.abort',
      expect.objectContaining({ sessionKey: 'agent:a1:task:proj-1:role:dev' }),
      expect.any(Number),
    );

    releaseList({ sessions: [] });
    await getAbortQuiesceLock('proj-1')?.abortWork;
  });

  it('idempotent second abort does not bump generation and rekicks', async () => {
    const aborted = runningProject({
      status: 'aborted',
      abortQuiescing: true,
      abortGeneration: 3,
      abortQuiesceStartedAt: 50,
    });
    getTempProject.mockResolvedValue(aborted);

    const rpc = vi.fn().mockImplementation(async (method: string) => {
      if (method === 'chat.abort') return {};
      if (method === 'sessions.list') return { sessions: [] };
      throw new Error(`unexpected ${method}`);
    });
    const gateway = { isConnected: () => true, rpc } as unknown as GatewayManager;

    // Seed an existing lock for generation 3 (failed / disconnected first pass).
    const { beginAbortQuiesceAndScheduleGateway } = await import(
      '@electron/services/office/project-gateway-abort'
    );
    beginAbortQuiesceAndScheduleGateway({
      gateway: undefined,
      projectId: 'proj-1',
      generation: 3,
      keysHint: ['k1'],
      startedAt: 50,
      staticSessionKeys: ['k1'],
      inflightSessionKeys: [],
    });
    rpc.mockClear();

    const saved = await abortOfficeTaskRun('proj-1', { gateway });
    expect(saved?.abortGeneration).toBe(3);
    expect(abortTaskRun).not.toHaveBeenCalled();
    await getAbortQuiesceLock('proj-1')?.abortWork;
    expect(rpc).toHaveBeenCalledWith(
      'chat.abort',
      { sessionKey: 'k1' },
      expect.any(Number),
    );
  });

  it('runOfficeProject rejects while abortQuiescing', async () => {
    const gateway = {
      isConnected: () => true,
      getStatus: () => ({ state: 'running' }),
    } as unknown as GatewayManager;
    await expect(
      runOfficeProject(
        gateway,
        runningProject({ status: 'aborted', abortQuiescing: true }),
      ),
    ).rejects.toThrow(/abort still in progress/i);
  });
});
