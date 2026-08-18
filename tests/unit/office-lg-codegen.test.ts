import { describe, expect, it } from 'vitest';
import type { LangGraphOrchestrationPlan } from '@/lib/office-langgraph-plan-types';
import { generateLangGraphCodegen } from '@/lib/office-langgraph-codegen';

function planV3(): LangGraphOrchestrationPlan {
  return {
    kind: 'langgraph_native',
    version: 3,
    nativeRuntime: 'subgraph_store',
    checkpointer: 'office_store',
    entry: 'n1',
    nodes: [
      { id: 'n1', kind: 'execute', label: 'E1', officeNodeId: 'lg-1' },
      { id: 'fo', kind: 'fan_out', label: 'FO' },
      { id: 'na', kind: 'execute', label: 'EA', officeNodeId: 'lg-A' },
      { id: 'fi', kind: 'fan_in', label: 'FI' },
    ],
    edges: [
      { from: 'n1', to: 'fo' },
      { from: 'fo', to: 'na', when: 'always' },
      { from: 'na', to: 'fi', when: 'on_success' },
    ],
    conditionalRoutes: [
      { from: 'n1', branches: [{ key: 'f', when: 'failure', targets: ['n1'] }] },
    ],
    subgraphs: [{ id: 'sub1', label: 'Parallel', entry: 'fo', exit: 'fi', nodeIds: ['na'] }],
    visualLayers: [],
  };
}

describe('generateLangGraphCodegen', () => {
  it('emits a v3 subgraph sketch with conditional rollback routes', () => {
    const code = generateLangGraphCodegen(planV3());
    expect(code).toContain('Auto-generated Office LangGraph StateGraph sketch');
    expect(code).toContain('plan.version=3 nativeRuntime=subgraph_store checkpointer=office_store');
    expect(code).toContain("builder.addNode('sub1', compiledSubgraph_sub1);");
    // execute node inside subgraph is skipped as a top-level addNode in v3
    expect(code).not.toContain("builder.addNode('na', execute_lg-A);");
    // standalone execute still added
    expect(code).toContain("builder.addNode('n1', execute_lg-1);");
    expect(code).toContain('conditionalRoutes (rollback):');
    expect(code).toContain('n1 failure -> n1');
    expect(code).toContain("const app = builder.compile({ checkpointer: 'office_store' });");
  });

  it('handles v1 plan with checkpoint + fan metadata comments and default runtime', () => {
    const plan: LangGraphOrchestrationPlan = {
      kind: 'langgraph_native',
      version: 1,
      checkpointer: 'office_task',
      entry: 'a',
      nodes: [
        { id: 'a', kind: 'execute', label: 'A', officeNodeId: 'lg-a' },
        { id: 'fo', kind: 'fan_out', label: 'FO' },
        { id: 'fi', kind: 'fan_in', label: 'FI' },
        { id: 'cp', kind: 'checkpoint', label: 'CP' },
      ],
      edges: [{ from: 'a', to: 'fo' }],
      conditionalRoutes: [],
      subgraphs: [],
      visualLayers: [],
    };
    const code = generateLangGraphCodegen(plan);
    // default runtime derived for version < 3
    expect(code).toContain('nativeRuntime=send_join');
    expect(code).toContain("builder.addNode('a', execute_lg-a);");
    expect(code).toContain('v2 metadata: fo (fan_out)');
    expect(code).toContain("v1 only: builder.addNode('cp', checkpoint);");
    // no rollback section when no conditional routes
    expect(code).not.toContain('conditionalRoutes (rollback):');
  });
});
