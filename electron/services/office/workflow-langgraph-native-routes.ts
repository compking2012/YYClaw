/**
 * Shared LangGraph native plan routing helpers (v2 Send + v3 subgraph compile).
 */
import { END, Send } from '@langchain/langgraph';
import type { LangGraphOrchestrationPlan } from '../../../src/lib/office-langgraph-plan-types';
import {
  planExecuteFailureTargets,
  planExecuteSuccessTargets,
  planFanInPredecessors,
  planFanOutTargets,
  planNodeById,
  planOutgoingTargets,
  resolveNativeCompileTargets,
  resolveNativeRouteTargets,
  subgraphForFanOut,
} from '../../../src/lib/office-langgraph-plan';
import { langGraphNodeRunRoute } from '../../../src/lib/office-workflow-edge-outcome';

export type LangGraphRoute = string | typeof END | Array<string | typeof END | Send>;

export type LangGraphRouteState = {
  mode?: string;
  runs: Array<{ nodeId: string; status: string; edgeOutcome?: string }>;
};

export function fanOutDispatchRoute(
  plan: LangGraphOrchestrationPlan,
  fanOutGraphId: string,
  state: unknown,
  useSubgraphs: boolean,
): LangGraphRoute {
  if (useSubgraphs) {
    const sub = subgraphForFanOut(plan, fanOutGraphId);
    return sub ? sub.id : END;
  }
  const targets = planFanOutTargets(plan, fanOutGraphId);
  if (targets.length === 0) return END;
  return targets.map((target) => new Send(target, state));
}

export function routeAfterJoin(
  plan: LangGraphOrchestrationPlan,
  joinGraphId: string,
  state: LangGraphRouteState,
  useSubgraphs: boolean,
): LangGraphRoute {
  const predecessors = planFanInPredecessors(plan, joinGraphId);
  for (const predGraphId of predecessors) {
    const predOfficeId = planNodeById(plan, predGraphId)?.officeNodeId;
    if (!predOfficeId) continue;
    const run = state.runs.find((candidate) => candidate.nodeId === predOfficeId);
    if (!run || (run.status !== 'completed' && run.status !== 'skipped')) {
      return END;
    }
  }

  const rawNext = planOutgoingTargets(plan, joinGraphId, 'always');
  const resolved = useSubgraphs
    ? resolveNativeCompileTargets(plan, rawNext)
    : resolveNativeRouteTargets(plan, rawNext);
  if (resolved.length === 0) return END;

  if (!useSubgraphs) {
    const fanOut = resolved.find((id) => planNodeById(plan, id)?.kind === 'fan_out');
    if (fanOut) return fanOutDispatchRoute(plan, fanOut, state, false);
  }

  if (resolved.length === 1) return resolved[0]!;
  return resolved;
}

export function routeAfterExecute(
  plan: LangGraphOrchestrationPlan,
  graphId: string,
  state: LangGraphRouteState,
  officeId: string,
  useSubgraphs: boolean,
): LangGraphRoute {
  if (state.mode === 'single') return END;
  const run = state.runs.find((candidate) => candidate.nodeId === officeId);
  if (!run || run.status === 'pending' || run.status === 'running') return END;

  switch (langGraphNodeRunRoute(run as Parameters<typeof langGraphNodeRunRoute>[0])) {
    case 'failure': {
      const failureTargets = planExecuteFailureTargets(plan, graphId);
      const resolved = useSubgraphs
        ? resolveNativeCompileTargets(plan, failureTargets)
        : failureTargets;
      return resolved.length > 0 ? resolved : END;
    }
    case 'halt':
      return END;
    case 'success': {
      const rawSuccess = planExecuteSuccessTargets(plan, graphId);
      const resolved = useSubgraphs
        ? resolveNativeCompileTargets(plan, rawSuccess)
        : resolveNativeRouteTargets(plan, rawSuccess);
      if (resolved.length === 0) return END;

      for (const target of resolved) {
        const planNode = planNodeById(plan, target);
        if (planNode?.kind === 'fan_out') {
          return fanOutDispatchRoute(plan, target, state, useSubgraphs);
        }
      }

      if (resolved.length === 1) return resolved[0]!;
      return resolved;
    }
    default:
      return END;
  }
}

export function routeFromEntry(
  plan: LangGraphOrchestrationPlan,
  state: unknown,
  useSubgraphs: boolean,
): LangGraphRoute {
  const entryNode = planNodeById(plan, plan.entry);
  if (!entryNode) return END;
  if (entryNode.kind === 'fan_out') {
    return fanOutDispatchRoute(plan, plan.entry, state, useSubgraphs);
  }
  if (entryNode.kind === 'execute') return plan.entry;
  const resolved = useSubgraphs
    ? resolveNativeCompileTargets(plan, [plan.entry])
    : resolveNativeRouteTargets(plan, [plan.entry]);
  const fanOut = resolved
    .map((id) => planNodeById(plan, id))
    .find((node) => node?.kind === 'fan_out');
  if (fanOut) return fanOutDispatchRoute(plan, fanOut.id, state, useSubgraphs);
  return resolved[0] ?? END;
}
