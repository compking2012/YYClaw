import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayManager } from '@electron/gateway/manager';
import type { OfficeTempProject } from '@electron/services/office/types';

const prepareOfficeSpawnDenyBeforeRun = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const releaseOfficeSpawnDenyAfterRun = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const notifyOfficeProjectRunStarted = vi.hoisted(() => vi.fn());
const notifyOfficeProjectRunStopped = vi.hoisted(() => vi.fn());
const isOfficeProjectRunLifecycleActive = vi.hoisted(() => vi.fn(() => false));
const runTaskWorkflow = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const runSmartTask = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@electron/services/office/office-spawn-policy-reconcile', () => ({
  prepareOfficeSpawnDenyBeforeRun,
  releaseOfficeSpawnDenyAfterRun,
}));

vi.mock('@electron/services/office/office-sync-runtime', () => ({
  notifyOfficeProjectRunStarted,
  notifyOfficeProjectRunStopped,
  isOfficeProjectRunLifecycleActive,
}));

vi.mock('@electron/services/office/smart-task-runner', () => ({
  runSmartTask,
  abortSmartTaskRun: vi.fn(),
}));

vi.mock('@electron/services/office/workflow-runner', () => ({
  runTaskWorkflow,
  abortTaskRun: vi.fn(),
}));

import { runOfficeProject } from '@electron/services/office/task-run';

function workflowProject(): OfficeTempProject {
  return {
    id: 'proj-wf',
    title: 'Workflow',
    status: 'pending',
    lifecycle: 'active',
    executionMode: 'workflow',
    agentIds: ['dev'],
    nodeRuns: [],
    workflow: { mode: 'simple', nodes: [], edges: [] },
    createdAt: 1,
    updatedAt: 1,
  } as OfficeTempProject;
}

function smartProject(): OfficeTempProject {
  return {
    ...workflowProject(),
    id: 'proj-smart',
    executionMode: 'smart',
  } as OfficeTempProject;
}

function runningGateway(): GatewayManager {
  return {
    getStatus: () => ({ state: 'running' }),
    isConnected: () => true,
  } as GatewayManager;
}

describe('runOfficeProject spawn policy ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('awaits prepare before notifyOfficeProjectRunStarted for workflow runs', async () => {
    const order: string[] = [];
    prepareOfficeSpawnDenyBeforeRun.mockImplementation(async () => {
      order.push('prepare');
    });
    notifyOfficeProjectRunStarted.mockImplementation(() => {
      order.push('notify-start');
    });
    runTaskWorkflow.mockImplementation(async () => {
      order.push('workflow');
    });
    releaseOfficeSpawnDenyAfterRun.mockImplementation(async () => {
      order.push('release');
    });
    notifyOfficeProjectRunStopped.mockImplementation(() => {
      order.push('notify-stop');
    });

    await runOfficeProject(runningGateway(), workflowProject());

    expect(order).toEqual(['prepare', 'notify-start', 'workflow', 'notify-stop', 'release']);
  });

  it('does not release spawn deny while another runOfficeProject lifecycle is still active', async () => {
    isOfficeProjectRunLifecycleActive.mockReturnValue(true);

    await runOfficeProject(runningGateway(), workflowProject());

    expect(notifyOfficeProjectRunStopped).toHaveBeenCalledWith('proj-wf');
    expect(releaseOfficeSpawnDenyAfterRun).not.toHaveBeenCalled();
  });

  it('does not release spawn deny while abort quiescing after run body', async () => {
    const { setAbortQuiesceLock, resetAbortQuiesceLocksForTests } = await import(
      '@electron/services/office/project-abort-quiesce'
    );
    resetAbortQuiesceLocksForTests();
    runTaskWorkflow.mockImplementation(async () => {
      setAbortQuiesceLock({
        projectId: 'proj-wf',
        generation: 1,
        startedAt: 1,
        staticSessionKeys: [],
        inflightSessionKeys: [],
        abortWork: Promise.resolve(),
      });
    });

    await runOfficeProject(runningGateway(), workflowProject());

    expect(releaseOfficeSpawnDenyAfterRun).not.toHaveBeenCalled();
    resetAbortQuiesceLocksForTests();
  });

  it('defers workflow-style release for smart runs until endSmartTaskRun path', async () => {
    const order: string[] = [];
    prepareOfficeSpawnDenyBeforeRun.mockImplementation(async () => {
      order.push('prepare');
    });
    notifyOfficeProjectRunStarted.mockImplementation(() => {
      order.push('notify-start');
    });
    runSmartTask.mockImplementation(async () => {
      order.push('smart');
    });
    releaseOfficeSpawnDenyAfterRun.mockImplementation(async () => {
      order.push('release');
    });
    notifyOfficeProjectRunStopped.mockImplementation(() => {
      order.push('notify-stop');
    });

    await runOfficeProject(runningGateway(), smartProject());

    expect(order).toEqual(['prepare', 'notify-start', 'smart']);
    expect(releaseOfficeSpawnDenyAfterRun).not.toHaveBeenCalled();
    expect(notifyOfficeProjectRunStopped).not.toHaveBeenCalled();
  });
});
