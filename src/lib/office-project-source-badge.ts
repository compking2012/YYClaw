import type { OfficeFixedGroup, OfficeTempProject } from '@/types/office';

export const PROJECT_SOURCE_GROUP_NAME_MAX = 8;

export function truncateProjectSourceGroupName(
  name: string,
  maxLen = PROJECT_SOURCE_GROUP_NAME_MAX,
): string {
  const trimmed = name.trim();
  if (trimmed.length <= maxLen) return trimmed;
  return `${trimmed.slice(0, maxLen)}…`;
}

/** 活跃项目是否展示「归档重启」标签（持久至再次归档或删除）。 */
export function projectShowsArchivedRestartBadge(
  project: Pick<OfficeTempProject, 'archivedRestartedAt' | 'lifecycle'>,
): boolean {
  const at = project.archivedRestartedAt;
  return (
    (project.lifecycle ?? 'active') === 'active'
    && typeof at === 'number'
    && Number.isFinite(at)
    && at > 0
  );
}

export type ProjectSourceBadgeKind = 'standalone' | 'standalone-upgraded' | 'spawn';

export function resolveProjectSourceBadgeKind(
  project: Pick<OfficeTempProject, 'origin' | 'parentGroupId' | 'lifecycle'>,
): ProjectSourceBadgeKind {
  if (project.origin === 'fixed_group' || project.parentGroupId?.trim()) {
    return 'spawn';
  }
  if ((project.lifecycle ?? 'active') === 'upgraded') {
    return 'standalone-upgraded';
  }
  return 'standalone';
}

export function projectSourceGroupName(
  project: Pick<OfficeTempProject, 'parentGroupId'>,
  group?: Pick<OfficeFixedGroup, 'name'> | null,
): string {
  const raw = group?.name?.trim() || project.parentGroupId?.trim() || '';
  return truncateProjectSourceGroupName(raw);
}
