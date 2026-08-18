// @ts-nocheck
import type { GatewayManager } from '../../../gateway/manager';

let applySyncDepth = 0;
const idleWaiters: Array<() => void> = [];

function flushIdleWaiters(): void {
  if (applySyncDepth !== 0) {
    return;
  }
  const w = idleWaiters.splice(0, idleWaiters.length);
  for (const fn of w) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

/**
 * While apply-sync depth is positive, any in-flight / queued `sessions.list` is cooperatively
 * cancelled on enter (via `GatewayManager.cooperativeCancelSessionsListForAdminSync`) so `config.set`
 * from apply-sync is not stuck behind a slow `sessions.list`.
 */
export function adminApplySyncSessionsGateEnter(gateway: GatewayManager): void {
  applySyncDepth += 1;
  if (applySyncDepth === 1) {
    gateway.cooperativeCancelSessionsListForAdminSync(
      new Error('RPC deferred: admin apply sync in progress'),
    );
  }
}

export function adminApplySyncSessionsGateLeave(_gateway: GatewayManager): void {
  applySyncDepth = Math.max(0, applySyncDepth - 1);
  flushIdleWaiters();
}

/** Resolve when no admin apply-sync is active (`clawx_apply_sync` handler). */
export function awaitAdminApplySyncSessionsIdle(): Promise<void> {
  if (applySyncDepth === 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    idleWaiters.push(resolve);
  });
}
