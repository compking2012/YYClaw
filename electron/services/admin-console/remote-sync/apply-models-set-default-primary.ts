// @ts-nocheck
import type { GatewayManager } from '../../../gateway/manager';
import { awaitAgentRuntimeConvergence } from '../../../gateway/config-refresh-scheduler';
import { logger } from '../../../utils/logger';
import { listAgentsSnapshotReadOnly } from '../../../utils/agent-config';
import { readModifyWriteOpenClawJson } from '../../../utils/openclaw-auth';
import { adminSyncLagLog } from './admin-sync-lag-log';
import { normalizeConfigPayload } from './config-helpers';

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/**
 * Manager workbench: switch default model via read-modify-write on
 * `openclaw.json`, then wait for the live runtime snapshot to converge.
 */
export async function applyModelsSetDefaultPrimary(
  gateway: GatewayManager,
  payloadUnknown: unknown,
): Promise<{ ok: boolean; primary: string }> {
  adminSyncLagLog('models_set_default_primary_enter', {});
  const payload = asObj(payloadUnknown);
  if (!payload) throw new Error('models_set_default_primary: payload must be an object');

  const primary = typeof payload.primaryModel === 'string' ? payload.primaryModel.trim() : '';
  if (!primary) throw new Error('models_set_default_primary: primaryModel is required');

  adminSyncLagLog('models_set_default_primary_disk_write_start', { primary });
  await readModifyWriteOpenClawJson((current) => {
    const currentConfig = normalizeConfigPayload(current);
    const agents = asObj(currentConfig.agents) ?? {};
    const defaults = asObj(agents.defaults) ?? {};
    const modelBlock = asObj(defaults.model) ?? {};

    const nextDefaults: Record<string, unknown> = {
      ...defaults,
      model: { ...modelBlock, primary },
    };

    const dm = payload.defaultsModels;
    if (dm && typeof dm === 'object' && !Array.isArray(dm)) {
      nextDefaults.models = dm;
    }

    return {
      ...currentConfig,
      agents: {
        ...agents,
        defaults: nextDefaults,
      },
    };
  });
  adminSyncLagLog('models_set_default_primary_disk_write_done', { primary });
  logger.info(`[clawx_apply_sync] models_set_default_primary ${primary} (awaiting native watcher)`);
  adminSyncLagLog('models_set_default_primary_runtime_wait_started', { primary });
  const snapshot = await listAgentsSnapshotReadOnly();
  await awaitAgentRuntimeConvergence(
    gateway,
    snapshot.agents.flatMap((agent) => {
      const modelRef = agent.modelRef?.trim();
      return modelRef ? [{ agentId: agent.id, modelRef }] : [];
    }),
  );
  return { ok: true, primary };
}
