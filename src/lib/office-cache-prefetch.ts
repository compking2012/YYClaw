/**
 * Office 缓存整包预取：唯一自动线（Gateway / 用户先进页）+ 手动强制刷新。
 * Phase 1 同步区 → Phase 2 异步区。
 */

import {
  applyOfficeDisplayCacheFromStore,
  mirrorPreferredFromStore,
} from '@/lib/office-display-cache-data';
import {
  bumpOfficeDisplayCacheGeneration,
  getOfficeDisplayCache,
  getOfficeDisplayCacheGeneration,
  isOfficeDisplayCacheSyncComplete,
  isOfficeDisplayCacheSyncReady,
  markOfficeDisplayCacheSyncHydrated,
  recoverOfficeDisplayCacheSyncAfterPrefetchFailure,
  setOfficeDisplayCacheHydrationLevel,
  setOfficeDisplayCacheSyncPhase,
} from '@/lib/office-display-cache';
import {
  beginGatewayInitialPrefetchPass,
  buildOfficeAsyncPrefetchProjectOrder,
  maybeFinishGatewayInitialPrefetchPass,
  preferredPrefetchTargetId,
  prefetchArchivedBlock,
  prefetchEditContext,
  resetOfficePrefetchState,
  scheduleOfficeAsyncPrefetch,
  syncWarmProjectPrefetchFromStore,
} from '@/lib/office-project-prefetch';
import { isOfficeProjectArchived, isOfficeProjectExecuting } from '@/lib/office-room-sidebar';
import { isOfficeCollaborationEnabled } from '@shared/office-collaboration-feature';
import { useAgentsStore } from '@/stores/agents';
import { useOfficeStore } from '@/stores/office';
import { useGatewayStore } from '@/stores/gateway';
import type { GatewayStatus } from '@/types/gateway';
import type { OfficeTempProject } from '@/types/office';

function isGatewayReadyForOffice(status: Pick<GatewayStatus, 'state' | 'gatewayReady'>): boolean {
  return status.state === 'running' && status.gatewayReady !== false;
}

export type OfficeCachePrefetchKind =
  | 'enter-persisted'
  | 'gateway-full'
  | 'gateway-supplement'
  | 'manual-full';

let prefetchInFlight: Promise<void> | null = null;
let currentPrefetchKind: OfficeCachePrefetchKind | null = null;
let enterPersistedDone = false;
let gatewayAutoCompleteDoneForGeneration = -1;

const prefetchListeners = new Set<() => void>();

function emitOfficeCachePrefetchChange(): void {
  for (const listener of prefetchListeners) {
    listener();
  }
}

export function subscribeOfficeCachePrefetch(listener: () => void): () => void {
  prefetchListeners.add(listener);
  return () => prefetchListeners.delete(listener);
}

/** @internal */
export function resetOfficeCachePrefetchStateForTest(): void {
  prefetchInFlight = null;
  currentPrefetchKind = null;
  enterPersistedDone = false;
  gatewayAutoCompleteDoneForGeneration = -1;
}

export function isOfficeCachePrefetchInFlight(): boolean {
  return prefetchInFlight !== null;
}

export function getOfficeCachePrefetchKind(): OfficeCachePrefetchKind | null {
  return currentPrefetchKind;
}

export function isOfficeCacheGatewayAutoComplete(): boolean {
  return (
    gatewayAutoCompleteDoneForGeneration === getOfficeDisplayCacheGeneration()
    && isOfficeDisplayCacheSyncComplete()
  );
}

function isPrefetchWorkCurrent(workGeneration: number): boolean {
  return workGeneration === getOfficeDisplayCacheGeneration();
}

async function fetchSnapshotAndAgents(withLoading: boolean, reconcile = false): Promise<void> {
  const office = useOfficeStore.getState();
  await Promise.all([
    office.fetchSnapshot({ notifyReview: false, withLoading }),
    useAgentsStore.getState().fetchAgents({ silent: !withLoading, reconcile }),
  ]);
}

async function hydratePreferredSync(
  preferredId: string | null,
  opts: { urgentProgress: boolean; urgentRoom: boolean },
): Promise<void> {
  if (!preferredId) return;
  const office = useOfficeStore.getState();
  const project = office.tempProjects.find((p) => p.id === preferredId);
  if (!project || isOfficeProjectArchived(project)) return;
  if (opts.urgentProgress && isOfficeProjectExecuting(project)) {
    await office.fetchProjectProgress(preferredId, { notifyReview: false, silent: true });
  }
  await office.fetchRoomMessages(preferredId, opts.urgentRoom ? { urgent: true } : {});
}

