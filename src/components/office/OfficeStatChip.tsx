import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function OfficeStatChip({
  icon,
  value,
  label,
  testId,
  className,
}: {
  icon: ReactNode;
  value: number;
  label: string;
  testId?: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border border-border/45 bg-background/80 px-2.5 py-1.5 text-xs text-muted-foreground shadow-sm',
        className,
      )}
      data-testid={testId}
    >
      <span className="text-primary/75">{icon}</span>
      <span className="font-semibold tabular-nums text-foreground">{value}</span>
      <span className="hidden sm:inline">{label}</span>
    </span>
  );
}
