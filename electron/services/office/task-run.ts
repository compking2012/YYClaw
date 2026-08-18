import type { GatewayManager } from '../../gateway/manager';
import { syntheticFixedGroupContextFromProject } from '../../../src/lib/office-task-workflow';
import type { OfficeFixedGroup, OfficeTempProject } from './types';
import { taskExecutionMode } from './task-execution-mode';
import { runSmartTask, abortSmartTaskRun } from './smart-task-runner';
import {
  runTaskWorkflow,
  abortTaskRun as abortWorkflowTaskRun,
  type RunTaskWorkflowOptions,
} from './workflow-runner';
import {
  isLangGraphWorkflowTask,
  LANGGRAPH_DISABLED_RUN_ERROR,
  taskWorkflowEngine,
} from '@/lib/office-workflow-engine';
import {
  isGatewayReadyForOfficeExecution,
  resumeOrphanedOfficeProjectsAfterGatewayReady,
} from './gateway-office-resume';
import {
  beginAbortQuiesceAndScheduleGateway,
  cloneProjectForGatewayAbort,
  collectSyncAbortSessionKeys,
  installAbortQuiesceLock,
  reconcileAbortQuiescingProjectsOnGatewayReady,
  rekickAbortProjectGatewaySessions,
  scheduleAbortForInstalledQuiesceLock,
} from './project-gateway-abort';
import {
  assertProjectNotAbortQuiescing,
  clearAbortQuiesceLock,
  getAbortQuiesceLock,
  isAbortQuiescing,
  ProjectAbortQuiescingError,
} from './project-abort-quiesce';
import { USER_ABORT_ROOM_MESSAGE } from '../../../src/lib/office-workflow-abort';
import {
  claimTaskAbortClear,
} from './task-run-abort-registry';
import { shouldBlockOfficeLlmSend } from './office-llm-send-guard';

export type { RunTaskWorkflowOptions };

export { USER_ABORT_ROOM_MESSAGE };

/**
 * In-flight dedupe only (not a sticky success claim).
 * A sticky claim keyed by abortGeneration caused workflow aborts to permanently skip the
 * room terminal: finalizeAbortedTaskRun wiped abortGeneration, so the next abort reused
 * generation=1 while the Set still blocked the write; fresh runs also bump epoch so any
 * earlier terminal disappears from the visible room.
 */
const abortRoomTerminalInflight = new Set<string>();

async function appendUserAbortRoomTerminal(
  project: OfficeTempProject,
  generation: number,
): Promise<void> {
  const projectId = project.id.trim();
  if (!projectId) return;
  const key = `${projectId}:${generation}`;
  if (abortRoomTerminalInflight.has(key)) return;
  abortRoomTerminalInflight.add(key);
  try {
    const { appendRoomMessage, getRoomMessages, listFixedGroups } = await import('./store');
    const { isUserAbortRoomMessage } = await import('../../../src/lib/office-workflow-abort');
    const existing = await getRoomMessages(projectId);
    if (existing.some((m) => m.from === 'system' && isUserAbortRoomMessage(m))) return;

    const groups = await listFixedGroups();
    const parent = project.parentGroupId
      ? groups.find((g) => g.id === project.parentGroupId)
      : undefined;
    const groupId = parent?.id ?? project.parentGroupId ?? project.id;
    await appendRoomMessage(
      {
        id: `room-${Date.now()}-user-abort-${generation}`,
        groupId,
        projectId,
        from: 'system',
        content: USER_ABORT_ROOM_MESSAGE,
        mentions: [],
        timestamp: Date.now(),
      },
      { notifyRenderer: true },
    );
  } catch (err) {
    console.warn('[office] user abort room message failed:', projectId, err);
  } finally {
    abortRoomTerminalInflight.delete(key);
  }
}

/** @visibleForTesting */
export function resetUserAbortRoomTerminalClaimsForTests(): void {
  abortRoomTerminalInflight.clear();
}

export type AbortOfficeTaskRunOptions = {
  gateway?: GatewayManager;
  markUserAborted?: boolean;
  reason?: string;
};

const officeGatewayGuardInstalled = new WeakSet<GatewayManager>();
let officeTaskLifecycleGateway: GatewayManager | null = null;
let officeGatewayAbortInFlight: Promise<void> | null = null;
/** In-process Gateway restart (SIGUSR1) briefly passes through `stopped` before reconnecting. */
const OFFICE_GATEWAY_STOPPED_ABORT_DELAY_MS = 12_000;
let officeGatewayStoppedAbortTimer: ReturnType<typeof setTimeout> | null = null;

