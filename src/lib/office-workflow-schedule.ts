import {
  groupNodesIntoExecutionLayers,
  topologicalSortWorkflowNodes,
} from '@/lib/office-workflow-edges';
import { nodeRunTriggersFailureEdge } from '@/lib/office-workflow-edge-outcome';
import {
  workflowNodePrimaryRoleId,
  workflowNodeRoleIds,
} from '@/lib/office-workflow-node';
import type { NodeRunRecord, WorkflowEdge, WorkflowNode } from '@/types/office';

function planningEdges(edgeList: WorkflowEdge[]): WorkflowEdge[] {
  return edgeList.filter((e) => (e.when ?? 'on_success') !== 'on_failure');
}

/** 正常推进用入边（不含 on_failure 回滚边；回滚由 completed+edgeOutcome 触发）。 */
export function forwardIncomingEdges(
  edges: WorkflowEdge[],
  nodeId: string,
): WorkflowEdge[] {
  return edges.filter(
    (e) => e.to === nodeId && (e.when ?? 'on_success') !== 'on_failure',
  );
}

function parallelExecutionLayerIndex(
  nodes: WorkflowNode[],
  nodeId: string,
): number | null {
  const layers = groupNodesIntoExecutionLayers(nodes);
  const idx = layers.findIndex((layer) => layer.some((n) => n.id === nodeId));
  return idx >= 0 ? idx : null;
}

/** 调度深度：同 parallelGroup 层共享层号，避免回滚边拉长路径导致并行叉只跑一支。 */
export function workflowNodeScheduleDepthForBatch(
  node: WorkflowNode,
  nodes: WorkflowNode[],
  schedulingEdges: WorkflowEdge[],
): number {
  if (node.parallelGroup?.trim()) {
    const layerIdx = parallelExecutionLayerIndex(nodes, node.id);
    if (layerIdx !== null) return layerIdx;
  }
  return workflowNodeScheduleDepth(node.id, nodes, schedulingEdges);
}

export function workflowEdgeList(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): WorkflowEdge[] {
  if (edges.length > 0) return edges;
  return nodes.slice(1).map((n, i) => ({
    from: nodes[i]!.id,
    to: n.id,
    when: 'on_success' as const,
  }));
}

function predecessorEdgeReady(
  edge: WorkflowEdge,
  prev: NodeRunRecord | undefined,
): boolean {
  if (!prev) return false;
  const when = edge.when ?? 'on_success';
  if (when === 'always') return prev.status === 'completed' || prev.status === 'skipped';
  if (when === 'on_partial') return prev.status === 'completed' || prev.status === 'running';
  if (when === 'on_failure') return nodeRunTriggersFailureEdge(prev);
  return (prev.status === 'completed' || prev.status === 'skipped')
    && !nodeRunTriggersFailureEdge(prev);
}

export function incomingReady(
  nodeId: string,
  edges: WorkflowEdge[],
  runs: Map<string, NodeRunRecord>,
): boolean {
  const allIncoming = edges.filter((e) => e.to === nodeId);
  const incoming = forwardIncomingEdges(edges, nodeId);
  if (incoming.length === 0) {
    if (allIncoming.length === 0) return true;
    const run = runs.get(nodeId);
    const reopenedForRollback =
      run?.status === 'pending'
      && ((run.reworkGeneration ?? 0) > 0 || Boolean(run.reworkReason?.trim()));
    if (reopenedForRollback) return true;
    return allIncoming.every((e) => predecessorEdgeReady(e, runs.get(e.from)));
  }
  return incoming.every((e) => predecessorEdgeReady(e, runs.get(e.from)));
}

/** 在完整 DAG 上判断是否存在 from → to 的有向路径（用于避免跳步并行）。 */
export function hasDirectedPath(
  fromId: string,
  toId: string,
  edgeList: WorkflowEdge[],
): boolean {
  if (fromId === toId) return true;
  const stack = [fromId];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const e of edgeList) {
      if (e.from !== cur) continue;
      if (e.to === toId) return true;
      stack.push(e.to);
    }
  }
  return false;
}

/** 从任一无前驱节点起的最长路径深度（0 = 入口层）。 */
export function workflowNodeScheduleDepth(
  nodeId: string,
  nodes: WorkflowNode[],
  edgeList: WorkflowEdge[],
): number {
  const incoming = edgeList.filter((e) => e.to === nodeId);
  if (incoming.length === 0) return 0;
  return (
    1 +
    Math.max(
      ...incoming.map((e) => workflowNodeScheduleDepth(e.from, nodes, edgeList)),
    )
  );
}

function sortNodesByProcessOrder(
  list: WorkflowNode[],
  nodes: WorkflowNode[],
  edgeList: WorkflowEdge[],
): WorkflowNode[] {
  const orderedEdges = planningEdges(edgeList);
  const ordered =
    topologicalSortWorkflowNodes(nodes, orderedEdges, (a, b) =>
      a.localeCompare(b, 'zh-CN'),
    ) ?? nodes;
  const rank = new Map(ordered.map((n, i) => [n.id, i]));
  return [...list].sort(
    (a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0),
  );
}

