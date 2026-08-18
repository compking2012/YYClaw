/**
 * Office 展示缓存：同步区（第一眼）+ 异步区（二次操作 / Gateway 后台预取）。
 */

import type { AgentSummary } from '@/types/agent';
import type {
  AgentBindingRecord,
  OfficeFixedGroup,
  OfficeTempProject,
  RoomMessage,
} from '@/types/office';

export type OfficeCachePhase = 'idle' | 'loading' | 'ready';

export type OfficeSyncHydrationLevel = 'none' | 'persisted' | 'complete';

export type OfficePreferredSyncCache = {
  project: OfficeTempProject;
  roomMessages: RoomMessage[];
};

/** @deprecated 异步区 expand 切片 phase；card 字段保留兼容旧预取 API。 */
export type OfficeProjectCardCacheEntry = {
  phase: OfficeCachePhase;
  project: OfficeTempProject | null;
};

export type OfficeProjectRoomCacheEntry = {
  phase: OfficeCachePhase;
  messages: RoomMessage[];
};

export type OfficeArchivedAsyncCache = {
  phase: OfficeCachePhase;
  projects: OfficeTempProject[];
};

export type OfficeEditContextAsyncCache = {
  phase: OfficeCachePhase;
  agentPool: string[];
};

export type OfficeDisplayCacheSync = {
  phase: OfficeCachePhase;
  hydrationLevel: OfficeSyncHydrationLevel;
  snapshotHydratedAt: number | null;
  preferredProjectId: string | null;
  /** @deprecated 使用 async.gatewayInitialPrefetchUiActive */
  gatewayInitialPrefetchUiActive: boolean;
  dataRevision: number;
  fixedGroups: OfficeFixedGroup[];
  /** 非归档项目，供卡片展示。 */
  tempProjects: OfficeTempProject[];
  archivedCount: number;
  agentBindings: Record<string, AgentBindingRecord>;
  agents: AgentSummary[];
  preferred: OfficePreferredSyncCache | null;
  projectCards: Record<string, OfficeProjectCardCacheEntry>;
};

export type OfficeDisplayCacheAsync = {
  gatewayInitialPrefetchUiActive: boolean;
  queueRunning: boolean;
  archived: OfficeArchivedAsyncCache;
  editContext: OfficeEditContextAsyncCache;
  rooms: Record<string, OfficeProjectRoomCacheEntry>;
};

export type OfficeDisplayCache = {
  generation: number;
  sync: OfficeDisplayCacheSync;
  async: OfficeDisplayCacheAsync;
};

const EMPTY_SYNC: OfficeDisplayCacheSync = {
  phase: 'idle',
  hydrationLevel: 'none',
  snapshotHydratedAt: null,
  preferredProjectId: null,
  gatewayInitialPrefetchUiActive: false,
  dataRevision: 0,
  fixedGroups: [],
  tempProjects: [],
  archivedCount: 0,
  agentBindings: {},
  agents: [],
  preferred: null,
  projectCards: {},
};

const EMPTY_ASYNC: OfficeDisplayCacheAsync = {
  gatewayInitialPrefetchUiActive: false,
  queueRunning: false,
  archived: { phase: 'idle', projects: [] },
  editContext: { phase: 'idle', agentPool: [] },
  rooms: {},
};

function createEmptyOfficeDisplayCache(generation = 0): OfficeDisplayCache {
  return {
    generation,
    sync: { ...EMPTY_SYNC, projectCards: {} },
    async: { ...EMPTY_ASYNC, rooms: {} },
  };
}

let cache: OfficeDisplayCache = createEmptyOfficeDisplayCache();

type OfficeDisplayCacheListener = () => void;
const listeners = new Set<OfficeDisplayCacheListener>();

function emitOfficeDisplayCacheChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeOfficeDisplayCache(listener: OfficeDisplayCacheListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getOfficeDisplayCache(): Readonly<OfficeDisplayCache> {
  return cache;
}

export function getOfficeDisplayCacheGeneration(): number {
  return cache.generation;
}

export function isOfficeDisplayCacheSyncReady(): boolean {
  return cache.sync.phase === 'ready' && cache.sync.snapshotHydratedAt != null;
}

export function isOfficeDisplayCacheSyncComplete(): boolean {
  return isOfficeDisplayCacheSyncReady() && cache.sync.hydrationLevel === 'complete';
}

export function shouldBlockOfficePageForSyncLoading(): boolean {
  if (cache.sync.phase !== 'loading') return false;
  return cache.sync.hydrationLevel !== 'persisted';
}

export function isOfficeDisplayCacheGatewayInitialPrefetchUiActive(): boolean {
  return cache.async.gatewayInitialPrefetchUiActive;
}

export function setOfficeDisplayCacheGatewayInitialPrefetchUiActive(active: boolean): void {
  if (cache.async.gatewayInitialPrefetchUiActive === active) return;
  cache = {
    ...cache,
    sync: { ...cache.sync, gatewayInitialPrefetchUiActive: active },
    async: { ...cache.async, gatewayInitialPrefetchUiActive: active },
  };
  emitOfficeDisplayCacheChange();
}

export function bumpOfficeDisplayCacheGeneration(): number {
  const next = cache.generation + 1;
  cache = createEmptyOfficeDisplayCache(next);
  emitOfficeDisplayCacheChange();
  return next;
}

export function setOfficeDisplayCacheSyncPhase(phase: OfficeCachePhase): void {
  if (cache.sync.phase === phase) return;
  cache = {
    ...cache,
    sync: { ...cache.sync, phase },
  };
  emitOfficeDisplayCacheChange();
}

export function setOfficeDisplayCacheHydrationLevel(level: OfficeSyncHydrationLevel): void {
  if (cache.sync.hydrationLevel === level) return;
  cache = {
    ...cache,
    sync: { ...cache.sync, hydrationLevel: level },
  };
  emitOfficeDisplayCacheChange();
}

export function markOfficeDisplayCacheSyncHydrated(
  preferredProjectId: string | null,
  hydrationLevel: OfficeSyncHydrationLevel,
): void {
  cache = {
    ...cache,
    sync: {
      ...cache.sync,
      phase: 'ready',
      hydrationLevel,
      snapshotHydratedAt: Date.now(),
      preferredProjectId,
    },
  };
  emitOfficeDisplayCacheChange();
}

export function touchOfficeDisplayCacheSnapshotHydrated(preferredProjectId?: string | null): void {
  if (cache.sync.phase !== 'ready') return;
  const nextPreferred =
    preferredProjectId !== undefined ? preferredProjectId : cache.sync.preferredProjectId;
  if (nextPreferred === cache.sync.preferredProjectId) return;
  const keepPreferred =
    nextPreferred != null && cache.sync.preferred?.project.id === nextPreferred
      ? cache.sync.preferred
      : null;
  cache = {
    ...cache,
    sync: {
      ...cache.sync,
      snapshotHydratedAt: Date.now(),
      preferredProjectId: nextPreferred,
      preferred: keepPreferred,
    },
  };
  emitOfficeDisplayCacheChange();
}

/** 同步区预取失败：避免 phase 长期卡在 loading。 */
export function recoverOfficeDisplayCacheSyncAfterPrefetchFailure(): void {
  if (cache.sync.phase !== 'loading') return;
  if (cache.sync.hydrationLevel === 'persisted' && cache.sync.snapshotHydratedAt != null) {
    setOfficeDisplayCacheSyncPhase('ready');
    return;
  }
  setOfficeDisplayCacheSyncPhase('idle');
}

export function patchOfficeDisplayCacheData(patch: {
  sync?: Partial<
    Pick<
      OfficeDisplayCacheSync,
      | 'fixedGroups'
      | 'tempProjects'
      | 'archivedCount'
      | 'agentBindings'
      | 'agents'
      | 'preferred'
      | 'projectCards'
      | 'hydrationLevel'
    >
  >;
  async?: Partial<Pick<OfficeDisplayCacheAsync, 'archived' | 'editContext' | 'rooms'>>;
}): void {
  cache = {
    ...cache,
    sync: patch.sync
      ? { ...cache.sync, ...patch.sync, dataRevision: cache.sync.dataRevision + 1 }
      : cache.sync,
    async: patch.async ? { ...cache.async, ...patch.async } : cache.async,
  };
  emitOfficeDisplayCacheChange();
}

export function removeOfficeDisplayCacheProject(projectId: string): void {
  const { [projectId]: _card, ...projectCards } = cache.sync.projectCards;
  const { [projectId]: _room, ...rooms } = cache.async.rooms;
  const wasActive = cache.sync.tempProjects.some((p) => p.id === projectId);
  const wasArchived = cache.async.archived.projects.some((p) => p.id === projectId);
  const nextProjects = cache.sync.tempProjects.filter((p) => p.id !== projectId);
  const nextArchived = cache.async.archived.projects.filter((p) => p.id !== projectId);
  const preferred =
    cache.sync.preferred?.project.id === projectId ? null : cache.sync.preferred;
  if (
    _card === undefined
    && _room === undefined
    && !wasActive
    && !wasArchived
    && preferred === cache.sync.preferred
  ) {
    return;
  }
  let archivedCount = cache.sync.archivedCount;
  if (wasArchived && !wasActive) {
    archivedCount = Math.max(0, archivedCount - 1);
  }
  cache = {
    ...cache,
    sync: {
      ...cache.sync,
      tempProjects: nextProjects,
      projectCards,
      preferred,
      archivedCount,
      dataRevision: cache.sync.dataRevision + 1,
    },
    async: {
      ...cache.async,
      rooms,
      archived: { ...cache.async.archived, projects: nextArchived },
    },
  };
  emitOfficeDisplayCacheChange();
}

export function getOfficeDisplayCacheProjectCardPhase(projectId: string): OfficeCachePhase {
  return cache.sync.projectCards[projectId]?.phase ?? 'idle';
}

export function setOfficeDisplayCacheProjectCardPhase(
  projectId: string,
  phase: OfficeCachePhase,
): void {
  const prev = cache.sync.projectCards[projectId];
  if ((prev?.phase ?? 'idle') === phase) return;
  cache = {
    ...cache,
    sync: {
      ...cache.sync,
      projectCards: {
        ...cache.sync.projectCards,
        [projectId]: {
          phase,
          project: prev?.project ?? null,
        },
      },
    },
  };
  emitOfficeDisplayCacheChange();
}

export function getOfficeDisplayCacheRoomPhase(projectId: string): OfficeCachePhase {
  return cache.async.rooms[projectId]?.phase ?? 'idle';
}

export function setOfficeDisplayCacheRoomPhase(projectId: string, phase: OfficeCachePhase): void {
  const prev = cache.async.rooms[projectId];
  if ((prev?.phase ?? 'idle') === phase) return;
  cache = {
    ...cache,
    async: {
      ...cache.async,
      rooms: {
        ...cache.async.rooms,
        [projectId]: {
          phase,
          messages: prev?.messages ?? [],
        },
      },
    },
  };
  emitOfficeDisplayCacheChange();
}

export function setOfficeDisplayCacheArchivedPhase(phase: OfficeCachePhase): void {
  if (cache.async.archived.phase === phase) return;
  cache = {
    ...cache,
    async: {
      ...cache.async,
      archived: { ...cache.async.archived, phase },
    },
  };
  emitOfficeDisplayCacheChange();
}

export function setOfficeDisplayCacheEditContextPhase(phase: OfficeCachePhase): void {
  if (cache.async.editContext.phase === phase) return;
  cache = {
    ...cache,
    async: {
      ...cache.async,
      editContext: { ...cache.async.editContext, phase },
    },
  };
  emitOfficeDisplayCacheChange();
}

export function setOfficeDisplayCacheAsyncQueueRunning(queueRunning: boolean): void {
  if (cache.async.queueRunning === queueRunning) return;
  cache = {
    ...cache,
    async: { ...cache.async, queueRunning },
  };
  emitOfficeDisplayCacheChange();
}

export type OfficeDisplayListsSnapshot = {
  fixedGroups: OfficeFixedGroup[];
  tempProjects: OfficeTempProject[];
  agentBindings: Record<string, AgentBindingRecord>;
  agents: AgentSummary[];
  roomMessagesByProject: Record<string, RoomMessage[]>;
  archivedCount: number;
};

let stableCacheListsRevision = -1;
let stableCacheLists: OfficeDisplayListsSnapshot = {
  fixedGroups: [],
  tempProjects: [],
  agentBindings: {},
  agents: [],
  roomMessagesByProject: {},
  archivedCount: 0,
};

function readOfficeDisplayListsFromCache(): OfficeDisplayListsSnapshot {
  const roomMessagesByProject: Record<string, RoomMessage[]> = {};
  for (const [projectId, entry] of Object.entries(cache.async.rooms)) {
    roomMessagesByProject[projectId] = entry.messages;
  }
  if (cache.sync.preferred) {
    roomMessagesByProject[cache.sync.preferred.project.id] = cache.sync.preferred.roomMessages;
  }
  const archived =
    cache.async.archived.phase === 'ready' ? cache.async.archived.projects : [];
  return {
    fixedGroups: cache.sync.fixedGroups,
    tempProjects: [...cache.sync.tempProjects, ...archived],
    agentBindings: cache.sync.agentBindings,
    agents: cache.sync.agents,
    roomMessagesByProject,
    archivedCount: cache.sync.archivedCount,
  };
}

export function getOfficeDisplayCacheListsSnapshot(): OfficeDisplayListsSnapshot {
  const revision = cache.sync.dataRevision;
  if (revision === stableCacheListsRevision) {
    return stableCacheLists;
  }
  stableCacheListsRevision = revision;
  stableCacheLists = readOfficeDisplayListsFromCache();
  return stableCacheLists;
}

/** @internal */
export function resetOfficeDisplayListsSnapshotForTest(): void {
  stableCacheListsRevision = -1;
  stableCacheLists = {
    fixedGroups: [],
    tempProjects: [],
    agentBindings: {},
    agents: [],
    roomMessagesByProject: {},
    archivedCount: 0,
  };
}

/** @internal test helper */
export function resetOfficeDisplayCacheForTest(): void {
  cache = createEmptyOfficeDisplayCache();
  resetOfficeDisplayListsSnapshotForTest();
  emitOfficeDisplayCacheChange();
}

export function getOfficeDisplayCacheDataRevision(): number {
  return cache.sync.dataRevision;
}
