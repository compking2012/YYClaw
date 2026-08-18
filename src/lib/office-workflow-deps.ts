import { workflowNodeRoleIds } from '@/lib/office-workflow-node';
import { nodeRunTriggersFailureEdge } from '@/lib/office-workflow-edge-outcome';
import { forwardIncomingEdges, workflowEdgeList } from '@/lib/office-workflow-schedule';
import type { NodeRunRecord, WorkflowEdge, WorkflowNode } from '@/types/office';

export function nodeRunsMap(nodeRuns: NodeRunRecord[]): Map<string, NodeRunRecord> {
  return new Map(nodeRuns.map((r) => [r.nodeId, r]));
}

/** Role ids on upstream steps that block `nodeId` from starting. */
export function getIncompletePredecessorRoleIds(
  nodeId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  runs: Map<string, NodeRunRecord>,
): string[] {
  const edgeList = workflowEdgeList(nodes, edges);
  const blocked: string[] = [];
  for (const e of forwardIncomingEdges(edgeList, nodeId)) {
    const prev = runs.get(e.from);
    const when = e.when ?? 'on_success';
    let ready: boolean;
    if (!prev) ready = false;
    else if (when === 'always') ready = prev.status === 'completed' || prev.status === 'skipped';
    else if (when === 'on_partial') ready = prev.status === 'completed' || prev.status === 'running';
    else if (when === 'on_failure') ready = nodeRunTriggersFailureEdge(prev);
    else ready = (prev.status === 'completed' || prev.status === 'skipped') && !nodeRunTriggersFailureEdge(prev);
    if (!ready) {
      const fromNode = nodes.find((n) => n.id === e.from);
      if (fromNode) {
        for (const rid of workflowNodeRoleIds(fromNode)) {
          if (!blocked.includes(rid)) blocked.push(rid);
        }
      }
    }
  }
  return blocked;
}

export type BlockingPredecessorStep = {
  nodeId: string;
  title: string;
  ownerNames: string;
  status: NodeRunRecord['status'] | 'pending';
};

/** Upstream workflow steps that are not finished and block the given step. */
export function getBlockingPredecessorSteps(
  nodeId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  runs: Map<string, NodeRunRecord>,
  roles: { id: string; name: string }[],
): BlockingPredecessorStep[] {
  const edgeList = workflowEdgeList(nodes, edges);
  const out: BlockingPredecessorStep[] = [];
  const seen = new Set<string>();

  for (const e of forwardIncomingEdges(edgeList, nodeId)) {
    const prev = runs.get(e.from);
    const when = e.when ?? 'on_success';
    let ready: boolean;
    if (!prev) ready = false;
    else if (when === 'always') ready = prev.status === 'completed' || prev.status === 'skipped';
    else if (when === 'on_partial') ready = prev.status === 'completed' || prev.status === 'running';
    else ready = (prev.status === 'completed' || prev.status === 'skipped') && !nodeRunTriggersFailureEdge(prev);
    if (ready) continue;

    const fromNode = nodes.find((n) => n.id === e.from);
    if (!fromNode || seen.has(fromNode.id)) continue;
    seen.add(fromNode.id);
    const index = nodes.findIndex((n) => n.id === fromNode.id);
    const ownerNames = workflowNodeRoleIds(fromNode)
      .map((id) => roles.find((r) => r.id === id)?.name ?? id)
      .join('、');
    out.push({
      nodeId: fromNode.id,
      title: fromNode.title?.trim() || `步骤${index + 1}`,
      ownerNames: ownerNames || '未指定',
      status: prev?.status ?? 'pending',
    });
  }

  return out;
}