export function shouldAbortOfficeTasksOnGatewayStateChange(
  prevState: string,
  nextState: string,
): boolean {
  // Only `error` is an immediate terminal abort. `stopped` is debounced below because
  // config reload / SIGUSR1 in-process restarts emit running -> stopped -> reconnecting.
  return prevState === 'running' && nextState === 'error';
}

function cancelScheduledOfficeGatewayStoppedAbort(): void {
  if (officeGatewayStoppedAbortTimer) {
    clearTimeout(officeGatewayStoppedAbortTimer);
    officeGatewayStoppedAbortTimer = null;
  }
}

function scheduleOfficeGatewayStoppedAbort(
  gateway: GatewayManager,
  reason: string,
): void {
  cancelScheduledOfficeGatewayStoppedAbort();
  officeGatewayStoppedAbortTimer = setTimeout(() => {
    officeGatewayStoppedAbortTimer = null;
    const status = gateway.getStatus();
    if (isGatewayReadyForOfficeExecution(status) && gateway.isConnected()) {
      return;
    }
    if (status.state === 'reconnecting' || status.state === 'starting') {
      return;
    }
    void abortRunningOfficeTasksBySystem(reason);
  }, OFFICE_GATEWAY_STOPPED_ABORT_DELAY_MS);
}

function projectNeedsAbort(project: OfficeTempProject): boolean {
  if (project.status === 'running') return true;
  if (project.abortQuiescing) return true;
  return project.nodeRuns.some((nr) => nr.status === 'running');
}

function groupContextForProject(
  project: OfficeTempProject,
  parentGroup?: OfficeFixedGroup | null,
): OfficeFixedGroup {
  if (parentGroup) return parentGroup;
  return syntheticFixedGroupContextFromProject(project);
}

function resolveOfficeAbortGateway(gateway?: GatewayManager): GatewayManager | undefined {
  return gateway ?? officeTaskLifecycleGateway ?? undefined;
}

async function abortRunningOfficeTasksBySystem(reason: string): Promise<void> {
  if (officeGatewayAbortInFlight) return officeGatewayAbortInFlight;
  officeGatewayAbortInFlight = (async () => {
    const { listTempProjects } = await import('./store');
    const { clearProjectAgentNewLedger } = await import('./office-session-new-ledger');
    const projects = await listTempProjects();
    const runningProjects = projects.filter(projectNeedsAbort);
    for (const project of runningProjects) {
      clearProjectAgentNewLedger(project.id);
    }
    await Promise.all(
      runningProjects.map(async (project) => {
        try {
          await abortOfficeTaskRunBySystem(
            project.id,
            reason,
            officeTaskLifecycleGateway ?? undefined,
          );
        } catch (err) {
          console.warn('[office] abort project on gateway restart failed:', project.id, err);
        }
      }),
    );
  })().finally(() => {
    officeGatewayAbortInFlight = null;
  });
  return officeGatewayAbortInFlight;
}

/**
 * Guard: if gateway leaves `running` (gateway/terminal restart), abort all in-flight office projects.
 */
export function ensureOfficeTaskGatewayLifecycleGuard(gateway: GatewayManager): void {
  officeTaskLifecycleGateway = gateway;
  if (officeGatewayGuardInstalled.has(gateway)) return;
  officeGatewayGuardInstalled.add(gateway);

  void import('./office-sync-runtime').then(({ refreshOfficeExecutionSyncPolling }) =>
    refreshOfficeExecutionSyncPolling(),
  );
  void import('./office-spawn-policy-reconcile').then(({ rebuildOfficeSpawnPolicyRefsFromStore, registerOfficeSpawnPolicyQuiescedHook }) => {
    registerOfficeSpawnPolicyQuiescedHook();
    return rebuildOfficeSpawnPolicyRefsFromStore();
  });

  let prevStatus = gateway.getStatus();
  if (isGatewayReadyForOfficeExecution(prevStatus) && gateway.isConnected()) {
    void resumeOrphanedOfficeProjectsAfterGatewayReady(gateway);
    void reconcileAbortQuiescingProjectsOnGatewayReady(gateway);
  }
  gateway.on('status', (status) => {
    const nextState = status.state;
    const prevState = prevStatus.state;

    if (nextState === 'running' || nextState === 'reconnecting' || nextState === 'starting') {
      cancelScheduledOfficeGatewayStoppedAbort();
    }

    const runningInterrupted = shouldAbortOfficeTasksOnGatewayStateChange(prevState, nextState);
    const wasReady = isGatewayReadyForOfficeExecution(prevStatus);
    const nowReady = isGatewayReadyForOfficeExecution(status);
    prevStatus = status;

    if (runningInterrupted) {
      void abortRunningOfficeTasksBySystem(`网关/终端发生重启（${nextState}）`);
      return;
    }

    if (prevState === 'running' && nextState === 'stopped') {
      if (!gateway.isAutoReconnectEnabled()) {
        void abortRunningOfficeTasksBySystem('网关/终端发生重启（stopped）');
      } else {
        scheduleOfficeGatewayStoppedAbort(gateway, '网关/终端发生重启（stopped）');
      }
      return;
    }

    if (!wasReady && nowReady) {
      void resumeOrphanedOfficeProjectsAfterGatewayReady(gateway);
      void reconcileAbortQuiescingProjectsOnGatewayReady(gateway);
    }
  });
}

