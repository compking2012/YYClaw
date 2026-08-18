// @ts-nocheck
import type { GatewayManager } from '../../../gateway/manager';
import { logger } from '../../../utils/logger';
import { deleteAgentConfig, removeAgentWorkspaceDirectory } from '../../../utils/agent-config';
import { adminSyncLagLog } from './admin-sync-lag-log';
import { notifyManagerConfigSnapshotBeforeGatewayReload } from '../notify-manager-config-snapshot';

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export async function applyAgentsDelete(
  gateway: GatewayManager,
  payloadUnknown: unknown,
): Promise<{ ok: boolean; agentId: string }> {
  adminSyncLagLog('agents_delete_enter', {});
  const payload = asObj(payloadUnknown);
  if (!payload) throw new Error('agents_delete: payload must be an object');
  const agentId = typeof payload.agentId === 'string' ? payload.agentId.trim() : '';
  if (!agentId) throw new Error('agents_delete: agentId is required');

  adminSyncLagLog('agents_delete_config_start', { agentId });
  const { removedEntry } = await deleteAgentConfig(agentId);
  adminSyncLagLog('agents_delete_config_done', { agentId });

  logger.info(`[clawx_apply_sync] agents_delete ${agentId} — restarting gateway`);
  notifyManagerConfigSnapshotBeforeGatewayReload('clawx_apply_sync_agents_delete');
  await gateway.restart();

  await removeAgentWorkspaceDirectory(removedEntry).catch((err) => {
    console.warn('[agents_delete] Failed to remove workspace:', err);
  });

  return { ok: true, agentId };
}
