import { parseMentions, roleMatchesMentionToken } from '@/lib/office-mention-parse';
import { getDirectPredecessorNodeIds } from '@/lib/office-workflow-prior-context';
import { workflowNodeRoleIds } from '@/lib/office-workflow-node';
import type { OfficeRole, WorkflowEdge, WorkflowNode } from '@/types/office';

/** 【回滚说明】无问题时仅允许填写「无」。 */
export const WORKFLOW_ROLLBACK_NONE_RE = /^无$/u;

const WORKFLOW_ROLLBACK_NONE_WITH_PUNCT_RE = /^无[。.!]?$/u;

/** 去掉首尾空白；将「无。」等规范为「无」。 */
export function normalizeWorkflowRollbackExplanationBody(body: string): string {
  const t = body.trim();
  if (WORKFLOW_ROLLBACK_NONE_WITH_PUNCT_RE.test(t)) return '无';
  return t;
}

/**
 * 严格回滚触发句式（整段匹配）：
 * 【回滚】{角色}在「{步骤/任务名}」的交付物存在{异常}（{原因}）
 */
export const WORKFLOW_ROLLBACK_TRIGGER_RE =
  /^【回滚】：?(.+?)在「(.+?)」的交付物存在(.+?)（(.+?)）$/u;

export type ParsedWorkflowRollbackTrigger = {
  roleHint: string;
  stepHint: string;
  anomaly: string;
  reason: string;
};

export type WorkflowRollbackDecision = {
  rollback: boolean;
  reason: string;
  predecessorNodeIds: string[];
  mentionedRoles: OfficeRole[];
};

export function parseWorkflowRollbackTrigger(
  body: string,
): ParsedWorkflowRollbackTrigger | null {
  const t = normalizeWorkflowRollbackExplanationBody(body);
  if (!t || WORKFLOW_ROLLBACK_NONE_RE.test(t)) return null;

  const modern = WORKFLOW_ROLLBACK_TRIGGER_RE.exec(t);
  if (modern) {
    return {
      roleHint: modern[1]!.trim(),
      stepHint: modern[2]!.trim(),
      anomaly: modern[3]!.trim(),
      reason: modern[4]!.trim(),
    };
  }

  return null;
}

export function isValidWorkflowRollbackExplanationBody(body: string): boolean {
  const t = normalizeWorkflowRollbackExplanationBody(body);
  if (!t) return false;
  if (WORKFLOW_ROLLBACK_NONE_RE.test(t)) return true;
  return parseWorkflowRollbackTrigger(t) != null;
}

function rolesMatchingHint(
  hint: string,
  roleIds: Set<string>,
  teamRoles: Pick<OfficeRole, 'id' | 'name' | 'agentId'>[],
): OfficeRole[] {
  const hits: OfficeRole[] = [];
  const seen = new Set<string>();
  const normalizedHint = hint.trim();
  if (!normalizedHint) return hits;

  for (const role of teamRoles) {
    if (!roleIds.has(role.id) || seen.has(role.id)) continue;
    const name = role.name.trim();
    if (
      name === normalizedHint
      || normalizedHint.includes(name)
      || name.includes(normalizedHint)
    ) {
      seen.add(role.id);
      hits.push(role as OfficeRole);
    }
  }

  for (const token of parseMentions(normalizedHint)) {
    const role = teamRoles.find((r) => roleMatchesMentionToken(r as OfficeRole, token));
    if (role && roleIds.has(role.id) && !seen.has(role.id)) {
      seen.add(role.id);
      hits.push(role as OfficeRole);
    }
  }

  return hits;
}

function nodeIdsForRolesOnNodes(
  nodeIds: string[],
  roleIds: Set<string>,
  nodes: WorkflowNode[],
): string[] {
  if (roleIds.size === 0) return nodeIds;
  return nodeIds.filter((nid) => {
    const n = nodes.find((x) => x.id === nid);
    if (!n) return false;
    return workflowNodeRoleIds(n).some((rid) => roleIds.has(rid));
  });
}

function nodesMatchingStepHint(
  nodeIds: string[],
  stepHint: string,
  nodes: WorkflowNode[],
): string[] {
  const hint = stepHint.trim();
  if (!hint) return nodeIds;
  const matched = nodeIds.filter((nid) => {
    const n = nodes.find((x) => x.id === nid);
    if (!n) return false;
    const title = (n.title ?? '').trim();
    const desc = (n.description ?? '').trim();
    return title.includes(hint) || hint.includes(title) || desc.includes(hint);
  });
  return matched.length > 0 ? matched : nodeIds;
}

