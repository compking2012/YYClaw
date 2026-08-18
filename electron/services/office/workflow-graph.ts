import type {
  NodeRunRecord,
  OfficeFixedGroup,
  OfficeScenario,
  OfficeTempProject,
  WorkflowDefinition,
  WorkflowEdge,
  WorkflowNode,
} from './types';
import { defaultWorkflowForAgents } from './store';
import { defaultEdgesForNodeOrder } from './workflow-edges';
import {
  workflowForProject as workflowForProjectFromLib,
  workflowForTask as workflowForTaskFromLib,
} from '../../../src/lib/office-task-workflow';
import { getIncompletePredecessorRoleIds as getIncompletePredecessorRoleIdsFromLib } from '../../../src/lib/office-workflow-deps';
import { workflowNodeAgentIds } from '../../../src/lib/office-workflow-node';
import { incomingReady, workflowEdgeList as scheduleWorkflowEdgeList } from '../../../src/lib/office-workflow-schedule';
import { isWorkflowReviewActive } from '../../../src/lib/office-workflow-user-checkpoint';

export { getIncompletePredecessorRoleIdsFromLib as getIncompletePredecessorRoleIds };

export function reconcileWorkflowForGroup(group: OfficeFixedGroup): WorkflowDefinition {
  const agentIds = group.agentIds.filter(Boolean);
  let { nodes, edges, mode } = group.workflow;

  if (nodes.length === 0) {
    return { mode, nodes: [], edges: [] };
  }

  const agentSet = new Set(agentIds);
  nodes = nodes.filter((n) => workflowNodeAgentIds(n).every((id) => agentSet.has(id)));
  for (const agentId of agentIds) {
    if (!nodes.some((n) => workflowNodeAgentIds(n).includes(agentId))) {
      nodes.push({
        id: `node-${agentId}`,
        agentId,
        execution: 'serial',
      });
    }
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  edges = edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

  if (edges.length === 0 && nodes.length > 1) {
    edges = defaultEdgesForNodeOrder(nodes);
  }

  const incomingTargets = new Set(edges.map((e) => e.to));
  const roots = nodes.filter((n) => !incomingTargets.has(n.id));
  if (roots.length === 0) {
    return defaultWorkflowForAgents(
      agentIds.length > 0 ? agentIds : nodes.flatMap((n) => workflowNodeAgentIds(n)),
    );
  }

  return { mode, nodes, edges };
}

export const workflowForProject = workflowForProjectFromLib;
export const workflowForTask = workflowForTaskFromLib;

type ScenarioLike = OfficeFixedGroup | OfficeScenario;

function scenarioLikeToGroup(input: ScenarioLike): OfficeFixedGroup {
  if ('agentIds' in input && Array.isArray(input.agentIds)) {
    return input;
  }
  const scenario = input as OfficeScenario;
  return {
    id: scenario.id,
    name: scenario.name,
    agentIds: scenario.roleIds ?? [],
    coordinatorAgentId: scenario.coordinatorRoleId ?? scenario.roleIds?.[0] ?? '',
    workflow: scenario.workflow ?? { mode: 'dag', nodes: [], edges: [] },
    createdAt: scenario.createdAt ?? Date.now(),
    updatedAt: scenario.updatedAt ?? Date.now(),
    sequence: scenario.sequence,
  };
}

export function reconcileWorkflowForScenario(scenario: ScenarioLike): WorkflowDefinition {
  return reconcileWorkflowForGroup(scenarioLikeToGroup(scenario));
}

export function freshNodeRuns(nodes: WorkflowNode[]): NodeRunRecord[] {
  return nodes.map((n) => ({
    nodeId: n.id,
    agentId: workflowNodeAgentIds(n)[0] ?? n.agentId,
    status: 'pending' as const,
  }));
}

export function workflowEdgeList(nodes: WorkflowNode[], edges: WorkflowEdge[]): WorkflowEdge[] {
  if (edges.length > 0) return edges;
  return nodes.slice(1).map((n, i) => ({
    from: nodes[i]!.id,
    to: n.id,
    when: 'on_success' as const,
  }));
}

export function diagnoseWorkflowStall(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  runs: Map<string, NodeRunRecord>,
  task?: Pick<OfficeTempProject, 'workflowReviewBatch'>,
): string | null {
  if (task && isWorkflowReviewActive(task)) {
    const phase = task.workflowReviewBatch!.phase;
    if (phase === 'collecting' || phase === 'ready_to_settle') {
      return null;
    }
  }

  const edgeList = scheduleWorkflowEdgeList(nodes, edges);
  const pending = nodes.filter((n) => runs.get(n.id)?.status === 'pending');
  if (pending.length === 0) {
    return 'Workflow stalled: no runnable step (check edges / dependencies)';
  }

  const blocked = pending.filter((n) => !incomingReady(n.id, edgeList, runs));
  if (blocked.length === pending.length) {
    const ids = blocked.map((n) => n.id).join(', ');
    return `Workflow blocked: no step can start (check workflow edges; pending nodes: ${ids})`;
  }

  return 'Workflow stalled: no runnable step (check edges / dependencies)';
}