/** Unified entry for office project execution (workflow vs smart). */
export async function runOfficeProject(
  gateway: GatewayManager,
  project: OfficeTempProject,
  parentGroup?: OfficeFixedGroup | null,
  options?: RunTaskWorkflowOptions,
): Promise<void> {
  const projectId = project.id.trim();

  const assertRunStillAllowed = async (): Promise<void> => {
    assertProjectNotAbortQuiescing(projectId);
    if (shouldBlockOfficeLlmSend(projectId)) {
      throw new ProjectAbortQuiescingError(projectId);
    }
    const { getTempProject } = await import('./store');
    const live = await getTempProject(projectId);
    if (live?.abortQuiescing) {
      throw new ProjectAbortQuiescingError(projectId);
    }
  };

  // Claim BEFORE the first assert so a residual userAborted from a finished abort
  // can be cleared; claim refuses to clear while a quiesce lock is held.
  const { permit: abortClearPermit } = claimTaskAbortClear(projectId);
  await assertRunStillAllowed();

  const { notifyOfficeProjectRunStarted, notifyOfficeProjectRunStopped } = await import(
    './office-sync-runtime'
  );
  const { prepareOfficeSpawnDenyBeforeRun, releaseOfficeSpawnDenyAfterRun } = await import(
    './office-spawn-policy-reconcile'
  );
  let deferUnifiedPollStop = false;
  try {
    const gw = gateway.getStatus();
    if (gw.state !== 'running' || !gateway.isConnected()) {
      throw new Error('Gateway is not running');
    }
    await prepareOfficeSpawnDenyBeforeRun(project);

    // Barrier after await: abort may have won the race during spawn-deny prepare.
    // Do NOT claim/clear again here — that would wipe a racing abort that marked
    // after the entry claim (lock may not be visible yet on legacy abort paths).
    await assertRunStillAllowed();

    notifyOfficeProjectRunStarted(project.id);
    const group = groupContextForProject(project, parentGroup);
    if (taskExecutionMode(project) === 'smart') {
      deferUnifiedPollStop = true;
      await runSmartTask(gateway, group as never, project as never, {
        ...options,
        abortClearPermit,
      });
      return;
    }
    if (isLangGraphWorkflowTask(project as never) && !__ENABLE_LANGGRAPH__) {
      throw new Error(LANGGRAPH_DISABLED_RUN_ERROR);
    }
    if (__ENABLE_LANGGRAPH__ && taskWorkflowEngine(project as never) === 'langgraph') {
      const { runTaskWorkflowLangGraph } = await import('./workflow-langgraph-runner');
      await runTaskWorkflowLangGraph(gateway, group as never, project as never, {
        ...options,
        abortClearPermit,
      });
      return;
    }
    await runTaskWorkflow(gateway, group as never, project as never, {
      ...options,
      abortClearPermit,
    });
  } finally {
    if (!deferUnifiedPollStop) {
      const { isOfficeProjectRunLifecycleActive } = await import('./office-sync-runtime');
      notifyOfficeProjectRunStopped(project.id);
      const { getTempProject } = await import('./store');
      const live = await getTempProject(project.id);
      const quiescing =
        isAbortQuiescing(project.id) || live?.abortQuiescing === true;
      if (!isOfficeProjectRunLifecycleActive(project.id) && !quiescing) {
        await releaseOfficeSpawnDenyAfterRun(project.id);
      }
    }
  }
}

