const activeNodeRunAbort = new Map<string, AbortController>();

function key(taskId: string, nodeId: string): string {
  return `${taskId}:${nodeId}`;
}

export function registerWorkflowNodeRunAbort(
  taskId: string,
  nodeId: string,
  controller: AbortController,
): void {
  activeNodeRunAbort.set(key(taskId, nodeId), controller);
}

export function clearWorkflowNodeRunAbort(taskId: string, nodeId: string): void {
  activeNodeRunAbort.delete(key(taskId, nodeId));
}

/** 中止正在执行的节点 Session（输出补全重试 / 群聊自愈重派发）。 */
export function abortWorkflowNodeRun(taskId: string, nodeId: string): void {
  activeNodeRunAbort.get(key(taskId, nodeId))?.abort();
}
