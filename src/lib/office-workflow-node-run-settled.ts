import type { NodeRunRecord, NodeRunStatus } from '@/types/office';

export type WorkflowNodeCompletionSource = 'session' | 'room_heal';

/**
 * Progress-card short terminal after upstream rework / 回流.
 * Must NOT contain「执行失败」— that prefix drives red bubble tint.
 */
export const WORKFLOW_UPSTREAM_REWORK_PROGRESS_TEXT = '已回流上游，等待重做';

/** Legacy false-positive abort copy (pre-fix); keep for UI downgrade only. */
export const LEGACY_MISLEADING_GATEWAY_ABORT_PROGRESS_SNIPPET =
  '任务执行被中断（可能因网关重启或重新执行覆盖';

export function isWorkflowUpstreamReworkProgressText(text: string | undefined): boolean {
  const t = (text ?? '').trim();
  if (!t) return false;
  return t === WORKFLOW_UPSTREAM_REWORK_PROGRESS_TEXT || t.startsWith('已回流上游');
}

export function isLegacyMisleadingGatewayAbortProgressText(text: string | undefined): boolean {
  const t = (text ?? '').trim();
  return t.includes(LEGACY_MISLEADING_GATEWAY_ABORT_PROGRESS_SNIPPET);
}

export function isWorkflowNodeRunTerminalStatus(
  status: NodeRunStatus | undefined,
): boolean {
  return status === 'completed' || status === 'skipped' || status === 'failed';
}

/** 该节点是否已被任一路径（Session / 群聊自愈）终结，另一路径不得再改状态。 */
export function isWorkflowNodeRunClaimedByOtherPath(
  run: NodeRunRecord | undefined,
  self: WorkflowNodeCompletionSource,
): boolean {
  if (!run?.completionSource) return false;
  if (run.completionSource === self) return false;
  return isWorkflowNodeRunTerminalStatus(run.status) || run.status === 'pending';
}

export function markWorkflowNodeCompletionSource(
  run: NodeRunRecord,
  source: WorkflowNodeCompletionSource,
): NodeRunRecord {
  return { ...run, completionSource: source };
}

/**
 * room_heal (or equivalent) claims a non-terminal pending outcome — upstream rework
 * or output retry — so the peer session wait must yield without treating it as hard fail.
 */
export function markWorkflowRoomHealPendingClaim(
  run: NodeRunRecord,
  patch: Partial<NodeRunRecord> = {},
): NodeRunRecord {
  return markWorkflowPendingClaim(run, 'room_heal', patch);
}

/** Claim a pending control-flow outcome (回流 / 输出补全) for the given path. */
export function markWorkflowPendingClaim(
  run: NodeRunRecord,
  source: WorkflowNodeCompletionSource,
  patch: Partial<NodeRunRecord> = {},
): NodeRunRecord {
  return markWorkflowNodeCompletionSource(
    {
      ...run,
      ...patch,
      status: 'pending',
    },
    source,
  );
}

/** Session 收稿 apply 前：仅当节点仍为 running 时可写回（避免覆盖自愈/重试已终结状态）。 */
export function sessionWorkflowApplyMayMutateRun(run: NodeRunRecord | undefined): boolean {
  return !!run && run.status === 'running';
}

/**
 * Map a peer-claimed node run to the session role-step status.
 * pending (回流 / 输出补全) must stay pending — never coerce to completed.
 */
export function mapPeerClaimedRunToRoleStepStatus(
  peer: Pick<NodeRunRecord, 'status'>,
): 'failed' | 'completed' | 'pending' {
  if (peer.status === 'failed') return 'failed';
  if (peer.status === 'completed' || peer.status === 'skipped') return 'completed';
  return 'pending';
}

/**
 * After role steps finish: if room_heal already claimed the live run, session
 * must not rewrite failed/completed over pending rework / output-retry.
 */
export function sessionWorkflowOutcomesShouldYieldToPeerClaim(
  liveRun: NodeRunRecord | undefined,
  self: WorkflowNodeCompletionSource = 'session',
): boolean {
  return isWorkflowNodeRunClaimedByOtherPath(liveRun, self) && !sessionWorkflowApplyMayMutateRun(liveRun);
}

/**
 * Claim the *live* map entry after reopenWorkflowUpstreamForRework.
 * Never claim a stale local `run` reference — that drops reworkGeneration bumps.
 */
export function claimLiveRunAfterUpstreamReworkOpen(params: {
  runs: Map<string, NodeRunRecord>;
  nodeId: string;
  source: WorkflowNodeCompletionSource;
  reason: string;
}): NodeRunRecord {
  const live = params.runs.get(params.nodeId);
  if (!live) {
    throw new Error(`claimLiveRunAfterUpstreamReworkOpen: missing run ${params.nodeId}`);
  }
  const claimed = markWorkflowPendingClaim(live, params.source, {
    edgeOutcome: undefined,
    error: params.reason.trim().slice(0, 500) || '【回滚说明】已触发工作流回滚',
    completedAt: undefined,
    summary: undefined,
    startedAt: undefined,
    outputRetryAttempts: undefined,
    completedAgentIds: undefined,
  });
  params.runs.set(params.nodeId, claimed);
  return claimed;
}

/**
 * Session role-step results that are pending-only soft yields (peer claim / heal
 * already owns the node) must not be promoted to node status=completed.
 */
export function sessionRoleResultsIndicateSoftPendingOnly(
  roleResults: ReadonlyArray<{
    status: string;
    upstreamRework?: unknown;
    outputRetry?: boolean;
  }>,
): boolean {
  if (roleResults.length === 0) return false;
  if (roleResults.some((r) => r.upstreamRework || r.outputRetry)) return false;
  if (roleResults.some((r) => r.status === 'failed' || r.status === 'completed' || r.status === 'skipped')) {
    return false;
  }
  return roleResults.every((r) => r.status === 'pending');
}
