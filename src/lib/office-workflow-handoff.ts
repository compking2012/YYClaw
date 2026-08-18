import { workflowNodeRoleIds } from '@/lib/office-workflow-node';
import { workflowEdgeList } from '@/lib/office-workflow-schedule';
import type { NodeRunRecord, WorkflowEdge, WorkflowNode } from '@/types/office';

function edgeIsForwardSuccess(edge: WorkflowEdge): boolean {
  const when = edge.when ?? 'on_success';
  return when === 'on_success' || when === 'always';
}

function peerLayerComplete(
  node: WorkflowNode,
  nodes: WorkflowNode[],
  runs: Map<string, NodeRunRecord>,
  completingNodeId: string,
): boolean {
  if (!node.parallelGroup) return true;
  const peers = nodes.filter((n) => n.parallelGroup === node.parallelGroup);
  return peers.every((p) => {
    if (p.id === completingNodeId) return true;
    const st = runs.get(p.id)?.status;
    return st === 'completed' || st === 'skipped';
  });
}

function sourceNodeIdsForHandoff(nodeId: string, nodes: WorkflowNode[]): string[] {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node?.parallelGroup) return [nodeId];
  return nodes.filter((n) => n.parallelGroup === node.parallelGroup).map((n) => n.id);
}

function expandTargetNodes(
  targetIds: Set<string>,
  nodes: WorkflowNode[],
): WorkflowNode[] {
  const out: WorkflowNode[] = [];
  const seen = new Set<string>();
  for (const tid of targetIds) {
    const t = nodes.find((n) => n.id === tid);
    if (!t) continue;
    const group = t.parallelGroup;
    if (group) {
      for (const n of nodes) {
        if (n.parallelGroup === group && !seen.has(n.id)) {
          seen.add(n.id);
          out.push(n);
        }
      }
    } else if (!seen.has(t.id)) {
      seen.add(t.id);
      out.push(t);
    }
  }
  return out;
}

export interface WorkflowHandoffTarget {
  roleId: string;
  /** Next-step subtask title for this role (workflow node title). */
  stepTitle: string;
}

function collectHandoffTargetNodes(
  nodeId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  runs: Map<string, NodeRunRecord>,
): WorkflowNode[] | null {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  if (!peerLayerComplete(node, nodes, runs, nodeId)) {
    return null;
  }

  const edgeList = workflowEdgeList(nodes, edges);
  const fromIds = sourceNodeIdsForHandoff(nodeId, nodes);
  const targetIds = new Set<string>();

  for (const from of fromIds) {
    for (const edge of edgeList) {
      if (edge.from !== from || !edgeIsForwardSuccess(edge)) continue;
      targetIds.add(edge.to);
    }
  }

  return expandTargetNodes(targetIds, nodes);
}

/**
 * Next roles and their subtask titles for room handoff after a step finishes.
 */
export function nextHandoffTargetsAfterNode(
  nodeId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  runs: Map<string, NodeRunRecord>,
  taskTitle?: string,
): WorkflowHandoffTarget[] {
  const targets = collectHandoffTargetNodes(nodeId, nodes, edges, runs);
  if (!targets || targets.length === 0) return [];

  const order: string[] = [];
  const titlesByRole = new Map<string, string[]>();

  for (const t of targets) {
    const stepTitle = t.title?.trim() || taskTitle?.trim() || '接续任务';
    for (const rid of workflowNodeRoleIds(t)) {
      if (!order.includes(rid)) order.push(rid);
      const list = titlesByRole.get(rid) ?? [];
      if (!list.includes(stepTitle)) list.push(stepTitle);
      titlesByRole.set(rid, list);
    }
  }

  return order.map((roleId) => ({
    roleId,
    stepTitle: (titlesByRole.get(roleId) ?? ['接续任务']).join('、'),
  }));
}

/**
 * Role ids to @ on handoff after a step finishes.
 * - Fork: product → (test + dev) yields both roles.
 * - Parallel layer: wait until all peers in the group complete, then one handoff @ entire next layer.
 */
export function nextHandoffRoleIdsAfterNode(
  nodeId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  runs: Map<string, NodeRunRecord>,
): string[] {
  return nextHandoffTargetsAfterNode(nodeId, nodes, edges, runs).map((t) => t.roleId);
}

/** @deprecated use nextHandoffTargetsAfterNode — kept for callers that only need graph topology. */
export function nextRoleIdsAfterNode(
  nodeId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): string[] {
  const emptyRuns = new Map(
    nodes.map((n) => [n.id, { nodeId: n.id, agentId: n.agentId, status: 'completed' as const }]),
  );
  return nextHandoffRoleIdsAfterNode(nodeId, nodes, edges, emptyRuns);
}
