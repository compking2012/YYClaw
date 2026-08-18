// @ts-nocheck
import type { GatewayManager } from '../../../gateway/manager';
import { logger } from '../../../utils/logger';
import { updateAgentToolsPolicy } from '../../../utils/agent-config';
import { adminSyncLagLog } from './admin-sync-lag-log';
import { scheduleGatewayRefresh } from '../../providers/provider-runtime-sync';
import { notifyManagerConfigSnapshotBeforeGatewayReload } from '../notify-manager-config-snapshot';

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asStringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean);
  return out;
}

export async function applyAgentsSetTools(
  gateway: GatewayManager,
  payloadUnknown: unknown,
): Promise<{ ok: boolean; agentId: string }> {
  adminSyncLagLog('agents_set_tools_enter', {});
  const payload = asObj(payloadUnknown);
  if (!payload) throw new Error('agents_set_tools: payload must be an object');
  const agentId = typeof payload.agentId === 'string' ? payload.agentId.trim() : '';
  if (!agentId) throw new Error('agents_set_tools: agentId is required');
  const allow = asStringArray(payload.allow);
  const deny = asStringArray(payload.deny);

  await updateAgentToolsPolicy(agentId, { allow, deny });
  logger.info(`[clawx_apply_sync] agents_set_tools ${agentId}`);
  notifyManagerConfigSnapshotBeforeGatewayReload('clawx_apply_sync_agents_set_tools');
  scheduleGatewayRefresh(
    gateway,
    `[clawx_apply_sync] OpenClaw config written after agents_set_tools (${agentId})`,
  );
  return { ok: true, agentId };
}
