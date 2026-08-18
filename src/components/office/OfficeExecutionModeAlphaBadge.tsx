import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/** Smart 协调者模式旁的 α（Alpha）实验标识。 */
export function OfficeExecutionModeAlphaBadge({ className }: { className?: string }) {
  const { t } = useTranslation('office');
  return (
    <span
      className={cn(
        'ml-1.5 inline-flex h-4 items-center justify-center rounded-full border border-violet-500/40 bg-violet-500/10 px-1.5 text-[10px] font-semibold leading-none text-violet-700 dark:text-violet-300',
        className,
      )}
      data-testid="office-smart-mode-alpha-badge"
      title={t('executionModeAlphaBadgeTitle')}
      aria-label={t('executionModeAlphaBadgeTitle')}
    >
      {t('executionModeAlphaBadge')}
    </span>
  );
}
