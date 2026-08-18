import { Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  bumpMaxRuntimeMinutes,
  clampMaxRuntimeMinutes,
  MAX_NODE_MAX_RUNTIME_MINUTES,
  MIN_NODE_MAX_RUNTIME_MINUTES,
} from '@/lib/office-workflow-max-runtime-step';
import { cn } from '@/lib/utils';

type WorkflowNodeMaxRuntimeStepperProps = {
  value: number;
  disabled?: boolean;
  testId?: string;
  className?: string;
  minutesUnitLabel: string;
  ariaLabel?: string;
  onChange: (minutes: number) => void;
};

export function WorkflowNodeMaxRuntimeStepper({
  value,
  disabled = false,
  testId,
  className,
  minutesUnitLabel,
  ariaLabel,
  onChange,
}: WorkflowNodeMaxRuntimeStepperProps) {
  const minutes = clampMaxRuntimeMinutes(value);
  const atMin = minutes <= MIN_NODE_MAX_RUNTIME_MINUTES;
  const atMax = minutes >= MAX_NODE_MAX_RUNTIME_MINUTES;

  return (
    <div
      className={cn('flex items-center gap-0.5', className)}
      data-testid={testId}
      aria-label={ariaLabel}
    >
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-7 w-7 shrink-0"
        disabled={disabled || atMin}
        data-testid={testId ? `${testId}-decrement` : undefined}
        aria-label={testId ? `${testId}-decrement` : undefined}
        onClick={() => onChange(bumpMaxRuntimeMinutes(minutes, 'down'))}
      >
        <Minus className="h-3 w-3" />
      </Button>
      <span
        className="min-w-[2rem] text-center text-[11px] font-medium tabular-nums text-foreground"
        data-testid={testId ? `${testId}-value` : undefined}
      >
        {minutes}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-7 w-7 shrink-0"
        disabled={disabled || atMax}
        data-testid={testId ? `${testId}-increment` : undefined}
        aria-label={testId ? `${testId}-increment` : undefined}
        onClick={() => onChange(bumpMaxRuntimeMinutes(minutes, 'up'))}
      >
        <Plus className="h-3 w-3" />
      </Button>
      <span className="text-[10px] text-muted-foreground">{minutesUnitLabel}</span>
    </div>
  );
}
