import { useTranslation } from 'react-i18next';
import {
  projectShowsArchivedRestartBadge,
  projectSourceGroupName,
  resolveProjectSourceBadgeKind,
} from '@/lib/office-project-source-badge';
import { cn } from '@/lib/utils';
import type { OfficeFixedGroup, OfficeTempProject } from '@/types/office';

const badgeClass =
  'ml-1.5 inline-flex shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-normal leading-none';

type ProjectSourceBadgesProps = {
  project: OfficeTempProject;
  group?: Pick<OfficeFixedGroup, 'name'> | null;
  className?: string;
};

export function ProjectSourceBadges({ project, group, className }: ProjectSourceBadgesProps) {
  const { t } = useTranslation('office');
  const kind = resolveProjectSourceBadgeKind(project);
  const sourceLabel =
    kind === 'spawn'
      ? t('projectSource.spawned', { name: projectSourceGroupName(project, group) })
      : kind === 'standalone-upgraded'
        ? t('projectSource.standaloneUpgraded')
        : t('projectSource.standalone');

  return (
    <span className={cn('inline-flex min-w-0 items-center', className)} data-testid="office-project-source-badges">
      <span
        className={cn(badgeClass, 'bg-muted/80 text-muted-foreground ring-1 ring-border/40')}
        data-testid="office-project-source-badge"
      >
        {sourceLabel}
      </span>
      {projectShowsArchivedRestartBadge(project) ? (
        <span
          className={cn(badgeClass, 'bg-emerald-500/10 text-emerald-700 ring-1 ring-emerald-500/25 dark:text-emerald-400')}
          data-testid="office-project-archived-restart-badge"
        >
          {t('projectSource.archivedRestart')}
        </span>
      ) : null}
    </span>
  );
}