async function prefetchSyncZonePersisted(workGeneration: number): Promise<string | null> {
  if (!isPrefetchWorkCurrent(workGeneration)) return null;
  setOfficeDisplayCacheSyncPhase('loading');
  await fetchSnapshotAndAgents(false, false);
  if (!isPrefetchWorkCurrent(workGeneration)) return null;
  const projects = useOfficeStore.getState().tempProjects;
  const preferredId = preferredPrefetchTargetId(projects);
  await hydratePreferredSync(preferredId, { urgentProgress: false, urgentRoom: false });
  if (!isPrefetchWorkCurrent(workGeneration)) return null;
  markOfficeDisplayCacheSyncHydrated(preferredId, 'persisted');
  applyOfficeDisplayCacheFromStore();
  mirrorPreferredFromStore(preferredId);
  syncWarmProjectPrefetchFromStore(projects);
  return preferredId;
}

async function prefetchSyncZoneComplete(
  workGeneration: number,
  withLoading: boolean,
): Promise<string | null> {
  if (!isPrefetchWorkCurrent(workGeneration)) return null;
  setOfficeDisplayCacheSyncPhase('loading');
  await fetchSnapshotAndAgents(withLoading, false);
  if (!isPrefetchWorkCurrent(workGeneration)) return null;
  const projects = useOfficeStore.getState().tempProjects;
  const preferredId = preferredPrefetchTargetId(projects);
  await hydratePreferredSync(preferredId, { urgentProgress: true, urgentRoom: true });
  if (!isPrefetchWorkCurrent(workGeneration)) return null;
  markOfficeDisplayCacheSyncHydrated(preferredId, 'complete');
  applyOfficeDisplayCacheFromStore();
  mirrorPreferredFromStore(preferredId);
  syncWarmProjectPrefetchFromStore(projects);
  return preferredId;
}

async function prefetchAsyncZone(
  projects: OfficeTempProject[],
  preferredId: string | null,
  gatewayInitialPass: boolean,
): Promise<void> {
  await prefetchEditContext();
  await prefetchArchivedBlock(projects);
  const order = buildOfficeAsyncPrefetchProjectOrder(projects, preferredId);
  if (gatewayInitialPass) {
    beginGatewayInitialPrefetchPass(order);
  }
  scheduleOfficeAsyncPrefetch(projects, preferredId);
  maybeFinishGatewayInitialPrefetchPass();
}

/**
 * 整包预取入口。
 * - enter-persisted：用户先进 Office（Gateway 未 ready），仅持久化同步区。
 * - gateway-full：Gateway 先 ready，整包 Phase1+2。
 * - gateway-supplement：用户先进后 Gateway ready，补全同步区 + Phase2。
 * - manual-full：手动刷新，强制 bump 后整包重跑（agents 只读，不写 openclaw.json）。
 */
