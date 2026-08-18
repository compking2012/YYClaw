import { describe, expect, it } from 'vitest';
import type {
  LangGraphOrchestrationPlan,
  LangGraphPlanNode,
} from '@/lib/office-langgraph-plan-types';
import {
  isLangGraphNativePlan,
  normalizeLangGraphNativePlan,
} from '@/lib/office-langgraph-plan-types';
import {
  deriveLangGraphPlanNodeStatus,
  graphCompileTargetForPlanNode,
  planConditionalRoute,
  planExecuteFailureTargets,
  planExecuteSuccessTargets,
  planFanInPredecessors,
  planFanOutTargets,
  planNodeById,
  planOutgoingTargets,
  resolveNativeCompileTargets,
  resolveNativeRouteTargets,
  subgraphForFanOut,
  type LangGraphPlanNodeRuntimeStatus,
} from '@/lib/office-langgraph-plan';

/** Build a plan exercising execute/fan_out/fan_in/checkpoint + subgraph + conditional routes. */
function buildPlan(): LangGraphOrchestrationPlan {
  return {
    kind: 'langgraph_native',
    version: 3,
    nativeRuntime: 'subgraph_store',
    checkpointer: 'office_store',
    entry: 'n_exec1',
    nodes: [
      { id: 'n_exec1', kind: 'execute', label: 'E1', officeNodeId: 'lg-1' },
      { id: 'n_fanout', kind: 'fan_out', label: 'Fan out' },
      { id: 'n_execA', kind: 'execute', label: 'EA', officeNodeId: 'lg-A', subgraphId: 'sub1' },
      { id: 'n_execB', kind: 'execute', label: 'EB', officeNodeId: 'lg-B' },
      { id: 'n_fanin', kind: 'fan_in', label: 'Fan in' },
      { id: 'n_cp', kind: 'checkpoint', label: 'CP' },
      { id: 'n_exec2', kind: 'execute', label: 'E2', officeNodeId: 'lg-2' },
    ],
    edges: [
      { from: 'n_exec1', to: 'n_fanout', when: 'on_success' },
      { from: 'n_fanout', to: 'n_execA', when: 'always' },
      { from: 'n_fanout', to: 'n_execB', when: 'always' },
      { from: 'n_execA', to: 'n_fanin', when: 'on_success' },
      { from: 'n_execB', to: 'n_fanin', when: 'on_success' },
      { from: 'n_fanin', to: 'n_cp', when: 'always' },
      { from: 'n_cp', to: 'n_exec2', when: 'always' },
    ],
    conditionalRoutes: [
      {
        from: 'n_exec1',
        branches: [
          { key: 'ok', when: 'success', targets: ['n_fanout'] },
          { key: 'ko', when: 'failure', targets: ['n_exec1'] },
        ],
      },
    ],
    subgraphs: [
      { id: 'sub1', label: 'Parallel', entry: 'n_fanout', exit: 'n_fanin', nodeIds: ['n_execA'] },
    ],
    visualLayers: [
      { kind: 'sequential', nodeIds: ['n_exec1'] },
      { kind: 'parallel', nodeIds: ['n_execA', 'n_execB'], subgraphId: 'sub1' },
    ],
  };
}

function nodeMap(plan: LangGraphOrchestrationPlan): Map<string, LangGraphPlanNode> {
  return new Map(plan.nodes.map((n) => [n.id, n]));
}