function rollbackEdgeTargets(
  currentNodeId: string,
  edges: WorkflowEdge[],
): string[] {
  return edges
    .filter(
      (e) =>
        e.from === currentNodeId
        && (e.when ?? 'on_success') === 'on_failure',
    )
    .map((e) => e.to);
}

/**
 * 有【回滚】触发句时解析前驱：优先 on_failure 回滚边，否则 DAG 直接前驱。
 */
export function resolveWorkflowRollbackPredecessorNodeIds(params: {
  currentNodeId: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  trigger: ParsedWorkflowRollbackTrigger;
  teamRoles: Pick<OfficeRole, 'id' | 'name' | 'agentId'>[];
}): string[] {
  const directPreds = getDirectPredecessorNodeIds(
    params.currentNodeId,
    params.nodes,
    params.edges,
  );
  const onFailureTargets = rollbackEdgeTargets(params.currentNodeId, params.edges);
  const candidatePool = onFailureTargets.length > 0 ? onFailureTargets : directPreds;
  if (candidatePool.length === 0) return [];

  const poolRoleIds = new Set<string>();
  for (const nid of candidatePool) {
    const n = params.nodes.find((x) => x.id === nid);
    if (!n) continue;
    for (const rid of workflowNodeRoleIds(n)) poolRoleIds.add(rid);
  }

  let mentionedRoles = rolesMatchingHint(
    params.trigger.roleHint,
    poolRoleIds,
    params.teamRoles,
  );
  if (mentionedRoles.length === 0) {
    const predRoleIds = new Set<string>();
    for (const nid of directPreds) {
      const n = params.nodes.find((x) => x.id === nid);
      if (!n) continue;
      for (const rid of workflowNodeRoleIds(n)) predRoleIds.add(rid);
    }
    mentionedRoles = rolesMatchingHint(params.trigger.roleHint, predRoleIds, params.teamRoles);
  }

  const mentionedRoleIds = new Set(mentionedRoles.map((r) => r.id));

  let predecessorNodeIds = candidatePool;
  if (mentionedRoleIds.size > 0) {
    const narrowed = nodeIdsForRolesOnNodes(
      predecessorNodeIds,
      mentionedRoleIds,
      params.nodes,
    );
    if (narrowed.length > 0) predecessorNodeIds = narrowed;
  }
  predecessorNodeIds = nodesMatchingStepHint(
    predecessorNodeIds,
    params.trigger.stepHint,
    params.nodes,
  );

  if (predecessorNodeIds.length === 0) {
    predecessorNodeIds = candidatePool.length > 0 ? candidatePool : directPreds;
  }

  return [...new Set(predecessorNodeIds)];
}

/**
 * 【回滚说明】为唯一业务回滚信号：有严格【回滚】触发句则必须回滚。
 * 前驱：优先 on_failure 回滚边，否则直接前驱（可经角色/步骤名收窄）。
 */
export function evaluateWorkflowRollback(params: {
  rollbackExplanation: string;
  currentNodeId: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  teamRoles: Pick<OfficeRole, 'id' | 'name' | 'agentId'>[];
}): WorkflowRollbackDecision {
  const empty: WorkflowRollbackDecision = {
    rollback: false,
    reason: '',
    predecessorNodeIds: [],
    mentionedRoles: [],
  };

  const trigger = parseWorkflowRollbackTrigger(params.rollbackExplanation);
  if (!trigger) return empty;

  const predecessorNodeIds = resolveWorkflowRollbackPredecessorNodeIds({
    currentNodeId: params.currentNodeId,
    nodes: params.nodes,
    edges: params.edges,
    trigger,
    teamRoles: params.teamRoles,
  });

  const poolRoleIds = new Set<string>();
  for (const nid of predecessorNodeIds) {
    const n = params.nodes.find((x) => x.id === nid);
    if (!n) continue;
    for (const rid of workflowNodeRoleIds(n)) poolRoleIds.add(rid);
  }
  const mentionedRoles = rolesMatchingHint(trigger.roleHint, poolRoleIds, params.teamRoles);

  return {
    rollback: true,
    reason: params.rollbackExplanation.trim().slice(0, 500),
    predecessorNodeIds,
    mentionedRoles,
  };
}
