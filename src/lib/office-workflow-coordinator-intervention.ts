import { workflowNodeRoleIds } from '@/lib/office-workflow-node';
import type { WorkflowNode } from '@/types/office';

export type WorkflowCoordinatorInterventionKind = 'redo' | 'skip_to' | 'other';

/** 协调者「用户介入判定」唯一 JSON 输出（须单独成块，勿夹杂其它正文）。 */
export type WorkflowCoordinatorInterventionJson = {
  needIntervention: boolean;
  /** 须重新执行或接续执行的子任务 nodeId（needIntervention=true 时必填） */
  activeNodeId: string | null;
  kind: WorkflowCoordinatorInterventionKind;
  /** skip_to 时被跳过的步骤 nodeId */
  skippedNodeId: string | null;
  reason: string;
  /** 发在项目群内的协调者回复；无需干预时须包含「无需干预」 */
  reply: string;
};

const JSON_FENCE_RE = /```(?:json)?\s*([\s\S]*?)```/i;

export function extractWorkflowCoordinatorInterventionJsonBlock(
  raw: string,
): string {
  const t = raw.trim();
  const fence = JSON_FENCE_RE.exec(t);
  if (fence?.[1]?.trim()) return fence[1].trim();
  const first = t.indexOf('{');
  const last = t.lastIndexOf('}');
  if (first >= 0 && last > first) return t.slice(first, last + 1);
  return t;
}

export function parseWorkflowCoordinatorInterventionJson(
  raw: string,
): WorkflowCoordinatorInterventionJson | null {
  const body = extractWorkflowCoordinatorInterventionJsonBlock(raw);
  try {
    const v = JSON.parse(body) as Record<string, unknown>;
    const needIntervention = v.needIntervention === true;
    const activeNodeId =
      typeof v.activeNodeId === 'string' && v.activeNodeId.trim()
        ? v.activeNodeId.trim()
        : null;
    const kindRaw = typeof v.kind === 'string' ? v.kind.trim() : 'other';
    const kind: WorkflowCoordinatorInterventionKind =
      kindRaw === 'redo' || kindRaw === 'skip_to' ? kindRaw : 'other';
    const skippedNodeId =
      typeof v.skippedNodeId === 'string' && v.skippedNodeId.trim()
        ? v.skippedNodeId.trim()
        : null;
    const reason = typeof v.reason === 'string' ? v.reason.trim() : '';
    const reply = typeof v.reply === 'string' ? v.reply.trim() : '';
    return {
      needIntervention,
      activeNodeId,
      kind,
      skippedNodeId,
      reason,
      reply,
    };
  } catch {
    return null;
  }
}

export function validateWorkflowCoordinatorInterventionDecision(
  json: WorkflowCoordinatorInterventionJson,
  nodes: WorkflowNode[],
): { ok: true } | { ok: false; detail: string } {
  const nodeIds = new Set(nodes.map((n) => n.id));
  if (!json.needIntervention) {
    if (!json.reply.trim()) {
      return { ok: false, detail: '无需干预时 reply 不可为空' };
    }
    if (!/无需干预/u.test(json.reply)) {
      return { ok: false, detail: '无需干预时 reply 须包含「无需干预」' };
    }
    return { ok: true };
  }
  if (!json.activeNodeId || !nodeIds.has(json.activeNodeId)) {
    return { ok: false, detail: 'needIntervention 时 activeNodeId 须为工作流内有效 nodeId' };
  }
  if (json.kind === 'skip_to' && json.skippedNodeId && !nodeIds.has(json.skippedNodeId)) {
    return { ok: false, detail: 'skippedNodeId 须为有效 nodeId' };
  }
  if (!json.reply.trim()) {
    return { ok: false, detail: '需要干预时 reply 不可为空' };
  }
  return { ok: true };
}

export function roleIdsForWorkflowNode(node: WorkflowNode): string[] {
  return workflowNodeRoleIds(node);
}
