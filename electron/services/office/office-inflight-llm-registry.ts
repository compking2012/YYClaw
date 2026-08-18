/**
 * Tracks in-flight Office Gateway LLM sessions so abort can target active runs
 * before nodeRuns.sessionKey is persisted (often only written after node settle).
 */

export type OfficeInflightLlmEntry = {
  projectId: string;
  sessionKey: string;
  runId?: string;
  agentId?: string;
  nodeId?: string;
  registeredAt: number;
};

const inflightByKey = new Map<string, OfficeInflightLlmEntry>();

function entryKey(projectId: string, sessionKey: string): string {
  return `${projectId.trim()}::${sessionKey.trim()}`;
}

export function registerOfficeInflightLlm(entry: {
  projectId: string;
  sessionKey: string;
  runId?: string;
  agentId?: string;
  nodeId?: string;
}): void {
  const projectId = entry.projectId.trim();
  const sessionKey = entry.sessionKey.trim();
  if (!projectId || !sessionKey) return;
  inflightByKey.set(entryKey(projectId, sessionKey), {
    projectId,
    sessionKey,
    runId: entry.runId?.trim() || undefined,
    agentId: entry.agentId?.trim() || undefined,
    nodeId: entry.nodeId?.trim() || undefined,
    registeredAt: Date.now(),
  });
}

export function unregisterOfficeInflightLlm(projectId: string, sessionKey: string): void {
  const id = projectId.trim();
  const key = sessionKey.trim();
  if (!id || !key) return;
  inflightByKey.delete(entryKey(id, key));
}

/** Take and clear all inflight entries for a project (abort sync path). */
export function takeOfficeInflightLlmSessionKeys(projectId: string): string[] {
  const id = projectId.trim();
  if (!id) return [];
  const keys: string[] = [];
  for (const [mapKey, entry] of inflightByKey) {
    if (entry.projectId !== id) continue;
    keys.push(entry.sessionKey);
    inflightByKey.delete(mapKey);
  }
  return [...new Set(keys)];
}

export function listOfficeInflightLlmSessionKeys(projectId: string): string[] {
  const id = projectId.trim();
  if (!id) return [];
  const keys: string[] = [];
  for (const entry of inflightByKey.values()) {
    if (entry.projectId === id) keys.push(entry.sessionKey);
  }
  return [...new Set(keys)];
}

/** @visibleForTesting */
export function resetOfficeInflightLlmRegistryForTests(): void {
  inflightByKey.clear();
}
