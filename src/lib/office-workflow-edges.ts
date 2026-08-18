import { ensureWorkflowRuntimeDefaults } from '@/lib/office-workflow-node';
import type { WorkflowDefinition, WorkflowEdge, WorkflowNode } from '@/types/office';

/** Topological order when dependency edges define a DAG; tie-break with `compareTitles`. */
export function topologicalSortWorkflowNodes(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  compareTitles: (titleA: string, titleB: string) => number,
): WorkflowNode[] | null {
  if (nodes.length === 0) return [];
  if (nodes.length === 1) return [...nodes];

  const nodeIds = new Set(nodes.map((n) => n.id));
  const incoming = new Map<string, number>();
  const out = new Map<string, WorkflowEdge[]>();
  for (const id of nodeIds) incoming.set(id, 0);
  for (const e of edges) {
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to) || e.from === e.to) return null;
    incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
    const list = out.get(e.from) ?? [];
    list.push(e);
    out.set(e.from, list);
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const ready = nodes
    .filter((n) => (incoming.get(n.id) ?? 0) === 0)
    .sort((a, b) => compareTitles(a.title ?? '', b.title ?? ''));

  const ordered: WorkflowNode[] = [];
  const queue = [...ready];

  while (queue.length > 0) {
    queue.sort((a, b) => compareTitles(a.title ?? '', b.title ?? ''));
    const node = queue.shift()!;
    ordered.push(node);
    for (const e of out.get(node.id) ?? []) {
      const nextIn = (incoming.get(e.to) ?? 1) - 1;
      incoming.set(e.to, nextIn);
      if (nextIn === 0) {
        const next = byId.get(e.to);
        if (next) queue.push(next);
      }
    }
  }

  return ordered.length === nodes.length ? ordered : null;
}

export function defaultEdgesForNodeOrder(nodes: WorkflowNode[]): WorkflowEdge[] {
  return nodes.slice(1).map((n, i) => ({
    from: nodes[i]!.id,
    to: n.id,
    when: 'on_success' as const,
  }));
}

/** Consecutive nodes sharing the same `parallelGroup` form one parallel layer. */
export function groupNodesIntoExecutionLayers(nodes: WorkflowNode[]): WorkflowNode[][] {
  const layers: WorkflowNode[][] = [];
  for (const node of nodes) {
    const pg = node.parallelGroup?.trim();
    const last = layers[layers.length - 1];
    if (pg && last?.[0]?.parallelGroup?.trim() === pg) {
      last.push(node);
    } else {
      layers.push([node]);
    }
  }
  return layers;
}

/** Fork from every node in the previous layer to every node in the next (parallel-safe). */
/**
 * 为并行层补全「上一层 → 本层每节点」的 on_success 边（保留已有边与 on_failure 回滚边）。
 * 修复仅一条 fork 或缺边时并行支路无法同时 incomingReady 的问题。
 */
export function ensureParallelLayerSuccessForkEdges(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): WorkflowEdge[] {
  const layers = groupNodesIntoExecutionLayers(nodes);
  if (layers.length < 2) return edges;

  const edgeKey = (e: WorkflowEdge) =>
    `${e.from}|${e.to}|${e.when ?? 'on_success'}`;
  const out = [...edges];
  const seen = new Set(out.map(edgeKey));

  for (let i = 1; i < layers.length; i++) {
    const prevLayer = layers[i - 1]!;
    const layer = layers[i]!;
    if (layer.length <= 1) continue;
    for (const fromNode of prevLayer) {
      for (const toNode of layer) {
        const candidate: WorkflowEdge = {
          from: fromNode.id,
          to: toNode.id,
          when: 'on_success',
        };
        const key = edgeKey(candidate);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(candidate);
      }
    }
  }

  return out;
}

export function buildForkJoinEdgesFromLayers(nodes: WorkflowNode[]): WorkflowEdge[] {
  const layers = groupNodesIntoExecutionLayers(nodes);
  const edges: WorkflowEdge[] = [];
  let prevLayerIds: string[] = [];
  for (const layer of layers) {
    const layerIds = layer.map((n) => n.id);
    for (const from of prevLayerIds) {
      for (const to of layerIds) {
        edges.push({ from, to, when: 'on_success' });
      }
    }
    prevLayerIds = layerIds;
  }
  return edges;
}

