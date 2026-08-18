import { isWorkflowReviewActive } from '@/lib/office-workflow-user-checkpoint';
import type { OfficeTempProject } from '@/types/office';

export function normalizeCompletionTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return value;
  }
  return undefined;
}

function isProjectAwaitingArchive(
  project: Pick<OfficeTempProject, 'status' | 'lifecycle'>,
): boolean {
  return project.status === 'completed' && (project.lifecycle ?? 'active') === 'active';
}

/** 合并执行完成轮次戳记：进入 completed 时写入 lastRunCompletedAt 并清空 handled；离开 completed 时清空。 */
export function mergeCompletionFollowUpFields(
  previous: Pick<
    OfficeTempProject,
    'status' | 'lastRunCompletedAt' | 'completionFollowUpHandledAt'
  > | null
  | undefined,
  next: Pick<
    OfficeTempProject,
    'status' | 'lastRunCompletedAt' | 'completionFollowUpHandledAt'
  >,
): Pick<OfficeTempProject, 'lastRunCompletedAt' | 'completionFollowUpHandledAt'> {
  const prevStatus = previous?.status;
  const nextStatus = next.status;

  if (prevStatus !== 'completed' && nextStatus === 'completed') {
    const stamp = Date.now();
    return { lastRunCompletedAt: stamp, completionFollowUpHandledAt: undefined };
  }

  if (prevStatus === 'completed' && nextStatus !== 'completed') {
    return { lastRunCompletedAt: undefined, completionFollowUpHandledAt: undefined };
  }

  return {
    lastRunCompletedAt:
      normalizeCompletionTimestamp(next.lastRunCompletedAt)
      ?? normalizeCompletionTimestamp(previous?.lastRunCompletedAt),
    completionFollowUpHandledAt:
      normalizeCompletionTimestamp(next.completionFollowUpHandledAt)
      ?? normalizeCompletionTimestamp(previous?.completionFollowUpHandledAt),
  };
}

/** 本轮执行成功完成后，是否仍需弹框/自动归档等后续处理。 */
export function isCompletionFollowUpPending(
  project: Pick<
    OfficeTempProject,
    | 'status'
    | 'lifecycle'
    | 'lastRunCompletedAt'
    | 'completionFollowUpHandledAt'
    | 'workflowReviewBatch'
  >,
): boolean {
  if (isWorkflowReviewActive(project)) return false;
  if (!isProjectAwaitingArchive(project)) return false;

  const epoch = normalizeCompletionTimestamp(project.lastRunCompletedAt);
  const handled = normalizeCompletionTimestamp(project.completionFollowUpHandledAt);

  if (!epoch) {
    return !handled;
  }
  if (!handled) return true;
  return handled < epoch;
}

export function completionFollowUpDismissStamp(
  project: Pick<OfficeTempProject, 'lastRunCompletedAt'>,
): number {
  return normalizeCompletionTimestamp(project.lastRunCompletedAt) ?? Date.now();
}

/**
 * 已完成归档重启：保留 completed 状态与执行数据，但标记本轮 follow-up 已处理，
 * 避免再次弹框/自动归档，直至用户重新执行并再次完成。
 */
export function completionFollowUpForArchivedCompletedReopen(
  project: Pick<OfficeTempProject, 'lastRunCompletedAt'>,
  reopenedAt: number,
): Pick<OfficeTempProject, 'lastRunCompletedAt' | 'completionFollowUpHandledAt'> {
  const epoch = normalizeCompletionTimestamp(project.lastRunCompletedAt) ?? reopenedAt;
  return { lastRunCompletedAt: epoch, completionFollowUpHandledAt: epoch };
}
