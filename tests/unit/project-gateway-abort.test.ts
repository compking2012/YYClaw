import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayManager } from '@electron/gateway/manager';
import type { OfficeTempProject } from '@electron/services/office/types';
import {
  getAbortQuiesceLock,
  resetAbortQuiesceLocksForTests,
  setAbortQuiesceLock,
} from '@electron/services/office/project-abort-quiesce';
import {
  resetOfficeInflightLlmRegistryForTests,
  registerOfficeInflightLlm,
} from '@electron/services/office/office-inflight-llm-registry';
import {
  ABORT_CONFIRM_DELAY_MS,
  abortProjectGatewaySessions,
  beginAbortQuiesceAndScheduleGateway,
  clearProjectAbortQuiesce,
  collectSyncAbortSessionKeys,
  listActiveGatewaySessionKeysForProject,
  reconcileAbortQuiescingProjectsOnGatewayReady,
  sessionKeyMatchesProject,
} from '@electron/services/office/project-gateway-abort';

const upsertTempProject = vi.hoisted(() => vi.fn());
const getTempProject = vi.hoisted(() => vi.fn());
const listTempProjects = vi.hoisted(() => vi.fn());
const releaseOfficeSpawnDenyForOrphanedProjectAbort = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

vi.mock('@electron/services/office/store', () => ({
  upsertTempProject,
  getTempProject,
  listTempProjects,
  notifyRendererProjectProgressUpdate: vi.fn(),
}));

vi.mock('@electron/services/office/office-spawn-policy-reconcile', () => ({
  releaseOfficeSpawnDenyForOrphanedProjectAbort,
}));

function project(partial: Partial<OfficeTempProject> = {}): OfficeTempProject {
  return {
    id: 'proj-1',
    title: 't',
    status: 'aborted',
    lifecycle: 'active',
    agentIds: ['a1'],
    nodeRuns: [],
    workflow: { mode: 'simple', nodes: [], edges: [] },
    createdAt: 1,
    updatedAt: 1,
    abortQuiescing: true,
    abortGeneration: 1,
    abortQuiesceStartedAt: 10,
    ...partial,
  } as OfficeTempProject;
}

describe('sessionKeyMatchesProject', () => {
  it('avoids prefix collisions between project-1 and project-10', () => {
    expect(sessionKeyMatchesProject('agent:a1:task-room:project-1', 'project-1')).toBe(true);
    expect(sessionKeyMatchesProject('agent:a1:task-room:project-10', 'project-1')).toBe(false);
    expect(sessionKeyMatchesProject('agent:a1:task:project-1:role:dev', 'project-1')).toBe(true);
  });
});

describe('collectSyncAbortSessionKeys', () => {
  beforeEach(() => {
    resetOfficeInflightLlmRegistryForTests();
  });

  it('takes inflight keys and running/pending node sessionKeys', () => {
    registerOfficeInflightLlm({
      projectId: 'proj-1',
      sessionKey: 'agent:a1:task-room:proj-1',
    });
    const keys = collectSyncAbortSessionKeys({
      id: 'proj-1',
      nodeRuns: [
        { nodeId: 'n1', agentId: 'a1', status: 'running', sessionKey: 'agent:a1:task:proj-1:role:x' },
        { nodeId: 'n2', agentId: 'a2', status: 'completed', sessionKey: 'agent:a2:task:proj-1:role:y' },
        { nodeId: 'n3', agentId: 'a3', status: 'pending' },
      ],
    });
    expect(keys.inflightSessionKeys).toEqual(['agent:a1:task-room:proj-1']);
    expect(keys.staticSessionKeys).toEqual(['agent:a1:task:proj-1:role:x']);
    expect(collectSyncAbortSessionKeys({ id: 'proj-1', nodeRuns: [] }).inflightSessionKeys).toEqual([]);
  });
});

