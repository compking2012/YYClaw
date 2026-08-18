import { schedulePreferredSyncRefresh } from '@/lib/office-display-cache-data';
import {
  getOfficeDisplayCache,
  isOfficeDisplayCacheSyncReady,
  removeOfficeDisplayCacheProject,
  setOfficeDisplayCacheProjectCardPhase,
  setOfficeDisplayCacheRoomPhase,
  touchOfficeDisplayCacheSnapshotHydrated,
} from '@/lib/office-display-cache';
import {
  enqueueOfficeProjectPrefetchSlice,
  invalidateProjectCardPrefetch,
  invalidateProjectRoomPrefetch,
  notifyProjectCardSynced,
  preferredPrefetchTargetId,
  syncIdleProjectCardPrefetch,
  clearOfficeProjectPrefetchTracking,
} from '@/lib/office-project-prefetch';
import {
  isOfficeProjectArchived,
  isOfficeProjectExecuting,
} from '@/lib/office-room-sidebar';
import type { OfficeTempProject } from '@/types/office';

function projectOfficeCacheStructuralSignature(
  project: OfficeTempProject,
): string {
  return [
    project.lifecycle ?? 'active',
    project.status,
    project.archivedRestartedAt ?? '',
    isOfficeProjectExecuting(project) ? 'executing' : 'idle',
  ].join('|');
}

function projectNeedsCacheReconcile(prev: OfficeTempProject, next: OfficeTempProject): boolean {
  if (projectOfficeCacheStructuralSignature(prev) !== projectOfficeCacheStructuralSignature(next)) {
    return true;
  }
  if (isOfficeProjectExecuting(next)) return false;
  return prev.updatedAt !== next.updatedAt;
}

function enqueuePrefetchIfSyncReady(projectId: string, slices: Array<'card' | 'room'>): void {
  if (!isOfficeDisplayCacheSyncReady()) return;
  const preferredId = getOfficeDisplayCache().sync.preferredProjectId;
  if (projectId === preferredId) return;
  for (const slice of slices) {
    enqueueOfficeProjectPrefetchSlice(projectId, slice);
  }
}

/** 单项目状态迁移后同步展示缓存（新建 / 归档 / 运行态变化等）。 */
export function reconcileOfficeDisplayCacheForProject(
  prev: OfficeTempProject | undefined,
  next: OfficeTempProject,
): void {
  if (!prev) {
    setOfficeDisplayCacheProjectCardPhase(next.id, 'idle');
    setOfficeDisplayCacheRoomPhase(next.id, 'idle');
    enqueuePrefetchIfSyncReady(next.id, ['card', 'room']);
    return;
  }

  const prevArchived = isOfficeProjectArchived(prev);
  const nextArchived = isOfficeProjectArchived(next);
  const prevExecuting = isOfficeProjectExecuting(prev);
  const nextExecuting = isOfficeProjectExecuting(next);

  if (prevArchived !== nextArchived) {
    if (nextArchived) {
      notifyProjectCardSynced(next.id);
      invalidateProjectRoomPrefetch(next.id);
    } else {
      invalidateProjectCardPrefetch(next.id);
      invalidateProjectRoomPrefetch(next.id);
      enqueuePrefetchIfSyncReady(next.id, ['card', 'room']);
    }
    return;
  }

  const preferredId = getOfficeDisplayCache().sync.preferredProjectId;
  if (next.id === preferredId) {
    return;
  }

  if (prevExecuting !== nextExecuting) {
    if (nextExecuting) {
      invalidateProjectCardPrefetch(next.id);
      invalidateProjectRoomPrefetch(next.id);
      enqueuePrefetchIfSyncReady(next.id, ['card', 'room']);
    } else {
      notifyProjectCardSynced(next.id);
      invalidateProjectRoomPrefetch(next.id);
      enqueuePrefetchIfSyncReady(next.id, ['room']);
    }
    return;
  }

  if (!nextArchived && !nextExecuting) {
    notifyProjectCardSynced(next.id);
  }
}

/** snapshot 持久化写入 store 后，与预取缓存对齐。 */
export function reconcileOfficeDisplayCacheFromProjects(
  prevProjects: OfficeTempProject[],
  nextProjects: OfficeTempProject[],
): void {
  const prevById = new Map(prevProjects.map((project) => [project.id, project]));
  const nextIds = new Set(nextProjects.map((project) => project.id));

  for (const projectId of Object.keys(getOfficeDisplayCache().sync.projectCards)) {
    if (!nextIds.has(projectId)) {
      clearOfficeProjectPrefetchTracking(projectId);
      removeOfficeDisplayCacheProject(projectId);
    }
  }
  for (const projectId of Object.keys(getOfficeDisplayCache().async.rooms)) {
    if (!nextIds.has(projectId)) {
      clearOfficeProjectPrefetchTracking(projectId);
      removeOfficeDisplayCacheProject(projectId);
    }
  }

  for (const next of nextProjects) {
    const prev = prevById.get(next.id);
    if (!prev || projectNeedsCacheReconcile(prev, next)) {
      reconcileOfficeDisplayCacheForProject(prev, next);
    }
  }

  if (isOfficeDisplayCacheSyncReady()) {
    const prevPreferredId = getOfficeDisplayCache().sync.preferredProjectId;
    const nextPreferredId = preferredPrefetchTargetId(nextProjects);
    touchOfficeDisplayCacheSnapshotHydrated(nextPreferredId);
    if (prevPreferredId !== nextPreferredId) {
      schedulePreferredSyncRefresh(nextPreferredId);
    }
    syncIdleProjectCardPrefetch(nextProjects);
  }
}