/** 同一角色多个可运行步骤时，仅保留流程最靠前的一步（避免产品同时跑「初稿」与「定稿」）。 */
export function dedupeSameRoleRunnableNodes(
  candidates: WorkflowNode[],
  nodes: WorkflowNode[],
  edgeList: WorkflowEdge[],
): WorkflowNode[] {
  const schedulingEdges = planningEdges(edgeList);
  const sorted = sortNodesByProcessOrder(candidates, nodes, schedulingEdges);
  const keepIds = new Set<string>();
  const roleTaken = new Set<string>();

  for (const node of sorted) {
    const roleIds = workflowNodeRoleIds(node);
    const conflict = roleIds.some((id) => roleTaken.has(id));
    if (conflict) continue;
    for (const id of roleIds) roleTaken.add(id);
    keepIds.add(node.id);
  }

  return candidates.filter((n) => keepIds.has(n.id));
}

/** Pending nodes ready to run, including parallel forks without explicit parallelGroup. */
export function nextRunnableNodes(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  runs: Map<string, NodeRunRecord>,
): WorkflowNode[] {
  const edgeList = workflowEdgeList(nodes, edges);
  const schedulingEdges = planningEdges(edgeList);

  const candidates: WorkflowNode[] = [];
  for (const node of nodes) {
    const run = runs.get(node.id);
    if (run && run.status !== 'pending') continue;
    if (!incomingReady(node.id, edgeList, runs)) continue;
    candidates.push(node);
  }

  if (candidates.length === 0) return [];

  const minDepth = Math.min(
    ...candidates.map((n) =>
      workflowNodeScheduleDepthForBatch(n, nodes, schedulingEdges),
    ),
  );
  const depthLayer = candidates.filter(
    (n) => workflowNodeScheduleDepthForBatch(n, nodes, schedulingEdges) === minDepth,
  );
  const layer = dedupeSameRoleRunnableNodes(depthLayer, nodes, schedulingEdges);

  const batch: WorkflowNode[] = [];
  const parallelGroups = new Map<string, WorkflowNode[]>();
  const ungrouped: WorkflowNode[] = [];

  for (const node of layer) {
    if (node.parallelGroup) {
      const g = parallelGroups.get(node.parallelGroup) ?? [];
      g.push(node);
      parallelGroups.set(node.parallelGroup, g);
    } else {
      ungrouped.push(node);
    }
  }

  for (const group of parallelGroups.values()) {
    batch.push(...group);
  }

  for (const node of ungrouped) {
    const blockedByPeer = ungrouped.some(
      (other) =>
        other.id !== node.id && hasDirectedPath(other.id, node.id, schedulingEdges),
    );
    if (!blockedByPeer) batch.push(node);
  }

  if (batch.length > 0) return batch;
  return [layer[0]!];
}

/** Preserve structured rollback/review text across crash-continue; drop unstructured abort leftovers. */
export function shouldPreserveReworkReasonOnContinue(reworkReason: string | undefined): boolean {
  const reason = reworkReason?.trim() ?? '';
  if (!reason) return false;
  return (
    reason.startsWith('【人工审查意见】')
    || reason.startsWith('【回滚】')
    || reason.startsWith('【下游回流')
    || reason.includes('【回滚】：')
  );
}

/** continue 续跑：保留 completed；failed/running 重置为 pending 以便重试；保留已 reopen 的 pending 元数据。 */
export function nodeRunsForWorkflowContinue(
  nodeRuns: NodeRunRecord[],
  nodes: WorkflowNode[],
): NodeRunRecord[] {
  const existing = new Map(nodeRuns.map((r) => [r.nodeId, r]));
  return nodes.map((n) => {
    const prev = existing.get(n.id);
    if (prev?.status === 'completed') return { ...prev };
    if (prev?.status === 'failed' || prev?.status === 'running') {
      return {
        ...prev,
        status: 'pending' as const,
        error: undefined,
        completedAt: undefined,
        startedAt: undefined,
        runId: undefined,
        sessionKey: undefined,
        // Clear stale edgeOutcome (e.g. failure left by a prior manual abort) so the
        // reopened node's on_success edge is not poisoned. Keep tagged rework/review
        // reasons so crash-continue still injects them into the next LLM prompt.
        edgeOutcome: undefined,
        reworkReason: shouldPreserveReworkReasonOnContinue(prev.reworkReason)
          ? prev.reworkReason
          : undefined,
      };
    }
    if (prev) return { ...prev };
    return {
      nodeId: n.id,
      agentId: workflowNodePrimaryRoleId(n),
      status: 'pending' as const,
    };
  });
}

/** 群聊 reconcile 标 completed 但未经 runner 会话执行的步骤，执行前重置为 pending。 */
export function resetUnattributedCompletedNodeRuns(
  runs: Map<string, NodeRunRecord>,
): void {
  for (const [nodeId, run] of runs) {
    if (run.status !== 'completed') continue;
    if (run.runId?.trim() || run.sessionKey?.trim()) continue;
    // runner 已落盘的 completed（含 edgeOutcome/summary）勿因缺 runId 被重置
    if (run.edgeOutcome === 'success' && run.summary?.trim()) continue;
    runs.set(nodeId, {
      ...run,
      status: 'pending',
      completedAt: undefined,
      summary: undefined,
      error: undefined,
      startedAt: undefined,
      completedAgentIds: undefined,
    });
  }
}
