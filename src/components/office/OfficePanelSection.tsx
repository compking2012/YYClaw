import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type OfficePanelSectionProps = {
  title: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
  muted?: boolean;
  headerClickable?: boolean;
  headerExpanded?: boolean;
  onHeaderClick?: () => void;
  headerTestId?: string;
};

export function OfficePanelSection({
  title,
  icon,
  action,
  children,
  className,
  testId,
  muted = false,
  headerClickable = false,
  headerExpanded,
  onHeaderClick,
  headerTestId,
}: OfficePanelSectionProps) {
  const headerInner = (
    <>
      <div className="flex min-w-0 items-center gap-2.5">
        {icon ? (
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary shadow-sm ring-1 ring-primary/10">
            {icon}
          </span>
        ) : null}
        <h3 className="truncate font-serif text-sm font-normal tracking-tight text-foreground">
          {title}
        </h3>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </>
  );

  const headerClassName = cn(
    'flex w-full items-center justify-between gap-2 border-b border-border/35 px-3 py-2.5',
    headerClickable && 'transition-colors hover:bg-muted/25',
  );

  return (
    <section
      className={cn(
        'overflow-hidden rounded-xl border shadow-sm',
        muted
          ? 'border-border/40 bg-muted/20'
          : 'border-border/45 bg-card/85',
        className,
      )}
      data-testid={testId}
    >
      {headerClickable ? (
        <button
          type="button"
          className={headerClassName}
          aria-expanded={headerExpanded}
          data-testid={headerTestId}
          onClick={onHeaderClick}
        >
          {headerInner}
        </button>
      ) : (
        <div className={headerClassName}>{headerInner}</div>
      )}
      {children ? <div className="p-2.5">{children}</div> : null}
    </section>
  );
}
