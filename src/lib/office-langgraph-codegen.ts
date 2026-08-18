import type { LangGraphOrchestrationPlan } from '@/lib/office-langgraph-plan-types';
import { planNodeById } from '@/lib/office-langgraph-plan';

/** Export a LangGraph Studio–style TS sketch from a native orchestration plan (debug/codegen). */
export function generateLangGraphCodegen(plan: LangGraphOrchestrationPlan): string {
  const runtime = plan.nativeRuntime ?? (plan.version >= 3 ? 'subgraph_store' : 'send_join');
  const lines: string[] = [
    '// Auto-generated Office LangGraph StateGraph sketch',
    '// Aligns with @langchain/langgraph compile structure for debugging.',
    `// plan.version=${plan.version} nativeRuntime=${runtime} checkpointer=${plan.checkpointer}`,
    '',
    "import { Annotation, END, Send, START, StateGraph, interrupt } from '@langchain/langgraph';",
    '',
    'const WorkflowState = Annotation.Root({',
    '  task: Annotation<OfficeTask>(),',
    '  workflow: Annotation<WorkflowDefinition>(),',
    '  runs: Annotation<NodeRunRecord[]>({ reducer: mergeNodeRuns, default: () => [] }),',
    '  pendingRework: Annotation<LangGraphPendingRework | null>(),',
    '  userInterventionRequest: Annotation<LangGraphUserInterventionRequest | null>(),',
    '});',
    '',
    'const builder = new StateGraph(WorkflowState);',
    '',
  ];

  const subgraphOfficeIds = new Set<string>();
  for (const sub of plan.subgraphs) {
    for (const graphId of sub.nodeIds) {
      const node = planNodeById(plan, graphId);
      if (node?.kind === 'execute' && node.officeNodeId) {
        subgraphOfficeIds.add(node.officeNodeId);
      }
    }
    lines.push(`// --- subgraph ${sub.id}: ${sub.label} ---`);
    for (const graphId of sub.nodeIds) {
      const node = planNodeById(plan, graphId);
      if (node?.kind === 'execute') {
        lines.push(`//   ${node.id} execute(${node.officeNodeId})`);
      } else if (node) {
        lines.push(`//   ${node.id} ${node.kind}`);
      }
    }
    if (plan.version >= 3) {
      lines.push(`builder.addNode('${sub.id}', compiledSubgraph_${sub.id});`);
    }
    lines.push('');
  }

  for (const node of plan.nodes) {
    if (node.kind === 'execute' && node.officeNodeId) {
      if (subgraphOfficeIds.has(node.officeNodeId) && plan.version >= 3) continue;
      lines.push(`builder.addNode('${node.id}', execute_${node.officeNodeId});`);
      continue;
    }
    if (plan.version < 3 && (node.kind === 'fan_in' || node.kind === 'fan_out')) {
      lines.push(`// v2 metadata: ${node.id} (${node.kind}) — compiled via Send/join, not as graph node`);
    }
    if (plan.version < 2 && node.kind === 'checkpoint') {
      lines.push(`// v1 only: builder.addNode('${node.id}', checkpoint);`);
    }
  }

  lines.push('');
  lines.push(`builder.addConditionalEdges(START, routeFromEntry); // entry=${plan.entry}`);
  lines.push('');
  lines.push('for (const executeNode of executeNodes) {');
  lines.push('  builder.addConditionalEdges(executeNode, routeAfterExecute);');
  lines.push('}');
  lines.push('');
  if (plan.conditionalRoutes.length > 0) {
    lines.push('// conditionalRoutes (rollback):');
    for (const route of plan.conditionalRoutes) {
      const failure = route.branches.find((branch) => branch.when === 'failure');
      lines.push(`//   ${route.from} failure -> ${(failure?.targets ?? []).join(', ') || 'END'}`);
    }
    lines.push('');
  }
  lines.push(`const app = builder.compile({ checkpointer: '${plan.checkpointer}' });`);
  lines.push(`// thread_id = office-task-{taskId}`);
  lines.push('export default app;');
  return lines.join('\n');
}
