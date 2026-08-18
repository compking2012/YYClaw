export function roleTaskSessionKey(
  agentId: string,
  roleId: string,
  taskId: string,
  nodeId: string,
  workflowRunId?: string,
): string {
  const base = `agent:${agentId}:office:task:${taskId}:role:${roleId}:node:${nodeId}`;
  if (workflowRunId) return `${base}:run:${workflowRunId}`;
  return base;
}

export function roleP2PSessionKey(agentId: string, peerAgentId: string, threadId: string): string {
  return `agent:${agentId}:office:p2p:${peerAgentId}:${threadId}`;
}

/** Per-project (task) team room session — one isolated room per task. */
export function taskRoomSessionKey(coordinatorAgentId: string, taskId: string): string {
  return `agent:${coordinatorAgentId}:office:task-room:${taskId}`;
}

/** @deprecated Use {@link taskRoomSessionKey}. */
export function roomSessionKey(coordinatorAgentId: string, scenarioOrTaskId: string): string {
  return taskRoomSessionKey(coordinatorAgentId, scenarioOrTaskId);
}

export function roleTaskRoomDmSuffix(taskId: string): string {
  return `task-${taskId}`;
}

export function roleDmSessionKey(agentId: string, roleId: string, suffix: string): string {
  return `agent:${agentId}:office:role:${roleId}:dm:${suffix}`;
}
