import type { GatewayManager } from '../../../gateway/manager';
import { logger } from '../../../utils/logger';
import { createAgent, createAgentWithSuppliedId } from '../../../utils/agent-config';
import { ensureClawXContext } from '../../../utils/openclaw-workspace';
import { adminSyncLagLog } from './admin-sync-lag-log';
import { scheduleGatewayRefresh, syncAllProviderAuthToRuntime } from '../../providers/provider-runtime-sync';
import { notifyManagerConfigSnapshotBeforeGatewayReload } from '../notify-manager-config-snapshot';

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export async function applyAgentsCreate(
  gateway: GatewayManager,
  payloadUnknown: unknown,
): Promise<{ ok: boolean; agentId: string }> {
  adminSyncLagLog('agents_create_enter', {});
  const payload = asObj(payloadUnknown);
  if (!payload) throw new Error('agents_create: payload must be an object');
  const agentId = typeof payload.agentId === 'string' ? payload.agentId.trim() : '';
  const displayNameRaw = typeof payload.displayName === 'string' ? payload.displayName.trim() : '';
  const workspace = typeof payload.workspace === 'string' ? payload.workspace : undefined;
  const inheritWorkspace = payload.inheritWorkspace === true;

  if (!agentId && !displayNameRaw) {
    throw new Error('agents_create: agentId or displayName is required');
  }

  let resolvedAgentId = agentId.trim().toLowerCase();

  adminSyncLagLog('agents_create_disk_write_start', { agentId: resolvedAgentId || displayNameRaw });
  if (!agentId && displayNameRaw) {
    const snapshot = await createAgent(displayNameRaw, { inheritWorkspace });
    const normalizedName = displayNameRaw.trim() || 'Agent';
    const created =
      snapshot.agents.find((a) => a.name === normalizedName) ?? snapshot.agents.at(-1);
    if (!created?.id) throw new Error('agents_create: failed to resolve new agent id');
    resolvedAgentId = created.id;
  } else {
    await createAgentWithSuppliedId(resolvedAgentId, {
      displayName: displayNameRaw || undefined,
      workspace,
      inheritWorkspace,
    });
  }
  adminSyncLagLog('agents_create_disk_write_done', { agentId: resolvedAgentId });

  syncAllProviderAuthToRuntime().catch((err) => {
    console.warn('[agents_create] Failed to sync provider auth after agent creation:', err);
  });
  void ensureClawXContext().catch((err) => {
    console.warn('[agents_create] Failed to ensure ClawX context:', err);
  });

  logger.info(`[clawx_apply_sync] agents_create ${resolvedAgentId}`);
  notifyManagerConfigSnapshotBeforeGatewayReload('clawx_apply_sync_agents_create');
  scheduleGatewayRefresh(
    gateway,
    `[clawx_apply_sync] OpenClaw config written after agents_create (${resolvedAgentId})`,
  );
  return { ok: true, agentId: resolvedAgentId };
}
