import { isOfficeProjectArchived } from '@/lib/office-room-sidebar';
import { isOfficeStandaloneUpgradeEligible } from '@/lib/office-project-lifecycle';
import type { OfficeTempProject } from '@/types/office';

/** 已归档项目是否可重启（已升级为固定组的除外）。 */
export function canRestartArchivedProject(
  project: Pick<OfficeTempProject, 'lifecycle'>,
  hasRestartHandler = true,
): boolean {
  if (!hasRestartHandler) return false;
  if ((project.lifecycle ?? 'active') === 'upgraded') return false;
  return isOfficeProjectArchived(project);
}

/** 已归档项目是否可删除（删目录+产物并解绑；任一已归档项目均可）。 */
export function canDeleteArchivedProject(
  project: Pick<OfficeTempProject, 'lifecycle'>,
  hasDeleteHandler = true,
): boolean {
  if (!hasDeleteHandler) return false;
  return isOfficeProjectArchived(project);
}

/** 已归档自建项目是否可升级为固定组。 */
export function canUpgradeArchivedStandaloneProject(
  project: Pick<OfficeTempProject, 'origin' | 'status' | 'lifecycle'>,
  hasUpgradeHandler = true,
): boolean {
  if (!hasUpgradeHandler) return false;
  if (!isOfficeProjectArchived(project)) return false;
  return isOfficeStandaloneUpgradeEligible(project);
}
