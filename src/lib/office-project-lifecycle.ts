import type { OfficeTempProject } from '@/types/office';
import { isCompletionFollowUpPending } from '@/lib/office-project-completion-follow-up';

/** 执行已成功结束，等待用户选择归档或升级（尚未归档）。 */
export function isOfficeProjectAwaitingArchive(
  project: Pick<OfficeTempProject, 'status' | 'lifecycle'>,
): boolean {
  return project.status === 'completed' && (project.lifecycle ?? 'active') === 'active';
}

/** 自建项目执行完成：弹出升级/归档/稍后提醒（每轮完成仅一次）。 */
export function isOfficeStandaloneAwaitingArchivePrompt(
  project: Pick<
    OfficeTempProject,
    'origin' | 'status' | 'lifecycle' | 'lastRunCompletedAt' | 'completionFollowUpHandledAt'
  >,
): boolean {
  return (
    project.origin === 'standalone'
    && isOfficeProjectAwaitingArchive(project)
    && isCompletionFollowUpPending(project)
  );
}

/** 固定组派出项目执行完成：自动归档（每轮完成仅一次）。 */
export function isOfficeFixedGroupProjectAutoArchive(
  project: Pick<
    OfficeTempProject,
    'origin' | 'status' | 'lifecycle' | 'lastRunCompletedAt' | 'completionFollowUpHandledAt'
  >,
): boolean {
  return (
    project.origin === 'fixed_group'
    && isOfficeProjectAwaitingArchive(project)
    && isCompletionFollowUpPending(project)
  );
}

/** 自建项目可升级为固定组：执行成功且未升级/解散（含已归档 completed），或执行未完成归档（dissolved）。 */
export function isOfficeStandaloneUpgradeEligible(
  project: Pick<OfficeTempProject, 'origin' | 'status' | 'lifecycle'>,
): boolean {
  if (project.origin !== 'standalone') return false;
  const lifecycle = project.lifecycle ?? 'active';
  if (lifecycle === 'upgraded') return false;
  if (lifecycle === 'dissolved') return true;
  if (lifecycle === 'completed') {
    return project.status === 'completed';
  }
  if (project.status !== 'completed') return false;
  return lifecycle === 'active';
}

/** 执行未完成归档（dissolved）升级前需二次确认。 */
export function isOfficeStandaloneDissolvedUpgrade(
  project: Pick<OfficeTempProject, 'origin' | 'lifecycle'>,
): boolean {
  if (project.origin !== 'standalone') return false;
  return (project.lifecycle ?? 'active') === 'dissolved';
}
