import type { RoleWorkStatusRecord } from '../../../src/lib/office-project-context';

const cache = new Map<string, RoleWorkStatusRecord[]>();

function cacheKey(coordinatorAgentId: string, taskId: string, memberKey: string): string {
  return `${coordinatorAgentId.trim()}:${taskId.trim()}:${memberKey.trim()}`;
}

export function getRoleStatusCache(
  coordinatorAgentId: string,
  taskId: string,
  roleId: string,
): RoleWorkStatusRecord[] {
  return cache.get(cacheKey(coordinatorAgentId, taskId, roleId)) ?? [];
}

export function setRoleStatusCache(
  coordinatorAgentId: string,
  taskId: string,
  roleId: string,
  records: RoleWorkStatusRecord[],
): void {
  cache.set(cacheKey(coordinatorAgentId, taskId, roleId), records);
}

export function clearRoleStatusCacheForAgentTask(
  coordinatorAgentId: string,
  taskId: string,
): void {
  const prefix = `${coordinatorAgentId.trim()}:${taskId.trim()}:`;
  for (const key of [...cache.keys()]) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

export function clearRoleStatusCacheForTask(taskId: string): void {
  const needle = `:${taskId.trim()}:`;
  for (const key of [...cache.keys()]) {
    if (key.includes(needle)) cache.delete(key);
  }
}
