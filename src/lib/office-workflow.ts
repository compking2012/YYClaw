import type { WorkflowDefinition } from '@/types/office';

export function defaultWorkflowForAgents(agentIds: string[]): WorkflowDefinition {
  const nodes = agentIds.map((agentId) => ({
    id: `node-${agentId}`,
    agentId,
    execution: 'serial' as const,
  }));
  const edges = agentIds.slice(1).map((agentId, i) => ({
    from: `node-${agentIds[i]}`,
    to: `node-${agentId}`,
    when: 'on_success' as const,
  }));
  return { mode: 'simple', nodes, edges };
}

/** @deprecated Use defaultWorkflowForAgents */
export function defaultWorkflowForRoles(roleIds: string[]): WorkflowDefinition {
  return defaultWorkflowForAgents(roleIds);
}
