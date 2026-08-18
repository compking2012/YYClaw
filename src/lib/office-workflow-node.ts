import { clampMaxRuntimeMinutes } from '@/lib/office-workflow-max-runtime-step';
import { DEFAULT_NODE_MAX_RUNTIME_MINUTES } from '@/lib/office-workflow-roles';
import type { WorkflowDefinition, WorkflowNode } from '@/types/office';

export type ProjectAgentRef = { agentId: string; displayName: string };

export function resolveWorkflowAgentRef(ref: string, members: ProjectAgentRef[]): string | null {
  const trimmed = ref.trim();
  if (!trimmed || members.length === 0) return null;
  const byId = members.find((m) => m.agentId === trimmed);
  if (byId) return byId.agentId;
  const byName = members.find((m) => m.displayName.trim() === trimmed);
  if (byName) return byName.agentId;
  return null;
}

function resolveWorkflowAgentRefs(refs: string[], members: ProjectAgentRef[]): string[] | null {
  const out: string[] = [];
  for (const ref of refs) {
    const id = resolveWorkflowAgentRef(ref, members);
    if (!id) return null;
    if (!out.includes(id)) out.push(id);
  }
  return out.length > 0 ? out : null;
}

function nodeHadAgentRef(
  node: WorkflowNode & { agent?: string; agents?: string[]; role?: string; roles?: string[] },
): boolean {
  return Boolean(
    node.agent?.trim()
    || node.role?.trim()
    || node.agentId?.trim()
    || (node.agents ?? []).some((a) => typeof a === 'string' && a.trim())
    || (node.roles ?? []).some((a) => typeof a === 'string' && a.trim())
    || (node.agentIds ?? []).some((a) => typeof a === 'string' && a.trim()),
  );
}

function stripWorkflowNodeAgentRefs(
  node: WorkflowNode & { agent?: string; agents?: string[]; role?: string; roles?: string[] },
): WorkflowNode {
  const { agent: _a, agents: _as, role: _r, roles: _rs, agentId: _id, agentIds: _ids, ...rest } = node;
  return { ...rest, agentId: '' };
}

function normalizeCustomWorkflowNode(
  node: WorkflowNode & { agent?: string; agents?: string[]; role?: string; roles?: string[] },
  members?: ProjectAgentRef[],
): WorkflowNode {
  if (members?.length && nodeHadAgentRef(node)) {
    const multiRefs = [...(node.agents ?? []), ...(node.agentIds ?? []), ...(node.roles ?? [])].filter(
      (r): r is string => typeof r === 'string' && Boolean(r.trim()),
    );
    if (multiRefs.length > 0) {
      const resolved = resolveWorkflowAgentRefs(multiRefs, members);
      if (resolved?.length) {
        return normalizeWorkflowNodeAgents({
          ...stripWorkflowNodeAgentRefs(node),
          agentId: resolved[0]!,
          agentIds: resolved.length > 1 ? resolved : undefined,
        });
      }
      return stripWorkflowNodeAgentRefs(node);
    }
    const singleRef = [node.agent, node.role, node.agentId]
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .find(Boolean);
    if (singleRef) {
      const resolved = resolveWorkflowAgentRef(singleRef, members);
      if (resolved) {
        return normalizeWorkflowNodeAgents({ ...node, agentId: resolved });
      }
      return stripWorkflowNodeAgentRefs(node);
    }
  }
  return normalizeWorkflowNodeAgents(node);
}

export function workflowNodeAgentIds(
  node: Pick<WorkflowNode, 'agentId' | 'agentIds'> & {
    agent?: string;
    agents?: string[];
    roleId?: string;
    roleIds?: string[];
    role?: string;
    roles?: string[];
  },
): string[] {
  const fromList = [
    ...(node.agentIds ?? []),
    ...(node.agents ?? []),
    ...(node.roleIds ?? []),
    ...(node.roles ?? []),
  ].filter((id): id is string => Boolean(typeof id === 'string' && id.trim()));
  if (fromList.length > 0) {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of fromList) {
      const trimmed = id.trim();
      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        out.push(trimmed);
      }
    }
    return out;
  }
  const single = (node.agentId ?? node.agent ?? node.roleId ?? node.role)?.trim();
  if (single) return [single];
  return [];
}

