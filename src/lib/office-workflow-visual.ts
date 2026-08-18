import {
  isLangGraphNativePlan,
  normalizeLangGraphNativePlan,
  type LangGraphOrchestrationPlan,
} from '@/lib/office-langgraph-plan-types';
import { topologicalSortWorkflowNodes } from '@/lib/office-workflow-edges';
import { workflowNodeRoleIds } from '@/lib/office-workflow-node';
import type { WorkflowDefinition, WorkflowNode } from '@/types/office';

export type WorkflowVisualLayer = {
  nodes: WorkflowNode[];
  parallel: boolean;
};

/** Map LangGraph native visualLayers to office execute-node layers (matches StateGraph preview). */
export function workflowVisualLayersFromLangGraphPlan(
  workflowNodes: WorkflowNode[],
  plan: LangGraphOrchestrationPlan,
): WorkflowVisualLayer[] {
  const nodeById = new Map(workflowNodes.map((node) => [node.id, node]));
  const planNodeById = new Map(plan.nodes.map((node) => [node.id, node]));
  const layers: WorkflowVisualLayer[] = [];

  for (const visualLayer of plan.visualLayers) {
    const executeNodes: WorkflowNode[] = [];
    for (const graphId of visualLayer.nodeIds) {
      const planNode = planNodeById.get(graphId);
      if (planNode?.kind !== 'execute' || !planNode.officeNodeId) continue;
      const officeNode = nodeById.get(planNode.officeNodeId);
      if (officeNode) executeNodes.push(officeNode);
    }
    if (executeNodes.length === 0) continue;
    layers.push({
      nodes: executeNodes,
      parallel: visualLayer.kind === 'parallel' && executeNodes.length > 1,
    });
  }

  return layers;
}

function workflowVisualLayersFromDagEdges(workflow: WorkflowDefinition): WorkflowVisualLayer[] {
  const { nodes, edges } = workflow;
  const ordered =
    topologicalSortWorkflowNodes(nodes, edges, (a, b) => a.localeCompare(b, 'zh-CN')) ?? nodes;

  const layers: WorkflowVisualLayer[] = [];
  for (const node of ordered) {
    const parallel = Boolean(node.parallelGroup);
    if (parallel && layers.length > 0 && layers[layers.length - 1]!.parallel) {
      const last = layers[layers.length - 1]!;
      if (last.nodes.every((n) => n.parallelGroup === node.parallelGroup)) {
        last.nodes.push(node);
        continue;
      }
    }
    if (parallel) {
      layers.push({ nodes: [node], parallel: true });
    } else {
      layers.push({ nodes: [node], parallel: false });
    }
  }
  return layers;
}

/** Group nodes into visual layers (parallel steps share a layer). */
export function workflowVisualLayers(workflow: WorkflowDefinition): WorkflowVisualLayer[] {
  if (workflow.nodes.length === 0) return [];

  if (isLangGraphNativePlan(workflow.orchestrationPlan)) {
    const plan = normalizeLangGraphNativePlan(workflow.orchestrationPlan);
    return workflowVisualLayersFromLangGraphPlan(workflow.nodes, plan);
  }

  return workflowVisualLayersFromDagEdges(workflow);
}

/** Execution order for progress sync (LangGraph uses plan layers, not raw node array). */
export function orderedWorkflowNodes(workflow: WorkflowDefinition): WorkflowNode[] {
  return workflowVisualLayers(workflow).flatMap((layer) => layer.nodes);
}

export function workflowNodeRoleLabels(
  node: WorkflowNode,
  roles: Array<{ id: string; name: string; emoji?: string }>,
): string {
  return workflowNodeRoleIds(node)
    .map((id) => {
      const r = roles.find((x) => x.id === id);
      return r ? `${r.emoji ?? '🤖'} ${r.name}` : id;
    })
    .join(' + ');
}
