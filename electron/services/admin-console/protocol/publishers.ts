import type { GatewayStatus } from '../../../gateway/manager';
import {
  collectAgentActivity,
  collectConfigSnapshot,
  collectStatsAll,
  collectSystemSnapshot,
  type ClientHeartbeatLifecycleStatus,
} from '../collectors';
import { listAgentsSnapshot, type AgentsSnapshot } from '../../../utils/agent-config';

/** Maps local gateway manager state to ClawManager `clients.status` (heartbeat). Exported for uplink coalescing. */
export function managerFacingLifecycleStatus(gw: GatewayStatus | null | undefined): ClientHeartbeatLifecycleStatus {
  if (!gw) return 'online';
  if (gw.state === 'stopped') return 'gateway_offline';
  if (gw.state === 'starting' || gw.state === 'reconnecting') return 'gateway_reconfiguring';
  if (gw.state === 'running' && gw.gatewayReady !== true) return 'gateway_warming';
  return 'online';
}

export type BuildHeartbeatPayloadOptions = {
  /**
   * 网关状态变化后防抖补发的那次心跳：仍带上磁盘上的完整配置快照，便于 Manager 以客户端为准刷新模型 UI，
   * 即便 lifecycle 仍为 gateway_*（平时周期心跳会跳过快照以免与进程状态短暂不一致）。
   */
  forceConfigSnapshot?: boolean;
};

export type ClientHeartbeatAgentRoster = {
  client_id: string;
  schema_version: 1;
  reported_at: string;
  defaultAgentId: string;
  defaultModelRef: string | null;
  agents: Array<{
    id: string;
    name: string;
    isDefault: boolean;
    modelRef: string | null;
    overrideModelRef: string | null;
    workspace: string;
    agentDir: string;
    channelTypes: string[];
  }>;
};

export function buildHeartbeatAgentRoster(
  clientId: string,
  reportedAt: string,
  snapshot: AgentsSnapshot,
): ClientHeartbeatAgentRoster {
  return {
    client_id: clientId,
    schema_version: 1,
    reported_at: reportedAt,
    defaultAgentId: snapshot.defaultAgentId,
    defaultModelRef: snapshot.defaultModelRef,
    agents: snapshot.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      isDefault: agent.isDefault,
      modelRef: agent.modelRef,
      overrideModelRef: agent.overrideModelRef,
      workspace: agent.workspace,
      agentDir: agent.agentDir,
      channelTypes: agent.channelTypes,
    })),
  };
}

export async function buildHeartbeatPayload(
  clientId: string,
  gatewayStatus?: GatewayStatus | null,
  options?: BuildHeartbeatPayloadOptions,
): Promise<Record<string, unknown>> {
  const lifecycle = managerFacingLifecycleStatus(gatewayStatus ?? null);
  const skipConfigSnapshot =
    !options?.forceConfigSnapshot
    && (lifecycle === 'gateway_reconfiguring'
      || lifecycle === 'gateway_warming'
      || lifecycle === 'gateway_offline');

  const [system, config, agentActivity, stats, agentsSnapshot] = await Promise.all([
    collectSystemSnapshot(lifecycle),
    skipConfigSnapshot ? Promise.resolve({} as Record<string, unknown>) : collectConfigSnapshot(),
    collectAgentActivity(),
    collectStatsAll(),
    listAgentsSnapshot(),
  ]);
  const timestamp = typeof system.timestamp === 'number'
    ? system.timestamp * 1000
    : Date.now();
  const agentRoster = buildHeartbeatAgentRoster(clientId, new Date(timestamp).toISOString(), agentsSnapshot);

  const base: Record<string, unknown> = {
    client_id: clientId,
    ...system,
    agentRoster,
    agentActivity,
    stats,
  };

  if (!skipConfigSnapshot) {
    Object.assign(base, config);
    if (config.crontab !== undefined) {
      base.crontabs = config.crontab;
    }
  }

  return base;
}

export async function buildConfigChangePayload(clientId: string): Promise<Record<string, unknown>> {
  const config = await collectConfigSnapshot();
  return {
    client_id: clientId,
    ...config,
    crontabs: config.crontab,
  };
}
