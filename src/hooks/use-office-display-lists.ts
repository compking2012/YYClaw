import { useSyncExternalStore } from 'react';
import {
  getOfficeDisplayCache,
  getOfficeDisplayCacheListsSnapshot,
  isOfficeDisplayCacheSyncReady,
  resetOfficeDisplayListsSnapshotForTest,
  subscribeOfficeDisplayCache,
  type OfficeDisplayListsSnapshot,
} from '@/lib/office-display-cache';
import { useAgentsStore } from '@/stores/agents';
import { useOfficeStore } from '@/stores/office';

export type OfficeDisplayLists = OfficeDisplayListsSnapshot;

function readOfficeDisplayListsFromStore(): OfficeDisplayLists {
  const office = useOfficeStore.getState();
  const agents = useAgentsStore.getState();
  return {
    fixedGroups: office.fixedGroups,
    tempProjects: office.tempProjects,
    agentBindings: office.agentBindings,
    agents: agents.agents,
    roomMessagesByProject: office.roomMessagesByProject,
    archivedCount: office.tempProjects.filter((p) => (p.lifecycle ?? 'active') !== 'active').length,
  };
}

export { resetOfficeDisplayListsSnapshotForTest };

/**
 * Office 列表/卡片/群聊展示数据：sync 就绪时读缓存（与持久化镜像一致），否则读 store。
 */
export function useOfficeDisplayLists(): OfficeDisplayLists {
  const storeOfficeTick = useOfficeStore(
    (s) => `${s.fixedGroups.length}:${s.tempProjects.map((p) => p.updatedAt).join(',')}`,
  );
  const storeRoomsTick = useOfficeStore(
    (s) => Object.entries(s.roomMessagesByProject).map(([id, msgs]) => `${id}:${msgs.length}`).join('|'),
  );
  const storeAgentsTick = useAgentsStore((s) => s.agents.map((a) => a.id).join(','));

  const cacheRevision = useSyncExternalStore(
    subscribeOfficeDisplayCache,
    () => (isOfficeDisplayCacheSyncReady() ? getOfficeDisplayCache().sync.dataRevision : -1),
    () => -1,
  );

  if (isOfficeDisplayCacheSyncReady()) {
    void cacheRevision;
    return getOfficeDisplayCacheListsSnapshot();
  }

  void storeOfficeTick;
  void storeRoomsTick;
  void storeAgentsTick;
  return readOfficeDisplayListsFromStore();
}

export function useOfficeSyncCacheRevision(): number {
  return useSyncExternalStore(
    subscribeOfficeDisplayCache,
    () => getOfficeDisplayCache().sync.dataRevision,
    () => 0,
  );
}
