import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

const badgeClass =
  'ml-1.5 inline-flex shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-normal leading-none';

type OfficeMissingAgentBadgeProps = {
  className?: string;
  testId?: string;
  /** Defaults to the "智能体缺失" copy; pass e.g. `missingAgents.emptyNodeBadge` for a distinct wording. */
  labelKey?: string;
};

export function OfficeMissingAgentBadge({
  className,
  testId = 'office-missing-agent-badge',
  labelKey = 'missingAgents.listBadge',
}: OfficeMissingAgentBadgeProps) {
  const { t } = useTranslation('office');
  return (
    <span
      className={cn(
        badgeClass,
        'bg-destructive/10 text-destructive ring-1 ring-destructive/30',
        className,
      )}
      data-testid={testId}
    >
      {t(labelKey)}
    </span>
  );
}
