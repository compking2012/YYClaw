/**
 * LangGraph v2 compile: Send-based fan-out, join barriers, MemorySaver (no synthetic checkpoint nodes).
 */
import { END, START, StateGraph } from '@langchain/langgraph';
import type { LangGraphOrchestrationPlan } from '../../../src/lib/office-langgraph-plan-types';
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

export function compileNativeLangGraphStateGraphV2(params: CompileNativeGraphParams) {
  const { plan, executeNodeById, workflowState } = params;
  const builder = new StateGraph(workflowState as never);
  const pathMap: Record<string, string | typeof END> = { [END]: END };

  for (const planNode of plan.nodes) {
    if (planNode.kind === 'execute' && planNode.officeNodeId) {
      builder.addNode(planNode.id, executeNodeById(planNode.officeNodeId) as never);
      pathMap[planNode.id] = planNode.id;
      continue;
    }
    if (planNode.kind === 'fan_in') {
      builder.addNode(planNode.id, (async () => ({})) as never);
      pathMap[planNode.id] = planNode.id;
    }
  }

  builder.addConditionalEdges(
    START,
    ((state: unknown) => routeFromEntry(plan, state, false)) as never,
    pathMap as never,
  );

  for (const planNode of plan.nodes) {
    if (planNode.kind === 'execute' && planNode.officeNodeId) {
      const graphId = planNode.id;
      const officeId = planNode.officeNodeId;
      builder.addConditionalEdges(
        graphId as never,
        ((state: unknown) => routeAfterExecute(plan, graphId, state as never, officeId, false)) as never,
        pathMap as never,
      );
      continue;
    }
    if (planNode.kind === 'fan_in') {
      builder.addConditionalEdges(
        planNode.id as never,
        ((state: unknown) => routeAfterJoin(plan, planNode.id, state as never, false)) as never,
        pathMap as never,
      );
    }
  }

  return builder;
}

export function usesNativeLangGraphRuntimeV2(plan: LangGraphOrchestrationPlan): boolean {
  if (plan.version >= 3 || plan.nativeRuntime === 'subgraph_store') return false;
  return plan.version >= 2 || plan.nativeRuntime === 'send_join';
}
