import type { WorkflowCoordinatorInterventionKind } from '@/lib/office-workflow-coordinator-intervention';
import { workflowNodeHasRole, workflowNodeRoleIds } from '@/lib/office-workflow-node';
import {
  collectDownstreamNodeIds,
  reopenWorkflowNodeAndDownstream,
} from '@/lib/office-workflow-upstream-rework';
import { workflowEdgeList } from '@/lib/office-workflow-schedule';
import type {
  NodeRunRecord,
  OfficeRole,
  OfficeTask,
  WorkflowEdge,
  WorkflowNode,
} from '@/types/office';

export type WorkflowUserInterventionKind = 'redo' | 'skip_to' | 'other';

/** 任务上持久化的介入状态（进行中忽略新的用户介入）。 */
export type WorkflowUserInterventionState = {
  /** 须执行完毕以清除介入标记的子任务（重做 X 则为 X；跳过 X 执行 Y 则为 Y）。 */
  activeNodeId: string;
  request: string;
  startedAt: number;
  kind: WorkflowUserInterventionKind;
  /** skip_to 时被跳过的步骤。 */
  skippedNodeId?: string;
};

export type WorkflowUserInterventionPlan = {
  nodeId: string;
  nodeTitle: string;
  roleIds: string[];
  downstreamNodeIds: string[];
  kind: WorkflowUserInterventionKind;
  activeNodeId: string;
  skippedNodeId?: string;
  intervention: WorkflowUserInterventionState;
};

export function isWorkflowUserInterventionActive(
  task: Pick<OfficeTask, 'workflowUserIntervention'>,
): boolean {
  return Boolean(task.workflowUserIntervention?.activeNodeId?.trim());
}

export function parseWorkflowUserInterventionKind(
  userContent: string,
): WorkflowUserInterventionKind {
  const t = userContent.trim();
  if (
    /跳过|略过|直接进入|下一(?:步|阶段|节点)|不做(?:此|该)?步|skip\s+/iu.test(t)
  ) {
    return 'skip_to';
  }
  if (/重做|重新(?:做|执行|实现|开发|编写|评审)|返工|重来|重做本步/iu.test(t)) {
    return 'redo';
  }
  return 'other';
}

function findNodeByTitleInContent(
  nodes: WorkflowNode[],
  content: string,
): WorkflowNode | null {
  const t = content.trim();
  if (!t) return null;
  for (const n of nodes) {
    const title = n.title?.trim();
    if (title && title.length >= 2 && t.includes(title)) return n;
  }
  return null;
}

/** 在分配给该角色的步骤中，选取用户介入要重开的节点。 */
export function pickWorkflowNodeForUserIntervention(params: {
  nodes: WorkflowNode[];
  roleId: string;
  runs: Map<string, NodeRunRecord>;
  userContent: string;
}): WorkflowNode | null {
  const candidates = params.nodes.filter((n) => workflowNodeHasRole(n, params.roleId));
  if (candidates.length === 0) return null;

  const byTitle = findNodeByTitleInContent(candidates, params.userContent);
  if (byTitle) return byTitle;

  const content = params.userContent.trim();
  for (const n of candidates) {
    const title = n.title?.trim();
    if (title && title.length >= 2 && content.includes(title)) return n;
  }

  let lastDone: WorkflowNode | null = null;
  for (const n of candidates) {
    const st = params.runs.get(n.id)?.status;
    if (st === 'completed' || st === 'failed' || st === 'skipped') lastDone = n;
  }
  if (lastDone) return lastDone;

  return candidates[candidates.length - 1]!;
}

function successorNodeIds(
  nodeId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): string[] {
  const edgeList = workflowEdgeList(nodes, edges);
  const ids = new Set<string>();
  for (const e of edgeList) {
    if (e.from !== nodeId) continue;
    const when = e.when ?? 'on_success';
    if (when === 'on_success' || when === 'always') ids.add(e.to);
  }
  return [...ids];
}

function pickSkipTargetNode(params: {
  sourceNode: WorkflowNode;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  userContent: string;
}): WorkflowNode | null {
  const succIds = successorNodeIds(params.sourceNode.id, params.nodes, params.edges);
  if (succIds.length === 0) return null;

  const byTitle = findNodeByTitleInContent(
    params.nodes.filter((n) => succIds.includes(n.id)),
    params.userContent,
  );
  if (byTitle) return byTitle;

  const first = params.nodes.find((n) => n.id === succIds[0]);
  return first ?? null;
}

function markNodeSkipped(
  runs: Map<string, NodeRunRecord>,
  node: WorkflowNode,
  reason: string,
): void {
  const prev = runs.get(node.id);
  runs.set(node.id, {
    nodeId: node.id,
    agentId: workflowNodeRoleIds(node)[0] ?? node.agentId,
    status: 'skipped',
    completedAt: Date.now(),
    summary: reason.slice(0, 400),
    error: undefined,
    startedAt: undefined,
    outputRetryAttempts: undefined,
    completedAgentIds: undefined,
    ...(prev?.sessionKey ? { sessionKey: prev.sessionKey } : {}),
    ...(prev?.runId ? { runId: prev.runId } : {}),
  });
}

