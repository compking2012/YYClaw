import type { GatewayManager } from '../../../gateway/manager';
import { logger } from '../../../utils/logger';
import { adminSyncLagLog } from './admin-sync-lag-log';

/**
 * Remote-only op: request a debounced full process restart without blocking the
 * apply-sync ACK (same loose semantics as local channel/plugin saves).
 */
export async function applyGatewayRestart(
  gateway: GatewayManager,
  _payload: unknown,
): Promise<{ ok: boolean }> {
  adminSyncLagLog('gateway_restart_op_scheduled', {});
  gateway.debouncedRestart(150);
  logger.info('[clawx_apply_sync] gateway_restart scheduled (debounced; ACK does not await spawn)');
  return { ok: true };
}
