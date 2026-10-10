import { isDevModeUnlocked } from '../../../utils/dev-mode';
import { logger } from '../../../utils/logger';

/** Monotonic anchor: last time a server-initiated `clawx_apply_sync` RPC was received on the device. */
let lastClawxRpcRecvPerf = 0;

/** Correlation id for one apply op (cleared after RPC reply is sent). */
let activeCorrelationId: string | null = null;

export function adminSyncLagSetCorrelation(id: string | null): void {
  activeCorrelationId = id;
}

export function adminSyncLagMarkClawxRpcReceived(): void {
  lastClawxRpcRecvPerf = performance.now();
}

export function adminSyncLagResetClawxRpcAnchor(): void {
  lastClawxRpcRecvPerf = 0;
}

function deltaSinceClawxRpcRecvMs(): string {
  if (lastClawxRpcRecvPerf <= 0) return 'n/a';
  return String(Math.round(performance.now() - lastClawxRpcRecvPerf));
}

/** Centrifuge 心跳 uplink 阶段：终端固定打出 lifecycle，便于对照 burst/30s。 */
const HEARTBEAT_UPLINK_PHASES = new Set([
  'heartbeat_uplink_begin',
  'heartbeat_uplink_ack',
  'heartbeat_uplink_err',
]);

function formatGatewayReadyLabel(value: unknown): string {
  if (value === true) return 'true';
  if (value === false) return 'false';
  return 'n/a';
}

function formatHeartbeatUplinkLogSuffix(fields?: Record<string, unknown>): string {
  if (!fields) return '';
  const parts: string[] = [];
  if (fields.lifecycle != null) parts.push(`lifecycle=${String(fields.lifecycle)}`);
  if (fields.gatewayState != null) parts.push(`state=${String(fields.gatewayState)}`);
  if ('gatewayReady' in fields) {
    parts.push(`gatewayReady=${formatGatewayReadyLabel(fields.gatewayReady)}`);
  }
  if (fields.lagReason != null) parts.push(`reason=${String(fields.lagReason)}`);
  if (fields.rpcMs != null) parts.push(`rpcMs=${String(fields.rpcMs)}`);
  if (fields.err != null) parts.push(`err=${String(fields.err)}`);
  return parts.length ? ` ${parts.join(' ')}` : '';
}

/**
 * Debug timeline for remote sync lag (Manager ↔ device). Grep logs for `[admin-sync-lag]`.
 * `ΔclawxRpcMs` = ms since this device received the `clawx_apply_sync` Centrifuge RPC (includes queue wait before op runs).
 */
export function adminSyncLagLog(phase: string, fields?: Record<string, unknown>): void {
  const heartbeatSuffix = HEARTBEAT_UPLINK_PHASES.has(phase)
    ? formatHeartbeatUplinkLogSuffix(fields)
    : '';

  if (isDevModeUnlocked()) {
    logger.info(
      `[admin-sync-lag] ${phase}${heartbeatSuffix} cid=${activeCorrelationId ?? '-'} ΔclawxRpcMs=${deltaSinceClawxRpcRecvMs()}`,
      fields ?? {},
    );
    return;
  }

  if (heartbeatSuffix) {
    logger.info(`[admin-sync-lag] ${phase}${heartbeatSuffix}`);
    return;
  }

  logger.info(`[admin-sync-lag] ${phase}`);
}
