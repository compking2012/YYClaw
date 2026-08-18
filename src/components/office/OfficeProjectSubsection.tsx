import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type OfficeProjectSubsectionProps = {
  title: ReactNode;
  children: ReactNode;
  testId?: string;
  variant?: 'standalone' | 'spawn';
};

export function OfficeProjectSubsection({
  title,
  children,
  testId,
  variant = 'spawn',
}: OfficeProjectSubsectionProps) {
  return (
    <div
      data-testid={testId}
      className={cn(
        'rounded-lg border p-2.5',
        variant === 'standalone'
          ? 'border-primary/25 bg-primary/[0.035] shadow-sm dark:border-primary/20 dark:bg-primary/[0.05]'
          : 'border-border/50 bg-background/80 shadow-sm dark:bg-muted/10',
      )}
    >
      <div className="mb-2.5 border-b border-border/30 pb-2">
        <h4 className="font-serif text-xs font-normal tracking-tight text-foreground/90">{title}</h4>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}