/** @deprecated alias */
export const runOfficeTask = runOfficeProject;

async function persistLocalAbortWithQuiesce(
  projectId: string,
  options: {
    markUserAborted?: boolean;
    reason?: string;
    abortQuiesce: { generation: number; startedAt: number };
    skipAutoComplete?: boolean;
  },
): Promise<OfficeTempProject | null> {
  const { getTempProject } = await import('./store');
  const project = await getTempProject(projectId);
  if (!project) return null;
  if (taskExecutionMode(project) === 'smart') {
    return abortSmartTaskRun(projectId, {
      markUserAborted: options.markUserAborted,
      reason: options.reason,
      abortQuiesce: options.abortQuiesce,
      skipAutoComplete: options.skipAutoComplete ?? options.markUserAborted !== false,
    }) as never;
  }
  return abortWorkflowTaskRun(projectId, {
    markUserAborted: options.markUserAborted,
    reason: options.reason,
    abortQuiesce: options.abortQuiesce,
    skipSpawnRelease: true,
  }) as never;
}

export async function abortOfficeTaskRunBySystem(
  projectId: string,
  reason: string,
  gateway?: GatewayManager,
): Promise<OfficeTempProject | null> {
  return abortOfficeTaskRun(projectId, {
    gateway,
    markUserAborted: false,
    reason,
  });
}

export async function abortOfficeTaskRun(
  projectId: string,
  options?: AbortOfficeTaskRunOptions,
): Promise<OfficeTempProject | null> {
  const { getTempProject } = await import('./store');
  const project = await getTempProject(projectId);
  if (!project) return null;

  const gateway = resolveOfficeAbortGateway(options?.gateway);
  const markUserAborted = options?.markUserAborted !== false;
  const reason = options?.reason?.trim() || '用户已手动中止本项目';

  // Idempotent: already aborted + quiescing → re-kick gateway abort if needed.
  // Still ensure the room terminal exists (sticky claim / wiped generation used to skip it).
  if (project.status === 'aborted' && project.abortQuiescing) {
    const lock = getAbortQuiesceLock(projectId);
    const generation = project.abortGeneration ?? lock?.generation ?? 1;
    if (markUserAborted) {
      await appendUserAbortRoomTerminal(project, generation);
    }
    if (lock) {
      rekickAbortProjectGatewaySessions({ gateway, projectId });
    } else {
      const cloned = cloneProjectForGatewayAbort(project);
      const syncKeys = collectSyncAbortSessionKeys(cloned, { takeInflight: true });
      const keysHint = [...syncKeys.inflightSessionKeys, ...syncKeys.staticSessionKeys];
      beginAbortQuiesceAndScheduleGateway({
        gateway,
        projectId,
        generation,
        keysHint,
        startedAt: project.abortQuiesceStartedAt ?? Date.now(),
        staticSessionKeys: syncKeys.staticSessionKeys,
        inflightSessionKeys: syncKeys.inflightSessionKeys,
      });
    }
    return project;
  }

  const cloned = cloneProjectForGatewayAbort(project);
  const syncKeys = collectSyncAbortSessionKeys(cloned, { takeInflight: true });
  const keysHint = [...syncKeys.inflightSessionKeys, ...syncKeys.staticSessionKeys];
  const startedAt = Date.now();
  const generation = (project.abortGeneration ?? 0) + 1;

  // Install memory lock before any await so concurrent run finally / revive paths
  // observe quiescing immediately (I9 spawn deny + I3 run gate).
  installAbortQuiesceLock({
    projectId,
    generation,
    startedAt,
    staticSessionKeys: syncKeys.staticSessionKeys,
    inflightSessionKeys: syncKeys.inflightSessionKeys,
  });

  try {
    const saved = await persistLocalAbortWithQuiesce(projectId, {
      markUserAborted,
      reason,
      abortQuiesce: { generation, startedAt },
      skipAutoComplete: markUserAborted,
    });
    if (!saved) {
      clearAbortQuiesceLock(projectId, generation);
      return null;
    }

    if (markUserAborted) {
      await appendUserAbortRoomTerminal(saved, generation);
    }

    scheduleAbortForInstalledQuiesceLock({
      gateway,
      projectId,
      generation,
      keysHint,
    });

    return saved;
  } catch (err) {
    clearAbortQuiesceLock(projectId, generation);
    throw err;
  }
}
