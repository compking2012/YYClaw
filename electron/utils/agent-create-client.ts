import { syncAllProviderAuthToRuntime } from '../services/providers/provider-runtime-sync';
import { createAgent, type AgentsSnapshot } from './agent-config';
import { ensureClawXContext } from './openclaw-workspace';

/** 与「智能体 → 添加智能体」一致的客户端 Agent 创建（含 workspace 模板与运行时同步）。 */
export async function createClientAgent(
  name: string,
  options?: { inheritWorkspace?: boolean; id?: string; skills?: string[] },
): Promise<AgentsSnapshot> {
  const snapshot = await createAgent(name, options);
  syncAllProviderAuthToRuntime().catch((err) => {
    console.warn('[agent-create] Failed to sync provider auth after agent creation:', err);
  });
  void ensureClawXContext().catch((err) => {
    console.warn('[agent-create] Failed to ensure ClawX context after agent creation:', err);
  });
  return snapshot;
}
