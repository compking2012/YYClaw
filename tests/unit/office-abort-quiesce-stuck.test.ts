/**
 * Repro: after user abort, UI stays on abortQuiescing ("Stopping model…") forever
 * when Gateway sessions remain active past the single-shot confirm window, and/or
 * Smart format-retry re-fires LLM after chat.abort.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GatewayManager } from '@electron/gateway/manager';
import type { OfficeTempProject } from '@electron/services/office/types';
import {
  getAbortQuiesceLock,
  isAbortQuiescing,
  clearAbortQuiesceLock,
  resetAbortQuiesceLocksForTests,
} from '@electron/services/office/project-abort-quiesce';
import {
  clearTaskUserAborted,
  markTaskUserAborted,
  isTaskUserAborted,
} from '@electron/services/office/task-run-abort-registry';

const upsertTempProject = vi.hoisted(() => vi.fn());
const getTempProject = vi.hoisted(() => vi.fn());
const listTempProjects = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const listFixedGroups = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const getRoomMessages = vi.hoisted(() => vi.fn().mockResolvedValue([]));
const appendRoomMessage = vi.hoisted(() => vi.fn(async (msg: unknown) => msg));
const releaseOfficeSpawnDenyForOrphanedProjectAbort = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);
const abortTaskRun = vi.hoisted(() => vi.fn());
const abortSmartTaskRun = vi.hoisted(() => vi.fn());

vi.mock('@electron/services/office/store', () => ({
  upsertTempProject,
  getTempProject,
  listTempProjects,
  listFixedGroups,
  getRoomMessages,
  appendRoomMessage,
  notifyRendererProjectProgressUpdate: vi.fn(),
}));

vi.mock('@electron/services/office/office-spawn-policy-reconcile', () => ({
  releaseOfficeSpawnDenyForOrphanedProjectAbort,
  prepareOfficeSpawnDenyBeforeRun: vi.fn(),
  releaseOfficeSpawnDenyAfterRun: vi.fn(),
}));

vi.mock('@electron/services/office/workflow-runner', () => ({
  runTaskWorkflow: vi.fn(),
  abortTaskRun,
}));

vi.mock('@electron/services/office/smart-task-runner', () => ({
  runSmartTask: vi.fn(),
  abortSmartTaskRun,
}));

vi.mock('@electron/services/office/office-sync-runtime', () => ({
  notifyOfficeProjectRunStarted: vi.fn(),
  notifyOfficeProjectRunStopped: vi.fn(),
  isOfficeProjectRunLifecycleActive: vi.fn(() => false),
}));

import {
  ABORT_QUIESCE_RETRY_DELAY_MS,
  beginAbortQuiesceAndScheduleGateway,
} from '@electron/services/office/project-gateway-abort';
import { abortOfficeTaskRun, resetUserAbortRoomTerminalClaimsForTests } from '@electron/services/office/task-run';
import { shouldStopRoomMentionLlmForProjectAbort } from '@electron/services/office/room-mention-llm';

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

describe('abort quiesce stuck forever (repro → fix)', () => {
  beforeEach(() => {
    resetAbortQuiesceLocksForTests();
    resetUserAbortRoomTerminalClaimsForTests();
    clearTaskUserAborted('proj-1');
    vi.clearAllMocks();
    vi.useFakeTimers();
    getTempProject.mockImplementation(async (id: string) => project({ id }));
    upsertTempProject.mockImplementation(async (p: OfficeTempProject) => p);
    abortTaskRun.mockImplementation(async (id: string, options?: { abortQuiesce?: unknown }) =>
      project({
        id,
        abortQuiescing: Boolean(options?.abortQuiesce),
        abortGeneration: 1,
        status: 'aborted',
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('repro/fix: keeps draining until sessions.list becomes idle (not single-shot give-up)', async () => {
    let listRound = 0;
    const rpc = vi.fn().mockImplementation(async (method: string) => {
      if (method === 'chat.abort') return {};
      if (method === 'sessions.list') {
        listRound += 1;
        // Stay active through first confirm window (ABORT_CONFIRM_MAX≈2 + final),
        // then become idle on later outer-loop rounds.
        if (listRound <= 6) {
          return {
            sessions: [{ key: 'agent:a1:task-room:proj-1', hasActiveRun: true, status: 'running' }],
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

    beginAbortQuiesceAndScheduleGateway({
      gateway,
      projectId: 'proj-1',
      generation: 1,
      keysHint: ['agent:a1:task-room:proj-1'],
      startedAt: 10,
      staticSessionKeys: ['agent:a1:task-room:proj-1'],
      inflightSessionKeys: [],
    });

    const lock = getAbortQuiesceLock('proj-1');
    expect(lock).toBeDefined();

    // Advance past several outer drain retries.
    for (let i = 0; i < 12; i++) {
      await vi.advanceTimersByTimeAsync(ABORT_QUIESCE_RETRY_DELAY_MS);
    }
    await lock!.abortWork;

    expect(getAbortQuiesceLock('proj-1')).toBeUndefined();
    expect(upsertTempProject).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'proj-1', abortQuiescing: false }),
    );
  });

  it('user abort posts exactly one room terminal "用户中止项目运行"', async () => {
    getTempProject.mockResolvedValueOnce(
      project({
        status: 'running',
        abortQuiescing: false,
        abortGeneration: undefined,
        nodeRuns: [{ nodeId: 'n1', agentId: 'a1', status: 'running' }],
      }),
    );
    const rpc = vi.fn().mockImplementation(async (method: string) => {
      if (method === 'chat.abort') return {};
      if (method === 'sessions.list') return { sessions: [] };
      throw new Error(`unexpected ${method}`);
    });
    const gateway = {
      isConnected: () => true,
      rpc,
    } as unknown as GatewayManager;

    await abortOfficeTaskRun('proj-1', { gateway, markUserAborted: true });
    await getAbortQuiesceLock('proj-1')?.abortWork;

    expect(appendRoomMessage).toHaveBeenCalledTimes(1);
    expect(appendRoomMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'proj-1',
        from: 'system',
        content: '用户手动中止项目运行',
      }),
      expect.objectContaining({ notifyRenderer: true }),
    );
  });

  it('workflow abort still posts room terminal after generation was wiped (sticky-claim hole)', async () => {
    // Repro: first abort claims gen=1; finalize wiped abortGeneration; next abort
    // recomputes gen=1. Sticky claim used to skip the write forever.
    getTempProject
      .mockResolvedValueOnce(
        project({
          id: 'proj-wf',
          status: 'running',
          abortQuiescing: false,
          abortGeneration: undefined,
          executionMode: 'workflow',
          nodeRuns: [{ nodeId: 'n1', agentId: 'a1', status: 'running' }],
        }),
      )
      .mockResolvedValueOnce(
        project({
          id: 'proj-wf',
          status: 'running',
          abortQuiescing: false,
          abortGeneration: undefined, // wiped by finalize / quiesce clear path
          executionMode: 'workflow',
          nodeRuns: [{ nodeId: 'n1', agentId: 'a1', status: 'running' }],
        }),
      );
    abortTaskRun.mockImplementation(async (id: string, options?: { abortQuiesce?: unknown }) =>
      project({
        id,
        abortQuiescing: Boolean(options?.abortQuiesce),
        abortGeneration: 1,
        status: 'aborted',
        executionMode: 'workflow',
      }),
    );
    getRoomMessages.mockResolvedValue([]);
    const gateway = {
      isConnected: () => true,
      rpc: vi.fn().mockResolvedValue({ sessions: [] }),
    } as unknown as GatewayManager;

    await abortOfficeTaskRun('proj-wf', { gateway, markUserAborted: true });
    clearAbortQuiesceLock('proj-wf');
    resetAbortQuiesceLocksForTests();
    // Simulate process still holding old sticky claim semantics — must still write.
    await abortOfficeTaskRun('proj-wf', { gateway, markUserAborted: true });

    expect(appendRoomMessage.mock.calls.filter((c) => c[0]?.from === 'system').length).toBeGreaterThanOrEqual(2);
  });

  it('mention LLM stops (no format-retry) when project is user-aborted / quiescing', () => {
    expect(shouldStopRoomMentionLlmForProjectAbort('proj-1')).toBe(false);
    markTaskUserAborted('proj-1');
    expect(shouldStopRoomMentionLlmForProjectAbort('proj-1')).toBe(true);
    expect(isTaskUserAborted('proj-1')).toBe(true);

    clearTaskUserAborted('proj-1');
    beginAbortQuiesceAndScheduleGateway({
      gateway: undefined,
      projectId: 'proj-1',
      generation: 1,
      keysHint: [],
      startedAt: 1,
      staticSessionKeys: [],
      inflightSessionKeys: [],
    });
    expect(isAbortQuiescing('proj-1')).toBe(true);
    expect(shouldStopRoomMentionLlmForProjectAbort('proj-1')).toBe(true);
  });
});
