import { expect, it } from 'vitest';
import { deriveLangGraphPlanNodeStatus, planNodeById, resolveNativeCompileTargets, resolveNativeRouteTargets } from '../../src/lib/office-langgraph-plan';
import { isLangGraphNativePlan, normalizeLangGraphNativePlan } from '../../src/lib/office-langgraph-plan-types';
import { generateLangGraphWorkflowFromDescriptionHeuristic } from '../../src/lib/office-workflow-generate';
import { orderedWorkflowNodes, workflowVisualLayers } from '../../src/lib/office-workflow-visual';
import type { OfficeRole } from '../../src/types/office';
import { describeLangGraph } from '../helpers/langgraph-flag';

describeLangGraph('office LangGraph native orchestration plan', () => {
  const roles: OfficeRole[] = [
    { id: 'pm', name: 'PM', agentId: 'pm', createdAt: 1, updatedAt: 1 },
    { id: 'dev', name: '开发', agentId: 'dev', createdAt: 1, updatedAt: 1 },
    { id: 'qa', name: '测试', agentId: 'qa', createdAt: 1, updatedAt: 1 },
  ];

  it('emits a langgraph_native plan with fan-out/fan-in instead of layer cross-product edges', () => {
    const result = generateLangGraphWorkflowFromDescriptionHeuristic(
      '1.PM编写项目计划；2.测试编写测试用例；3.开发实现，与2并行；4.测试验收',
      roles,
    );

    const plan = result?.workflow.orchestrationPlan;
    expect(isLangGraphNativePlan(plan)).toBe(true);
    if (!isLangGraphNativePlan(plan)) return;

    expect(plan.kind).toBe('langgraph_native');
    expect(plan.version).toBeGreaterThanOrEqual(3);
    expect(plan.nativeRuntime).toBe('subgraph_store');
    expect(plan.checkpointer).toBe('office_store');
    expect(plan.nodes.some((node) => node.kind === 'fan_out')).toBe(true);
    expect(plan.nodes.some((node) => node.kind === 'fan_in')).toBe(true);
    expect(plan.nodes.some((node) => node.kind === 'checkpoint')).toBe(true);
    expect(plan.subgraphs.length).toBeGreaterThan(0);

    const successEdges = result?.workflow.edges.filter((edge) => (edge.when ?? 'on_success') === 'on_success') ?? [];
    expect(successEdges.length).toBe(0);
  });

  it('uses dash-safe graph node ids that LangGraph accepts', () => {
    const result = generateLangGraphWorkflowFromDescriptionHeuristic(
      '1.PM编写项目计划；2.开发实现；3.测试验收',
      roles,
    );
    const plan = result?.workflow.orchestrationPlan;
    expect(isLangGraphNativePlan(plan)).toBe(true);
    if (!isLangGraphNativePlan(plan)) return;
    expect(plan.nodes.every((node) => !node.id.includes(':'))).toBe(true);
  });

  it('normalizes legacy colon graph ids for LangGraph compile', () => {
    const result = generateLangGraphWorkflowFromDescriptionHeuristic(
      '1.PM编写项目计划；2.开发实现',
      roles,
    );
    const plan = result?.workflow.orchestrationPlan;
    if (!isLangGraphNativePlan(plan)) throw new Error('missing plan');
    const legacy = {
      ...plan,
      entry: plan.entry.replace(/-/g, ':').replace('lgn:', 'lgn:'),
      nodes: plan.nodes.map((node) => ({ ...node, id: node.id.replace(/^lgn-/, 'lgn:').replace(/-/g, ':') })),
      edges: [],
      conditionalRoutes: [],
      subgraphs: [],
      visualLayers: [],
    };
    legacy.entry = legacy.nodes[0]?.id ?? legacy.entry;
    const normalized = normalizeLangGraphNativePlan(legacy as typeof plan);
    expect(normalized.nodes.every((node) => !node.id.includes(':'))).toBe(true);
  });

  it('maps conditional rollback routes onto the native plan', () => {
    const result = generateLangGraphWorkflowFromDescriptionHeuristic(
      '1.PM编写项目计划；2.开发实现；3.测试验收；4.审计验收，如审计不通过则回滚到2',
      roles,
    );
    const plan = result?.workflow.orchestrationPlan;
    expect(isLangGraphNativePlan(plan)).toBe(true);
    if (!isLangGraphNativePlan(plan)) return;

    expect(plan.conditionalRoutes.length).toBeGreaterThan(0);
    expect(result?.workflow.edges.some((edge) => edge.when === 'on_failure')).toBe(true);
  });

  it('derives runtime visual layers from native plan (parallel layer matches execute steps)', () => {
    const result = generateLangGraphWorkflowFromDescriptionHeuristic(
      '1.PM编写项目计划；2.测试编写测试用例；3.开发实现，与2并行；4.测试验收',
      roles,
    );
    expect(result).not.toBeNull();
    const layers = workflowVisualLayers(result!.workflow);
    const parallelLayer = layers.find((layer) => layer.parallel && layer.nodes.length === 2);
    expect(parallelLayer).toBeDefined();
    expect(parallelLayer!.nodes.map((node) => node.title).sort()).toEqual(
      ['开发实现', '测试用例设计'].sort(),
    );
    expect(orderedWorkflowNodes(result!.workflow).map((node) => node.title)).toEqual(
      layers.flatMap((layer) => layer.nodes).map((node) => node.title),
    );
  });

  it('resolveNativeRouteTargets skips checkpoint nodes for v2 routing', () => {
    const result = generateLangGraphWorkflowFromDescriptionHeuristic(
      '1.PM编写项目计划；2.开发实现；3.测试验收',
      roles,
    );
    const plan = result?.workflow.orchestrationPlan;
    if (!isLangGraphNativePlan(plan)) throw new Error('missing plan');
    const execNode = plan.nodes.find((node) => node.kind === 'execute');
    expect(execNode).toBeDefined();
    const cpTarget = plan.edges.find((edge) => edge.from === execNode!.id)?.to;
    expect(planNodeById(plan, cpTarget!)?.kind).toBe('checkpoint');
    const resolved = resolveNativeRouteTargets(plan, [cpTarget!]);
    expect(resolved.some((id) => planNodeById(plan, id)?.kind === 'checkpoint')).toBe(false);
  });

  it('derives fan_in/checkpoint status from execute node runs', () => {
    const result = generateLangGraphWorkflowFromDescriptionHeuristic(
      '1.PM编写项目计划；2.测试编写测试用例；3.开发实现，与2并行；4.测试验收',
      roles,
    );
    const plan = result?.workflow.orchestrationPlan;
    if (!isLangGraphNativePlan(plan)) throw new Error('missing plan');
    const planNodeById = new Map(plan.nodes.map((node) => [node.id, node]));
    const parallelLayer = plan.visualLayers.find((layer) => layer.kind === 'parallel');
    expect(parallelLayer).toBeDefined();
    const fanIn = planNodeById.get(parallelLayer!.nodeIds.find((id) => planNodeById.get(id)?.kind === 'fan_in')!);
    expect(fanIn).toBeDefined();
    const execIds = parallelLayer!.nodeIds
      .map((id) => planNodeById.get(id))
      .filter((node) => node?.kind === 'execute')
      .map((node) => node!.officeNodeId!);
    expect(
      deriveLangGraphPlanNodeStatus(fanIn!, plan, {
        [execIds[0]!]: 'completed',
        [execIds[1]!]: 'running',
      }, planNodeById),
    ).toBe('running');
    expect(
      deriveLangGraphPlanNodeStatus(fanIn!, plan, {
        [execIds[0]!]: 'completed',
        [execIds[1]!]: 'completed',
      }, planNodeById),
    ).toBe('completed');
  });

  it('resolveNativeCompileTargets maps fan_out to subgraph id for v3 routing', () => {
    const result = generateLangGraphWorkflowFromDescriptionHeuristic(
      '1.PM编写项目计划；2.测试编写测试用例；3.开发实现，与2并行；4.测试验收',
      roles,
    );
    const plan = result?.workflow.orchestrationPlan;
    if (!isLangGraphNativePlan(plan)) throw new Error('missing plan');
    const fanOut = plan.nodes.find((node) => node.kind === 'fan_out');
    expect(fanOut).toBeDefined();
    const targets = resolveNativeCompileTargets(plan, [fanOut!.id]);
    expect(targets.length).toBe(1);
    expect(plan.subgraphs.some((sub) => sub.id === targets[0])).toBe(true);
  });

  it('exports LangGraph codegen sketch from native plan', async () => {
    const { generateLangGraphCodegen } = await import('../../src/lib/office-langgraph-codegen');
    const result = generateLangGraphWorkflowFromDescriptionHeuristic(
      '1.PM编写项目计划；2.开发实现；3.测试验收',
      roles,
    );
    const plan = result?.workflow.orchestrationPlan;
    if (!isLangGraphNativePlan(plan)) throw new Error('missing plan');
    const code = generateLangGraphCodegen(plan);
    expect(code).toContain('StateGraph');
    expect(code).toContain('office-task-{taskId}');
    expect(code).toContain(`version=${plan.version}`);
  });
});
