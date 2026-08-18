/** Tasks the user explicitly aborted — block room reconcile from resurrecting a run. */
import { isAbortQuiescing } from './project-abort-quiesce';

const userAbortedTaskIds = new Set<string>();

/**
 * Monotonic abort sequence per project. Bumped on every markTaskUserAborted.
 * A run that started with clear-permit seq=N must not clear after seq advanced (abort won the race).
 */
const abortSeqByTaskId = new Map<string, number>();

/** 系统/网关/重新执行导致的中止原因（供群聊与 nodeRuns 展示）。 */
const abortReasonByTaskId = new Map<string, string>();

/**
 * Parallel batch sibling aborted because another node in the same batch
 * triggered upstream rework (batchAbort). Not a hard fault of this node.
 */
export const WORKFLOW_PARALLEL_REWORK_BATCH_ABORT_MESSAGE =
  '因并行步骤触发工作流回流，本步已中止（非本步故障）';

export function markTaskUserAborted(taskId: string): void {
  const id = taskId.trim();
  if (!id) return;
  userAbortedTaskIds.add(id);
  abortSeqByTaskId.set(id, (abortSeqByTaskId.get(id) ?? 0) + 1);
}

/**
 * Snapshot abort seq at run claim time. Pass to {@link clearTaskUserAborted} so a
 * concurrent abort (which bumps seq) cannot be wiped by the older run.
 */
export function issueTaskAbortClearPermit(taskId: string): number {
  const id = taskId.trim();
  if (!id) return 0;
  return abortSeqByTaskId.get(id) ?? 0;
}

/**
 * Snapshot abort seq and clear only if unchanged — atomic in JS (no await between).
 * Use at run claim so a concurrent markTaskUserAborted cannot be wiped.
 *
 * Never clear while an abort-quiesce lock is held — that would wipe an in-flight
 * abort that installed the lock before markTaskUserAborted.
 */
export function claimTaskAbortClear(taskId: string): {
  permit: number;
  cleared: boolean;
} {
  const id = taskId.trim();
  const permit = issueTaskAbortClearPermit(id);
  if (!id) return { permit: 0, cleared: false };
  if (isAbortQuiescing(id)) {
    return { permit, cleared: false };
  }
  const cleared = clearTaskUserAborted(id, { onlyIfAbortSeq: permit });
  return { permit, cleared };
}

export type ClearTaskUserAbortedOptions = {
  /**
   * When set, clear only if abort seq is still this value.
   * Omit only for intentional admin/reset paths that already asserted not quiescing.
   */
  onlyIfAbortSeq?: number;
};

/**
 * @returns true when the aborted flag was cleared (or was already clear).
 */
export function clearTaskUserAborted(
  taskId: string,
  options?: ClearTaskUserAbortedOptions,
): boolean {
  const id = taskId.trim();
  if (!id) return false;
  if (options?.onlyIfAbortSeq !== undefined) {
    const current = abortSeqByTaskId.get(id) ?? 0;
    if (current !== options.onlyIfAbortSeq) return false;
  }
  userAbortedTaskIds.delete(id);
  abortReasonByTaskId.delete(id);
  return true;
}

export function isTaskUserAborted(taskId: string): boolean {
  return userAbortedTaskIds.has(taskId.trim());
}

/** @visibleForTesting */
export function resetTaskAbortRegistryForTests(): void {
  userAbortedTaskIds.clear();
  abortSeqByTaskId.clear();
  abortReasonByTaskId.clear();
}

export function setOfficeTaskAbortReason(taskId: string, reason: string): void {
  const trimmed = reason.trim();
  if (trimmed) abortReasonByTaskId.set(taskId, trimmed.slice(0, 500));
}

export function peekOfficeTaskAbortReason(taskId: string): string | undefined {
  return abortReasonByTaskId.get(taskId);
}

export function clearOfficeTaskAbortReason(taskId: string): void {
  abortReasonByTaskId.delete(taskId);
}

/**
 * Stamp parallel-rework batch-abort copy for sibling progress cards.
 * No-op when a higher-priority reason already exists or the user aborted —
 * must not overwrite gateway/user abort reasons.
 * @returns true when the parallel-rework message was written
 */
export function stampWorkflowParallelReworkBatchAbortReason(taskId: string): boolean {
  if (isTaskUserAborted(taskId)) return false;
  if (peekOfficeTaskAbortReason(taskId)) return false;
  setOfficeTaskAbortReason(taskId, WORKFLOW_PARALLEL_REWORK_BATCH_ABORT_MESSAGE);
  return true;
}

/**
 * Clear only the parallel-rework stamp. Leaves any later/other abort reason intact
 * (unconditional clear after a batch would wipe gateway-stop reasons).
 */
export function clearWorkflowParallelReworkBatchAbortReason(taskId: string): void {
  if (peekOfficeTaskAbortReason(taskId) !== WORKFLOW_PARALLEL_REWORK_BATCH_ABORT_MESSAGE) return;
  clearOfficeTaskAbortReason(taskId);
}

/** 群聊/节点失败文案：避免仅显示 "Aborted"。 */
export function resolveOfficeTaskAbortMessage(taskId: string): string {
  const stored = peekOfficeTaskAbortReason(taskId);
  if (stored) return stored;
  if (isTaskUserAborted(taskId)) return '用户已手动中止本项目';
  return '任务执行被中断，请稍后点击续跑';
}
