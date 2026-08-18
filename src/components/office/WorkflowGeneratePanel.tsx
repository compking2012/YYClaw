import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { hostApiFetch } from '@/lib/host-api';
import { officeFormFieldClass } from '@/lib/office-form-field-styles';
import { toast } from '@/lib/toast';
import type { WorkflowDefinition } from '@/types/office';

interface WorkflowGeneratePanelProps {
  teamRoleIds: string[];
  coordinatorRoleId?: string;
  taskTitle?: string;
  disabled?: boolean;
  onApply: (patch: { workflow: WorkflowDefinition; workflowMode: 'simple' | 'dag' }) => void;
}

export function WorkflowGeneratePanel({
  teamRoleIds,
  coordinatorRoleId,
  taskTitle,
  disabled = false,
  onApply,
}: WorkflowGeneratePanelProps) {
  const { t } = useTranslation('office');
  const [description, setDescription] = useState('');
  const [generating, setGenerating] = useState(false);
  const [preview, setPreview] = useState<{
    summary: string;
    source: string;
    workflow: WorkflowDefinition;
    mode: 'simple' | 'dag';
  } | null>(null);

  const runGenerate = async (strategy: 'auto' | 'heuristic') => {
    const text = description.trim();
    if (!text) {
      toast.error(t('workflow.generateNeedDescription'));
      return;
    }
    if (teamRoleIds.length === 0) {
      toast.error(t('workflow.generateNeedRoles'));
      return;
    }
    setGenerating(true);
    setPreview(null);
    try {
      const res = await hostApiFetch<{
        success: boolean;
        error?: string;
        workflow?: WorkflowDefinition;
        mode?: 'simple' | 'dag';
        summary?: string;
        source?: string;
      }>('/api/office/workflows/generate', {
        method: 'POST',
        body: JSON.stringify({
          description: text,
          roleIds: teamRoleIds,
          coordinatorRoleId,
          taskTitle: taskTitle?.trim() || undefined,
          strategy,
        }),
      });
      if (!res.success || !res.workflow || !res.mode) {
        toast.error(t(res.error ?? 'workflow.generateFailed'));
        return;
      }
      setPreview({
        workflow: res.workflow,
        mode: res.mode,
        summary: res.summary ?? '',
        source: res.source ?? 'heuristic',
      });
    } catch (e) {
      toast.error(String(e));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div
      className="space-y-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-2.5"
      data-testid="office-workflow-generate-panel"
    >
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div>
          <p className="text-xs font-semibold">{t('workflow.generateTitle')}</p>
          <p className="text-[10px] text-muted-foreground">{t('workflow.generateHint')}</p>
        </div>
      </div>
      <div>
        <Label htmlFor="office-workflow-generate-desc" className="text-[11px]">
          {t('workflow.generateDescriptionLabel')}
        </Label>
        <Textarea
          id="office-workflow-generate-desc"
          className={officeFormFieldClass('mt-1 min-h-[88px] text-xs')}
          value={description}
          disabled={disabled || generating}
          placeholder={t('workflow.generatePlaceholder')}
          data-testid="office-workflow-generate-input"
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          size="sm"
          className="h-8 text-xs"
          disabled={disabled || generating || teamRoleIds.length === 0}
          data-testid="office-workflow-generate-submit"
          onClick={() => void runGenerate('auto')}
        >
          {generating ? t('workflow.generateRunning') : t('workflow.generateSubmit')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 text-xs"
          disabled={disabled || generating || teamRoleIds.length === 0}
          data-testid="office-workflow-generate-heuristic"
          onClick={() => void runGenerate('heuristic')}
        >
          {t('workflow.generateHeuristicOnly')}
        </Button>
      </div>
      {preview ? (
        <div className="rounded-md border bg-background/80 p-2 text-[11px]">
          <p className="font-medium text-foreground">{t('workflow.generatePreview')}</p>
          <p className="mt-1 text-muted-foreground">
            {t(
              preview.source === 'ai'
                ? 'workflow.generateSource.ai'
                : preview.source === 'ai_fallback'
                  ? 'workflow.generateSource.ai_fallback'
                  : 'workflow.generateSource.heuristic',
            )}
          </p>
          <p className="mt-1 leading-relaxed">{preview.summary}</p>
          <Button
            type="button"
            size="sm"
            className="mt-2 h-8 w-full text-xs"
            data-testid="office-workflow-generate-apply"
            onClick={() => {
              onApply({ workflow: preview.workflow, workflowMode: preview.mode });
              toast.success(t('workflow.generateApplied'));
              setPreview(null);
            }}
          >
            {t('workflow.generateApply')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