export async function runOfficeCachePrefetch(opts: {
  kind: OfficeCachePrefetchKind;
  gatewayInitialPass?: boolean;
}): Promise<void> {
  if (!isOfficeCollaborationEnabled()) return;
  if (opts.kind === 'manual-full') {
    if (prefetchInFlight) {
      await prefetchInFlight;
    }
    bumpOfficeDisplayCacheGeneration();
    resetOfficePrefetchState();
    enterPersistedDone = false;
    gatewayAutoCompleteDoneForGeneration = -1;
  } else if (opts.kind === 'enter-persisted') {
    if (prefetchInFlight) {
      await prefetchInFlight;
      return;
    }
    if (enterPersistedDone) return;
    if (isOfficeCacheGatewayAutoComplete()) return;
    if (currentPrefetchKind === 'gateway-full' || currentPrefetchKind === 'manual-full') {
      if (prefetchInFlight) await prefetchInFlight;
      return;
    }
  } else if (opts.kind === 'gateway-full') {
    if (prefetchInFlight) {
      await prefetchInFlight;
      return;
    }
    if (enterPersistedDone) {
      const cache = getOfficeDisplayCache();
      if (cache.sync.hydrationLevel === 'persisted' && isOfficeDisplayCacheSyncReady()) {
        await runOfficeCachePrefetch({
          kind: 'gateway-supplement',
          gatewayInitialPass: opts.gatewayInitialPass,
        });
        return;
      }
    }
    bumpOfficeDisplayCacheGeneration();
    resetOfficePrefetchState();
    enterPersistedDone = false;
    gatewayAutoCompleteDoneForGeneration = -1;
  } else if (opts.kind === 'gateway-supplement') {
    if (prefetchInFlight) {
      await prefetchInFlight;
      return;
    }
    if (!enterPersistedDone) {
      await runOfficeCachePrefetch({
        kind: 'gateway-full',
        gatewayInitialPass: opts.gatewayInitialPass,
      });
      return;
    }
    if (gatewayAutoCompleteDoneForGeneration === getOfficeDisplayCacheGeneration()) return;
  }

  const work = (async () => {
    const workGeneration = getOfficeDisplayCacheGeneration();
    try {
      if (opts.kind === 'enter-persisted') {
        await prefetchSyncZonePersisted(workGeneration);
        if (!isPrefetchWorkCurrent(workGeneration)) return;
        enterPersistedDone = true;
        return;
      }

      const withLoading = opts.kind === 'gateway-full' || opts.kind === 'manual-full';
      if (withLoading && isPrefetchWorkCurrent(workGeneration)) {
        setOfficeDisplayCacheHydrationLevel('none');
      }
      let preferredId: string | null;
      if (opts.kind === 'gateway-supplement') {
        preferredId = await prefetchSyncZoneComplete(workGeneration, false);
      } else {
        preferredId = await prefetchSyncZoneComplete(workGeneration, withLoading);
      }
      if (!isPrefetchWorkCurrent(workGeneration)) return;

      const latestProjects = useOfficeStore.getState().tempProjects;
      await prefetchAsyncZone(
        latestProjects,
        preferredId,
        opts.gatewayInitialPass === true,
      );
      if (!isPrefetchWorkCurrent(workGeneration)) return;
      gatewayAutoCompleteDoneForGeneration = getOfficeDisplayCacheGeneration();
      if (opts.kind === 'manual-full') {
        enterPersistedDone = true;
      }
    } catch {
      if (!isPrefetchWorkCurrent(workGeneration)) return;
      recoverOfficeDisplayCacheSyncAfterPrefetchFailure();
    }
  })();

  prefetchInFlight = work;
  currentPrefetchKind = opts.kind;
  emitOfficeCachePrefetchChange();
  try {
    await work;
  } finally {
    if (prefetchInFlight === work) {
      prefetchInFlight = null;
      currentPrefetchKind = null;
      emitOfficeCachePrefetchChange();
    }
  }
}

/** Gateway 非 ready → ready：整包或补全预取。 */
export function handleGatewayOfficeCachePrefetch(gatewayInitialPass = true): void {
  if (!isOfficeCollaborationEnabled()) return;
  if (prefetchInFlight) {
    if (currentPrefetchKind === 'enter-persisted') {
      void prefetchInFlight.then(() => {
        handleGatewayOfficeCachePrefetch(gatewayInitialPass);
      });
    }
    return;
  }

  const cache = getOfficeDisplayCache();
  const canSupplement =
    enterPersistedDone
    && cache.sync.hydrationLevel === 'persisted'
    && isOfficeDisplayCacheSyncReady();

  // 每次 Gateway ready 跃迁都开启新一轮自动预取周期
  gatewayAutoCompleteDoneForGeneration = -1;

  if (canSupplement) {
    void runOfficeCachePrefetch({ kind: 'gateway-supplement', gatewayInitialPass });
    return;
  }

  enterPersistedDone = false;
  void runOfficeCachePrefetch({ kind: 'gateway-full', gatewayInitialPass });
}

/** 用户进入 Office 页：按需触发持久化预取或仅读缓存。 */
export function handleOfficePageEnter(): void {
  if (!isOfficeCollaborationEnabled()) return;
  if (prefetchInFlight || isOfficeCacheGatewayAutoComplete()) return;
  if (isOfficeDisplayCacheSyncReady()) return;
  const gatewayReady = isGatewayReadyForOffice(useGatewayStore.getState().status);
  if (gatewayReady) {
    // Gateway 已 ready：等待 Gateway 触发的整包/补全预取，不另开 enter-persisted
    return;
  }
  if (!enterPersistedDone) {
    void runOfficeCachePrefetch({ kind: 'enter-persisted' });
  }
}

export function isOfficeDisplayCachePrefetchActive(
  projects: OfficeTempProject[] = [],
): boolean {
  if (prefetchInFlight !== null) return true;
  const cache = getOfficeDisplayCache();
  if (cache.sync.phase === 'loading' && cache.sync.hydrationLevel !== 'persisted') return true;
  if (!isOfficeDisplayCacheSyncReady()) return true;
  if (cache.async.queueRunning) return true;
  if (cache.async.archived.phase === 'loading') return true;
  if (cache.async.editContext.phase === 'loading') return true;
  for (const entry of Object.values(cache.sync.projectCards)) {
    if (entry.phase === 'loading') return true;
  }
  for (const entry of Object.values(cache.async.rooms)) {
    if (entry.phase === 'loading') return true;
  }
  void projects;
  return false;
}
