import type { GatewayManager } from '../../../gateway/manager';
import { awaitAgentRuntimeConvergence } from '../../../gateway/config-refresh-scheduler';
import { logger } from '../../../utils/logger';
import { setDefaultAgent } from '../../../utils/agent-config';
import { adminSyncLagLog } from './admin-sync-lag-log';
import { notifyManagerConfigSnapshotBeforeGatewayReload } from '../notify-manager-config-snapshot';

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export async function applyAgentsSetDefault(
  gateway: GatewayManager,
  payloadUnknown: unknown,
): Promise<{ ok: boolean; agentId: string }> {
  adminSyncLagLog('agents_set_default_enter', {});
  const payload = asObj(payloadUnknown);
  if (!payload) throw new Error('agents_set_default: payload must be an object');
  const agentId = typeof payload.agentId === 'string' ? payload.agentId.trim() : '';
  if (!agentId) throw new Error('agents_set_default: agentId is required');

  const snapshot = await setDefaultAgent(agentId);
  logger.info(`[clawx_apply_sync] agents_set_default ${agentId}`);
  notifyManagerConfigSnapshotBeforeGatewayReload('clawx_apply_sync_agents_set_default');
  await awaitAgentRuntimeConvergence(
    gateway,
    snapshot.agents.flatMap((agent) => {
      const modelRef = agent.modelRef?.trim();
      return modelRef ? [{ agentId: agent.id, modelRef }] : [];
    }),
    { expectedDefaultAgentId: agentId },
  );
  return { ok: true, agentId };
}
