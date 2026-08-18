/** LangGraph-native orchestration plan (source of truth for LangGraph engine). */

export type LangGraphPlanNodeKind =
  | 'execute'
  | 'fan_out'
  | 'fan_in'
  | 'checkpoint';

export interface LangGraphPlanNode {
  id: string;
  kind: LangGraphPlanNodeKind;
  label: string;
  /** Office workflow step id (lg-*), set for execute nodes. */
  officeNodeId?: string;
  parallelGroup?: string;
  subgraphId?: string;
}

export interface LangGraphPlanEdge {
  from: string;
  to: string;
  when?: 'always' | 'on_success' | 'on_failure';
}

export interface LangGraphConditionalBranch {
  key: string;
  when: 'success' | 'failure' | 'default';
  targets: string[];
}

export interface LangGraphConditionalRoute {
  from: string;
  branches: LangGraphConditionalBranch[];
}

export interface LangGraphSubgraph {
  id: string;
  label: string;
  entry: string;
  exit: string;
  nodeIds: string[];
}

export interface LangGraphVisualLayer {
  kind: 'sequential' | 'parallel';
  nodeIds: string[];
  subgraphId?: string;
}

export interface LangGraphOrchestrationPlan {
  kind: 'langgraph_native';
  /** 1 = fan_out/fan_in/checkpoint nodes; 2 = Send + join + MemorySaver; 3 = subgraph + file checkpointer + interrupt */
  version: 1 | 2 | 3;
  /** v2: Send fan-out + join; v3: nested subgraph + office_store checkpointer + interrupt/resume */
  nativeRuntime?: 'office_nodes' | 'send_join' | 'subgraph_store';
  checkpointer: 'office_task' | 'langgraph_memory' | 'office_store';
  entry: string;
  nodes: LangGraphPlanNode[];
  edges: LangGraphPlanEdge[];
  conditionalRoutes: LangGraphConditionalRoute[];
  subgraphs: LangGraphSubgraph[];
  visualLayers: LangGraphVisualLayer[];
}

export type WorkflowOrchestrationPlan =
  | {
      kind: 'dag_edges';
    }
  | {
      kind: 'langgraph_state_graph';
      entry?: string;
      scheduler?: string;
      executor?: string;
      postprocess?: string;
    }
  | LangGraphOrchestrationPlan;

export function isLangGraphNativePlan(
  plan: WorkflowOrchestrationPlan | undefined,
): plan is LangGraphOrchestrationPlan {
  return plan?.kind === 'langgraph_native';
}

/** LangGraph rejects ":" in node names; normalize legacy/generated ids before compile. */
export function normalizeLangGraphNativePlan(plan: LangGraphOrchestrationPlan): LangGraphOrchestrationPlan {
  const remapId = (id: string): string => id.replace(/:/g, '-');

  return {
    ...plan,
    entry: remapId(plan.entry),
    nodes: plan.nodes.map((node) => ({ ...node, id: remapId(node.id), subgraphId: node.subgraphId ? remapId(node.subgraphId) : undefined })),
    edges: plan.edges.map((edge) => ({ ...edge, from: remapId(edge.from), to: remapId(edge.to) })),
    conditionalRoutes: plan.conditionalRoutes.map((route) => ({
      ...route,
      from: remapId(route.from),
      branches: route.branches.map((branch) => ({
        ...branch,
        targets: branch.targets.map(remapId),
      })),
    })),
    subgraphs: (plan.subgraphs ?? []).map((sub) => ({
      ...sub,
      id: remapId(sub.id),
      entry: remapId(sub.entry),
      exit: remapId(sub.exit),
      nodeIds: sub.nodeIds.map(remapId),
    })),
    visualLayers: (plan.visualLayers ?? []).map((layer) => ({
      ...layer,
      nodeIds: layer.nodeIds.map(remapId),
      subgraphId: layer.subgraphId ? remapId(layer.subgraphId) : undefined,
    })),
  };
}