describe('abortProjectGatewaySessions + quiesce clear', () => {
  beforeEach(() => {
    resetAbortQuiesceLocksForTests();
    resetOfficeInflightLlmRegistryForTests();
    vi.clearAllMocks();
    vi.useFakeTimers();
    getTempProject.mockImplementation(async (id: string) => project({ id }));
    upsertTempProject.mockImplementation(async (p: OfficeTempProject) => p);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts keysHint then clears quiesce when list reports idle', async () => {
    const rpc = vi.fn().mockImplementation(async (method: string) => {
      if (method === 'chat.abort') return {};
      if (method === 'sessions.list') return { sessions: [] };
      throw new Error(`unexpected ${method}`);
    });
    const gateway = {
      isConnected: () => true,
      rpc,
    } as unknown as GatewayManager;

    beginAbortQuiesceAndScheduleGateway({
      gateway,
      projectId: 'proj-1',
      generation: 1,
      keysHint: ['agent:a1:task-room:proj-1'],
      startedAt: 10,
      staticSessionKeys: ['agent:a1:task-room:proj-1'],
      inflightSessionKeys: [],
    });
    expect(getAbortQuiesceLock('proj-1')?.generation).toBe(1);

    const lock = getAbortQuiesceLock('proj-1');
    expect(lock).toBeDefined();
    await lock!.abortWork;

    expect(rpc).toHaveBeenCalledWith(
      'chat.abort',
      { sessionKey: 'agent:a1:task-room:proj-1' },
      expect.any(Number),
    );
    expect(getAbortQuiesceLock('proj-1')).toBeUndefined();
    expect(upsertTempProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'proj-1', abortQuiescing: false }),
    );
    expect(releaseOfficeSpawnDenyForOrphanedProjectAbort).toHaveBeenCalledWith('proj-1');
  });

  it('keeps quiescing when sessions.list fails (drain continues, does not clear)', async () => {
    const rpc = vi.fn().mockImplementation(async (method: string) => {
      if (method === 'chat.abort') return {};
      if (method === 'sessions.list') throw new Error('list down');
      throw new Error(`unexpected ${method}`);
    });
    const gateway = {
      isConnected: () => true,
      rpc,
    } as unknown as GatewayManager;

    beginAbortQuiesceAndScheduleGateway({
      gateway,
      projectId: 'proj-1',
      generation: 1,
      keysHint: ['k1'],
      startedAt: 1,
      staticSessionKeys: ['k1'],
      inflightSessionKeys: [],
    });
    // Finish first confirm window + one outer retry tick; still must not clear.
    await vi.advanceTimersByTimeAsync(ABORT_CONFIRM_DELAY_MS * 3);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(getAbortQuiesceLock('proj-1')).toBeDefined();
    expect(upsertTempProject).not.toHaveBeenCalledWith(
      expect.objectContaining({ abortQuiescing: false }),
    );
    // Stop the drain so the test can exit (disconnect → schedule returns).
    (gateway as { isConnected: () => boolean }).isConnected = () => false;
    await vi.advanceTimersByTimeAsync(1_000);
    await getAbortQuiesceLock('proj-1')?.abortWork;
    expect(getAbortQuiesceLock('proj-1')).toBeDefined();
  });

  it('aborts active listed sessions and confirms idle after delay', async () => {
    let listRound = 0;
    const rpc = vi.fn().mockImplementation(async (method: string) => {
      if (method === 'chat.abort') return {};
      if (method === 'sessions.list') {
        listRound += 1;
        if (listRound === 1) {
          return {
            sessions: [
              { key: 'agent:a1:task-room:proj-1', hasActiveRun: true },
              { key: 'agent:a1:task-room:proj-10', hasActiveRun: true },
            ],
          };
        }
        return { sessions: [] };
      }
      throw new Error(`unexpected ${method}`);
    });
    const gateway = {
      isConnected: () => true,
      rpc,
    } as unknown as GatewayManager;

    const resultPromise = abortProjectGatewaySessions(gateway, 'proj-1', []);
    await vi.advanceTimersByTimeAsync(ABORT_CONFIRM_DELAY_MS);
    const result = await resultPromise;
    expect(result.confirmedIdle).toBe(true);
    expect(rpc).toHaveBeenCalledWith(
      'chat.abort',
      { sessionKey: 'agent:a1:task-room:proj-1' },
      expect.any(Number),
    );
    expect(rpc).not.toHaveBeenCalledWith(
      'chat.abort',
      { sessionKey: 'agent:a1:task-room:proj-10' },
      expect.any(Number),
    );
  });

  it('clearProjectAbortQuiesce ignores stale generation', async () => {
    setAbortQuiesceLock({
      projectId: 'proj-1',
      generation: 3,
      startedAt: 1,
      staticSessionKeys: [],
      inflightSessionKeys: [],
      abortWork: Promise.resolve(),
    });
    await clearProjectAbortQuiesce('proj-1', 2);
    expect(getAbortQuiesceLock('proj-1')?.generation).toBe(3);
    expect(upsertTempProject).not.toHaveBeenCalled();
  });

  it('reconcileAbortQuiescingProjectsOnGatewayReady clears idle projects without lock', async () => {
    const stuck = project({ id: 'proj-1', abortGeneration: 4 });
    listTempProjects.mockResolvedValue([stuck]);
    getTempProject.mockResolvedValue(stuck);
    const rpc = vi.fn().mockResolvedValue({ sessions: [] });
    const gateway = {
      isConnected: () => true,
      rpc,
    } as unknown as GatewayManager;

    await reconcileAbortQuiescingProjectsOnGatewayReady(gateway);
    expect(upsertTempProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'proj-1', abortQuiescing: false }),
    );
  });

  it('listActiveGatewaySessionKeysForProject only returns hasActiveRun matching keys', async () => {
    const gateway = {
      isConnected: () => true,
      rpc: vi.fn().mockResolvedValue({
        sessions: [
          { key: 'agent:a1:task-room:proj-1', hasActiveRun: true },
          // Stale status=running after abort must NOT keep quiesce locked.
          { key: 'agent:a1:task-room:proj-1-stale', status: 'running' },
          { key: 'agent:a1:task-room:proj-1-idle', status: 'idle', hasActiveRun: false },
          { key: 'agent:a1:task-room:other', hasActiveRun: true },
        ],
      }),
    } as unknown as GatewayManager;
    const listed = await listActiveGatewaySessionKeysForProject(gateway, 'proj-1');
    expect(listed.listSucceeded).toBe(true);
    expect(listed.keys).toEqual(['agent:a1:task-room:proj-1']);
  });

  it('clears quiesce when only stale status=running remains after abort', async () => {
    const rpc = vi.fn().mockImplementation(async (method: string) => {
      if (method === 'chat.abort') return {};
      if (method === 'sessions.list') {
        return {
          sessions: [
            { key: 'agent:a1:task-room:proj-1', status: 'running', hasActiveRun: false },
          ],
        };
      }
      throw new Error(`unexpected ${method}`);
    });
    const gateway = {
      isConnected: () => true,
      rpc,
    } as unknown as GatewayManager;

    beginAbortQuiesceAndScheduleGateway({
      gateway,
      projectId: 'proj-1',
      generation: 1,
      keysHint: ['agent:a1:task-room:proj-1'],
      startedAt: 10,
      staticSessionKeys: ['agent:a1:task-room:proj-1'],
      inflightSessionKeys: [],
    });
    await getAbortQuiesceLock('proj-1')!.abortWork;
    expect(getAbortQuiesceLock('proj-1')).toBeUndefined();
    expect(upsertTempProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'proj-1', abortQuiescing: false }),
    );
  });
});
