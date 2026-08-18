import { useEffect, useState, useSyncExternalStore } from 'react';
import { isOfficeDisplayCacheGatewayInitialPrefetchUiActive } from '@/lib/office-display-cache';
import {
  getProjectPrefetchState,
  subscribeOfficeProjectPrefetch,
  type ProjectPrefetchState,
} from '@/lib/office-project-prefetch';

const EMPTY: ProjectPrefetchState = { card: 'idle', room: 'idle' };

export function useOfficeProjectPrefetch(projectId: string | null | undefined): ProjectPrefetchState {
  const subscribe = subscribeOfficeProjectPrefetch;
  const getSnapshot = () => (projectId ? getProjectPrefetchState(projectId) : EMPTY);
  const serverSnapshot = EMPTY;

  return useSyncExternalStore(subscribe, getSnapshot, () => serverSnapshot);
}

/** 监听任意预取状态变化（用于自动展开检测）。 */
export function useOfficePrefetchRevision(): number {
  const [revision, setRevision] = useState(0);
  useEffect(() => subscribeOfficeProjectPrefetch(() => setRevision((v) => v + 1)), []);
  return revision;
}

/** Gateway ready 触发的首次 Office 预取进行中（刷新按钮绿灯，仅展示）。 */
export function useGatewayInitialOfficePrefetchUi(): boolean {
  return useSyncExternalStore(
    subscribeOfficeProjectPrefetch,
    isOfficeDisplayCacheGatewayInitialPrefetchUiActive,
    () => false,
  );
}
