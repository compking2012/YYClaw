import { OFFICE_UNIFIED_POLL_MS } from '../../../shared/office-unified-poll';
import {
  flushOfficeProjectRoomPending,
  resetOfficeProjectRoomSyncForTest,
  setOfficeProjectRoomPollingEnabled,
} from './office-project-room-sync';
import { isAnySmartTaskMarkedRunning } from './smart-task-completion';
import {
  flushOfficeSessionHistoryPending,
  resetOfficeSessionHistorySyncForTest,
  setOfficeSessionHistoryPollingEnabled,
} from './office-session-history-sync';

export { OfficeSyncPollingInactiveError } from './office-sync-polling-error';
export { OFFICE_UNIFIED_POLL_MS };

/** In-memory run refs reported by active project executions (ref-counted). */
const runningProjectRefCounts = new Map<string, number>();
/** Project ids rehydrated from persisted store (crash recovery); not cleared by refresh. */
const storeRecoveredProjectIds = new Set<string>();
let executionLeaseCount = 0;
let unifiedTimer: ReturnType<typeof setInterval> | null = null;
let unifiedTickInFlight: Promise<void> | null = null;
let tickWaiters: Array<{ resolve: () => void; reject: (reason: unknown) => void }> = [];

type TickListener = () => void;
const tickListeners = new Set<TickListener>();
type OfficeExecutionQuiescedListener = () => void;
const quiescedListeners = new Set<OfficeExecutionQuiescedListener>();

export function onOfficeExecutionQuiesced(listener: OfficeExecutionQuiescedListener): () => void {
  quiescedListeners.add(listener);
  return () => quiescedListeners.delete(listener);
}

function notifyOfficeExecutionQuiesced(): void {
  if (isOfficePollEnabled()) return;
  for (const listener of quiescedListeners) {
    try {
      listener();
    } catch {
      // listener errors must not break office lifecycle hooks
    }
  }
}

function projectIsExecuting(project: {
  lifecycle?: string;
  status: string;
  nodeRuns: Array<{ status?: string }>;
}): boolean {
  if ((project.lifecycle ?? 'active') !== 'active') return false;
  if (project.status === 'running') return true;
  return project.nodeRuns.some((nr) => nr.status === 'running');
}

async function listExecutingProjectIdsFromStore(): Promise<string[]> {
  const { listTempProjects } = await import('./store');
  const projects = await listTempProjects();
  if (!Array.isArray(projects)) return [];
  return projects.filter((p) => projectIsExecuting(p)).map((p) => p.id);
}

function runningProjectRefTotal(): number {
  let total = 0;
  for (const count of runningProjectRefCounts.values()) {
    total += count;
  }
  return total;
}

/** 内存中是否有活跃的项目执行（runOfficeProject / Smart 任务标记）。 */
export function isOfficeProjectExecutionActiveInMemory(): boolean {
  return runningProjectRefTotal() > 0 || isAnySmartTaskMarkedRunning();
}

function resolveTickWaiters(): void {
  const pending = tickWaiters;
  tickWaiters = [];
  for (const waiter of pending) waiter.resolve();
}

function rejectTickWaiters(error: unknown): void {
  const pending = tickWaiters;
  tickWaiters = [];
  for (const waiter of pending) waiter.reject(error);
}

async function runOfficeUnifiedPollTick(): Promise<void> {
  if (unifiedTickInFlight) {
    await unifiedTickInFlight;
    return;
  }

  unifiedTickInFlight = (async () => {
    await Promise.all([
      flushOfficeSessionHistoryPending(),
      flushOfficeProjectRoomPending(),
    ]);
    resolveTickWaiters();
    for (const listener of tickListeners) {
      try {
        listener();
      } catch {
        // listener errors must not break the office tick
      }
    }
    const { broadcastToRenderer } = await import('../../utils/broadcast-renderer');
    broadcastToRenderer('office:unified-poll-tick', { at: Date.now() });
  })().finally(() => {
    unifiedTickInFlight = null;
  });

  await unifiedTickInFlight;
}

function ensureUnifiedTimerRunning(): void {
  if (unifiedTimer) return;
  unifiedTimer = setInterval(() => {
    void runOfficeUnifiedPollTick();
  }, OFFICE_UNIFIED_POLL_MS);
  unifiedTimer.unref?.();
}

function stopUnifiedTimer(): void {
  if (!unifiedTimer) return;
  clearInterval(unifiedTimer);
  unifiedTimer = null;
  rejectTickWaiters(new Error('office-unified-poll-stopped'));
}

function isOfficePollEnabled(): boolean {
  return (
    runningProjectRefTotal() > 0
    || executionLeaseCount > 0
    || storeRecoveredProjectIds.size > 0
    || isAnySmartTaskMarkedRunning()
  );
}

function syncPollingEnabledFlags(): void {
  const enabled = isOfficePollEnabled();
  setOfficeProjectRoomPollingEnabled(enabled);
  setOfficeSessionHistoryPollingEnabled(enabled);
  if (enabled) {
    ensureUnifiedTimerRunning();
  } else {
    stopUnifiedTimer();
  }
}

function bumpRunningProjectRef(projectId: string): void {
  runningProjectRefCounts.set(projectId, (runningProjectRefCounts.get(projectId) ?? 0) + 1);
  storeRecoveredProjectIds.delete(projectId);
}

