import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { officeFormFieldClass } from '@/lib/office-form-field-styles';
import { buildEnhancePromptGenPrompt } from '@/lib/enhance-prompt';
import { hostApi } from '@/lib/host-api';
import { toast } from '@/lib/toast';
import type { OfficeTaskExecutionMode } from '@/types/office';

interface TaskWorkflowDescriptionFieldProps {
  executionMode: OfficeTaskExecutionMode;
  value: string;
  disabled?: boolean;
  id: string;
  testId: string;
  /** When omitted, workflow mode defaults to required. */
  required?: boolean;
  onChange: (value: string) => void;
  /** Agent whose configured text model rewrites the draft. Omit to hide the "enhance prompt" button. */
  enhanceAgentId?: string;
}

export function TaskWorkflowDescriptionField({
  executionMode,
  value,
  disabled = false,
  id,
  testId,
  required,
  onChange,
  enhanceAgentId,
}: TaskWorkflowDescriptionFieldProps) {
  const { t } = useTranslation('office');
  const workflowMode = executionMode === 'workflow';
  const [smartOpen, setSmartOpen] = useState(true);
  const [enhancing, setEnhancing] = useState(false);
  const descriptionRequired = required ?? workflowMode;

  useEffect(() => {
    if (!workflowMode) {
      // Expand when entering non-workflow mode (collapsible UI only applies there).
       
      setSmartOpen(true);
    }
  }, [executionMode, workflowMode]);

  const labelKey = descriptionRequired
    ? 'taskForm.workflowDescriptionRequired'
    : 'taskForm.workflowDescriptionOptionalHint';

  const handleEnhance = async () => {
    const draft = value.trim();
    if (!draft || enhancing) return;
    setEnhancing(true);
    try {
      const { system, input } = buildEnhancePromptGenPrompt(draft);
      const res = await hostApi.agents.generateText({ agentId: enhanceAgentId, system, input }) as {
        success: boolean;
        text?: string;
        error?: string;
      };
      if (!res.success || !res.text) throw new Error(res.error || 'Generation failed');
      onChange(res.text);
    } catch (error) {
      toast.error(t('taskForm.enhancePromptFailed', { error: String(error) }));
    } finally {
      setEnhancing(false);
    }
  };

  const enhanceButton = enhanceAgentId ? (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
      onClick={(event) => {
        event.stopPropagation();
        void handleEnhance();
      }}
      disabled={disabled || enhancing || !value.trim()}
      title={t('taskForm.enhancePrompt')}
      data-testid={`${testId}-enhance`}
    >
      {enhancing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
    </Button>
  ) : null;

  const textarea = (
    <Textarea
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={workflowMode ? 3 : 2}
      disabled={disabled}
      className={officeFormFieldClass()}
      placeholder={t('taskForm.workflowDescriptionPlaceholder')}
      data-testid={testId}
    />
  );

  if (workflowMode) {
    return (
      <div className="space-y-1.5" data-testid="office-task-workflow-description">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={id}>{t(labelKey)}</Label>
          {enhanceButton}
        </div>
        {textarea}
      </div>
    );
  }

  const preview = value.trim().slice(0, 80);

  return (
    <div className="space-y-1.5" data-testid="office-task-workflow-description">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="flex flex-1 items-center gap-2 rounded-lg border bg-card px-2.5 py-2 text-left hover:bg-muted/30"
          data-testid={`${testId}-toggle`}
          onClick={() => setSmartOpen((v) => !v)}
        >
          {smartOpen ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0 flex-1">
            <Label className="cursor-pointer">{t(labelKey)}</Label>
            {!smartOpen && preview ? (
              <p className="truncate text-xs text-muted-foreground">{preview}</p>
            ) : null}
          </div>
        </button>
        {enhanceButton}
      </div>
      {smartOpen ? textarea : null}
    </div>
  );
}
