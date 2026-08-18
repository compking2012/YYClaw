import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { availableTaskRunnerModes, type TaskRunnerMode } from '@/lib/office-task-runner-mode';
import { OfficeExecutionModeAlphaBadge } from '@/components/office/OfficeExecutionModeAlphaBadge';
import { cn } from '@/lib/utils';

interface TaskRunnerModeFieldProps {
  value: TaskRunnerMode;
  disabled?: boolean;
  onChange: (mode: TaskRunnerMode) => void;
}

export function TaskRunnerModeField({
  value,
  disabled = false,
  onChange,
}: TaskRunnerModeFieldProps) {
  const { t } = useTranslation('office');

  const modes: {
    id: TaskRunnerMode;
    label: string;
    hint: string;
    testId: string;
  }[] = [
      {
        id: 'dag',
        label: t('taskForm.runnerModeDag'),
        hint: t('taskForm.runnerModeDagHint'),
        testId: 'office-task-runner-dag',
      },
      ...(availableTaskRunnerModes().includes('langgraph')
        ? [{
          id: 'langgraph' as const,
          label: t('taskForm.runnerModeLangGraph'),
          hint: t('taskForm.runnerModeLangGraphHint'),
          testId: 'office-task-runner-langgraph',
        }]
        : []),
      {
        id: 'smart',
        label: t('taskForm.runnerModeSmart'),
        hint: t('taskForm.runnerModeSmartHint'),
        testId: 'office-task-runner-smart',
      },
    ];

  return (
    <div className="space-y-2.5" data-testid="office-task-runner-mode">
      <Label>{t('taskForm.executionMode')}</Label>
      <div className={cn('grid grid-cols-1 gap-2', modes.length > 2 ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
        {modes.map((mode) => {
          const active = value === mode.id;
          return (
            <label
              key={mode.id}
              className={cn(
                'cursor-pointer rounded-xl border px-3 py-2.5 transition-all',
                active
                  ? 'border-primary/40 bg-primary/5 shadow-sm ring-1 ring-primary/20'
                  : 'border-border/50 bg-muted/20 hover:border-border hover:bg-muted/40',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type="radio"
                name="office-task-runner-mode"
                value={mode.id}
                checked={active}
                disabled={disabled}
                data-testid={mode.testId}
                className="sr-only"
                onChange={() => onChange(mode.id)}
              />
              <span className="inline-flex items-center text-xs font-semibold leading-tight">
                {mode.label}
                {mode.id === 'smart' ? <OfficeExecutionModeAlphaBadge /> : null}
              </span>
              {mode.hint ? (
                <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
                  {mode.hint}
                </span>
              ) : null}
            </label>
          );
        })}
      </div>
    </div>
  );
}
