import { workflowEdgeList } from '@/lib/office-workflow-schedule';
import type { NodeRunRecord, NodeRunStatus, WorkflowEdge, WorkflowNode } from '@/types/office';

function isNodeRunTerminal(status?: NodeRunStatus): boolean {
  return status === 'completed' || status === 'skipped';
}

function forwardPredecessorIds(
  nodeId: string,
  edgeList: WorkflowEdge[],
): string[] {
  return edgeList
    .filter((e) => e.to === nodeId && (e.when ?? 'on_success') !== 'on_failure')
    .map((e) => e.from)
    .sort();
}

/**
 * 用户介入从 activeNode 接续时，须同步重开的并行步骤：
 * - 同 parallelGroup 且未完成的 peer；
 * - 或与 activeNode 共享相同前驱、处于同一 fork 层且未完成的 sibling。
 * 已完成/跳过的并行步骤不重开。
 */
export function collectUserInterventionResumeNodeIds(
  activeNodeId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  runs: Map<string, NodeRunRecord>,
): string[] {
  const active = nodes.find((n) => n.id === activeNodeId);
  if (!active) return [activeNodeId];

  const edgeList = workflowEdgeList(nodes, edges);
  const seeds = new Set<string>([activeNodeId]);
  const activePredKey = forwardPredecessorIds(activeNodeId, edgeList).join('|');

  if (active.parallelGroup?.trim()) {
    for (const peer of nodes) {
      if (peer.parallelGroup !== active.parallelGroup || peer.id === activeNodeId) continue;
      if (isNodeRunTerminal(runs.get(peer.id)?.status)) continue;
      seeds.add(peer.id);
    }
  }

  for (const node of nodes) {
    if (node.id === activeNodeId || seeds.has(node.id)) continue;
    if (forwardPredecessorIds(node.id, edgeList).join('|') !== activePredKey) continue;
    if (isNodeRunTerminal(runs.get(node.id)?.status)) continue;
    seeds.add(node.id);
  }

  return [...seeds];
}

export function collectDownstreamNodeIds(
  fromNodeId: string,
  edgeList: WorkflowEdge[],
): Set<string> {
  const forwardEdges = edgeList.filter((e) => (e.when ?? 'on_success') !== 'on_failure');
  const out = new Set<string>();
  const stack = [fromNodeId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const e of forwardEdges) {
      if (e.from !== cur || out.has(e.to)) continue;
      out.add(e.to);
      stack.push(e.to);
    }
  }
  return out;
}

/** True when reworkReason carries human-checkpoint review text (not agent-to-agent rollback). */
export function isHumanReviewReworkReason(reworkReason: string | undefined): boolean {
  return Boolean(reworkReason?.trim().startsWith('【人工审查意见】'));
}

/** Strip structured 【回滚】 tag so the downstream-rework header can own the reason wording. */
export function stripWorkflowRollbackTagForPrompt(reworkReason: string): string {
  return reworkReason.replace(/^【回滚】：?\s*/u, '').trim();
}

/**
 * Prefix for node LLM prompts after rework.
 * - Agent/auto rollback → 【下游回流·须优先并针对性处理。原因如下】：{原因}
 * - Human checkpoint review (already tagged 【人工审查意见】) → 【用户介入·须优先满足】
 */
export function buildWorkflowReworkPromptPrefix(reworkReason: string | undefined): string {
  const reason = reworkReason?.trim();
  if (!reason) return '';
  const clipped = reason.slice(0, 2_000);
  if (isHumanReviewReworkReason(clipped)) {
    return [
      '【用户介入·须优先满足】',
      clipped,
      '（请按上述审查意见修正本步交付物并重新输出唯一结构化 JSON。）',
    ].join('\n');
  }
  const body = stripWorkflowRollbackTagForPrompt(clipped);
  if (!body) return '';
  return `【下游回流·须优先并针对性处理。原因如下】：${body}`;
}

/** 将回滚目标前驱置为 pending；当前步及下游回到 pending。 */
export function reopenWorkflowUpstreamForRework(params: {
  runs: Map<string, NodeRunRecord>;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  currentNodeId: string;
  predecessorNodeIds: string[];
  /** 来自下游节点的回滚说明，写入各前驱节点 prompt。 */
  reworkReason?: string;
}): void {
  const edgeList = workflowEdgeList(params.nodes, params.edges);
  const downstream = collectDownstreamNodeIds(params.currentNodeId, edgeList);
  const predSet = new Set(params.predecessorNodeIds);

  const reasonNote = params.reworkReason?.trim().slice(0, 2_000);
  for (const predId of params.predecessorNodeIds) {
    const pred = params.runs.get(predId);
    if (!pred) continue;
    params.runs.set(predId, {
      ...pred,
      status: 'pending',
      edgeOutcome: undefined,
      error: undefined,
      completedAt: undefined,
      summary: undefined,
      startedAt: undefined,
      outputRetryAttempts: undefined,
      completedAgentIds: undefined,
      sessionKey: undefined,
      runId: undefined,
      reworkGeneration: (pred.reworkGeneration ?? 0) + 1,
      reworkReason: reasonNote || pred.reworkReason,
    });
  }

  const cur = params.runs.get(params.currentNodeId);
  if (cur) {
    resetNodeRunToPendingForRework(params.runs, params.currentNodeId, {
      error: '等待上游补充交付后重新校验输入',
    });
  }

  for (const nid of downstream) {
    if (predSet.has(nid) || nid === params.currentNodeId) continue;
    resetNodeRunToPendingForRework(params.runs, nid);
  }
}

/** 失败/回流重开：须 bump reworkGeneration 并清 session，避免群聊旧交付跳过重跑。 */
function resetNodeRunToPendingForRework(
  runs: Map<string, NodeRunRecord>,
  nodeId: string,
  opts?: { error?: string },
): void {
  const r = runs.get(nodeId);
  if (!r) return;
  runs.set(nodeId, {
    ...r,
    status: 'pending',
    edgeOutcome: undefined,
    error: opts?.error ?? undefined,
    completedAt: undefined,
    summary: undefined,
    startedAt: undefined,
    outputRetryAttempts: undefined,
    completedAgentIds: undefined,
    sessionKey: undefined,
    runId: undefined,
    reworkGeneration: (r.reworkGeneration ?? 0) + 1,
  });
}

/** 用户介入重开：须 bump reworkGeneration 并清 session，避免群聊旧交付导致跳过重跑。 */
function resetNodeRunToPendingForUserIntervention(
  runs: Map<string, NodeRunRecord>,
  nodeId: string,
): void {
  resetNodeRunToPendingForRework(runs, nodeId);
}

/** 用户介入后：重开指定步骤（及未完成并行 peer）及其下游，上游已完成步骤保持不变。 */
export function reopenWorkflowNodeAndDownstream(params: {
  runs: Map<string, NodeRunRecord>;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  nodeId: string;
}): void {
  const edgeList = workflowEdgeList(params.nodes, params.edges);
  const seedIds = collectUserInterventionResumeNodeIds(
    params.nodeId,
    params.nodes,
    params.edges,
    params.runs,
  );
  const downstream = new Set<string>();
  for (const seedId of seedIds) {
    resetNodeRunToPendingForUserIntervention(params.runs, seedId);
    for (const nid of collectDownstreamNodeIds(seedId, edgeList)) {
      downstream.add(nid);
    }
  }
  for (const nid of downstream) {
    resetNodeRunToPendingForUserIntervention(params.runs, nid);
  }
}