export function planWorkflowUserIntervention(params: {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  runs: Map<string, NodeRunRecord>;
  targetRoles: Pick<OfficeRole, 'id' | 'name'>[];
  userContent: string;
}): WorkflowUserInterventionPlan | null {
  if (params.targetRoles.length === 0) return null;

  const kind = parseWorkflowUserInterventionKind(params.userContent);
  const primary = params.targetRoles[0]!;
  const sourceNode = pickWorkflowNodeForUserIntervention({
    nodes: params.nodes,
    roleId: primary.id,
    runs: params.runs,
    userContent: params.userContent,
  });
  if (!sourceNode) return null;

  const edgeList = workflowEdgeList(params.nodes, params.edges);
  const startedAt = Date.now();
  const request = params.userContent.trim().slice(0, 4_000);

  if (kind === 'skip_to') {
    const target = pickSkipTargetNode({
      sourceNode,
      nodes: params.nodes,
      edges: params.edges,
      userContent: params.userContent,
    });
    if (!target) return null;

    markNodeSkipped(
      params.runs,
      sourceNode,
      `用户介入：已跳过「${sourceNode.title?.trim() || sourceNode.id}」`,
    );

    reopenWorkflowNodeAndDownstream({
      runs: params.runs,
      nodes: params.nodes,
      edges: params.edges,
      nodeId: target.id,
    });

    const intervention: WorkflowUserInterventionState = {
      activeNodeId: target.id,
      request,
      startedAt,
      kind: 'skip_to',
      skippedNodeId: sourceNode.id,
    };

    return {
      nodeId: sourceNode.id,
      nodeTitle: sourceNode.title?.trim() || '工作流步骤',
      roleIds: params.targetRoles.map((r) => r.id),
      downstreamNodeIds: [...collectDownstreamNodeIds(target.id, edgeList)],
      kind: 'skip_to',
      activeNodeId: target.id,
      skippedNodeId: sourceNode.id,
      intervention,
    };
  }

  reopenWorkflowNodeAndDownstream({
    runs: params.runs,
    nodes: params.nodes,
    edges: params.edges,
    nodeId: sourceNode.id,
  });

  const intervention: WorkflowUserInterventionState = {
    activeNodeId: sourceNode.id,
    request,
    startedAt,
    kind: kind === 'redo' ? 'redo' : 'other',
  };

  return {
    nodeId: sourceNode.id,
    nodeTitle: sourceNode.title?.trim() || '工作流步骤',
    roleIds: params.targetRoles.map((r) => r.id),
    downstreamNodeIds: [...collectDownstreamNodeIds(sourceNode.id, edgeList)],
    kind: intervention.kind,
    activeNodeId: sourceNode.id,
    intervention,
  };
}

/** 协调者模型判定的介入计划（activeNodeId 由模型指定）。 */
export function planWorkflowUserInterventionFromCoordinator(params: {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  runs: Map<string, NodeRunRecord>;
  userContent: string;
  activeNodeId: string;
  kind: WorkflowCoordinatorInterventionKind;
  skippedNodeId?: string | null;
}): WorkflowUserInterventionPlan | null {
  const activeNode = params.nodes.find((n) => n.id === params.activeNodeId);
  if (!activeNode) return null;

  const edgeList = workflowEdgeList(params.nodes, params.edges);
  const startedAt = Date.now();
  const request = params.userContent.trim().slice(0, 4_000);
  const roleIds = workflowNodeRoleIds(activeNode);

  if (params.kind === 'skip_to' && params.skippedNodeId) {
    const sourceNode = params.nodes.find((n) => n.id === params.skippedNodeId);
    if (!sourceNode) return null;
    markNodeSkipped(
      params.runs,
      sourceNode,
      `用户介入：已跳过「${sourceNode.title?.trim() || sourceNode.id}」`,
    );
    reopenWorkflowNodeAndDownstream({
      runs: params.runs,
      nodes: params.nodes,
      edges: params.edges,
      nodeId: activeNode.id,
    });
    const intervention: WorkflowUserInterventionState = {
      activeNodeId: activeNode.id,
      request,
      startedAt,
      kind: 'skip_to',
      skippedNodeId: sourceNode.id,
    };
    return {
      nodeId: sourceNode.id,
      nodeTitle: sourceNode.title?.trim() || '工作流步骤',
      roleIds,
      downstreamNodeIds: [...collectDownstreamNodeIds(activeNode.id, edgeList)],
      kind: 'skip_to',
      activeNodeId: activeNode.id,
      skippedNodeId: sourceNode.id,
      intervention,
    };
  }

  reopenWorkflowNodeAndDownstream({
    runs: params.runs,
    nodes: params.nodes,
    edges: params.edges,
    nodeId: activeNode.id,
  });

  const intervention: WorkflowUserInterventionState = {
    activeNodeId: activeNode.id,
    request,
    startedAt,
    kind: params.kind === 'redo' ? 'redo' : 'other',
  };

  return {
    nodeId: activeNode.id,
    nodeTitle: activeNode.title?.trim() || '工作流步骤',
    roleIds,
    downstreamNodeIds: [...collectDownstreamNodeIds(activeNode.id, edgeList)],
    kind: intervention.kind,
    activeNodeId: activeNode.id,
    intervention,
  };
}

export function clearWorkflowUserInterventionIfNodeDone(
  task: OfficeTask,
  completedNodeId: string,
): boolean {
  const active = task.workflowUserIntervention?.activeNodeId;
  if (!active || active !== completedNodeId) return false;
  task.workflowUserIntervention = undefined;
  return true;
}

/** 介入步骤失败时也清除标记，避免任务永久锁死在 intervention_in_progress。 */
export function clearWorkflowUserInterventionIfNodeTerminal(
  task: OfficeTask,
  nodeId: string,
  status: 'completed' | 'failed' | 'skipped',
): boolean {
  const active = task.workflowUserIntervention?.activeNodeId;
  if (!active || active !== nodeId) return false;
  if (status !== 'completed' && status !== 'failed' && status !== 'skipped') return false;
  task.workflowUserIntervention = undefined;
  return true;
}
