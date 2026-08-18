import type { WorkflowNodeRuntimeStatus } from '@/components/office/WorkflowVisualPreview';
import type { NodeRunRecord, WorkflowNode } from '@/types/office';

/** 节点是否已真正向 Gateway 发起大模型调用（有 runId）。 */
export function workflowNodeLlmDispatched(
  run: Pick<NodeRunRecord, 'runId'> | undefined,
): boolean {
  return Boolean(run?.runId?.trim());
}

/** 仅在实际 LLM 已派发时对 running 节点做脉冲高亮。 */
export function workflowNodeShouldPulse(
  status: WorkflowNodeRuntimeStatus | undefined,
  run: Pick<NodeRunRecord, 'runId'> | undefined,
): boolean {
  return status === 'running' && workflowNodeLlmDispatched(run);
}

/**
 * 上游层已全部完成，且下游至少一步处于「待执行」或「已发帖执行中但尚未派发 LLM」时，
 * 高亮层间箭头（表示交接带）。
 */
export function shouldHighlightWorkflowLayerHandoff(
  previousLayerNodes: WorkflowNode[],
  nextLayerNodes: WorkflowNode[],
  nodeStatusById: Record<string, WorkflowNodeRuntimeStatus | undefined>,
  nodeRuns: NodeRunRecord[],
): boolean {
  if (previousLayerNodes.length === 0 || nextLayerNodes.length === 0) return false;

  const runsByNodeId = new Map(nodeRuns.map((r) => [r.nodeId, r]));
  const prevAllCompleted = previousLayerNodes.every(
    (n) => nodeStatusById[n.id] === 'completed',
  );
  if (!prevAllCompleted) return false;

  return nextLayerNodes.some((n) => {
    const st = nodeStatusById[n.id];
    if (st === 'pending') return true;
    if (st === 'running' && !workflowNodeLlmDispatched(runsByNodeId.get(n.id))) {
      return true;
    }
    return false;
  });
}
