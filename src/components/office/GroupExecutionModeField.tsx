import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { OfficeExecutionModeAlphaBadge } from '@/components/office/OfficeExecutionModeAlphaBadge';
import type { OfficeTaskExecutionMode } from '@/types/office';

type GroupExecutionMode = Extract<OfficeTaskExecutionMode, 'smart' | 'workflow'>;

interface GroupExecutionModeFieldProps {
  value: GroupExecutionMode;
  disabled?: boolean;
  locked?: boolean;
  onChange?: (mode: GroupExecutionMode) => void;
}

export function GroupExecutionModeField({
  value,
  disabled = false,
  locked = false,
  onChange,
}: GroupExecutionModeFieldProps) {
  const { t } = useTranslation('office');

  const modes: {
    id: GroupExecutionMode;
    label: string;
    hint: string;
    testId: string;
  }[] = [
    {
      id: 'workflow',
      label: t('groupForm.executionModeWorkflow'),
      hint: t('groupForm.executionModeWorkflowHint'),
      testId: 'office-group-execution-workflow',
    },
    {
      id: 'smart',
      label: t('groupForm.executionModeSmart'),
      hint: t('groupForm.executionModeSmartHint'),
      testId: 'office-group-execution-smart',
    },
  ];

  if (locked) {
    const active = modes.find((m) => m.id === value) ?? modes[0]!;
    return (
      <div className="space-y-2" data-testid="office-group-execution-mode-locked">
        <Label>{t('groupForm.executionMode')}</Label>
        <div className="rounded-xl border border-border/50 bg-muted/20 px-3 py-2.5">
          <span className="inline-flex items-center text-xs font-semibold">
            {active.label}
            {active.id === 'smart' ? <OfficeExecutionModeAlphaBadge /> : null}
          </span>
          <span className="mt-1 block text-[11px] text-muted-foreground">{t('groupForm.executionModeLockedHint')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2.5" data-testid="office-group-execution-mode">
      <Label>{t('groupForm.executionMode')}</Label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
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
                name="office-group-execution-mode"
                value={mode.id}
                checked={active}
                disabled={disabled}
                data-testid={mode.testId}
                className="sr-only"
                onChange={() => onChange?.(mode.id)}
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
