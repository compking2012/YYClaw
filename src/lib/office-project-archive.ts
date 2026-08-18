import type { OfficeTempProject, TaskStatus, TempProjectLifecycle } from '@/types/office';
import { isOfficeProjectExecuting } from '@/lib/office-room-sidebar';
import { taskExecutionMode } from '@/lib/office-task-execution-mode';

export type ProjectArchiveTransition = {
  lifecycle: Extract<TempProjectLifecycle, 'completed' | 'dissolved'>;
  status: TaskStatus;
};

/** 执行未完成归档的工作流是否应保留 nodeRuns 供接续（含运行中强制归档）。 */
export function shouldPreserveArchivedWorkflowProgress(
  project: Pick<OfficeTempProject, 'lifecycle' | 'status' | 'executionMode' | 'nodeRuns'>,
): boolean {
  return (
    (project.lifecycle ?? 'active') === 'dissolved'
    && project.status === 'aborted'
    && taskExecutionMode(project) === 'workflow'
    && project.nodeRuns.length > 0
  );
}

/** 归档重启后回到活跃列表、仍保留工作流 nodeRuns，可接续执行。 */
export function isWorkflowResumeEligible(
  project: Pick<OfficeTempProject, 'lifecycle' | 'status' | 'executionMode' | 'nodeRuns'>,
): boolean {
  return (
    (project.lifecycle ?? 'active') === 'active'
    && project.status === 'aborted'
    && taskExecutionMode(project) === 'workflow'
    && project.nodeRuns.length > 0
  );
}

/** 已完成归档重启：保留 completed 状态与全部执行数据（nodeRuns、群聊与磁盘交付物不因重启而清理）。 */
export function shouldPreserveArchivedCompletedExecution(
  project: Pick<OfficeTempProject, 'lifecycle' | 'status'>,
): boolean {
  const lifecycle = project.lifecycle ?? 'active';
  return lifecycle === 'completed' && project.status === 'completed';
}

/**
 * 固定组模板同步到继承子项目时，是否保留既有 nodeRuns。
 * 避免编辑固定组后清空已完成/可接续派出项目的执行进度（含升级绑定场景）。
 */
export function shouldPreserveChildProjectNodeRunsOnGroupSync(
  project: Pick<OfficeTempProject, 'lifecycle' | 'status' | 'executionMode' | 'nodeRuns'>,
): boolean {
  if (isOfficeProjectExecuting(project)) return true;
  if (shouldPreserveArchivedWorkflowProgress(project)) return true;
  if (shouldPreserveArchivedCompletedExecution(project)) return true;
  if (isWorkflowResumeEligible(project)) return true;
  if (project.status === 'completed' && project.nodeRuns.length > 0) return true;
  return false;
}

/**
 * 归档时写入的 lifecycle / status：
 * - 执行已成功结束 → completed / completed
 * - 执行中强制归档、已中止、或执行中途中断 → dissolved / aborted（工作流保留 nodeRuns 供接续）
 * - 从未执行即归档 → dissolved / pending（待执行）
 * - 其它未完成态（failed / blocked 等）手动归档 → dissolved / aborted
 */
export function resolveProjectArchiveTransition(
  project: Pick<OfficeTempProject, 'status' | 'nodeRuns'>,
  options?: { forcedWhileExecuting?: boolean },
): ProjectArchiveTransition {
  if (project.status === 'completed' && !isOfficeProjectExecuting(project)) {
    return { lifecycle: 'completed', status: 'completed' };
  }
  if (project.status === 'pending' && !options?.forcedWhileExecuting) {
    return { lifecycle: 'dissolved', status: 'pending' };
  }
  if (
    options?.forcedWhileExecuting
    || project.status === 'aborted'
    || project.status === 'running'
    || project.status === 'failed'
    || project.status === 'blocked'
  ) {
    return { lifecycle: 'dissolved', status: 'aborted' };
  }
  return { lifecycle: 'dissolved', status: 'aborted' };
}
