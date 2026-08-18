import { parseMentions, roleMatchesMentionToken } from '@/lib/office-mention-parse';
import { getDirectPredecessorNodeIds } from '@/lib/office-workflow-prior-context';
import { workflowNodeRoleIds, type ProjectAgentRef } from '@/lib/office-workflow-node';
import type {
  NodeRunRecord,
  WorkflowEdge,
  WorkflowNode,
} from '@/types/office';

export type WorkflowUpstreamMentionMessage = {
  from?: string;
  fromRoleId?: string;
  content?: string;
  phase?: string;
  nodeId?: string;
};

/** 群聊协作询问：runner 活跃时仅此场景允许成员 @ 上游并在群内回复。 */
export function isWorkflowUpstreamClarificationMessage(
  message: WorkflowUpstreamMentionMessage | undefined,
): boolean {
  if (!message?.content?.trim()) return false;
  if (message.from === 'user' || message.from === 'system') return false;
  if (message.phase === 'task_clarification') return true;
  return /协作询问|❓\s*协作询问/u.test(message.content);
}

function matchWorkflowNodeByStepTitleInContent(
  content: string,
  nodes: WorkflowNode[],
  speakerRoleId: string,
): string | undefined {
  const roleNodes = nodes.filter((n) => workflowNodeRoleIds(n).includes(speakerRoleId));
  const hits = roleNodes.filter((n) => {
    const title = n.title?.trim();
    return title && title.length >= 2 && content.includes(title);
  });
  if (hits.length === 0) return undefined;
  if (hits.length === 1) return hits[0]!.id;
  hits.sort(
    (a, b) => (b.title?.trim().length ?? 0) - (a.title?.trim().length ?? 0),
  );
  return hits[0]!.id;
}

export function findWorkflowSpeakerNodeId(params: {
  nodeRuns?: NodeRunRecord[];
  nodes: WorkflowNode[];
  speakerRoleId: string;
  messageNodeId?: string;
  content?: string;
}): string | undefined {
  const explicit = params.messageNodeId?.trim();
  if (explicit) {
    const node = params.nodes.find((n) => n.id === explicit);
    if (node && workflowNodeRoleIds(node).includes(params.speakerRoleId)) {
      return explicit;
    }
  }

  const body = params.content?.trim() ?? '';
  if (body) {
    const byTitle = matchWorkflowNodeByStepTitleInContent(
      body,
      params.nodes,
      params.speakerRoleId,
    );
    if (byTitle) return byTitle;
  }

  const runs = params.nodeRuns ?? [];
  for (const status of ['running', 'pending'] as const) {
    for (const run of runs) {
      if (run.status !== status) continue;
      const node = params.nodes.find((n) => n.id === run.nodeId);
      if (!node) continue;
      if (workflowNodeRoleIds(node).includes(params.speakerRoleId)) {
        return run.nodeId;
      }
    }
  }

  const roleNodes = params.nodes.filter((n) =>
    workflowNodeRoleIds(n).includes(params.speakerRoleId),
  );
  return roleNodes.length === 1 ? roleNodes[0]!.id : undefined;
}

function predecessorRoleIdsForNode(
  nodeId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): Set<string> {
  const predNodeIds = getDirectPredecessorNodeIds(nodeId, nodes, edges);
  const roleIds = new Set<string>();
  for (const nid of predNodeIds) {
    const node = nodes.find((n) => n.id === nid);
    if (!node) continue;
    for (const rid of workflowNodeRoleIds(node)) roleIds.add(rid);
  }
  return roleIds;
}

/** 从消息正文解析 @，且目标须为当前步骤直接上游角色。 */
export function resolveWorkflowUpstreamMentionRoleIds(params: {
  message: WorkflowUpstreamMentionMessage;
  speakerRoleId: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  nodeRuns?: NodeRunRecord[];
  teamRoles: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[];
}): string[] {
  if (!isWorkflowUpstreamClarificationMessage(params.message)) return [];
  const nodeId = findWorkflowSpeakerNodeId({
    nodeRuns: params.nodeRuns,
    nodes: params.nodes,
    speakerRoleId: params.speakerRoleId,
    messageNodeId: params.message.nodeId,
  });
  if (!nodeId) return [];

  const allowed = predecessorRoleIdsForNode(nodeId, params.nodes, params.edges);
  if (allowed.size === 0) return [];

  const content = params.message.content ?? '';
  const hits: string[] = [];
  const seen = new Set<string>();
  for (const token of parseMentions(content)) {
    const role = params.teamRoles.find((r) => roleMatchesMentionToken(r, token));
    if (!role || role.agentId === params.speakerRoleId) continue;
    if (!allowed.has(role.agentId) || seen.has(role.agentId)) continue;
    seen.add(role.agentId);
    hits.push(role.agentId);
  }
  return hits;
}

export function isWorkflowUpstreamClarificationTarget(params: {
  message?: WorkflowUpstreamMentionMessage;
  speakerRoleId?: string;
  targetRoleId: string;
  coordinatorRoleId: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  nodeRuns?: NodeRunRecord[];
  teamRoles: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[];
}): boolean {
  if (!params.message || !params.speakerRoleId) return false;
  if (params.targetRoleId === params.coordinatorRoleId) return false;
  if (params.speakerRoleId === params.coordinatorRoleId) return false;
  const allowed = resolveWorkflowUpstreamMentionRoleIds({
    message: params.message,
    speakerRoleId: params.speakerRoleId,
    nodes: params.nodes,
    edges: params.edges,
    nodeRuns: params.nodeRuns,
    teamRoles: params.teamRoles,
  });
  return allowed.includes(params.targetRoleId);
}
