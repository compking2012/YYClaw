import type { GatewayStatus } from '@/types/gateway';
import { isOfficeCollaborationEnabled } from '@shared/office-collaboration-feature';
import { handleGatewayOfficeCachePrefetch } from '@/lib/office-cache-prefetch';

/** Gateway 子系统就绪，可安全拉取 Office 数据。 */
export function isGatewayReadyForOffice(status: Pick<GatewayStatus, 'state' | 'gatewayReady'>): boolean {
  return status.state === 'running' && status.gatewayReady !== false;
}

/**
 * Gateway 状态变迁：仅在 非 ready → ready 时触发 Office 缓存预取。
 */
export function handleGatewayStatusTransitionForOfficeCache(
  previous: Pick<GatewayStatus, 'state' | 'gatewayReady'>,
  next: Pick<GatewayStatus, 'state' | 'gatewayReady'>,
): void {
  if (!isOfficeCollaborationEnabled()) return;
  const wasReady = isGatewayReadyForOffice(previous);
  const nowReady = isGatewayReadyForOffice(next);
  if (wasReady || !nowReady) return;
  handleGatewayOfficeCachePrefetch(true);
}
