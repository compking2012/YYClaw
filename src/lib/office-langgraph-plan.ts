import type {
  LangGraphConditionalRoute,
  LangGraphOrchestrationPlan,
  LangGraphPlanNode,
  LangGraphVisualLayer,
} from '@/lib/office-langgraph-plan-types';

export type LangGraphPlanNodeRuntimeStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed';

function officeIdsForPlanNodes(
  graphIds: string[],
  planNodeById: Map<string, LangGraphPlanNode>,
): string[] {
  return graphIds
    .map((id) => planNodeById.get(id))
    .filter((node): node is LangGraphPlanNode => node?.kind === 'execute' && Boolean(node.officeNodeId))
    .map((node) => node.officeNodeId!);
}

function aggregateOfficeStatuses(
  officeIds: string[],
  nodeStatusById: Record<string, LangGraphPlanNodeRuntimeStatus>,
): LangGraphPlanNodeRuntimeStatus {
  if (officeIds.length === 0) return 'pending';
  const statuses = officeIds.map((id) => nodeStatusById[id] ?? 'pending');
  if (statuses.some((status) => status === 'failed')) return 'failed';
  if (statuses.some((status) => status === 'running')) return 'running';
  if (statuses.every((status) => status === 'completed')) return 'completed';
  if (statuses.some((status) => status === 'completed')) return 'running';
  return 'pending';
}

function executeOfficeIdsInVisualLayer(
  layer: LangGraphVisualLayer,
  planNodeById: Map<string, LangGraphPlanNode>,
): string[] {
  return officeIdsForPlanNodes(layer.nodeIds, planNodeById);
}

/** Derive fan_out / fan_in / checkpoint display status from execute node runs. */
export function deriveLangGraphPlanNodeStatus(
  planNode: LangGraphPlanNode,
  plan: LangGraphOrchestrationPlan,
  nodeStatusById: Record<string, LangGraphPlanNodeRuntimeStatus> | undefined,
  planNodeById: Map<string, LangGraphPlanNode>,
): LangGraphPlanNodeRuntimeStatus | undefined {
  if (!nodeStatusById) return undefined;

  if (planNode.kind === 'execute' && planNode.officeNodeId) {
    return nodeStatusById[planNode.officeNodeId];
  }

  const layer = plan.visualLayers.find((candidate) => candidate.nodeIds.includes(planNode.id));

  if (planNode.kind === 'fan_out') {
    const executeIds = layer
      ? executeOfficeIdsInVisualLayer(layer, planNodeById)
      : officeIdsForPlanNodes(planFanOutTargets(plan, planNode.id), planNodeById);
    const aggregate = aggregateOfficeStatuses(executeIds, nodeStatusById);
    if (aggregate === 'pending') return 'pending';
    return 'completed';
  }

  if (planNode.kind === 'fan_in') {
    const executeIds = layer
      ? executeOfficeIdsInVisualLayer(layer, planNodeById)
      : officeIdsForPlanNodes(planFanInPredecessors(plan, planNode.id), planNodeById);
    return aggregateOfficeStatuses(executeIds, nodeStatusById);
  }

  if (planNode.kind === 'checkpoint' && layer) {
    return aggregateOfficeStatuses(
      executeOfficeIdsInVisualLayer(layer, planNodeById),
      nodeStatusById,
    );
  }

  return undefined;
}

export function planOutgoingTargets(
  plan: LangGraphOrchestrationPlan,
  fromGraphId: string,
  when?: 'always' | 'on_success' | 'on_failure',
): string[] {
  return plan.edges
    .filter((edge) => edge.from === fromGraphId && (when ? (edge.when ?? 'on_success') === when : true))
    .map((edge) => edge.to);
}

export function planConditionalRoute(
  plan: LangGraphOrchestrationPlan,
  fromGraphId: string,
): LangGraphConditionalRoute | undefined {
  return plan.conditionalRoutes.find((route) => route.from === fromGraphId);
}

export function planFanInPredecessors(
  plan: LangGraphOrchestrationPlan,
  fanInGraphId: string,
): string[] {
  return plan.edges
    .filter((edge) => edge.to === fanInGraphId && (edge.when ?? 'on_success') === 'on_success')
    .map((edge) => edge.from);
}

export function planNodeById(
  plan: LangGraphOrchestrationPlan,
  graphNodeId: string,
): LangGraphPlanNode | undefined {
  return plan.nodes.find((node) => node.id === graphNodeId);
}

export function planFanOutTargets(
  plan: LangGraphOrchestrationPlan,
  fanOutGraphId: string,
): string[] {
  return planOutgoingTargets(plan, fanOutGraphId, 'always');
}

export function planExecuteSuccessTargets(
  plan: LangGraphOrchestrationPlan,
  executeGraphId: string,
): string[] {
  const route = planConditionalRoute(plan, executeGraphId);
  const fromRoute = route?.branches.find((branch) => branch.when === 'success')?.targets ?? [];
  if (fromRoute.length > 0) return fromRoute;
  return [
    ...planOutgoingTargets(plan, executeGraphId, 'always'),
    ...planOutgoingTargets(plan, executeGraphId, 'on_success'),
  ];
}

export function planExecuteFailureTargets(
  plan: LangGraphOrchestrationPlan,
  executeGraphId: string,
): string[] {
  const route = planConditionalRoute(plan, executeGraphId);
  return route?.branches.find((branch) => branch.when === 'failure')?.targets ?? [];
}

/** Skip synthetic checkpoint nodes; stop before fan_out (handled via Send/subgraph at compile). */
export function resolveNativeRouteTargets(
  plan: LangGraphOrchestrationPlan,
  targetGraphIds: string[],
): string[] {
  let current = [...targetGraphIds];
  let guard = 0;
  while (guard++ < 16) {
    if (current.length === 0) return [];
    const kinds = current.map((id) => planNodeById(plan, id)?.kind);
    if (kinds.every((kind) => kind === 'checkpoint')) {
      current = current.flatMap((id) => planOutgoingTargets(plan, id, 'always'));
      continue;
    }
    return current;
  }
  return current;
}

export function subgraphForFanOut(
  plan: LangGraphOrchestrationPlan,
  fanOutGraphId: string,
) {
  return plan.subgraphs.find((sub) => sub.entry === fanOutGraphId);
}

/** Map plan graph id to compiled main-graph node (subgraph id for parallel executes). */
export function graphCompileTargetForPlanNode(
  plan: LangGraphOrchestrationPlan,
  graphId: string,
): string {
  const node = planNodeById(plan, graphId);
  if (!node) return graphId;
  if (node.kind === 'fan_out') {
    const sub = subgraphForFanOut(plan, graphId);
    return sub?.id ?? graphId;
  }
  if (node.kind === 'execute' && node.subgraphId) {
    return node.subgraphId;
  }
  return graphId;
}

/** Map fan_out / in-subgraph execute nodes to compiled subgraph ids (v3). */
export function resolveNativeCompileTargets(
  plan: LangGraphOrchestrationPlan,
  targetGraphIds: string[],
): string[] {
  const mapped = resolveNativeRouteTargets(plan, targetGraphIds).map((id) =>
    graphCompileTargetForPlanNode(plan, id),
  );
  return [...new Set(mapped)];
}
