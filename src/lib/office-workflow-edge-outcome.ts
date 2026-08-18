import type { NodeRunRecord } from '@/types/office';

export type WorkflowDeliverableConclusion = '通过' | '不通过' | '已交付';

/**
 * Read structured room-mirror `结论：…` line (serialized deliverable.conclusion).
 * Does not fuzzy-match words like「失败」inside free-form summary text.
 */
export function readWorkflowDeliverableConclusionFromMirrorText(
  text: string | undefined,
): WorkflowDeliverableConclusion | undefined {
  if (!text?.trim()) return undefined;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    let value: string | undefined;
    if (trimmed.startsWith('结论：')) value = trimmed.slice('结论：'.length).trim();
    else if (trimmed.startsWith('结论:')) value = trimmed.slice('结论:'.length).trim();
    if (value === '通过' || value === '不通过' || value === '已交付') return value;
  }
  return undefined;
}

/** Business failure is only deliverable.conclusion === 不通过. */
export function isWorkflowDeliverableConclusionFailure(
  conclusion: string | undefined,
): boolean {
  return (conclusion ?? '').trim() === '不通过';
}

/**
 * 业务「结论不通过」：仅 completed + failure 信号。
 * 不含 status=failed（API/超时等技术失败，续跑重试即可，勿自动回滚/走 on_failure 边）。
 *
 * Prefer explicit edgeOutcome (set from deliverable.conclusion at apply time).
 * Fallback: parse room-mirror `结论：` line only (not free-text「失败」).
 */
export function nodeRunHasFailureConclusion(
  run: Pick<NodeRunRecord, 'status' | 'edgeOutcome' | 'summary' | 'error'> | undefined,
): boolean {
  if (!run || run.status !== 'completed') return false;
  if (run.edgeOutcome === 'failure') return true;
  if (run.edgeOutcome === 'success') return false;
  const mirrored = readWorkflowDeliverableConclusionFromMirrorText(
    [run.summary, run.error].filter(Boolean).join('\n'),
  );
  return isWorkflowDeliverableConclusionFailure(mirrored);
}

/**
 * Session DAG `on_failure` 入边是否就绪。
 * 仅业务结论不通过（completed + edgeOutcome=failure）。
 * 技术 status=failed 不得打开 on_failure（与 LangGraph halt、勿自动回滚一致；续跑重试）。
 */
export function nodeRunTriggersFailureEdge(run: Pick<NodeRunRecord, 'status' | 'edgeOutcome'>): boolean {
  return run.status === 'completed' && run.edgeOutcome === 'failure';
}

/** LangGraph 条件边：仅业务结论 failure 走 on_failure（对齐 nodeRunHasFailureConclusion）。 */
export function nodeRunRoutesToFailureTargets(
  run: Pick<NodeRunRecord, 'status' | 'edgeOutcome' | 'summary' | 'error'> | undefined,
): boolean {
  return nodeRunHasFailureConclusion(run);
}

export type LangGraphNodeRunRoute = 'pending' | 'failure' | 'halt' | 'success';

/**
 * LangGraph execute 节点出边路由：
 * - pending：未完成
 * - failure：业务结论不通过（on_failure）
 * - halt：技术失败（勿当 success）
 * - success：业务成功
 */
export function langGraphNodeRunRoute(
  run: Pick<NodeRunRecord, 'status' | 'edgeOutcome' | 'summary' | 'error'> | undefined,
): LangGraphNodeRunRoute {
  if (!run || run.status === 'pending' || run.status === 'running') return 'pending';
  if (run.status === 'failed') return 'halt';
  if (nodeRunHasFailureConclusion(run)) return 'failure';
  if (run.status === 'completed') return 'success';
  return 'pending';
}