describe('office-langgraph-plan pure helpers', () => {
  const plan = buildPlan();

  it('planNodeById resolves and misses', () => {
    expect(planNodeById(plan, 'n_exec1')?.kind).toBe('execute');
    expect(planNodeById(plan, 'missing')).toBeUndefined();
  });

  it('planOutgoingTargets filters by when', () => {
    expect(planOutgoingTargets(plan, 'n_fanout', 'always').sort()).toEqual(['n_execA', 'n_execB']);
    expect(planOutgoingTargets(plan, 'n_exec1')).toEqual(['n_fanout']);
    expect(planOutgoingTargets(plan, 'n_exec1', 'on_failure')).toEqual([]);
  });

  it('planConditionalRoute + execute success/failure targets', () => {
    expect(planConditionalRoute(plan, 'n_exec1')?.from).toBe('n_exec1');
    expect(planConditionalRoute(plan, 'n_cp')).toBeUndefined();
    expect(planExecuteSuccessTargets(plan, 'n_exec1')).toEqual(['n_fanout']);
    expect(planExecuteFailureTargets(plan, 'n_exec1')).toEqual(['n_exec1']);
    // no route -> fallback to edges
    expect(planExecuteSuccessTargets(plan, 'n_execA')).toEqual(['n_fanin']);
    expect(planExecuteFailureTargets(plan, 'n_execA')).toEqual([]);
  });

  it('fan in/out helpers', () => {
    expect(planFanOutTargets(plan, 'n_fanout').sort()).toEqual(['n_execA', 'n_execB']);
    expect(planFanInPredecessors(plan, 'n_fanin').sort()).toEqual(['n_execA', 'n_execB']);
    expect(subgraphForFanOut(plan, 'n_fanout')?.id).toBe('sub1');
    expect(subgraphForFanOut(plan, 'n_exec1')).toBeUndefined();
  });

  it('resolveNativeRouteTargets skips checkpoint chain', () => {
    // n_cp is checkpoint -> resolves to its always target n_exec2
    expect(resolveNativeRouteTargets(plan, ['n_cp'])).toEqual(['n_exec2']);
    // non-checkpoint returned as-is
    expect(resolveNativeRouteTargets(plan, ['n_exec1'])).toEqual(['n_exec1']);
    // empty
    expect(resolveNativeRouteTargets(plan, [])).toEqual([]);
  });

  it('graphCompileTargetForPlanNode + resolveNativeCompileTargets', () => {
    // fan_out -> subgraph id
    expect(graphCompileTargetForPlanNode(plan, 'n_fanout')).toBe('sub1');
    // execute with subgraphId -> subgraphId
    expect(graphCompileTargetForPlanNode(plan, 'n_execA')).toBe('sub1');
    // plain execute -> itself
    expect(graphCompileTargetForPlanNode(plan, 'n_exec1')).toBe('n_exec1');
    // unknown -> itself
    expect(graphCompileTargetForPlanNode(plan, 'ghost')).toBe('ghost');
    expect(resolveNativeCompileTargets(plan, ['n_cp'])).toEqual(['n_exec2']);
  });

  describe('deriveLangGraphPlanNodeStatus', () => {
    const map = nodeMap(plan);
    const exec1 = planNodeById(plan, 'n_exec1')!;
    const fanout = planNodeById(plan, 'n_fanout')!;
    const fanin = planNodeById(plan, 'n_fanin')!;
    const cp = planNodeById(plan, 'n_cp')!;

    it('returns undefined without status map', () => {
      expect(deriveLangGraphPlanNodeStatus(exec1, plan, undefined, map)).toBeUndefined();
    });

    it('execute node reads its office status', () => {
      const s: Record<string, LangGraphPlanNodeRuntimeStatus> = { 'lg-1': 'running' };
      expect(deriveLangGraphPlanNodeStatus(exec1, plan, s, map)).toBe('running');
    });

    it('fan_in aggregates failure/running/completed/pending', () => {
      expect(
        deriveLangGraphPlanNodeStatus(fanin, plan, { 'lg-A': 'failed', 'lg-B': 'completed' }, map),
      ).toBe('failed');
      expect(
        deriveLangGraphPlanNodeStatus(fanin, plan, { 'lg-A': 'running', 'lg-B': 'completed' }, map),
      ).toBe('running');
      expect(
        deriveLangGraphPlanNodeStatus(fanin, plan, { 'lg-A': 'completed', 'lg-B': 'completed' }, map),
      ).toBe('completed');
      expect(
        deriveLangGraphPlanNodeStatus(fanin, plan, { 'lg-A': 'completed' }, map),
      ).toBe('running');
      expect(deriveLangGraphPlanNodeStatus(fanin, plan, {}, map)).toBe('pending');
    });

    it('fan_out maps pending vs completed', () => {
      expect(deriveLangGraphPlanNodeStatus(fanout, plan, {}, map)).toBe('pending');
      expect(
        deriveLangGraphPlanNodeStatus(fanout, plan, { 'lg-A': 'completed', 'lg-B': 'completed' }, map),
      ).toBe('completed');
    });

    it('checkpoint aggregates layer execute statuses', () => {
      // n_cp has no visual layer -> returns undefined
      expect(deriveLangGraphPlanNodeStatus(cp, plan, { 'lg-A': 'completed' }, map)).toBeUndefined();
    });
  });
});

describe('office-langgraph-plan-types', () => {
  it('isLangGraphNativePlan narrows correctly', () => {
    expect(isLangGraphNativePlan(buildPlan())).toBe(true);
    expect(isLangGraphNativePlan({ kind: 'dag_edges' })).toBe(false);
    expect(isLangGraphNativePlan(undefined)).toBe(false);
  });

  it('normalizeLangGraphNativePlan remaps colon ids', () => {
    const raw = buildPlan();
    raw.entry = 'a:b';
    raw.nodes.push({ id: 'x:y', kind: 'execute', label: 'X', officeNodeId: 'lg:z', subgraphId: 's:1' });
    raw.edges.push({ from: 'a:b', to: 'x:y' });
    const norm = normalizeLangGraphNativePlan(raw);
    expect(norm.entry).toBe('a-b');
    expect(norm.nodes.some((n) => n.id === 'x-y' && n.subgraphId === 's-1')).toBe(true);
    expect(norm.edges.some((e) => e.from === 'a-b' && e.to === 'x-y')).toBe(true);
    expect(norm.conditionalRoutes[0].from).toBe('n_exec1');
  });
});
