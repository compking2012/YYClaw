import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LangGraphWorkflowVisualPreview } from '@/components/office/LangGraphWorkflowVisualPreview';
import { tryApplyLangGraphCustomJson } from '@/lib/office-langgraph-workflow-bundle';
import {
  formatLangGraphCustomWorkflowTemplateJson,
  isLangGraphCustomWorkflowJsonEmpty,
} from '@/lib/office-langgraph-custom-template';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { officeFormFieldClass } from '@/lib/office-form-field-styles';
import { cn } from '@/lib/utils';
import type { ProjectAgentRef } from '@/lib/office-workflow-node';
import type { LangGraphWorkflowSource, WorkflowDefinition } from '@/types/office';

interface LangGraphCustomWorkflowEditorProps {
  workflow: WorkflowDefinition;
  /** @deprecated Use teamMembers */
  roles?: never[];
  teamMembers: ProjectAgentRef[];
  jsonDraft?: string;
  disabled?: boolean;
  editGateMissingBadgeByKey?: ReadonlyMap<string, boolean>;
  langGraphMissingKeySource?: LangGraphWorkflowSource;
  onChange: (workflow: WorkflowDefinition) => void;
  onJsonDraftChange?: (jsonText: string) => void;
}

export function LangGraphCustomWorkflowEditor({
  workflow,
  teamMembers,
  jsonDraft = '',
  disabled = false,
  editGateMissingBadgeByKey,
  langGraphMissingKeySource = 'custom',
  onChange,
  onJsonDraftChange,
}: LangGraphCustomWorkflowEditorProps) {
  const { t } = useTranslation('office');
  const [visualOpen, setVisualOpen] = useState(false);
  const [jsonText, setJsonText] = useState(() =>
    jsonDraft.trim() ? jsonDraft : JSON.stringify(workflow, null, 2),
  );
  const [parseError, setParseError] = useState<string | null>(null);
  const [validationErrorKey, setValidationErrorKey] = useState<string | null>(null);

  const templateJson = useMemo(
    () => formatLangGraphCustomWorkflowTemplateJson(
      teamMembers,
      t('langGraphWorkflow.customTemplateStepTitle'),
    ),
    [teamMembers, t],
  );

  const showEmptyTips = useMemo(
    () => isLangGraphCustomWorkflowJsonEmpty(jsonText),
    [jsonText],
  );

  useEffect(() => {
    if (jsonDraft.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- controlled draft → local editor buffer
      setJsonText(jsonDraft);
      return;
    }
     
    setJsonText(JSON.stringify(workflow, null, 2));
    setParseError(null);
    setValidationErrorKey(null);
  }, [workflow, jsonDraft]);

  const previewWorkflow = workflow;

  const applyJson = useCallback(() => {
    const result = tryApplyLangGraphCustomJson(jsonText, teamMembers);
    if (!result.ok) {
      if (result.parseError) {
        setParseError(result.parseError);
        setValidationErrorKey(null);
      } else {
        setValidationErrorKey(result.errorKey);
        setParseError(null);
      }
      return false;
    }
    setValidationErrorKey(null);
    setParseError(null);
    onChange(result.workflow);
    return true;
  }, [jsonText, onChange, teamMembers]);

  return (
    <div className="space-y-2" data-testid="office-langgraph-custom-editor">
      <Label data-testid="office-langgraph-custom-orchestration-title">
        {t('langGraphWorkflow.customOrchestrationTitle')}
      </Label>
      <p className="text-[11px] text-muted-foreground">{t('langGraphWorkflow.customHint')}</p>
      {showEmptyTips ? (
        <div
          className="rounded-lg border border-dashed border-border/60 bg-muted/15 p-2"
          data-testid="office-langgraph-custom-json-tips"
        >
          <p className="mb-1.5 text-[10px] font-medium text-muted-foreground">
            {t('langGraphWorkflow.customJsonTipsTitle')}
          </p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-muted-foreground">
            {templateJson}
          </pre>
        </div>
      ) : null}
      <Textarea
        value={jsonText}
        disabled={disabled}
        rows={12}
        className={officeFormFieldClass('font-mono text-[11px]')}
        data-testid="office-langgraph-custom-json"
        onChange={(e) => {
          setJsonText(e.target.value);
          onJsonDraftChange?.(e.target.value);
          setParseError(null);
          setValidationErrorKey(null);
        }}
      />
      {parseError ? (
        <p className="text-[11px] text-red-700 dark:text-red-400">{parseError}</p>
      ) : validationErrorKey ? (
        <p className="text-[11px] text-red-700 dark:text-red-400">{t(validationErrorKey)}</p>
      ) : workflow.nodes.length > 0 ? (
        <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
          {t('langGraphWorkflow.customValid')}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          data-testid="office-langgraph-custom-validate"
          onClick={applyJson}
        >
          {t('langGraphWorkflow.customValidate')}
        </Button>
      </div>

      <button
        type="button"
        className="flex w-full items-center gap-1 rounded-lg border border-border/50 bg-muted/20 px-2 py-1.5 text-left text-[11px] font-medium"
        onClick={() => setVisualOpen((v) => !v)}
      >
        {visualOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        {t('workflow.langGraphVisualTitle')}
      </button>
      {visualOpen ? (
        <div
          className={cn(
            'rounded-lg border bg-gradient-to-b from-primary/5 to-transparent p-3',
            workflow.nodes.length === 0 && 'opacity-60',
          )}
        >
          {workflow.nodes.length > 0 ? (
            <LangGraphWorkflowVisualPreview
              workflow={previewWorkflow}
              members={teamMembers}
              editGateMissingBadgeByKey={editGateMissingBadgeByKey}
              langGraphMissingKeySource={langGraphMissingKeySource}
            />
          ) : (
            <p className="text-center text-[11px] text-muted-foreground">
              {t('langGraphWorkflow.customPreviewEmpty')}
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
