/**
 * LangGraph v3 compile: nested StateGraph subgraphs for parallel layers.
 */
import { END, Send, START, StateGraph } from '@langchain/langgraph';
import type { LangGraphOrchestrationPlan } from '../../../src/lib/office-langgraph-plan-types';
import { planNodeById } from '../../../src/lib/office-langgraph-plan';
import {
  routeAfterExecute,
  routeAfterJoin,
  routeFromEntry,
} from './workflow-langgraph-native-routes';

type CompileNativeGraphParams = {
  plan: LangGraphOrchestrationPlan;
  executeNodeById: (officeNodeId: string) => (state: unknown) => Promise<Partial<unknown>>;
  workflowState: unknown;
};

function officeNodeIdsInSubgraph(plan: LangGraphOrchestrationPlan, subgraphId: string): Set<string> {
  const sub = plan.subgraphs.find((candidate) => candidate.id === subgraphId);
  if (!sub) return new Set();
  return new Set(
    sub.nodeIds
      .map((id) => planNodeById(plan, id))
      .filter((node) => node?.kind === 'execute' && node.officeNodeId)
      .map((node) => node!.officeNodeId!),
  );
}

function compileParallelSubgraph(
  plan: LangGraphOrchestrationPlan,
  subgraphId: string,
  executeNodeById: CompileNativeGraphParams['executeNodeById'],
  workflowState: unknown,
) {
  const sub = plan.subgraphs.find((candidate) => candidate.id === subgraphId);
  if (!sub) throw new Error(`Missing LangGraph subgraph: ${subgraphId}`);

  const execPlanNodes = sub.nodeIds
    .map((id) => planNodeById(plan, id))
    .filter((node) => node?.kind === 'execute' && node.officeNodeId);
  const fanInId = sub.exit;
  const innerPathMap: Record<string, string | typeof END> = { [END]: END };

  const builder = new StateGraph(workflowState as never);
  for (const execNode of execPlanNodes) {
    builder.addNode(execNode!.id, executeNodeById(execNode!.officeNodeId!) as never);
    innerPathMap[execNode!.id] = execNode!.id;
  }
  builder.addNode(fanInId, (async () => ({})) as never);
  innerPathMap[fanInId] = fanInId;

  builder.addConditionalEdges(
    START,
    ((state: unknown) => {
      if (execPlanNodes.length === 0) return END;
      if (execPlanNodes.length === 1) return execPlanNodes[0]!.id;
      return execPlanNodes.map((node) => new Send(node!.id, state));
    }) as never,
    innerPathMap as never,
  );

  for (const execNode of execPlanNodes) {
    const graphId = execNode!.id;
    const officeId = execNode!.officeNodeId!;
    builder.addConditionalEdges(
      graphId as never,
      ((state: unknown) => routeAfterExecute(plan, graphId, state as never, officeId, false)) as never,
      innerPathMap as never,
    );
  }

  builder.addConditionalEdges(
    fanInId as never,
    ((state: unknown) => {
      const joined = routeAfterJoin(plan, fanInId, state as never, false);
      if (joined === END) return END;
      return END;
    }) as never,
    innerPathMap as never,
  );

  return builder.compile({ name: `office-langgraph-sub-${subgraphId}` });
}

export function compileNativeLangGraphStateGraphV3(params: CompileNativeGraphParams) {
  const { plan, executeNodeById, workflowState } = params;
  const subgraphOfficeIds = new Set<string>();
  for (const sub of plan.subgraphs) {
    for (const officeId of officeNodeIdsInSubgraph(plan, sub.id)) subgraphOfficeIds.add(officeId);
  }

  const builder = new StateGraph(workflowState as never);
  const pathMap: Record<string, string | typeof END> = { [END]: END };

  for (const planNode of plan.nodes) {
    if (planNode.kind !== 'execute' || !planNode.officeNodeId) continue;
    if (subgraphOfficeIds.has(planNode.officeNodeId)) continue;
    builder.addNode(planNode.id, executeNodeById(planNode.officeNodeId) as never);
    pathMap[planNode.id] = planNode.id;
  }

  for (const sub of plan.subgraphs) {
    const compiled = compileParallelSubgraph(plan, sub.id, executeNodeById, workflowState);
    builder.addNode(sub.id, compiled as never);
    pathMap[sub.id] = sub.id;
  }

  builder.addConditionalEdges(
    START,
    ((state: unknown) => routeFromEntry(plan, state, true)) as never,
    pathMap as never,
  );

  for (const planNode of plan.nodes) {
    if (planNode.kind !== 'execute' || !planNode.officeNodeId) continue;
    if (subgraphOfficeIds.has(planNode.officeNodeId)) continue;
    const graphId = planNode.id;
    const officeId = planNode.officeNodeId;
    builder.addConditionalEdges(
      graphId as never,
      ((state: unknown) => routeAfterExecute(plan, graphId, state as never, officeId, true)) as never,
      pathMap as never,
    );
  }

  for (const sub of plan.subgraphs) {
    builder.addConditionalEdges(
      sub.id as never,
      ((state: unknown) => routeAfterJoin(plan, sub.exit, state as never, true)) as never,
      pathMap as never,
    );
  }

  return builder;
}

export function usesNativeLangGraphRuntimeV3(plan: LangGraphOrchestrationPlan): boolean {
  return plan.version >= 3 || plan.nativeRuntime === 'subgraph_store';
}
