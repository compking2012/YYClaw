import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { ModalPortal } from '@/components/ui/modal-portal';
import { SKILL_SIDE_SHEET_Z_INDEX_CLASS } from '@/components/skills/skill-picker-styles';

export type SkillSideSheetShellProps = {
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  headerExtra?: ReactNode;
  testId?: string;
  exitTestId?: string;
  maxWidthClass?: string;
};

/** Skills side panel without Radix Sheet (avoids overlay + macOS drag-region swallowing header clicks). */
export function SkillSideSheetShell({
  onClose,
  title,
  subtitle,
  children,
  headerExtra,
  testId,
  exitTestId,
  maxWidthClass = 'sm:max-w-[560px]',
}: SkillSideSheetShellProps) {
  const { t } = useTranslation('common');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <ModalPortal>
    <div className={cn('pointer-events-none fixed inset-0', SKILL_SIDE_SHEET_Z_INDEX_CLASS)} role="dialog" aria-modal="true">
      <div className="pointer-events-none absolute inset-0 bg-black/30 dark:bg-black/60" aria-hidden />
      <div
        data-testid={testId}
        className={cn(
          'no-drag pointer-events-auto absolute right-0 inset-y-0 flex h-full w-full flex-col border-l border-black/10 bg-background shadow-[0_0_40px_rgba(0,0,0,0.2)] dark:border-white/10',
          maxWidthClass,
        )}
      >
        <div className="border-b border-black/10 px-7 py-6 dark:border-white/10">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-[24px] font-serif font-normal tracking-tight text-foreground">{title}</h2>
              {subtitle ? (
                <p className="mt-1 text-[13px] text-foreground/70">{subtitle}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              data-testid={exitTestId}
              className="no-drag mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-foreground/55 transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10"
              aria-label={t('close', { defaultValue: 'Close' })}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {headerExtra}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
    </ModalPortal>
  );
}
