/** Office 场景禁止 Agent 侧自行 spawn 的工具（Smart 群聊 @ 派活 / Workflow serial 执行）。 */
export const OFFICE_SPAWN_TOOL_DENY = ['sessions_spawn', 'sessions_yield', 'subagents'] as const;

export type OfficeSpawnToolDeny = (typeof OFFICE_SPAWN_TOOL_DENY)[number];

export function mergeOfficeSpawnToolDeny(
  existingTools: Record<string, unknown>,
): Record<string, unknown> {
  const allow = new Set<string>(
    Array.isArray(existingTools.allow) ? (existingTools.allow as string[]) : [],
  );
  for (const tool of OFFICE_SPAWN_TOOL_DENY) {
    allow.delete(tool);
  }
  const deny = new Set<string>(
    Array.isArray(existingTools.deny) ? (existingTools.deny as string[]) : [],
  );
  for (const tool of OFFICE_SPAWN_TOOL_DENY) {
    deny.add(tool);
  }
  return {
    ...existingTools,
    allow: [...allow],
    deny: [...deny],
  };
}

export function stripOfficeSpawnToolDeny(
  existingTools: Record<string, unknown>,
): Record<string, unknown> {
  const deny = new Set<string>(
    Array.isArray(existingTools.deny) ? (existingTools.deny as string[]) : [],
  );
  for (const tool of OFFICE_SPAWN_TOOL_DENY) {
    deny.delete(tool);
  }
  const next: Record<string, unknown> = { ...existingTools };
  if (deny.size > 0) {
    next.deny = [...deny];
  } else {
    delete next.deny;
  }
  return next;
}

/** @deprecated Use {@link rebuildOfficeSpawnPolicyRefsFromStore} from office-spawn-policy-reconcile. */
export async function refreshOfficeSpawnToolPolicy(): Promise<void> {
  const { rebuildOfficeSpawnPolicyRefsFromStore } = await import('./office-spawn-policy-reconcile');
  await rebuildOfficeSpawnPolicyRefsFromStore();
}

/** Office RPC 路径包装：tool deny 由 runtime policy 注入，不写 openclaw.json。 */
export async function withOfficeSpawnToolDeny<T>(
  _agentId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return fn();
}

export function resolveAgentIdFromOfficeSessionKey(sessionKey: string): string {
  const match = sessionKey.trim().match(/^agent:([^:]+):/);
  return match?.[1]?.trim() ?? '';
}

/** Office 主进程禁止通过 Gateway RPC 新建 subagent（Workflow 亦走 serial）。 */
export function assertOfficeSpawnRpcDisabled(): never {
  throw new Error('Office 场景已禁用 subagent spawn（sessions.spawn）');
}
