// @ts-nocheck
import type { GatewayManager } from '../../../gateway/manager';
import { logger } from '../../../utils/logger';
import { updateAgentListProfile } from '../../../utils/agent-config';
import { adminSyncLagLog } from './admin-sync-lag-log';
import { scheduleGatewayRefresh } from '../../providers/provider-runtime-sync';
import { notifyManagerConfigSnapshotBeforeGatewayReload } from '../notify-manager-config-snapshot';

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export async function applyAgentsUpdateProfile(
  gateway: GatewayManager,
  payloadUnknown: unknown,
): Promise<{ ok: boolean; agentId: string }> {
  adminSyncLagLog('agents_update_profile_enter', {});
  const payload = asObj(payloadUnknown);
  if (!payload) throw new Error('agents_update_profile: payload must be an object');
  const agentId = typeof payload.agentId === 'string' ? payload.agentId.trim() : '';
  if (!agentId) throw new Error('agents_update_profile: agentId is required');

  const name = typeof payload.name === 'string' ? payload.name : undefined;
  const theme = typeof payload.theme === 'string' ? payload.theme : undefined;
  const emoji = typeof payload.emoji === 'string' ? payload.emoji : undefined;
  const avatar = typeof payload.avatar === 'string' ? payload.avatar : undefined;

  await updateAgentListProfile(agentId, { name, theme, emoji, avatar });
  logger.info(`[clawx_apply_sync] agents_update_profile ${agentId}`);
  notifyManagerConfigSnapshotBeforeGatewayReload('clawx_apply_sync_agents_update_profile');
  scheduleGatewayRefresh(
    gateway,
    `[clawx_apply_sync] OpenClaw config written after agents_update_profile (${agentId})`,
  );
  return { ok: true, agentId };
}