export function workflowNodePrimaryAgentId(node: Pick<WorkflowNode, 'agentId' | 'agentIds'>): string {
  return workflowNodeAgentIds(node)[0] ?? node.agentId ?? '';
}

export function workflowNodeHasAgent(
  node: Pick<WorkflowNode, 'agentId' | 'agentIds'>,
  agentId: string,
): boolean {
  return workflowNodeAgentIds(node).includes(agentId);
}

export function workflowNodeIsMultiAgent(node: Pick<WorkflowNode, 'agentId' | 'agentIds'>): boolean {
  return workflowNodeAgentIds(node).length > 1;
}

export function normalizeWorkflowNodeAgents(
  node: WorkflowNode & { agent?: string; agents?: string[] },
): WorkflowNode {
  const ids = workflowNodeAgentIds(node);
  if (ids.length === 0) {
    const { agent: _a, agents: _as, ...rest } = node;
    return rest;
  }
  const { agent: _a, agents: _as, ...rest } = node;
  return {
    ...rest,
    agentId: ids[0]!,
    agentIds: ids.length > 1 ? ids : undefined,
  };
}

export function resolveWorkflowForExecution(
  workflow: WorkflowDefinition,
  members: ProjectAgentRef[],
): WorkflowDefinition {
  if (!members.length) return workflow;
  return normalizeCustomWorkflowNodes(workflow, members);
}

export function normalizeCustomWorkflowNodes(
  workflow: WorkflowDefinition,
  members?: ProjectAgentRef[],
): WorkflowDefinition {
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) => normalizeCustomWorkflowNode(node, members)),
  };
}

export function customWorkflowNodeAgentUnresolved(
  original: WorkflowNode & { agent?: string; agents?: string[] },
  normalized: WorkflowNode | undefined,
): boolean {
  return nodeHadAgentRef(original) && !normalized?.agentId?.trim();
}

export function countWorkflowNodesWithAgent(
  workflowNodes: Pick<WorkflowNode, 'id' | 'agentId' | 'agentIds'>[],
  agentId: string,
): number {
  return workflowNodes.filter((n) => workflowNodeHasAgent(n, agentId)).length;
}

export function ensureWorkflowRuntimeDefaults(
  workflow: WorkflowDefinition,
): WorkflowDefinition {
  let changed = false;
  const nodes = workflow.nodes.map((n) => {
    const v = n.maxRuntimeMinutes;
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
      const clamped = clampMaxRuntimeMinutes(v);
      if (clamped === v) return n;
      changed = true;
      return { ...n, maxRuntimeMinutes: clamped };
    }
    changed = true;
    return { ...n, maxRuntimeMinutes: DEFAULT_NODE_MAX_RUNTIME_MINUTES };
  });
  return changed ? { ...workflow, nodes } : workflow;
}

// Legacy aliases for incremental file migration (remove as callers are updated)
export const workflowNodeRoleIds = workflowNodeAgentIds;
export const workflowNodePrimaryRoleId = workflowNodePrimaryAgentId;
export const workflowNodeHasRole = workflowNodeHasAgent;
export const workflowNodeIsMultiRole = workflowNodeIsMultiAgent;
export const normalizeWorkflowNodeRoles = normalizeWorkflowNodeAgents;
export type TeamRoleRef = ProjectAgentRef;
export const customWorkflowNodeRoleUnresolved = customWorkflowNodeAgentUnresolved;
export const countWorkflowNodesWithRole = countWorkflowNodesWithAgent;
