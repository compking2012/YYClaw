import type { GatewayManager } from '../../../gateway/manager';
import { awaitAgentRuntimeConvergence } from '../../../gateway/config-refresh-scheduler';
import { logger } from '../../../utils/logger';
import { updateAgentModel } from '../../../utils/agent-config';
import { adminSyncLagLog } from './admin-sync-lag-log';
import {
  syncAgentModelOverrideToRuntime,
  syncAllProviderAuthToRuntime,
} from '../../providers/provider-runtime-sync';
import { notifyManagerConfigSnapshotBeforeGatewayReload } from '../notify-manager-config-snapshot';

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export async function applyAgentsSetModel(
  gateway: GatewayManager,
  payloadUnknown: unknown,
): Promise<{ ok: boolean; agentId: string }> {
  adminSyncLagLog('agents_set_model_enter', {});
  const payload = asObj(payloadUnknown);
  if (!payload) throw new Error('agents_set_model: payload must be an object');
  const agentId = typeof payload.agentId === 'string' ? payload.agentId.trim() : '';
  if (!agentId) throw new Error('agents_set_model: agentId is required');
  let modelRef: string | null;
  if (payload.model === null || payload.model === undefined) {
    modelRef = null;
  } else if (typeof payload.model === 'string') {
    const t = payload.model.trim();
    modelRef = t || null;
  } else {
    throw new Error('agents_set_model: model must be a string or null');
  }

  const snapshot = await updateAgentModel(agentId, modelRef);
  try {
    await syncAllProviderAuthToRuntime();
    await syncAgentModelOverrideToRuntime(agentId);
  } catch (e) {
    console.warn('[agents_set_model] runtime sync warning:', e);
  }
  logger.info(`[clawx_apply_sync] agents_set_model ${agentId}`);
  notifyManagerConfigSnapshotBeforeGatewayReload('clawx_apply_sync_agents_set_model');
  const effectiveModelRef = snapshot.agents.find((agent) => agent.id === agentId)?.modelRef?.trim();
  await awaitAgentRuntimeConvergence(
    gateway,
    effectiveModelRef ? [{ agentId, modelRef: effectiveModelRef }] : [],
  );
  return { ok: true, agentId };
}