export function edgesEqual(a: WorkflowEdge[], b: WorkflowEdge[]): boolean {
  if (a.length !== b.length) return false;
  const key = (e: WorkflowEdge) => `${e.from}|${e.to}|${e.when ?? 'on_success'}`;
  const setA = new Set(a.map(key));
  return b.every((e) => setA.has(key(e)));
}

export function syncWorkflowEdges(workflow: WorkflowDefinition): WorkflowDefinition {
  const { nodes } = workflow;
  if (nodes.length < 2) {
    return { ...workflow, edges: [] };
  }

  if (workflow.edgesCustomized) {
    const edges = ensureParallelLayerSuccessForkEdges(nodes, workflow.edges);
    if (edgesEqual(workflow.edges, edges)) return workflow;
    return { ...workflow, edges };
  }

  const hasParallelGroup = nodes.some((n) => Boolean(n.parallelGroup?.trim()));
  const edges = ensureParallelLayerSuccessForkEdges(
    nodes,
    hasParallelGroup
      ? buildForkJoinEdgesFromLayers(nodes)
      : defaultEdgesForNodeOrder(nodes),
  );
  const next: WorkflowDefinition = {
    ...workflow,
    mode: hasParallelGroup ? 'dag' : workflow.mode,
    edges,
  };
  if (edgesEqual(workflow.edges, next.edges) && workflow.mode === next.mode) {
    return workflow;
  }
  return next;
}

export function applyWorkflowChange(
  workflow: WorkflowDefinition,
  edgesTouched: boolean,
): WorkflowDefinition {
  const next = edgesTouched
    ? workflow.edgesCustomized
      ? workflow
      : { ...workflow, edgesCustomized: true }
    : syncWorkflowEdges(workflow);
  return ensureWorkflowRuntimeDefaults(next);
}

export type WorkflowEdgesValidation =
  | { valid: true }
  | { valid: false; i18nKey: string };

export function validateWorkflowEdges(workflow: WorkflowDefinition): WorkflowEdgesValidation {
  const { nodes, edges } = workflow;
  if (nodes.length < 2) return { valid: true };

  if (
    workflow.orchestrationEngine === 'langgraph'
    && workflow.orchestrationPlan
    && (workflow.orchestrationPlan.kind === 'langgraph_native'
      || workflow.orchestrationPlan.kind === 'langgraph_state_graph')
  ) {
    return { valid: true };
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const e of edges) {
    if (!nodeIds.has(e.from) || !nodeIds.has(e.to) || e.from === e.to) {
      return { valid: false, i18nKey: 'workflow.validationInvalidEdges' };
    }
  }

  if (edges.length === 0) {
    return { valid: false, i18nKey: 'workflow.validationNeedEdges' };
  }

  const incoming = new Set(edges.map((e) => e.to));
  const roots = nodes.filter((n) => !incoming.has(n.id));
  if (roots.length === 0) {
    return { valid: false, i18nKey: 'workflow.validationNoRoot' };
  }

  const reachable = new Set<string>();
  const out = new Map<string, WorkflowEdge[]>();
  for (const e of edges) {
    const list = out.get(e.from) ?? [];
    list.push(e);
    out.set(e.from, list);
  }
  const queue = roots.map((r) => r.id);
  for (const id of queue) reachable.add(id);
  for (let i = 0; i < queue.length; i++) {
    const from = queue[i]!;
    for (const e of out.get(from) ?? []) {
      if (!reachable.has(e.to)) {
        reachable.add(e.to);
        queue.push(e.to);
      }
    }
  }
  if (reachable.size !== nodes.length) {
    return { valid: false, i18nKey: 'workflow.validationUnreachableNodes' };
  }

  if (workflow.mode === 'simple' && !workflow.edgesCustomized) {
    const expected = defaultEdgesForNodeOrder(nodes);
    if (!edgesEqual(edges, expected)) {
      return { valid: false, i18nKey: 'workflow.validationEdgesOutOfSync' };
    }
  }

  return { valid: true };
}
