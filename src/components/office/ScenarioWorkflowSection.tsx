import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { LangGraphWorkflowVisualPreview } from '@/components/office/LangGraphWorkflowVisualPreview';
import { WorkflowStepRuntimeList } from '@/components/office/WorkflowStepRuntimeList';
import { WorkflowVisualPreview } from '@/components/office/WorkflowVisualPreview';
import { previewDagWorkflow } from '@/lib/office-workflow-preview';
import { requestWorkflowGeneration } from '@/lib/office-workflow-generate-client';
import {
  buildOrchestrationInputKey,
  initialPreviewSyncedKey,
  isOrchestrationPreviewStale,
  type OrchestrationInputSnapshot,
} from '@/lib/office-workflow-preview-state';
import { summarizeWorkflow } from '@/lib/office-workflow-generate';
import {
  prepareWorkflowStepDraftsPayload,
  trimWorkflowStepDraftRows,
} from '@/lib/office-workflow-step-drafts';
import { applyWorkflowChange } from '@/lib/office-workflow-edges';
import { ensureRuleWorkflowFromStepDrafts } from '@/lib/office-workflow-orchestration-mode';
import { agentIdsFromWorkflow } from '@/lib/office-workflow-roles';
import type { ProjectAgentRef } from '@/lib/office-workflow-node';
import { toast } from '@/lib/toast';
import { ENABLE_LANGGRAPH } from '@/lib/feature-langgraph';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { OfficeWorkflowEngine, WorkflowDefinition, WorkflowStepDraftRow, LangGraphWorkflowSource } from '@/types/office';
import type { WorkflowOrchestrationMode } from '@/lib/office-workflow-orchestration-mode';

export type DagWorkflowPreviewBinding = {
  isStale: boolean;
  isPreviewing: boolean;
  previewDisabled?: boolean;
  onPreview: () => Promise<
    | { ok: true; workflow: WorkflowDefinition }
    | { ok: false; errorKey: string }
  >;
};

export function workflowGenerationInputKey(
  taskTitle: string | undefined,
  taskFeatureDescription: string,
  taskDescription: string,
): string {
  return `${taskTitle?.trim() ?? ''}::${taskFeatureDescription.trim()}::${taskDescription.trim()}`;
}

interface ScenarioWorkflowSectionProps {
  workflow: WorkflowDefinition;
  teamMembers: ProjectAgentRef[];
  agentIds?: string[];
  coordinatorAgentId?: string;
  taskTitle?: string;
  taskFeatureDescription?: string;
  taskDescription?: string;
  workflowStepDrafts?: WorkflowStepDraftRow[];
  workflowEngine?: OfficeWorkflowEngine;
  sectionHintKey?: string;
  /** DAG 结构化编排：按钮为「生成工作流」，按节点表规则生成（非 LLM 启发式）。 */
  structuredOrchestration?: boolean;
  /** 嵌入结构化编排面板：去掉外层边框，默认折叠流程图。 */
  embedded?: boolean;
  onChange: (patch: { workflow: WorkflowDefinition }) => void;
  disabled?: boolean;
  /** Notifies parent when AI/heuristic workflow generation is in flight (for disabling save). */
  onGeneratingChange?: (generating: boolean) => void;
  /** Controlled DAG preview (workflow engine = dag). LangGraph keeps legacy inline generation. */
  dagPreview?: DagWorkflowPreviewBinding;
  orchestrationMode?: WorkflowOrchestrationMode;
  /** Open-edit snapshot node missing badges (workflow:* / langgraph:* keys). */
  editGateMissingBadgeByKey?: ReadonlyMap<string, boolean>;
  langGraphMissingKeySource?: LangGraphWorkflowSource;
  /** See `WorkflowVisualPreview`'s `nodesRegenerated` prop. */
  nodesRegenerated?: boolean;
}

