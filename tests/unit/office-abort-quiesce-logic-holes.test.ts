import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayManager } from '@electron/gateway/manager';
import type { OfficeTempProject } from '@electron/services/office/types';
import {
  getAbortQuiesceLock,
  resetAbortQuiesceLocksForTests,
} from '@electron/services/office/project-abort-quiesce';

const getTempProject = vi.hoisted(() => vi.fn());
const upsertTempProject = vi.hoisted(() => vi.fn());
const listTempProjects = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const releaseOfficeSpawnDenyForOrphanedProjectAbort = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const releaseOfficeSpawnDenyAfterRun = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const prepareOfficeSpawnDenyBeforeRun = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const notifyOfficeProjectRunStarted = vi.hoisted(() => vi.fn());
const notifyOfficeProjectRunStopped = vi.hoisted(() => vi.fn());
const isOfficeProjectRunLifecycleActive = vi.hoisted(() => vi.fn(() => false));
const abortTaskRun = vi.hoisted(() => vi.fn());
const runTaskWorkflow = vi.hoisted(() => vi.fn());

vi.mock('@electron/services/office/store', () => ({
  getTempProject,
  upsertTempProject,
  listTempProjects,
  listFixedGroups: vi.fn().mockResolvedValue([]),
  getRoomMessages: vi.fn().mockResolvedValue([]),
  appendRoomMessage: vi.fn(async (msg: unknown) => msg),
  notifyRendererProjectProgressUpdate: vi.fn(),
}));

vi.mock('@electron/services/office/office-spawn-policy-reconcile', () => ({
  prepareOfficeSpawnDenyBeforeRun,
  releaseOfficeSpawnDenyAfterRun,
  releaseOfficeSpawnDenyForOrphanedProjectAbort,
}));

vi.mock('@electron/services/office/office-sync-runtime', () => ({
  notifyOfficeProjectRunStarted,
  notifyOfficeProjectRunStopped,
  isOfficeProjectRunLifecycleActive,
}));

vi.mock('@electron/services/office/workflow-runner', () => ({
  runTaskWorkflow,
  abortTaskRun,
}));

vi.mock('@electron/services/office/smart-task-runner', () => ({
  runSmartTask: vi.fn(),
  abortSmartTaskRun: vi.fn(),
}));

import { clearProjectAbortQuiesce } from '@electron/services/office/project-gateway-abort';
import { abortOfficeTaskRun, runOfficeProject } from '@electron/services/office/task-run';

function baseProject(partial: Partial<OfficeTempProject> = {}): OfficeTempProject {
  return {
    id: 'proj-1',
    title: 't',
    status: 'running',
    lifecycle: 'active',
    executionMode: 'workflow',
    agentIds: ['a1'],
    nodeRuns: [{ nodeId: 'n1', agentId: 'a1', status: 'running' }],
    workflow: { mode: 'simple', nodes: [], edges: [] },
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  } as OfficeTempProject;
}

describe('abort quiesce logic hole fixes', () => {
  beforeEach(() => {
    resetAbortQuiesceLocksForTests();
    vi.clearAllMocks();
    upsertTempProject.mockImplementation(async (p: OfficeTempProject) => p);
  });

  it('does not release spawn deny when clearProjectAbortQuiesce generation is stale', async () => {
    getTempProject.mockResolvedValue(
      baseProject({
        status: 'aborted',
        abortQuiescing: true,
        abortGeneration: 5,
      }),
    );

    await clearProjectAbortQuiesce('proj-1', 4);

    expect(upsertTempProject).not.toHaveBeenCalled();
    expect(releaseOfficeSpawnDenyForOrphanedProjectAbort).not.toHaveBeenCalled();
  });

  it('refuses to start runOfficeProject when store abortQuiescing', async () => {
    getTempProject.mockResolvedValue(
      baseProject({
        status: 'aborted',
        abortQuiescing: true,
        abortGeneration: 1,
      }),
    );
    runTaskWorkflow.mockResolvedValue(undefined);

    const gateway = {
      isConnected: () => true,
      getStatus: () => ({ state: 'running' }),
      rpc: vi.fn().mockResolvedValue({ sessions: [] }),
    } as unknown as GatewayManager;

    await expect(runOfficeProject(gateway, baseProject())).rejects.toMatchObject({
      code: 'PROJECT_ABORT_QUIESCING',
    });
    expect(runTaskWorkflow).not.toHaveBeenCalled();
    expect(releaseOfficeSpawnDenyAfterRun).not.toHaveBeenCalled();
  });

  it('skips spawn deny release in runOfficeProject finally when store turns abortQuiescing mid-run', async () => {
    let afterRunner = false;
    getTempProject.mockImplementation(async () => {
      if (!afterRunner) {
        return baseProject({ status: 'running', abortQuiescing: false });
      }
      return baseProject({
        status: 'aborted',
        abortQuiescing: true,
        abortGeneration: 1,
      });
    });
    runTaskWorkflow.mockImplementation(async () => {
      afterRunner = true;
    });

    const gateway = {
      isConnected: () => true,
      getStatus: () => ({ state: 'running' }),
      rpc: vi.fn().mockResolvedValue({ sessions: [] }),
    } as unknown as GatewayManager;

    await runOfficeProject(gateway, baseProject());

    expect(releaseOfficeSpawnDenyAfterRun).not.toHaveBeenCalled();
  });

  it('installs abort quiesce lock before awaiting persist', async () => {
    let sawLockDuringPersist = false;
    let resolvePersist!: (value: OfficeTempProject) => void;
    const persistGate = new Promise<OfficeTempProject>((resolve) => {
      resolvePersist = resolve;
    });
    abortTaskRun.mockImplementation(async () => {
      sawLockDuringPersist = getAbortQuiesceLock('proj-1')?.generation === 1;
      return persistGate;
    });
    getTempProject.mockResolvedValue(baseProject());

    const gateway = {
      isConnected: () => false,
      rpc: vi.fn(),
    } as unknown as GatewayManager;

    const abortPromise = abortOfficeTaskRun('proj-1', { gateway });
    await vi.waitFor(() => {
      expect(abortTaskRun).toHaveBeenCalled();
    });
    expect(sawLockDuringPersist).toBe(true);
    expect(getAbortQuiesceLock('proj-1')?.generation).toBe(1);

    resolvePersist(
      baseProject({
        status: 'aborted',
        abortQuiescing: true,
        abortGeneration: 1,
        abortQuiesceStartedAt: 10,
      }),
    );
    await abortPromise;
    expect(getAbortQuiesceLock('proj-1')?.generation).toBe(1);
  });
});