function dropRunningProjectRef(projectId: string): void {
  const next = (runningProjectRefCounts.get(projectId) ?? 0) - 1;
  if (next <= 0) {
    runningProjectRefCounts.delete(projectId);
    storeRecoveredProjectIds.delete(projectId);
    return;
  }
  runningProjectRefCounts.set(projectId, next);
}

/** True while a live runOfficeProject lifecycle has reported start and not yet stopped. */
export function isOfficeProjectRunLifecycleActive(projectId: string): boolean {
  const id = projectId.trim();
  if (!id) return false;
  return (runningProjectRefCounts.get(id) ?? 0) > 0;
}

/** First project run start under Office — starts the shared 3s poll timer when transitioning 0→1. */
export function notifyOfficeProjectRunStarted(projectId: string): void {
  const id = projectId.trim();
  if (!id) return;
  const wasInactive = !isOfficePollEnabled();
  bumpRunningProjectRef(id);
  syncPollingEnabledFlags();
  if (wasInactive) {
    void runOfficeUnifiedPollTick();
  }
}

/** Project run ended — stops the shared timer when the last running project stops. */
export function notifyOfficeProjectRunStopped(projectId: string): void {
  const id = projectId.trim();
  if (!id) return;
  if (!runningProjectRefCounts.has(id) && !storeRecoveredProjectIds.has(id)) {
    return;
  }
  if (runningProjectRefCounts.has(id)) {
    dropRunningProjectRef(id);
  } else {
    storeRecoveredProjectIds.delete(id);
  }
  syncPollingEnabledFlags();
  notifyOfficeExecutionQuiesced();
}

/** Align caller loops to the next Office unified poll tick (3s while projects run). */
export function waitForOfficeUnifiedPollTick(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(new Error('aborted'));
  }
  if (!isOfficePollEnabled()) {
    return Promise.reject(new Error('office-unified-poll-inactive'));
  }
  return new Promise((resolve, reject) => {
    const entry = { resolve, reject };
    tickWaiters.push(entry);
    if (!signal) return;
    const onAbort = () => {
      const index = tickWaiters.indexOf(entry);
      if (index >= 0) tickWaiters.splice(index, 1);
      reject(new Error('aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export function onOfficeUnifiedPollTick(listener: TickListener): () => void {
  tickListeners.add(listener);
  return () => tickListeners.delete(listener);
}

export function isOfficeUnifiedPollingActive(): boolean {
  return isOfficePollEnabled();
}

/** @deprecated Prefer notifyOfficeProjectRunStarted/Stopped. Kept for tests. */
export function acquireOfficeExecutionSync(): void {
  const wasInactive = !isOfficePollEnabled();
  executionLeaseCount += 1;
  syncPollingEnabledFlags();
  if (wasInactive) {
    void runOfficeUnifiedPollTick();
  }
}

/** @deprecated Prefer notifyOfficeProjectRunStarted/Stopped. Kept for tests. */
export function releaseOfficeExecutionSync(): void {
  if (executionLeaseCount <= 0) return;
  executionLeaseCount -= 1;
  syncPollingEnabledFlags();
}

/** True while any reported project run or legacy lease is active. */
export function isOfficeExecutionSyncActive(): boolean {
  return isOfficeUnifiedPollingActive();
}

/** True while unified polling is active or persisted store still shows executing projects. */
export async function isOfficeExecutionSyncActiveForPolling(): Promise<boolean> {
  if (isOfficeUnifiedPollingActive()) return true;
  const executingIds = await listExecutingProjectIdsFromStore();
  return executingIds.length > 0;
}

/**
 * Reconcile timer state from persisted projects (startup / crash recovery only).
 * Never clears in-memory run refs reported by live executions.
 */
export async function refreshOfficeExecutionSyncPolling(): Promise<void> {
  const executingIds = await listExecutingProjectIdsFromStore();
  const executingIdSet = new Set(executingIds);

  for (const id of [...storeRecoveredProjectIds]) {
    if (!executingIdSet.has(id)) {
      storeRecoveredProjectIds.delete(id);
    }
  }

  for (const id of executingIds) {
    if (runningProjectRefCounts.has(id)) continue;
    storeRecoveredProjectIds.add(id);
  }

  syncPollingEnabledFlags();
  if (isOfficePollEnabled() && !unifiedTickInFlight) {
    void runOfficeUnifiedPollTick();
  }
}

/** @internal */
export function getOfficeSyncRuntimeDiagnostics(): {
  enabled: boolean;
  runningProjectRefs: Record<string, number>;
  storeRecoveredProjectIds: string[];
  executionLeaseCount: number;
  timerActive: boolean;
  tickInFlight: boolean;
  tickWaiters: number;
} {
  return {
    enabled: isOfficePollEnabled(),
    runningProjectRefs: Object.fromEntries(runningProjectRefCounts),
    storeRecoveredProjectIds: [...storeRecoveredProjectIds],
    executionLeaseCount,
    timerActive: unifiedTimer != null,
    tickInFlight: unifiedTickInFlight != null,
    tickWaiters: tickWaiters.length,
  };
}

/** @internal */
export function resetOfficeSyncRuntimeForTest(): void {
  runningProjectRefCounts.clear();
  storeRecoveredProjectIds.clear();
  executionLeaseCount = 0;
  unifiedTickInFlight = null;
  stopUnifiedTimer();
  tickWaiters = [];
  tickListeners.clear();
  setOfficeProjectRoomPollingEnabled(false);
  setOfficeSessionHistoryPollingEnabled(false);
  resetOfficeProjectRoomSyncForTest();
  resetOfficeSessionHistorySyncForTest();
}
