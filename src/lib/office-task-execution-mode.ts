import type { OfficeTempProject } from '@/types/office';
import { smartMentionStallWatchdogMs } from '@/lib/office-smart-mention-stall';

export type OfficeTaskExecutionMode = 'workflow' | 'smart';

/** @deprecated Use OfficeTaskExecutionMode */
export type OfficeTempProjectExecutionMode = OfficeTaskExecutionMode;

export function taskExecutionMode(
  project: Pick<OfficeTempProject, 'executionMode'>,
): OfficeTaskExecutionMode {
  return project.executionMode === 'smart' ? 'smart' : 'workflow';
}

export function isWorkflowTask(project: Pick<OfficeTempProject, 'executionMode'>): boolean {
  return taskExecutionMode(project) === 'workflow';
}

export function isSmartTask(project: Pick<OfficeTempProject, 'executionMode'>): boolean {
  return taskExecutionMode(project) === 'smart';
}

/** Room @mention initial wait; Smart 默认 0（无上限），可由 SMART_MENTION_STALL_MS 设软上限。 */
export function roomMentionInitialReplyTimeoutMs(
  project: Pick<OfficeTempProject, 'executionMode'> | null | undefined,
): number {
  return smartMentionReplyTimeoutMs(project);
}

/** Smart / Workflow 群聊点名 Session 等待超时（毫秒）；0 表示不限制。 */
export function smartMentionReplyTimeoutMs(
  project: Pick<OfficeTempProject, 'executionMode'> | null | undefined,
): number {
  if (project && isSmartTask(project)) {
    const watchdog = smartMentionStallWatchdogMs();
    return watchdog > 0 ? watchdog : 0;
  }
  return 60_000;
}
