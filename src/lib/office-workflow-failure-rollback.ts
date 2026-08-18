import { nodeRunHasFailureConclusion } from '@/lib/office-workflow-edge-outcome';
import {
  collectDownstreamNodeIds,
  reopenWorkflowUpstreamForRework,
} from '@/lib/office-workflow-upstream-rework';
import {
  forwardIncomingEdges,
  workflowEdgeList,
} from '@/lib/office-workflow-schedule';
import type { NodeRunRecord, WorkflowEdge, WorkflowNode } from '@/types/office';

export type WorkflowAutoRollbackSource = 'on_failure_edge' | 'direct_predecessor' | 'none';

export type WorkflowAutoRollbackDecision = {
  shouldRollback: boolean;
  targetNodeIds: string[];
  reason: string;
  source: WorkflowAutoRollbackSource;
};

export { nodeRunHasFailureConclusion } from '@/lib/office-workflow-edge-outcome';

export function failureRollbackTargetsFromNode(
  nodeId: string,
  edges: WorkflowEdge[],
): string[] {
  return edges
    .filter(
      (e) =>
        e.from === nodeId
        && (e.when ?? 'on_success') === 'on_failure',
    )
    .map((e) => e.to);
}

/** forward 直接前驱（并行层则全部返回）。 */
export function forwardDirectPredecessorNodeIds(
  nodeId: string,
  edges: WorkflowEdge[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const edge of forwardIncomingEdges(edges, nodeId)) {
    if (seen.has(edge.from)) continue;
    seen.add(edge.from);
    out.push(edge.from);
  }
  return out.sort();
}

function defaultRollbackReason(
  run: Pick<NodeRunRecord, 'error' | 'summary'>,
): string {
  return (
    run.error?.trim()
    || run.summary?.trim().slice(0, 500)
    || '【回滚说明】本步结论为不通过，须重新处理上游交付'
  );
}

/**
 * DAG 自动回滚决策：
 * 1. 有 on_failure 出边 → 回滚到边上目标；
 * 2. 否则 → 回滚到 forward 直接前驱（并行则整层）。
 */
export function resolveWorkflowAutoRollback(params: {
  nodeId: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  run: NodeRunRecord;
}): WorkflowAutoRollbackDecision {
  const empty: WorkflowAutoRollbackDecision = {
    shouldRollback: false,
    targetNodeIds: [],
    reason: '',
    source: 'none',
  };
  const { run, nodeId, nodes, edges } = params;
  if (!nodeRunHasFailureConclusion(run)) return empty;
  if (run.status !== 'completed') return empty;

  const onFailureTargets = failureRollbackTargetsFromNode(nodeId, edges);
  const edgeList = workflowEdgeList(nodes, edges);
  const targetNodeIds =
    onFailureTargets.length > 0
      ? onFailureTargets
      : forwardDirectPredecessorNodeIds(nodeId, edgeList);

  if (targetNodeIds.length === 0) return empty;

  return {
    shouldRollback: true,
    targetNodeIds,
    reason: defaultRollbackReason(run),
    source: onFailureTargets.length > 0 ? 'on_failure_edge' : 'direct_predecessor',
  };
}

/** 当前步已回到 pending（手动/自动回滚后）则勿重复执行。 */
function rollbackAlreadyApplied(
  runs: Map<string, NodeRunRecord>,
  nodeId: string,
): boolean {
  const current = runs.get(nodeId);
  return !current || current.status === 'pending';
}

export type AppliedWorkflowAutoRollback = {
  nodeId: string;
  decision: WorkflowAutoRollbackDecision;
};

/** 对单个失败节点执行自动回滚；已回滚或无目标时返回 null。 */
export function applyWorkflowAutoRollbackForNode(params: {
  nodeId: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  runs: Map<string, NodeRunRecord>;
}): AppliedWorkflowAutoRollback | null {
  const run = params.runs.get(params.nodeId);
  if (!run) return null;

  const decision = resolveWorkflowAutoRollback({
    nodeId: params.nodeId,
    nodes: params.nodes,
    edges: params.edges,
    run,
  });
  if (!decision.shouldRollback) return null;
  if (rollbackAlreadyApplied(params.runs, params.nodeId)) {
    return null;
  }

  reopenWorkflowUpstreamForRework({
    runs: params.runs,
    nodes: params.nodes,
    edges: params.edges,
    currentNodeId: params.nodeId,
    predecessorNodeIds: decision.targetNodeIds,
    reworkReason: decision.reason,
  });
  return { nodeId: params.nodeId, decision };
}

/** 批次执行后：对本批结论不通过的节点立即自动回滚。 */
export function applyWorkflowAutoRollbackForBatch(params: {
  nodeIds: string[];
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  runs: Map<string, NodeRunRecord>;
}): AppliedWorkflowAutoRollback[] {
  const applied: AppliedWorkflowAutoRollback[] = [];
  for (const nodeId of params.nodeIds) {
    const run = params.runs.get(nodeId);
    if (!run || !nodeRunHasFailureConclusion(run)) continue;
    const result = applyWorkflowAutoRollbackForNode({
      nodeId,
      nodes: params.nodes,
      edges: params.edges,
      runs: params.runs,
    });
    if (result) applied.push(result);
  }
  return applied;
}

/**
 * 续跑/死锁兜底：存在 completed+failure 且仍阻塞至少一个 pending 下游时，执行自动回滚。
 * 不要求「全部 pending 均不可运行」（否则并行层已就绪时会漏掉回滚）。
 */
export function tryResolveWorkflowFailureDeadlock(params: {
  runs: Map<string, NodeRunRecord>;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}): AppliedWorkflowAutoRollback | null {
  const edgeList = workflowEdgeList(params.nodes, params.edges);
  const pendingIds = new Set(
    params.nodes
      .filter((n) => params.runs.get(n.id)?.status === 'pending')
      .map((n) => n.id),
  );
  if (pendingIds.size === 0) return null;

  for (const node of params.nodes) {
    const run = params.runs.get(node.id);
    if (!run || !nodeRunHasFailureConclusion(run)) continue;
    if (run.status !== 'completed') continue;

    const downstream = collectDownstreamNodeIds(node.id, edgeList);
    if (![...pendingIds].some((id) => downstream.has(id))) continue;

    const applied = applyWorkflowAutoRollbackForNode({
      nodeId: node.id,
      nodes: params.nodes,
      edges: params.edges,
      runs: params.runs,
    });
    if (applied) return applied;
  }

  return null;
}

/** 续跑启动：处理磁盘上残留的 completed+failure（含下游已部分可运行的情况）。 */
export function recoverStaleCompletedFailureRollbacks(params: {
  runs: Map<string, NodeRunRecord>;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}): AppliedWorkflowAutoRollback[] {
  const applied: AppliedWorkflowAutoRollback[] = [];
  for (const node of params.nodes) {
    const run = params.runs.get(node.id);
    if (!run || !nodeRunHasFailureConclusion(run) || run.status !== 'completed') continue;
    const result = applyWorkflowAutoRollbackForNode({
      nodeId: node.id,
      nodes: params.nodes,
      edges: params.edges,
      runs: params.runs,
    });
    if (result) applied.push(result);
  }
  return applied;
}
