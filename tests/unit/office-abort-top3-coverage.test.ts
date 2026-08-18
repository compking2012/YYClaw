/**
 * Coverage for TOP3 abort hardening:
 * 1) run∩abort ownership (clear permit / claim / barriers)
 * 2) LLM send gate + format-retry abort short-circuit
 * 3) ALS project-dir lock (nested ok, concurrent queued)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayManager } from '@electron/gateway/manager';
import type { OfficeTempProject } from '@electron/services/office/types';

const getTempProject = vi.hoisted(() => vi.fn());
const upsertTempProject = vi.hoisted(() => vi.fn());
const listTempProjects = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const listFixedGroups = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const getRoomMessages = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const appendRoomMessage = vi.hoisted(() => vi.fn(async (msg: unknown) => msg));
const notifyRendererProjectProgressUpdate = vi.hoisted(() => vi.fn());
const prepareOfficeSpawnDenyBeforeRun = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const releaseOfficeSpawnDenyAfterRun = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const releaseOfficeSpawnDenyForOrphanedProjectAbort = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);
const notifyOfficeProjectRunStarted = vi.hoisted(() => vi.fn());
const notifyOfficeProjectRunStopped = vi.hoisted(() => vi.fn());
const isOfficeProjectRunLifecycleActive = vi.hoisted(() => vi.fn(() => false));
const abortTaskRun = vi.hoisted(() => vi.fn());
const runTaskWorkflow = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const runSmartTask = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const abortSmartTaskRun = vi.hoisted(() => vi.fn());

vi.mock('@electron/services/office/store', () => ({
  getTempProject,
  upsertTempProject,
  listTempProjects,
  listFixedGroups,
  getRoomMessages,
  appendRoomMessage,
  notifyRendererProjectProgressUpdate,
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
  runSmartTask,
  abortSmartTaskRun,
}));

vi.mock('@electron/services/office/office-session-new', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@electron/services/office/office-session-new')>();
  return {
    ...actual,
    ensureProjectAgentSessionNew: vi.fn(async () => undefined),
  };
});

vi.mock('@electron/services/office/office-spawn-policy', () => ({
  assertOfficeSpawnRpcDisabled: vi.fn(),
  resolveAgentIdFromOfficeSessionKey: () => 'agent-a',
  withOfficeSpawnToolDeny: async (_agentId: string, fn: () => Promise<unknown>) => fn(),
}));

import {
  claimTaskAbortClear,
  clearTaskUserAborted,
  issueTaskAbortClearPermit,
  isTaskUserAborted,
  markTaskUserAborted,
  resetTaskAbortRegistryForTests,
} from '@electron/services/office/task-run-abort-registry';
import {
  clearAbortQuiesceLock,
  getAbortQuiesceLock,
  isAbortQuiescing,
  resetAbortQuiesceLocksForTests,
} from '@electron/services/office/project-abort-quiesce';
import {
  assertOfficeLlmSendAllowed,
  OfficeLlmSendAbortedError,
  shouldBlockOfficeLlmSend,
} from '@electron/services/office/office-llm-send-guard';
import {
  clearProjectAbortQuiesce,
  installAbortQuiesceLock,
} from '@electron/services/office/project-gateway-abort';
import { abortOfficeTaskRun, runOfficeProject } from '@electron/services/office/task-run';
import { callAgentMessage } from '@electron/services/office/gateway-rpc';
import { shouldBlockOfficeProgressWriteDuringAbort } from '@/lib/office-workflow-abort';

function project(partial: Partial<OfficeTempProject> = {}): OfficeTempProject {
  return {
    id: 'proj-1',
    title: 't',
    status: 'running',
    lifecycle: 'active',
    agentIds: ['a1'],
    nodeRuns: [{ nodeId: 'n1', agentId: 'a1', status: 'running' }],
    workflow: { mode: 'simple', nodes: [], edges: [] },
    executionMode: 'workflow',
    createdAt: 1,
    updatedAt: 1,
    ...partial,
  } as OfficeTempProject;
}

describe('TOP3-1 run∩abort ownership', () => {
  beforeEach(() => {
    resetTaskAbortRegistryForTests();
    resetAbortQuiesceLocksForTests();
    vi.clearAllMocks();
    prepareOfficeSpawnDenyBeforeRun.mockReset().mockResolvedValue(undefined);
    releaseOfficeSpawnDenyAfterRun.mockReset().mockResolvedValue(undefined);
    runTaskWorkflow.mockReset().mockResolvedValue(undefined);
    runSmartTask.mockReset().mockResolvedValue(undefined);
    getTempProject.mockImplementation(async (id: string) => project({ id }));
    upsertTempProject.mockImplementation(async (p: OfficeTempProject) => p);
    abortTaskRun.mockImplementation(async (id: string, options?: { abortQuiesce?: unknown }) =>
      project({
        id,
        status: 'aborted',
        abortQuiescing: Boolean(options?.abortQuiesce),
        abortGeneration: 1,
      }),
    );
  });

  afterEach(() => {
    resetTaskAbortRegistryForTests();
    resetAbortQuiesceLocksForTests();
  });

  it('claimTaskAbortClear clears residual and refuses while quiescing (main)', () => {
    const idle = claimTaskAbortClear('p1');
    expect(idle.permit).toBe(0);
    expect(idle.cleared).toBe(true);

    markTaskUserAborted('p1');
    const residual = claimTaskAbortClear('p1');
    expect(residual.permit).toBe(1);
    expect(residual.cleared).toBe(true);
    expect(isTaskUserAborted('p1')).toBe(false);

    markTaskUserAborted('p1');
    installAbortQuiesceLock({
      projectId: 'p1',
      generation: 1,
      startedAt: 1,
      staticSessionKeys: [],
      inflightSessionKeys: [],
    });
    const whileQuiescing = claimTaskAbortClear('p1');
    expect(whileQuiescing.cleared).toBe(false);
    expect(isTaskUserAborted('p1')).toBe(true);

    clearAbortQuiesceLock('p1', 1);
    const permitOnly = issueTaskAbortClearPermit('p1');
    markTaskUserAborted('p1'); // bump — stale permit
    expect(clearTaskUserAborted('p1', { onlyIfAbortSeq: permitOnly })).toBe(false);
    expect(isTaskUserAborted('p1')).toBe(true);
  });

  it('runOfficeProject aborts start when memory lock appears after prepare (branch)', async () => {
    let prepareCalls = 0;
    prepareOfficeSpawnDenyBeforeRun.mockImplementation(async () => {
      prepareCalls += 1;
      installAbortQuiesceLock({
        projectId: 'proj-1',
        generation: 9,
        startedAt: 1,
        staticSessionKeys: [],
        inflightSessionKeys: [],
      });
      markTaskUserAborted('proj-1');
    });

    const gateway = {
      isConnected: () => true,
      getStatus: () => ({ state: 'running' }),
    } as unknown as GatewayManager;

    await expect(runOfficeProject(gateway, project())).rejects.toMatchObject({
      code: 'PROJECT_ABORT_QUIESCING',
    });
    expect(prepareCalls).toBe(1);
    expect(runTaskWorkflow).not.toHaveBeenCalled();
    expect(notifyOfficeProjectRunStarted).not.toHaveBeenCalled();
  });

  it('runOfficeProject passes abortClearPermit into workflow runner (main)', async () => {
    const gateway = {
      isConnected: () => true,
      getStatus: () => ({ state: 'running' }),
    } as unknown as GatewayManager;

    await runOfficeProject(gateway, project());

    expect(runTaskWorkflow).toHaveBeenCalledWith(
      gateway,
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ abortClearPermit: expect.any(Number) }),
    );
  });

  it('runOfficeProject clears residual userAborted then starts (branch)', async () => {
    markTaskUserAborted('proj-1');
    const gateway = {
      isConnected: () => true,
      getStatus: () => ({ state: 'running' }),
    } as unknown as GatewayManager;

    await runOfficeProject(gateway, project());

    expect(isTaskUserAborted('proj-1')).toBe(false);
    expect(runTaskWorkflow).toHaveBeenCalled();
  });

  it('runOfficeProject refuses start when quiesce lock held with userAborted (branch)', async () => {
    markTaskUserAborted('proj-1');
    installAbortQuiesceLock({
      projectId: 'proj-1',
      generation: 1,
      startedAt: 1,
      staticSessionKeys: [],
      inflightSessionKeys: [],
    });
    const gateway = {
      isConnected: () => true,
      getStatus: () => ({ state: 'running' }),
    } as unknown as GatewayManager;

    await expect(runOfficeProject(gateway, project())).rejects.toMatchObject({
      code: 'PROJECT_ABORT_QUIESCING',
    });
    expect(runTaskWorkflow).not.toHaveBeenCalled();
    expect(isTaskUserAborted('proj-1')).toBe(true);
  });

  it('claim between barriers clears residual userAborted without quiesce (branch)', async () => {
    markTaskUserAborted('proj-residual');
    expect(isTaskUserAborted('proj-residual')).toBe(true);
    const { permit, cleared } = claimTaskAbortClear('proj-residual');
    expect(cleared).toBe(true);
    expect(isTaskUserAborted('proj-residual')).toBe(false);
    expect(permit).toBeGreaterThanOrEqual(1);
  });

  it('stale runner clear cannot wipe abort that raced after permit issued (branch)', async () => {
    const gateway = {
      isConnected: () => true,
      getStatus: () => ({ state: 'running' }),
    } as unknown as GatewayManager;

    runTaskWorkflow.mockImplementation(async (_gw, _g, _p, opts) => {
      // Simulate abort winning after run claimed but before runner clear.
      markTaskUserAborted('proj-1');
      installAbortQuiesceLock({
        projectId: 'proj-1',
        generation: 3,
        startedAt: Date.now(),
        staticSessionKeys: [],
        inflightSessionKeys: [],
      });
      const cleared = clearTaskUserAborted('proj-1', {
        onlyIfAbortSeq: opts?.abortClearPermit,
      });
      expect(cleared).toBe(false);
      expect(isTaskUserAborted('proj-1')).toBe(true);
      expect(shouldBlockOfficeLlmSend('proj-1')).toBe(true);
    });

    await runOfficeProject(gateway, project());
    expect(isTaskUserAborted('proj-1')).toBe(true);
  });

  it('progress write guard blocks completed overwrite while aborting (branch)', () => {
    expect(
      shouldBlockOfficeProgressWriteDuringAbort({
        before: { status: 'aborted', abortQuiescing: true },
        next: {
          status: 'completed',
          abortQuiescing: false,
          nodeRuns: [{ nodeId: 'n1', agentId: 'a1', status: 'completed' }],
        },
        userAborted: true,
        memoryQuiescing: true,
      }),
    ).toBe(true);

    expect(
      shouldBlockOfficeProgressWriteDuringAbort({
        before: { status: 'aborted', abortQuiescing: true },
        next: {
          status: 'aborted',
          abortQuiescing: true,
          nodeRuns: [{ nodeId: 'n1', agentId: 'a1', status: 'failed' }],
        },
        userAborted: true,
        memoryQuiescing: true,
      }),
    ).toBe(false);

    // Settle may leave pending nodes; aborted terminal write must still land.
    expect(
      shouldBlockOfficeProgressWriteDuringAbort({
        before: { status: 'running', abortQuiescing: true },
        next: {
          status: 'aborted',
          abortQuiescing: true,
          nodeRuns: [
            { nodeId: 'n1', agentId: 'a1', status: 'failed' },
            { nodeId: 'n2', agentId: 'a2', status: 'pending' },
          ],
        },
        userAborted: true,
        memoryQuiescing: true,
      }),
    ).toBe(false);
  });

  it('progress write guard blocks aborted→failed after quiesce cleared (14:14 red-light)', () => {
    expect(
      shouldBlockOfficeProgressWriteDuringAbort({
        before: { status: 'aborted', abortQuiescing: false },
        next: {
          status: 'failed',
          abortQuiescing: false,
          nodeRuns: [
            { nodeId: 'n1', agentId: 'a1', status: 'failed' },
            { nodeId: 'n2', agentId: 'a2', status: 'pending' },
          ],
        },
        userAborted: false,
        memoryQuiescing: false,
      }),
    ).toBe(true);
  });
});

describe('TOP3-2 LLM send gate + retry abort', () => {
  beforeEach(() => {
    resetTaskAbortRegistryForTests();
    resetAbortQuiesceLocksForTests();
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetTaskAbortRegistryForTests();
    resetAbortQuiesceLocksForTests();
  });

  it('callAgentMessage rejects when user-aborted before ensure (main)', async () => {
    markTaskUserAborted('proj-send');
    const gateway = {
      rpc: vi.fn().mockResolvedValue({ runId: 'r1' }),
    } as unknown as GatewayManager;

    await expect(
      callAgentMessage(gateway, 'agent:a:task-room:proj-send', 'hi', 'idem', {
        projectId: 'proj-send',
      }),
    ).rejects.toBeInstanceOf(OfficeLlmSendAbortedError);
    expect(gateway.rpc).not.toHaveBeenCalled();
  });

  it('callAgentMessage rejects when abort starts during session-new await (branch)', async () => {
    const sessionNew = await import('@electron/services/office/office-session-new');
    vi.mocked(sessionNew.ensureProjectAgentSessionNew).mockImplementation(async () => {
      markTaskUserAborted('proj-mid');
      installAbortQuiesceLock({
        projectId: 'proj-mid',
        generation: 1,
        startedAt: 1,
        staticSessionKeys: [],
        inflightSessionKeys: [],
      });
    });

    const gateway = {
      rpc: vi.fn().mockResolvedValue({ runId: 'r2' }),
    } as unknown as GatewayManager;

    await expect(
      callAgentMessage(gateway, 'agent:a:task-room:proj-mid', 'hi', 'idem', {
        projectId: 'proj-mid',
      }),
    ).rejects.toBeInstanceOf(OfficeLlmSendAbortedError);
    expect(gateway.rpc).not.toHaveBeenCalled();

    vi.mocked(sessionNew.ensureProjectAgentSessionNew).mockImplementation(async () => undefined);
  });

  it('callAgentMessage infers projectId from office session key when omitted (branch)', async () => {
    markTaskUserAborted('inferred-proj');
    const gateway = {
      rpc: vi.fn().mockResolvedValue({ runId: 'r3' }),
    } as unknown as GatewayManager;

    await expect(
      callAgentMessage(
        gateway,
        'agent:a:office:task-room:inferred-proj',
        'hi',
        'idem-inferred',
      ),
    ).rejects.toBeInstanceOf(OfficeLlmSendAbortedError);
    expect(gateway.rpc).not.toHaveBeenCalled();
  });

  it('shouldBlockOfficeLlmSend covers userAborted and quiesce independently (branch)', () => {
    expect(shouldBlockOfficeLlmSend('')).toBe(false);
    expect(shouldBlockOfficeLlmSend(undefined)).toBe(false);
    expect(() => assertOfficeLlmSendAllowed(undefined)).not.toThrow();

    markTaskUserAborted('p-a');
    expect(shouldBlockOfficeLlmSend('p-a')).toBe(true);
    clearTaskUserAborted('p-a');

    installAbortQuiesceLock({
      projectId: 'p-q',
      generation: 1,
      startedAt: 1,
      staticSessionKeys: [],
      inflightSessionKeys: [],
    });
    expect(shouldBlockOfficeLlmSend('p-q')).toBe(true);
    expect(isAbortQuiescing('p-q')).toBe(true);
  });

  it('clearProjectAbortQuiesce keeps memory lock until disk persist finishes (main)', async () => {
    installAbortQuiesceLock({
      projectId: 'proj-1',
      generation: 2,
      startedAt: 10,
      staticSessionKeys: [],
      inflightSessionKeys: [],
    });
    markTaskUserAborted('proj-1');

    let resolvePersist!: (v: OfficeTempProject) => void;
    const persistGate = new Promise<OfficeTempProject>((r) => {
      resolvePersist = r;
    });

    getTempProject.mockResolvedValue(
      project({
        status: 'aborted',
        abortQuiescing: true,
        abortGeneration: 2,
      }),
    );
    upsertTempProject.mockImplementation(async () => persistGate);

    const clearPromise = clearProjectAbortQuiesce('proj-1', 2);
    // While disk persist is in-flight, memory lock must still block sends.
    await Promise.resolve();
    expect(getAbortQuiesceLock('proj-1')?.generation).toBe(2);
    expect(shouldBlockOfficeLlmSend('proj-1')).toBe(true);

    resolvePersist(
      project({
        status: 'aborted',
        abortQuiescing: false,
        abortGeneration: 2,
      }),
    );
    await clearPromise;
    expect(getAbortQuiesceLock('proj-1')).toBeUndefined();
    // Quiesce clear drops userAborted so post-abort edits / re-run LLM are unblocked.
    expect(isTaskUserAborted('proj-1')).toBe(false);
    expect(shouldBlockOfficeLlmSend('proj-1')).toBe(false);
  });
});

describe('TOP3-3 ALS project dir lock', () => {
  it('allows nested re-entry and queues external concurrent callers (main+branch)', async () => {
    vi.resetModules();
    const { withOfficeProjectDirLock, resetOfficeProjectDirLocksForTests } = await import(
      '@electron/services/office/office-project-dir-lock'
    );
    resetOfficeProjectDirLocksForTests();

    const order: string[] = [];
    let releaseA!: () => void;
    const holdA = new Promise<void>((r) => {
      releaseA = r;
    });
    let enteredA!: () => void;
    const aEntered = new Promise<void>((r) => {
      enteredA = r;
    });

    const a = withOfficeProjectDirLock('dir-1', async () => {
      order.push('a-enter');
      enteredA();
      await withOfficeProjectDirLock('dir-1', async () => {
        order.push('a-nested');
      });
      await holdA;
      order.push('a-exit');
    });

    await aEntered;
    const b = withOfficeProjectDirLock('dir-1', async () => {
      order.push('b');
    });
    const c = withOfficeProjectDirLock('dir-other', async () => {
      order.push('c-other');
    });

    await new Promise((r) => setTimeout(r, 20));
    // B must wait; other project id may proceed.
    expect(order).toContain('a-enter');
    expect(order).toContain('a-nested');
    expect(order).not.toContain('b');
    expect(order).toContain('c-other');

    releaseA();
    await Promise.all([a, b, c]);
    expect(order.indexOf('a-exit')).toBeLessThan(order.indexOf('b'));
  });

  it('empty projectId bypasses lock (branch)', async () => {
    const { withOfficeProjectDirLock } = await import(
      '@electron/services/office/office-project-dir-lock'
    );
    const result = await withOfficeProjectDirLock('  ', async () => 'ok');
    expect(result).toBe('ok');
  });
});

describe('TOP3 abortOfficeTaskRun installs lock before persist (regression)', () => {
  beforeEach(() => {
    resetTaskAbortRegistryForTests();
    resetAbortQuiesceLocksForTests();
    vi.clearAllMocks();
    getTempProject.mockResolvedValue(project());
    upsertTempProject.mockImplementation(async (p: OfficeTempProject) => p);
  });

  it('send is blocked as soon as lock is installed during abort persist (branch)', async () => {
    let resolvePersist!: (v: OfficeTempProject) => void;
    const persistGate = new Promise<OfficeTempProject>((r) => {
      resolvePersist = r;
    });
    abortTaskRun.mockImplementation(async () => {
      expect(isAbortQuiescing('proj-1')).toBe(true);
      expect(shouldBlockOfficeLlmSend('proj-1')).toBe(true);
      return persistGate;
    });

    const gateway = {
      isConnected: () => false,
      rpc: vi.fn(),
    } as unknown as GatewayManager;

    const abortPromise = abortOfficeTaskRun('proj-1', { gateway, markUserAborted: true });
    await vi.waitFor(() => expect(abortTaskRun).toHaveBeenCalled());

    await expect(
      callAgentMessage(gateway, 'agent:a:task-room:proj-1', 'x', 'idem', {
        projectId: 'proj-1',
      }),
    ).rejects.toBeInstanceOf(OfficeLlmSendAbortedError);

    resolvePersist(
      project({
        status: 'aborted',
        abortQuiescing: true,
        abortGeneration: 1,
      }),
    );
    await abortPromise;
    clearAbortQuiesceLock('proj-1');
  });
});
