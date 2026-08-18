import type { WorkflowDefinition, WorkflowNode } from '@/types/office';
import {
  workflowNodeAgentIds,
  workflowNodePrimaryAgentId,
  type ProjectAgentRef,
} from '@/lib/office-workflow-node';
import { clampMaxRuntimeMinutes } from '@/lib/office-workflow-max-runtime-step';

export const DEFAULT_NODE_MAX_RUNTIME_MINUTES = 30;

export function nodeMaxRuntimeMinutes(node: Pick<WorkflowNode, 'maxRuntimeMinutes'>): number {
  const v = node.maxRuntimeMinutes;
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    return clampMaxRuntimeMinutes(v);
  }
  return DEFAULT_NODE_MAX_RUNTIME_MINUTES;
}

function workflowNodeTimeoutFloorMinutes(node: Pick<WorkflowNode, 'title'>): number {
  const title = node.title?.trim() ?? '';
  if (/测试验收|安全审计/u.test(title)) return 45;
  return 0;
}

export function workflowNodeAgentTimeoutMs(
  node: Pick<WorkflowNode, 'maxRuntimeMinutes' | 'title'>,
  outputRetryAttempts = 0,
): number {
  const configured = Math.max(
    nodeMaxRuntimeMinutes(node),
    workflowNodeTimeoutFloorMinutes(node),
    0,
  );
  const floor = configured <= 10 ? 20 : configured;
  const effective = outputRetryAttempts > 0 ? Math.max(floor, 18) : floor;
  return effective * 60_000;
}

export function agentIdsFromWorkflow(nodes: WorkflowNode[]): string[] {
  const ids: string[] = [];
  for (const n of nodes) {
    for (const agentId of workflowNodeAgentIds(n)) {
      if (!ids.includes(agentId)) ids.push(agentId);
    }
  }
  return ids;
}

export function roleTaskListText(
  node: Pick<WorkflowNode, 'description'> | undefined,
): string {
  if (!node) return '';
  return node.description?.trim() ?? '';
}

export function nodeStepLabel(
  node: WorkflowNode,
  index: number,
  members: ProjectAgentRef[],
): string {
  const nodeAgents = workflowNodeAgentIds(node)
    .map((id) => members.find((m) => m.agentId === id))
    .filter((m): m is ProjectAgentRef => !!m);
  const agentPart =
    nodeAgents.length > 0
      ? nodeAgents.map((m) => m.displayName).join(' + ')
      : workflowNodePrimaryAgentId(node);
  const name = node.title?.trim();
  if (name) return agentPart ? `${name} · ${agentPart}` : name;
  return agentPart ? `任务${index + 1} · ${agentPart}` : `任务${index + 1}`;
}

export function emptyWorkflow(mode: WorkflowDefinition['mode'] = 'dag'): WorkflowDefinition {
  return { mode, nodes: [], edges: [] };
}

export function ensureCoordinatorInTeam(
  coordinatorAgentId: string,
  agentIds: string[],
  fallbackAgentId?: string,
): string {
  if (coordinatorAgentId && agentIds.includes(coordinatorAgentId)) return coordinatorAgentId;
  return fallbackAgentId && agentIds.includes(fallbackAgentId)
    ? fallbackAgentId
    : (agentIds[0] ?? coordinatorAgentId);
}

export const roleIdsFromWorkflow = agentIdsFromWorkflow;
