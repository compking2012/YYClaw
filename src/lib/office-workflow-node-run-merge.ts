import type { NodeRunRecord } from '@/types/office';

type NodeRunProgressRank = 0 | 4 | 5 | 6 | 7;

export function nodeRunProgressRank(status: NodeRunRecord['status']): NodeRunProgressRank {
  switch (status) {
    case 'pending':
      return 0;
    case 'running':
      return 4;
    case 'skipped':
      return 5;
    case 'completed':
      return 6;
    case 'failed':
      return 7;
    default:
      return 0;
  }
}

/** Merge two snapshots of the same workflow step; keep the furthest-along execution state. */
export function mergeNodeRunRecord(left: NodeRunRecord, right: NodeRunRecord): NodeRunRecord {
  if (left.nodeId !== right.nodeId) {
    throw new Error(`mergeNodeRunRecord nodeId mismatch: ${left.nodeId} vs ${right.nodeId}`);
  }
  const leftReworkGeneration = left.reworkGeneration ?? 0;
  const rightReworkGeneration = right.reworkGeneration ?? 0;
  let preferred: NodeRunRecord;
  if (rightReworkGeneration !== leftReworkGeneration) {
    preferred = rightReworkGeneration > leftReworkGeneration ? right : left;
  } else {
    const leftRetryAttempts = left.outputRetryAttempts ?? 0;
    const rightRetryAttempts = right.outputRetryAttempts ?? 0;
    if (
      right.status === 'pending'
      && left.status !== 'pending'
      && rightRetryAttempts > leftRetryAttempts
    ) {
      preferred = right;
    } else if (
      left.status === 'pending'
      && right.status !== 'pending'
      && leftRetryAttempts > rightRetryAttempts
    ) {
      preferred = left;
    } else {
      const leftRank = nodeRunProgressRank(left.status);
      const rightRank = nodeRunProgressRank(right.status);
      preferred = rightRank >= leftRank ? right : left;
    }
  }
  const other = preferred === right ? left : right;
  const reworkGeneration = Math.max(
    preferred.reworkGeneration ?? 0,
    other.reworkGeneration ?? 0,
  );
  const outputRetryAttempts = Math.max(
    preferred.outputRetryAttempts ?? 0,
    other.outputRetryAttempts ?? 0,
  );
  return {
    ...other,
    ...preferred,
    runId: preferred.runId ?? other.runId,
    sessionKey: preferred.sessionKey ?? other.sessionKey,
    startedAt: preferred.startedAt ?? other.startedAt,
    completedAt: preferred.completedAt ?? other.completedAt,
    summary: preferred.summary ?? other.summary,
    error: preferred.error ?? other.error,
    edgeOutcome: preferred.edgeOutcome ?? other.edgeOutcome,
    completedAgentIds: preferred.completedAgentIds ?? other.completedAgentIds,
    reworkGeneration: reworkGeneration > 0 ? reworkGeneration : undefined,
    outputRetryAttempts: outputRetryAttempts > 0 ? outputRetryAttempts : undefined,
    reworkReason: preferred.reworkReason ?? other.reworkReason,
  };
}

export function mergeNodeRunLists(...lists: NodeRunRecord[][]): NodeRunRecord[] {
  const merged = new Map<string, NodeRunRecord>();
  for (const list of lists) {
    for (const run of list) {
      const prev = merged.get(run.nodeId);
      merged.set(run.nodeId, prev ? mergeNodeRunRecord(prev, run) : { ...run });
    }
  }
  return [...merged.values()];
}
