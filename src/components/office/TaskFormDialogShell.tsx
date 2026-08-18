import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { ModalPortal } from '@/components/ui/modal-portal';

interface TaskFormDialogShellProps {
  testId: string;
  title: ReactNode;
  onClose: () => void;
  footer: ReactNode;
  children: ReactNode;
  /** 工作流模式略增宽并尽量占满视口高度（内容区滚动，底栏固定）。 */
  size?: 'default' | 'tall';
}

export function TaskFormDialogShell({
  testId,
  title,
  onClose,
  footer,
  children,
  size = 'default',
}: TaskFormDialogShellProps) {
  const isTall = size === 'tall';
  const [mounted, setMounted] = useState(false);
  const isMac = typeof window !== 'undefined' && window.electron?.platform === 'darwin';
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const handleClose = useCallback(() => {
    onCloseRef.current();
  }, []);

  useEffect(() => {
    // Portal must mount after first paint so ModalPortal finds document.body.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only mount gate
    setMounted(true);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!mounted) return null;

  return (
    <ModalPortal>
      <div
        className={cn(
          'pointer-events-none fixed inset-0 z-[100] flex justify-center p-2 sm:p-4',
          isMac ? 'items-start pt-12' : 'items-end sm:items-center',
        )}
        data-testid={testId}
        role="dialog"
        aria-modal="true"
      >
        <div
          className="pointer-events-auto fixed inset-0 bg-zinc-950/88 dark:bg-zinc-950/92"
          aria-hidden
          onClick={handleClose}
        />
        <div
          className={cn(
            'no-drag pointer-events-auto relative z-10 isolate flex w-full transform-gpu flex-col overflow-hidden rounded-2xl border border-border/60 bg-background shadow-xl',
            isTall ? 'max-w-3xl' : 'max-w-2xl',
            isMac ? 'max-h-[calc(100dvh-3.5rem)]' : 'max-h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-2rem)]',
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="relative flex shrink-0 items-start justify-between gap-3 border-b border-border/40 bg-surface-input/30 px-5 py-3.5 sm:px-6 sm:py-4">
            <h2 className="pointer-events-none flex min-w-0 flex-1 flex-wrap items-center gap-2 pr-2 font-serif text-lg font-normal tracking-tight text-foreground">
              {title}
            </h2>
            <button
              type="button"
              onClick={handleClose}
              className="no-drag relative z-20 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div
            className="office-form-scroll min-h-0 flex-1 scroll-smooth px-5 py-4 sm:px-6 sm:py-5"
            data-office-task-form-scroll
          >
            {children}
          </div>
          <div className="no-drag flex shrink-0 justify-end gap-2.5 border-t border-border/40 bg-background px-5 py-3 sm:px-6 sm:py-3.5">
            {footer}
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

export function TaskFormSection({
  children,
  className,
  variant = 'plain',
}: {
  children: ReactNode;
  className?: string;
  /** plain：无额外边框（默认，性能更好）；card：独立卡片区块 */
  variant?: 'card' | 'plain';
}) {
  return (
    <section
      className={cn(
        'space-y-4',
        variant === 'card' && 'rounded-xl border border-border/45 bg-surface-input/15 p-4 sm:p-5',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function TaskFormField({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('flex w-full flex-col gap-1.5', className)}>{children}</div>;
}

/** 基础信息与工作流编排区之间的醒目分隔线。 */
export function TaskFormWorkflowSeparator({ label }: { label?: ReactNode }) {
  const { t } = useTranslation('office');
  const text = label ?? t('workflow.section');
  return (
    <div
      className="relative mt-2 pb-1 pt-5"
      role="separator"
      aria-orientation="horizontal"
      data-testid="office-form-workflow-separator"
    >
      <div className="border-t-2 border-border/60 dark:border-border/50" />
      <span className="absolute left-0 top-3 bg-background pr-2.5 font-sans text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {text}
      </span>
    </div>
  );
}
