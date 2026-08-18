// @ts-nocheck
import { randomUUID } from 'node:crypto';
import type { GatewayManager } from '../../../gateway/manager';
import './clawxApplySyncOps/registerDefaults';
import { invokeClawxApplySyncOp } from './clawxApplySyncOps/registry';
import { adminSyncLagLog, adminSyncLagSetCorrelation } from './admin-sync-lag-log';
import {
  adminApplySyncSessionsGateEnter,
  adminApplySyncSessionsGateLeave,
} from './admin-apply-sync-sessions-gate';

/** Centrifuge RPC `clawx_apply_sync` — body `{ op, payload }`; ops registered in clawxApplySyncOps. */
export async function applyClawxSyncAction(gateway: GatewayManager | null, body: unknown): Promise<unknown> {
  if (!gateway) throw new Error('Gateway manager is not available');
  const rec = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (!rec) throw new Error('clawx_apply_sync expects a JSON object body');
  const op = typeof rec.op === 'string' ? rec.op.trim() : '';
  if (!op) throw new Error('clawx_apply_sync requires "op"');

  const cid = randomUUID();
  const t0 = performance.now();
  adminApplySyncSessionsGateEnter(gateway);
  adminSyncLagSetCorrelation(cid);
  adminSyncLagLog('apply_sync_begin', { op });
  try {
    return await invokeClawxApplySyncOp(gateway, op, rec.payload);
  } catch (e) {
    adminSyncLagLog('apply_sync_throw', {
      op,
      err: e instanceof Error ? e.message : String(e),
    });
    throw e;
  } finally {
    adminSyncLagLog('apply_sync_handler_done', { op, elapsedMs: Math.round(performance.now() - t0) });
    adminApplySyncSessionsGateLeave(gateway);
  }
}

export { registerClawxApplySyncOp, invokeClawxApplySyncOp } from './clawxApplySyncOps/registry';
export { ClawxApplySyncOp } from './clawxApplySyncOps/ops';
