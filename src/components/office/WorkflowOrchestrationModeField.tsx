import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { OfficeExecutionModeAlphaBadge } from '@/components/office/OfficeExecutionModeAlphaBadge';
import type { WorkflowOrchestrationMode } from '@/lib/office-workflow-orchestration-mode';

interface WorkflowOrchestrationModeFieldProps {
  value: WorkflowOrchestrationMode;
  disabled?: boolean;
  locked?: boolean;
  onChange?: (mode: WorkflowOrchestrationMode) => void;
}

export function WorkflowOrchestrationModeField({
  value,
  disabled = false,
  locked = false,
  onChange,
}: WorkflowOrchestrationModeFieldProps) {
  const { t } = useTranslation('office');

  const modes: {
    id: WorkflowOrchestrationMode;
    label: string;
    hint: string;
    testId: string;
    alpha?: boolean;
  }[] = [
    {
      id: 'rule',
      label: t('workflowOrchestrationMode.rule'),
      hint: t('workflowOrchestrationMode.ruleHint'),
      testId: 'office-workflow-orchestration-rule',
    },
    {
      id: 'heuristic',
      label: t('workflowOrchestrationMode.heuristic'),
      hint: t('workflowOrchestrationMode.heuristicHint'),
      testId: 'office-workflow-orchestration-heuristic',
      alpha: true,
    },
  ];

  if (locked) {
    const active = modes.find((m) => m.id === value) ?? modes[0]!;
    return (
      <div className="space-y-2" data-testid="office-workflow-orchestration-mode-locked">
        <Label>{t('workflowOrchestrationMode.label')}</Label>
        <div className="rounded-xl border border-border/50 bg-muted/20 px-3 py-2.5">
          <span className="inline-flex items-center text-xs font-semibold">
            {active.label}
            {active.alpha ? <OfficeExecutionModeAlphaBadge /> : null}
          </span>
          <span className="mt-1 block text-[11px] text-muted-foreground">
            {t('workflowOrchestrationMode.lockedHint')}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2.5" data-testid="office-workflow-orchestration-mode">
      <Label>{t('workflowOrchestrationMode.label')}</Label>
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
                name="office-workflow-orchestration-mode"
                value={mode.id}
                checked={active}
                disabled={disabled}
                data-testid={mode.testId}
                className="sr-only"
                onChange={() => onChange?.(mode.id)}
              />
              <span className="inline-flex items-center text-xs font-semibold leading-tight">
                {mode.label}
                {mode.alpha ? <OfficeExecutionModeAlphaBadge /> : null}
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
