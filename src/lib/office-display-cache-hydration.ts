/**
 * @deprecated 使用 office-cache-prefetch.ts。保留兼容导出。
 */

import {
  handleGatewayOfficeCachePrefetch,
  handleOfficePageEnter,
  isOfficeCachePrefetchInFlight,
  isOfficeDisplayCachePrefetchActive,
  resetOfficeCachePrefetchStateForTest,
  runOfficeCachePrefetch,
} from '@/lib/office-cache-prefetch';
import {
  resetGatewayInitialPrefetchPassForTest,
  resetOfficePrefetchState,
} from '@/lib/office-project-prefetch';
import { SHOW_OFFICE_COLLABORATION } from '@/lib/feature-office';

export {
  handleGatewayOfficeCachePrefetch,
  handleOfficePageEnter,
  isOfficeDisplayCachePrefetchActive,
  runOfficeCachePrefetch,
};

export function isOfficeCollaborationPrefetchEnabled(): boolean {
  return SHOW_OFFICE_COLLABORATION;
}

/** @deprecated 使用 runOfficeCachePrefetch({ kind: 'manual-full' }) 或 gateway 路径 */
export async function runOfficeDisplayCacheHydration(opts?: {
  withLoading?: boolean;
  gatewayInitialPass?: boolean;
}): Promise<void> {
  if (opts?.gatewayInitialPass) {
    await runOfficeCachePrefetch({ kind: 'gateway-full', gatewayInitialPass: true });
    return;
  }
  await runOfficeCachePrefetch({ kind: 'manual-full' });
}

/** @deprecated 由 runOfficeCachePrefetch 内部处理 */
export async function finalizeOfficeDisplayCacheSync(): Promise<string | null> {
  return null;
}

export function isOfficeDisplayCacheHydrationInFlight(): boolean {
  return isOfficeCachePrefetchInFlight();
}

export function resetOfficeDisplayCacheHydrationForTest(): void {
  resetOfficeCachePrefetchStateForTest();
  resetOfficePrefetchState();
  resetGatewayInitialPrefetchPassForTest();
}