function ScenarioWorkflowSectionInner({
  workflow,
  teamMembers,
  agentIds = [],
  coordinatorAgentId,
  taskTitle,
  taskFeatureDescription = '',
  taskDescription = '',
  workflowStepDrafts = [],
  workflowEngine = 'dag',
  sectionHintKey,
  structuredOrchestration = false,
  embedded = false,
  onChange,
  disabled = false,
  onGeneratingChange,
  dagPreview,
  orchestrationMode: orchestrationModeProp,
  editGateMissingBadgeByKey,
  langGraphMissingKeySource,
  nodesRegenerated,
}: ScenarioWorkflowSectionProps) {
  const { t } = useTranslation('office');
  const orchestrationEngine: OfficeWorkflowEngine =
    ENABLE_LANGGRAPH && workflowEngine === 'langgraph' ? 'langgraph' : 'dag';
  const [visualOpen, setVisualOpen] = useState(false);
  const [generatingLegacy, setGeneratingLegacy] = useState(false);
  const [internalPreviewing, setInternalPreviewing] = useState(false);

  const orchestrationMode: WorkflowOrchestrationMode =
    orchestrationModeProp ?? (structuredOrchestration ? 'rule' : 'heuristic');
  const orchestrationSnapshot = useMemo(
    (): OrchestrationInputSnapshot => ({
      orchestrationMode,
      workflowStepDrafts,
      heuristicDescription: taskDescription,
    }),
    [orchestrationMode, taskDescription, workflowStepDrafts],
  );
  const orchestrationInputKey = useMemo(
    () => buildOrchestrationInputKey(orchestrationSnapshot),
    [orchestrationSnapshot],
  );

  const [internalPreviewSyncedKey, setInternalPreviewSyncedKey] = useState<string | null>(() =>
    initialPreviewSyncedKey({
      orchestration: orchestrationSnapshot,
      hasMaterializedWorkflow: workflow.nodes.length > 0,
    }),
  );
  const [genSummary, setGenSummary] = useState<string | null>(null);
  const [genSource, setGenSource] = useState<string | null>(null);
  const userGeneratedBaselineRef = useRef('');
  const loadedBaselineRef = useRef<string | null>(null);

  const descriptionKey = orchestrationInputKey;
  const hasStructuredDrafts = useMemo(
    () => trimWorkflowStepDraftRows(workflowStepDrafts).length > 0,
    [workflowStepDrafts],
  );
  const preparedDescription = useMemo(() => {
    if (!hasStructuredDrafts) return taskDescription.trim();
    return prepareWorkflowStepDraftsPayload(workflowStepDrafts, teamMembers).workflowDescription;
  }, [hasStructuredDrafts, taskDescription, teamMembers, workflowStepDrafts]);

  if (loadedBaselineRef.current === null && workflow.nodes.length > 0) {
    loadedBaselineRef.current = descriptionKey;
  }

  const orchestrationBaselineKey =
    userGeneratedBaselineRef.current || loadedBaselineRef.current;
  const internalStale =
    isOrchestrationPreviewStale(internalPreviewSyncedKey, orchestrationSnapshot)
    && (taskDescription.trim().length > 0 || hasStructuredDrafts);
  const legacyStale =
    workflow.nodes.length > 0 &&
    (taskDescription.trim().length > 0 || hasStructuredDrafts) &&
    orchestrationBaselineKey !== null &&
    orchestrationBaselineKey !== descriptionKey;
  const regenerateStale = dagPreview
    ? dagPreview.isStale
    : orchestrationEngine === 'dag'
      ? internalStale
      : legacyStale;
  const generating = dagPreview
    ? dagPreview.isPreviewing
    : orchestrationEngine === 'dag'
      ? internalPreviewing
      : generatingLegacy;

  useEffect(() => {
    onGeneratingChange?.(generating);
    return () => {
      onGeneratingChange?.(false);
    };
  }, [generating, onGeneratingChange]);

  const apply = useCallback(
    (next: WorkflowDefinition) => {
      const synced = applyWorkflowChange({ ...next, mode: 'dag' }, false);
      onChange({ workflow: synced });
    },
    [onChange],
  );

  const roleLikeMembers = useMemo(
    () =>
      teamMembers.map((m) => ({
        id: m.agentId,
        name: m.displayName,
        emoji: '🤖',
      })),
    [teamMembers],
  );
  const usedRoleIds = useMemo(() => agentIdsFromWorkflow(workflow.nodes), [workflow.nodes]);
  const hasWorkflow = workflow.nodes.length > 0;

  const markOrchestrationBaseline = useCallback(() => {
    userGeneratedBaselineRef.current = descriptionKey;
  }, [descriptionKey]);

  const runDagPreviewInternal = useCallback(async () => {
    if (agentIds.length === 0) return false;
    setInternalPreviewing(true);
    try {
      const result = await previewDagWorkflow({
        orchestrationMode,
        workflowStepDrafts,
        heuristicDescription: taskDescription,
        workflow,
        members: teamMembers,
        agentIds,
        coordinatorAgentId,
        taskTitle: taskTitle?.trim() || undefined,
        featureDescription: taskFeatureDescription.trim() || undefined,
      });
      if (!result.ok) {
        toast.error(t(result.errorKey));
        return false;
      }
      apply(result.workflow);
      setInternalPreviewSyncedKey(orchestrationInputKey);
      markOrchestrationBaseline();
      setGenSummary(summarizeWorkflow(result.workflow, roleLikeMembers as never));
      setGenSource(result.source);
      return true;
    } catch (e) {
      toast.error(String(e));
      return false;
    } finally {
      setInternalPreviewing(false);
    }
  }, [
    agentIds,
    apply,
    coordinatorAgentId,
    markOrchestrationBaseline,
    orchestrationInputKey,
    orchestrationMode,
    roleLikeMembers,
    t,
    taskDescription,
    taskFeatureDescription,
    taskTitle,
    teamMembers,
    workflow,
    workflowStepDrafts,
  ]);

  const runStructuredGenerate = useCallback(() => {
    if (!hasStructuredDrafts || agentIds.length === 0) return;
    setGeneratingLegacy(true);
    try {
      const ensured = ensureRuleWorkflowFromStepDrafts({
        workflowStepDrafts,
        members: teamMembers,
        workflow,
      });
      if (!ensured.ok) {
        toast.error(t(ensured.errorKey));
        return;
      }
      apply(ensured.workflow);
      markOrchestrationBaseline();
      setGenSummary(summarizeWorkflow(ensured.workflow, roleLikeMembers as never));
      setGenSource('structured_rule');
    } finally {
      setGeneratingLegacy(false);
    }
  }, [
    agentIds.length,
    apply,
    hasStructuredDrafts,
    markOrchestrationBaseline,
    roleLikeMembers,
    t,
    teamMembers,
    workflow,
    workflowStepDrafts,
  ]);

  const runGenerate = useCallback(
    async (strategy: 'auto' | 'heuristic', description: string) => {
      const steps = (hasStructuredDrafts ? preparedDescription : description).trim();
      const feature = taskFeatureDescription.trim();
      if ((!steps && !feature && !hasStructuredDrafts) || agentIds.length === 0) return false;
      setGeneratingLegacy(true);
      try {
        const res = await requestWorkflowGeneration({
          description: steps || feature,
          featureDescription: feature || undefined,
          workflowStepDrafts: hasStructuredDrafts ? workflowStepDrafts : undefined,
          agentIds,
          coordinatorAgentId,
          taskTitle: taskTitle?.trim() || undefined,
          strategy,
          workflowEngine: orchestrationEngine,
        });
        if (!res.ok) {
          toast.error(t(res.errorKey));
          return false;
        }
        onChange({
          workflow:
            orchestrationEngine === 'langgraph'
              ? { ...res.workflow, mode: 'dag', orchestrationEngine: 'langgraph' }
              : { ...res.workflow, mode: 'dag' },
        });
        markOrchestrationBaseline();
        setGenSummary(res.summary ?? summarizeWorkflow(res.workflow, roleLikeMembers as never));
        setGenSource(res.source ?? strategy);
        return true;
      } catch (e) {
        toast.error(String(e));
        return false;
      } finally {
        setGeneratingLegacy(false);
      }
    },
    [
      agentIds,
      coordinatorAgentId,
      hasStructuredDrafts,
      markOrchestrationBaseline,
      onChange,
      orchestrationEngine,
      preparedDescription,
      roleLikeMembers,
      t,
      taskFeatureDescription,
      taskTitle,
      workflowStepDrafts,
    ],
  );

  const handlePreviewClick = useCallback(async () => {
    if (dagPreview) {
      const result = await dagPreview.onPreview();
      if (!result.ok) {
        toast.error(t(result.errorKey));
        return;
      }
      setGenSummary(summarizeWorkflow(result.workflow, roleLikeMembers as never));
      setGenSource(orchestrationMode === 'rule' ? 'structured_rule' : 'ai');
      return;
    }
    if (orchestrationEngine === 'langgraph') {
      if (structuredOrchestration) {
        runStructuredGenerate();
        return;
      }
      void runGenerate('heuristic', preparedDescription || taskDescription);
      return;
    }
    await runDagPreviewInternal();
  }, [
    apply,
    dagPreview,
    orchestrationEngine,
    orchestrationMode,
    preparedDescription,
    roleLikeMembers,
    runDagPreviewInternal,
    runGenerate,
    runStructuredGenerate,
    structuredOrchestration,
    t,
    taskDescription,
  ]);

  const collapsedSummary = useMemo(() => {
    if (genSummary) return genSummary;
    if (hasWorkflow) return summarizeWorkflow(workflow, roleLikeMembers as never);
    return t('workflow.visualEmpty');
  }, [genSummary, hasWorkflow, roleLikeMembers, t, workflow]);

  return (
    <div
      className={cn(
        'space-y-2',
        embedded ? 'space-y-2.5' : 'rounded-lg border bg-muted/10 p-2',
      )}
      data-testid="office-scenario-workflow-section"
    >
      <div className={cn('flex flex-wrap items-center justify-between gap-2', embedded && 'gap-3')}>
        <div className="min-w-0">
          <p className={cn('text-xs font-semibold', embedded && 'font-serif font-normal tracking-tight')}>
            {embedded ? t('workflow.sectionPreview') : t('workflow.section')}
          </p>
          {sectionHintKey ? (
            <p className="text-[10px] text-muted-foreground">{t(sectionHintKey)}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <span className="rounded-md border bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground">
            {orchestrationEngine === 'langgraph' ? 'LangGraph' : 'DAG'}
          </span>
          <Button
            type="button"
            size="sm"
            variant={regenerateStale ? 'default' : 'outline'}
            className={cn(
              'h-7 text-[10px] transition-shadow',
              regenerateStale && 'ring-2 ring-amber-500/80 shadow-md shadow-amber-500/20',
            )}
            disabled={
              disabled ||
              dagPreview?.previewDisabled ||
              generating ||
              (structuredOrchestration
                ? !hasStructuredDrafts
                : !taskDescription.trim() && !taskFeatureDescription.trim() && !hasStructuredDrafts) ||
              agentIds.length === 0
            }
            data-testid="office-workflow-preview"
            title={
              regenerateStale
                ? t(structuredOrchestration ? 'workflow.regenerateStaleHintStructured' : 'workflow.regenerateStaleHint')
                : undefined
            }
            onClick={() => {
              void handlePreviewClick();
            }}
          >
            <Sparkles className="mr-1 h-3 w-3" />
            {generating
              ? t('workflow.generateRunning')
              : t('workflow.previewWorkflow')}
          </Button>
        </div>
      </div>

      {regenerateStale ? (
        <p className="text-[10px] font-medium text-amber-700 dark:text-amber-300">
          {t(structuredOrchestration ? 'workflow.regenerateStaleBannerStructured' : 'workflow.regenerateStaleBanner')}
        </p>
      ) : null}

      {teamMembers.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">{t('workflow.needAgents')}</p>
      ) : (
        <>
          {hasWorkflow && !structuredOrchestration ? (
            <WorkflowStepRuntimeList
              workflow={workflow}
              disabled={disabled || generating}
              userCheckpointEditable={orchestrationEngine !== 'langgraph'}
              onChange={apply}
            />
          ) : null}
          <button
            type="button"
            className={cn(
              'flex w-full items-center gap-2 rounded-lg border text-left transition-colors hover:bg-muted/30',
              embedded ? 'border-border/40 bg-muted/10 px-3 py-2' : 'bg-card px-2.5 py-2',
            )}
            data-testid="office-workflow-visual-toggle"
            onClick={() => setVisualOpen((v) => !v)}
          >
            {visualOpen ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold">
                {orchestrationEngine === 'langgraph'
                  ? t('workflow.langGraphVisualTitle')
                  : t('workflow.visualTitle')}
              </p>
              {!visualOpen ? (
                <p className="truncate text-[10px] text-muted-foreground">{collapsedSummary}</p>
              ) : genSource ? (
                <p className="text-[10px] text-muted-foreground">
                  {t(
                    genSource === 'structured_rule'
                      ? 'workflow.generateSource.structured_rule'
                      : genSource === 'ai'
                      ? 'workflow.generateSource.ai'
                      : genSource === 'langgraph_ai'
                        ? 'workflow.generateSource.langgraph_ai'
                      : genSource === 'ai_fallback'
                        ? 'workflow.generateSource.ai_fallback'
                        : genSource === 'langgraph_ai_fallback'
                          ? 'workflow.generateSource.langgraph_ai_fallback'
                          : genSource === 'langgraph_heuristic'
                            ? 'workflow.generateSource.langgraph_heuristic'
                        : 'workflow.generateSource.heuristic',
                  )}
                </p>
              ) : null}
            </div>
          </button>

          {visualOpen ? (
            <div
              className={cn(
                'rounded-lg border border-border/40 bg-muted/10',
                embedded ? 'p-2.5' : 'bg-gradient-to-b from-primary/5 to-transparent p-3',
              )}
            >
              {generating && !hasWorkflow ? (
                <p className="text-center text-[11px] text-muted-foreground">{t('workflow.generateRunning')}</p>
              ) : orchestrationEngine === 'langgraph' ? (
                  <LangGraphWorkflowVisualPreview
                    workflow={workflow}
                    members={teamMembers}
                    editGateMissingBadgeByKey={editGateMissingBadgeByKey}
                    langGraphMissingKeySource={langGraphMissingKeySource}
                  />
                ) : (
                  <WorkflowVisualPreview
                    workflow={workflow}
                    members={teamMembers}
                    editGateMissingBadgeByKey={editGateMissingBadgeByKey}
                    nodesRegenerated={nodesRegenerated}
                  />
              )}
            </div>
          ) : null}
        </>
      )}

      {usedRoleIds.length > 0 ? (
        <p className="text-[10px] text-muted-foreground">
          {t('workflow.teamRolesDerived', {
            roles: usedRoleIds
              .map((id) => teamMembers.find((m) => m.agentId === id)?.displayName ?? id)
              .join('、'),
          })}
        </p>
      ) : null}
    </div>
  );
}

export const ScenarioWorkflowSection = memo(ScenarioWorkflowSectionInner);
