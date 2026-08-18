import { workflowNodePrimaryAgentId } from '@/lib/office-workflow-node';
import type { NodeRunRecord, NodeRunStatus, OfficeTempProject } from '@/types/office';

/** Room terminal copy when the user aborts a project run (system bubble, shown in red). */
export const USER_ABORT_ROOM_MESSAGE = '用户手动中止项目运行';

/**
 * Quiet node progress after user abort.
 * The system bubble already carries {@link USER_ABORT_ROOM_MESSAGE}; repeating
 * 「执行失败：用户已手动中止本项目」 on the in-flight node card is redundant.
 */
export const WORKFLOW_USER_ABORT_NODE_PROGRESS_TEXT = '已停止';

/** True when a failure detail / abort reason is the user-initiated abort copy. */
export function isUserAbortFailureDetail(detail: string | null | undefined): boolean {
  const t = (detail ?? '').trim();
  if (!t) return false;
  return /用户已手动中止|用户手动中止/.test(t);
}

/** True for the unified system abort terminal (and trimmed variants). */
export function isUserAbortRoomMessage(
  message: { content?: string; from?: string; progressText?: string } | null | undefined,
): boolean {
  if (!message) return false;
  if (message.from === 'system') {
    return (message.content ?? '').trim() === USER_ABORT_ROOM_MESSAGE;
  }
  // Legacy workflow announceFailed cards (pre-dedupe) still get red abort styling.
  const progress = (message.progressText ?? '').trim();
  return progress.includes('执行失败') && isUserAbortFailureDetail(progress);
}

/** Optimistic / persist snapshot right after user requests abort (before gateway quiesce). */
export function taskSnapshotAfterAbortRequested(
  project: OfficeTempProject,
  reason: string,
  now = Date.now(),
  options?: { abortGeneration?: number },
): OfficeTempProject {
  const abortGeneration =
    options?.abortGeneration ?? (project.abortGeneration ?? 0) + 1;
  return {
    ...project,
    status: 'aborted',
    nodeRuns: settleWorkflowNodeRunsAfterStop(project, reason, now),
    workflowReviewBatch: undefined,
    workflowUserIntervention: undefined,
    workflowStall: undefined,
    workflowRunId: undefined,
    abortQuiescing: true,
    abortGeneration,
    abortQuiesceStartedAt: now,
    updatedAt: now,
  };
}

export function isOfficeProjectAbortQuiescing(
  project: Pick<OfficeTempProject, 'abortQuiescing'>,
): boolean {
  return project.abortQuiescing === true;
}

/** Block runner progress that would revive or demote a project still stopping after abort. */
export function shouldBlockOfficeProgressWriteDuringAbort(params: {
  before: Pick<OfficeTempProject, 'abortQuiescing' | 'status'> | null | undefined;
  next: Pick<OfficeTempProject, 'status' | 'nodeRuns' | 'abortQuiescing'>;
  userAborted: boolean;
  memoryQuiescing: boolean;
}): boolean {
  const activelyQuiescing =
    params.memoryQuiescing
    || params.before?.abortQuiescing === true
    || params.next.abortQuiescing === true;
  const abortContext = params.userAborted || activelyQuiescing;

  // Sticky demotion guard: after flags/quiesce clear, never let lagging runner
  // overwrite disk `aborted` with `failed`/`completed` (14:14 red-light hole).
  // Re-run is allowed (`aborted` → `running`) once claim cleared userAborted.
  if (
    !abortContext
    && params.before?.status === 'aborted'
    && (params.next.status === 'failed' || params.next.status === 'completed')
  ) {
    return true;
  }

  if (!abortContext) return false;

  // Abort terminal writes must always be allowed (settle may still show pending
  // nodes mid-flight). Do not use the pending-node check against status=aborted.
  if (params.next.status === 'aborted' || params.next.status === 'blocked') {
    return false;
  }

  // Refuse revival, lagging success, or project-level failed while abort is active.
  return (
    params.next.status === 'running'
    || params.next.status === 'completed'
    || params.next.status === 'failed'
    || params.next.nodeRuns.some((nr) => nr.status === 'running' || nr.status === 'pending')
  );
}

/** 将仍在 running/pending 的节点落为 failed，避免中止/归档后 UI 仍显示执行中。 */
export function settleWorkflowNodeRunsAfterStop(
  project: Pick<OfficeTempProject, 'nodeRuns' | 'workflow'>,
  reason: string,
  now = Date.now(),
): NodeRunRecord[] {
  const reasonText = reason.trim().slice(0, 500) || '用户已手动中止本项目';
  const workflowNodes = project.workflow?.nodes ?? [];

  if (workflowNodes.length === 0) {
    return project.nodeRuns.map((nr) =>
      nr.status === 'running' || nr.status === 'pending'
        ? {
            ...nr,
            status: 'failed' as NodeRunStatus,
            error: nr.error && nr.error !== 'Aborted' ? nr.error : reasonText,
            completedAt: nr.completedAt ?? now,
          }
        : nr,
    );
  }

  const runs = new Map(project.nodeRuns.map((nr) => [nr.nodeId, nr]));
  return workflowNodes.map((node) => {
    const run = runs.get(node.id);
    if (!run) {
      return {
        nodeId: node.id,
        agentId: workflowNodePrimaryAgentId(node),
        status: 'failed' as NodeRunStatus,
        error: reasonText,
        completedAt: now,
      };
    }
    if (run.status === 'running' || run.status === 'pending') {
      return {
        ...run,
        status: 'failed' as NodeRunStatus,
        error: run.error && run.error !== 'Aborted' ? run.error : reasonText,
        completedAt: run.completedAt ?? now,
      };
    }
    return run;
  });
}
