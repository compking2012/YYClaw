import { emptyWorkflow } from '@/lib/office-workflow-roles';
import type { ProjectAgentRef } from '@/lib/office-workflow-node';
import type { WorkflowDefinition } from '@/types/office';

/** Minimal LangGraph native workflow JSON for custom editor tips / reference. */
export function buildLangGraphCustomWorkflowTemplate(
  members: ProjectAgentRef[],
  stepTitle = '示例步骤',
): WorkflowDefinition {
  const agentId = members[0]?.agentId ?? '';
  const template = emptyWorkflow('dag');
  return {
    ...template,
    orchestrationEngine: 'langgraph',
    edgesCustomized: true,
    orchestrationPlan: {
      kind: 'langgraph_native',
      version: 3,
      nativeRuntime: 'subgraph_store',
      checkpointer: 'office_store',
      entry: 'lg-entry',
      nodes: [
        {
          id: 'lg-entry',
          kind: 'execute',
          label: 'First step',
          officeNodeId: 'lg-step-1',
        },
      ],
      edges: [],
      conditionalRoutes: [],
      subgraphs: [],
      visualLayers: [{ kind: 'sequential', nodeIds: ['lg-entry'] }],
    },
    nodes: [
      {
        id: 'lg-step-1',
        agentId,
        title: stepTitle,
        execution: 'serial',
      },
    ],
    edges: [],
  };
}

export function formatLangGraphCustomWorkflowTemplateJson(
  members: ProjectAgentRef[],
  stepTitle?: string,
): string {
  return JSON.stringify(buildLangGraphCustomWorkflowTemplate(members, stepTitle), null, 2);
}

export function isLangGraphCustomWorkflowJsonEmpty(jsonText: string): boolean {
  return jsonText.trim().length === 0;
}
