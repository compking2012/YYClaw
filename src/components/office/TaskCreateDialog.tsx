import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentsStore } from '@/stores/agents';
import { isShallowRecordDirty, requestCloseOfficeDraft } from '@/lib/office-unsaved-draft';
import { LangGraphWorkflowSection } from '@/components/office/LangGraphWorkflowSection';
import { ScenarioWorkflowSection } from '@/components/office/ScenarioWorkflowSection';
import {
  TaskFormDialogShell,
  TaskFormField,
  TaskFormWorkflowSeparator,
} from '@/components/office/TaskFormDialogShell';
import { TaskRunnerModeField } from '@/components/office/TaskRunnerModeField';
import { OfficeExecutionModeAlphaBadge } from '@/components/office/OfficeExecutionModeAlphaBadge';
import { AgentPoolPicker } from '@/components/office/AgentPoolPicker';
import { TaskTeamAgentsDisplay } from '@/components/office/TaskTeamRolesDisplay';
import { TaskWorkflowDescriptionField } from '@/components/office/TaskWorkflowDescriptionField';
import { WorkflowStepDraftsField } from '@/components/office/WorkflowStepDraftsField';
import { WorkflowOrchestrationModeField } from '@/components/office/WorkflowOrchestrationModeField';
import { OfficeStructuredWorkflowPanel } from '@/components/office/OfficeStructuredWorkflowPanel';
import {
  DEFAULT_WORKFLOW_ORCHESTRATION_MODE,
  heuristicDescriptionForForm,
  orchestrationModeFromGroup,
  showHeuristicWorkflowDescriptionField,
  showWorkflowOrchestrationModeField,
  showWorkflowStepDraftsField,
  type WorkflowOrchestrationMode,
} from '@/lib/office-workflow-orchestration-mode';
import { orchestrationBaselineSnapshot } from '@/lib/office-orchestration-baseline';
import { initialPreviewSyncedKey } from '@/lib/office-workflow-preview-state';
import { resolveDagWorkflowForSave } from '@/lib/office-workflow-preview';
import { useOfficeDagWorkflowPreview } from '@/hooks/useOfficeDagWorkflowPreview';
import { toast } from '@/lib/toast';
import { stripAgentIdsFromOfficeWorkflowRefs } from '@/lib/office-missing-agents';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ensureCoordinatorInTeam, emptyWorkflow } from '@/lib/office-workflow-roles';
import { cn } from '@/lib/utils';
import { officeFormFieldClass } from '@/lib/office-form-field-styles';
import { ENABLE_LANGGRAPH } from '@/lib/feature-langgraph';
import { langGraphWorkflowDescriptionRequired } from '@/lib/office-langgraph-workflow-bundle';
import { projectMembersFromIds } from '@/lib/office-project-members';
import {
  emptyWorkflowStepDraftRows,
  resolveWorkflowStepDraftRows,
} from '@/lib/office-workflow-step-drafts';
import {
  isWorkflowRunnerMode,
  taskRunnerModeFromFields,
  taskRunnerModeToFields,
  type TaskRunnerMode,
} from '@/lib/office-task-runner-mode';
import { fixedGroupExecutionMode, spawnedProjectOrchestrationModeLocked } from '@/lib/office-fixed-group';
import type {
  LangGraphWorkflowBundle,
  LangGraphWorkflowSource,
  OfficeFixedGroup,
  OfficeTaskExecutionMode,
  OfficeWorkflowEngine,
  WorkflowDefinition,
  WorkflowStepDraftRow,
  AgentBindingRecord,
} from '@/types/office';
import type { AgentSummary } from '@/types/agent';

export type TaskCreateMode = 'standalone' | 'spawn';

export interface TaskCreateOpenOptions {
  origin?: TaskCreateMode;
  groupId?: string;
}

export interface TaskCreateSubmitMeta {
  mode: TaskCreateMode;
  group: OfficeFixedGroup | null;
}

export function emptyTaskCreateForm(
  coordinatorAgentId = '',
  agentIds: string[] = [],
): TaskCreateFormState {
  return {
    title: '',
    featureDescription: '',
    description: '',
    agentIds,
    coordinatorAgentId,
    executionMode: 'workflow',
    workflowEngine: 'dag',
    workflow: emptyWorkflow('dag'),
    workflowStepDrafts: emptyWorkflowStepDraftRows(),
    workflowOrchestrationMode: DEFAULT_WORKFLOW_ORCHESTRATION_MODE,
    heuristicWorkflowDescription: '',
    langGraphTab: 'heuristic',
    langGraphWorkflowBundle: undefined,
    langGraphCustomJsonDraft: '',
  };
}

/** 从固定组预填派出项目表单（工作流模板、编排方式、成员等）。 */
export function taskCreateFormFromGroup(
  group: OfficeFixedGroup,
  agents: Pick<AgentSummary, 'id' | 'name'>[],
  overrides?: Partial<Pick<TaskCreateFormState, 'title' | 'featureDescription'>>,
): TaskCreateFormState {
  const groupMode = fixedGroupExecutionMode(group);
  const orchestrationMode = orchestrationModeFromGroup(group);
  const members = projectMembersFromIds(group.agentIds, (id) =>
    agents.find((a) => a.id === id)?.name,
  );
  const groupWorkflow = group.workflow?.nodes?.length
    ? structuredClone(group.workflow)
    : emptyWorkflow('dag');
  return {
    ...emptyTaskCreateForm(group.coordinatorAgentId, [...group.agentIds]),
    ...overrides,
    agentIds: [...group.agentIds],
    coordinatorAgentId: group.coordinatorAgentId,
    executionMode: groupMode,
    workflowEngine: 'dag',
    // Open-time sync: show live group DAG immediately (save still compares dirty vs group).
    workflow: groupWorkflow,
    workflowOrchestrationMode: orchestrationMode,
    heuristicWorkflowDescription: heuristicDescriptionForForm({
      orchestrationMode,
      storedDescription: group.workflowDescription,
    }),
    workflowStepDrafts: orchestrationMode === 'rule'
      ? resolveWorkflowStepDraftRows(group.workflowStepDrafts, undefined, members)
      : emptyWorkflowStepDraftRows(),
    description: group.workflowDescription ?? '',
    langGraphWorkflowBundle: undefined,
    langGraphCustomJsonDraft: '',
  };
}

export interface TaskCreateFormState {
  title: string;
  featureDescription: string;
  description: string;
  agentIds: string[];
  coordinatorAgentId: string;
  executionMode: OfficeTaskExecutionMode;
  workflowEngine: OfficeWorkflowEngine;
  workflow: WorkflowDefinition;
  workflowStepDrafts: WorkflowStepDraftRow[];
  workflowOrchestrationMode: WorkflowOrchestrationMode;
  heuristicWorkflowDescription: string;
  langGraphTab: LangGraphWorkflowSource;
  langGraphWorkflowBundle?: LangGraphWorkflowBundle;
  langGraphCustomJsonDraft?: string;
}

interface TaskCreateDialogProps {
  open: boolean;
  openOptions?: TaskCreateOpenOptions;
  initialForm: TaskCreateFormState;
  fixedGroups: OfficeFixedGroup[];
  agentBindings: Record<string, AgentBindingRecord>;
  saving?: boolean;
  onClose: () => void;
  onCreate: (meta: TaskCreateSubmitMeta, form: TaskCreateFormState) => void;
}

function TaskCreateDialogInner({
  open,
  openOptions,
  initialForm,
  fixedGroups,
  agentBindings,
  saving = false,
  onClose,
  onCreate,
}: TaskCreateDialogProps) {
  const { t } = useTranslation('office');
  const agents = useAgentsStore((s) => s.agents);
  const [form, setForm] = useState(initialForm);
  const baselineRef = useRef(initialForm);
  const [orchestrationBaseline, setOrchestrationBaseline] = useState(() =>
    orchestrationBaselineSnapshot({
      orchestrationMode: initialForm.workflowOrchestrationMode,
      heuristicDescription: initialForm.heuristicWorkflowDescription,
      workflowStepDrafts: initialForm.workflowStepDrafts,
    }),
  );
  const [langGraphGenerating, setLangGraphGenerating] = useState(false);
  const [submittingLocal, setSubmittingLocal] = useState(false);
  const [step, setStep] = useState<'origin' | 'form'>('origin');
  const [origin, setOrigin] = useState<TaskCreateMode | null>(null);
  const [spawnGroupId, setSpawnGroupId] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  const onChange = useCallback((next: TaskCreateFormState) => {
    setForm(next);
  }, []);

  const patchForm = useCallback((patch: Partial<TaskCreateFormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  }, []);

  const formRef = useRef(form);
  useEffect(() => {
    formRef.current = form;
  }, [form]);

  const handleRequestClose = useCallback(() => {
    requestCloseOfficeDraft({
      dirty: isShallowRecordDirty(formRef.current, baselineRef.current),
      onClose,
      message: t('unsaved.confirmDiscard'),
    });
  }, [onClose, t]);

  useEffect(() => {
    if (!open) return;
    setForm(initialForm);
    baselineRef.current = initialForm;
    setOrchestrationBaseline(
      orchestrationBaselineSnapshot({
        orchestrationMode: initialForm.workflowOrchestrationMode,
        heuristicDescription: initialForm.heuristicWorkflowDescription,
        workflowStepDrafts: initialForm.workflowStepDrafts,
      }),
    );
  }, [open, initialForm]);

  const spawnGroup = useMemo(
    () => fixedGroups.find((g) => g.id === spawnGroupId) ?? null,
    [fixedGroups, spawnGroupId],
  );
  const mode: TaskCreateMode = origin ?? 'standalone';
  const group = mode === 'spawn' ? spawnGroup : null;

  const lookup = (id: string) => agents.find((a) => a.id === id)?.name;
  const smartSpawn = mode === 'spawn' && group && fixedGroupExecutionMode(group) === 'smart';
  const showMemberPicker = mode === 'standalone' || smartSpawn;
  const memberAgentIds = showMemberPicker ? form.agentIds : group?.agentIds ?? [];
  const memberCoordinatorId = showMemberPicker
    ? ensureCoordinatorInTeam(
      form.coordinatorAgentId,
      form.agentIds,
      form.agentIds[0] ?? '',
    )
    : group?.coordinatorAgentId ?? '';
  const pickerAgents = useMemo(() => {
    if (!smartSpawn || !group) return agents;
    const pool = new Set([...group.agentIds, ...form.agentIds]);
    return agents.filter((a) => pool.has(a.id));
  }, [agents, form.agentIds, group, smartSpawn]);
  const teamMembers = projectMembersFromIds(memberAgentIds, lookup);
  const coordinatorId = ensureCoordinatorInTeam(
    memberCoordinatorId,
    memberAgentIds,
    memberCoordinatorId,
  );

  const runnerMode = taskRunnerModeFromFields(form.executionMode, form.workflowEngine);
  const workflowMode = isWorkflowRunnerMode(runnerMode);
  const orchestrationModeLocked =
    mode === 'spawn' && Boolean(group && spawnedProjectOrchestrationModeLocked(group));
  const effectiveOrchestrationMode =
    orchestrationModeLocked && group
      ? orchestrationModeFromGroup(group)
      : form.workflowOrchestrationMode;

  const dagPreviewCtrl = useOfficeDagWorkflowPreview({
    executionMode: form.executionMode,
    orchestrationMode: effectiveOrchestrationMode,
    workflowStepDrafts: form.workflowStepDrafts,
    heuristicDescription: form.heuristicWorkflowDescription,
    workflow: form.workflow,
    members: teamMembers,
    agentIds: memberAgentIds,
    coordinatorAgentId: coordinatorId,
    taskTitle: form.title,
    featureDescription: form.featureDescription,
    orchestrationBaseline,
    baselineHasMaterializedWorkflow: form.workflow.nodes.length > 0,
    enabled: workflowMode && form.workflowEngine === 'dag',
  });

  const dagPreviewBinding = useMemo(
    () => ({
      isStale: dagPreviewCtrl.isStale,
      isPreviewing: dagPreviewCtrl.isPreviewing,
      previewDisabled: saving || submittingLocal,
      onPreview: async () => {
        const result = await dagPreviewCtrl.runPreview();
        if (result.ok) {
          patchForm({ workflow: result.workflow });
          setLangGraphGenerating(false);
        }
        return result;
      },
    }),
    [dagPreviewCtrl, patchForm, saving, submittingLocal],
  );

  const usesDagPreview = workflowMode && form.workflowEngine === 'dag';
  const previewBusy =
    saving
    || submittingLocal
    || (usesDagPreview ? dagPreviewCtrl.isPreviewing : langGraphGenerating);
  const willRegenerateOnSave = workflowMode && form.workflowEngine === 'dag' && dagPreviewCtrl.isStale;

  useEffect(() => {
    if (!open) return;
    dagPreviewCtrl.setPreviewSyncedKey(
      initialPreviewSyncedKey({
        orchestration: orchestrationBaseline,
        hasMaterializedWorkflow: form.workflow.nodes.length > 0,
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open/baseline reset; form.workflow captured at open sync
  }, [open, orchestrationBaseline, form.workflow.nodes.length]);

  const handleSubmit = useCallback(async () => {
    if (previewBusy) return;
    setSubmittingLocal(true);
    try {
      let nextForm = formRef.current;
      if (workflowMode && nextForm.workflowEngine === 'dag') {
        const resolved = await resolveDagWorkflowForSave({
          executionMode: nextForm.executionMode,
          spawnFromGroup: mode === 'spawn',
          groupWorkflow: group?.workflow,
          group: group
            ? {
                workflow: group.workflow,
                workflowDescription: group.workflowDescription,
                workflowStepDrafts: group.workflowStepDrafts,
                workflowOrchestrationMode: group.workflowOrchestrationMode,
                agentIds: group.agentIds,
                coordinatorAgentId: group.coordinatorAgentId,
              }
            : null,
          orchestration: dagPreviewCtrl.orchestration,
          orchestrationBaseline,
          previewSyncedKey: dagPreviewCtrl.previewSyncedKey,
          workflow: nextForm.workflow,
          members: teamMembers,
          agentIds: memberAgentIds,
          coordinatorAgentId: coordinatorId,
          taskTitle: nextForm.title,
          featureDescription: nextForm.featureDescription,
        });
        if (!resolved.ok) {
          toast.error(t(resolved.errorKey));
          return;
        }
        dagPreviewCtrl.markPreviewSynced();
        nextForm = { ...nextForm, workflow: resolved.workflow };
      }
      onCreate({ mode, group }, nextForm);
    } finally {
      setSubmittingLocal(false);
    }
  }, [
    coordinatorId,
    dagPreviewCtrl,
    group,
    memberAgentIds,
    mode,
    onCreate,
    orchestrationBaseline,
    previewBusy,
    t,
    teamMembers,
    workflowMode,
  ]);

  useEffect(() => {
    if (!open) {
      setLangGraphGenerating(false);
      return;
    }
    const preferredOrigin = openOptions?.origin;
    const preferredGroupId = openOptions?.groupId ?? null;
    setOrigin(preferredOrigin ?? null);
    setSpawnGroupId(preferredGroupId);
    if (preferredOrigin === 'standalone') {
      setStep('form');
      return;
    }
    if (
      preferredOrigin === 'spawn'
      && preferredGroupId
      && fixedGroups.some((g) => g.id === preferredGroupId)
    ) {
      setStep('form');
      return;
    }
    setStep('origin');
  }, [open, openOptions?.origin, openOptions?.groupId, fixedGroups]);

  useEffect(() => {
    if (!open) setLangGraphGenerating(false);
  }, [open]);

  useEffect(() => {
    // Focus the title field once the form step is shown (avoids Windows focus
    // loss where the freshly-portaled dialog inputs can't be clicked into).
    if (open && step === 'form') titleInputRef.current?.focus();
  }, [open, step]);

  const patchWorkflowStepDrafts = useCallback((workflowStepDrafts: WorkflowStepDraftRow[]) => {
    patchForm({ workflowStepDrafts });
  }, [patchForm]);

  if (!open) return null;

  const langGraphDescriptionRequired = langGraphWorkflowDescriptionRequired(
    form.workflowEngine,
    form.langGraphTab,
  );
  const showOrchestrationMode = showWorkflowOrchestrationModeField({
    executionMode: form.executionMode,
    workflowEngine: form.workflowEngine,
  });
  const showStepDrafts = showWorkflowStepDraftsField({
    executionMode: form.executionMode,
    workflowEngine: form.workflowEngine,
    langGraphTab: form.langGraphTab,
    orchestrationMode: effectiveOrchestrationMode,
  });
  const showHeuristicDescription = showHeuristicWorkflowDescriptionField({
    executionMode: form.executionMode,
    workflowEngine: form.workflowEngine,
    langGraphTab: form.langGraphTab,
    orchestrationMode: effectiveOrchestrationMode,
  });
  const structuredOrchestration =
    form.workflowEngine === 'dag' && effectiveOrchestrationMode === 'rule';
  const workflowDescriptionRequired =
    mode !== 'spawn'
    && workflowMode
    && ((form.workflowEngine === 'langgraph' && langGraphDescriptionRequired && !showStepDrafts)
      || (form.workflowEngine === 'dag' && effectiveOrchestrationMode === 'heuristic'));

  const workflowDescriptionValue =
    form.workflowEngine === 'dag' && effectiveOrchestrationMode === 'heuristic'
      ? form.heuristicWorkflowDescription
      : form.description;

  const presetOrigin = openOptions?.origin;
  const originContinueDisabled =
    !origin || (origin === 'spawn' && (!spawnGroupId || fixedGroups.length === 0));

  const applyOriginToForm = (nextOrigin: TaskCreateMode, nextGroup: OfficeFixedGroup | null) => {
    if (nextOrigin === 'spawn' && nextGroup) {
      const next = {
        ...taskCreateFormFromGroup(nextGroup, agents),
        title: form.title,
        featureDescription: form.featureDescription,
      };
      onChange(next);
      baselineRef.current = next;
      setOrchestrationBaseline(
        orchestrationBaselineSnapshot({
          orchestrationMode: next.workflowOrchestrationMode,
          heuristicDescription: next.heuristicWorkflowDescription,
          workflowStepDrafts: next.workflowStepDrafts,
        }),
      );
      return;
    }
    const next = {
      ...emptyTaskCreateForm(),
      title: form.title,
      featureDescription: form.featureDescription,
      description: form.description,
    };
    onChange(next);
    baselineRef.current = next;
    setOrchestrationBaseline(
      orchestrationBaselineSnapshot({
        orchestrationMode: next.workflowOrchestrationMode,
        heuristicDescription: next.heuristicWorkflowDescription,
        workflowStepDrafts: next.workflowStepDrafts,
      }),
    );
  };

  const handleOriginContinue = () => {
    if (originContinueDisabled || !origin) return;
    applyOriginToForm(origin, spawnGroup);
    setStep('form');
  };

  const dialogTitle =
    step === 'origin'
      ? t('taskForm.createTitle')
      : mode === 'spawn' && group
        ? t('taskForm.createFromGroupTitle', { name: group.name })
        : t('taskForm.createTitle');

  return (
    <TaskFormDialogShell
      testId="office-task-create-dialog"
      title={dialogTitle}
      size={step === 'form' && workflowMode ? 'tall' : 'default'}
      onClose={handleRequestClose}
      footer={
        step === 'origin' ? (
          <>
            <Button variant="outline" size="sm" onClick={handleRequestClose} disabled={saving}>
              {t('wizard.cancel')}
            </Button>
            <Button
              size="sm"
              disabled={originContinueDisabled || saving}
              data-testid="office-task-create-origin-continue"
              onClick={handleOriginContinue}
            >
              {t('taskForm.originContinue')}
            </Button>
          </>
        ) : (
          <>
            {!presetOrigin ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStep('origin')}
                disabled={saving || langGraphGenerating}
              >
                {t('taskForm.originBack')}
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={handleRequestClose} disabled={previewBusy}>
              {t('wizard.cancel')}
            </Button>
            <Button
              size="sm"
              disabled={
                previewBusy ||
                !form.title.trim() ||
                !form.featureDescription.trim() ||
                (workflowDescriptionRequired && !workflowDescriptionValue.trim()) ||
                memberAgentIds.length === 0
              }
              data-testid="office-task-create-submit"
              onClick={() => void handleSubmit()}
            >
              {submittingLocal && willRegenerateOnSave
                ? t('workflow.generateRunning')
                : previewBusy
                  ? t('taskForm.saving')
                  : t('taskForm.create')}
            </Button>
          </>
        )
      }
    >
      {step === 'origin' ? (
        <div className="space-y-5" data-testid="office-task-create-origin">
          <div className="space-y-2.5">
            <Label>{t('taskForm.originLabel')}</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label
                className={cn(
                  'cursor-pointer rounded-xl border px-3 py-2.5 transition-all',
                  origin === 'spawn'
                    ? 'border-primary/40 bg-primary/5 shadow-sm ring-1 ring-primary/20'
                    : 'border-border/50 bg-muted/20 hover:border-border hover:bg-muted/40',
                  fixedGroups.length === 0 && 'cursor-not-allowed opacity-60',
                )}
              >
                <input
                  type="radio"
                  name="office-task-create-origin"
                  value="spawn"
                  checked={origin === 'spawn'}
                  disabled={fixedGroups.length === 0}
                  data-testid="office-task-create-origin-spawn"
                  className="sr-only"
                  onChange={() => setOrigin('spawn')}
                />
                <span className="text-xs font-semibold leading-tight">{t('taskForm.originSpawn')}</span>
                <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
                  {t('taskForm.originSpawnHint')}
                </span>
              </label>
              <label
                className={cn(
                  'cursor-pointer rounded-xl border px-3 py-2.5 transition-all',
                  origin === 'standalone'
                    ? 'border-primary/40 bg-primary/5 shadow-sm ring-1 ring-primary/20'
                    : 'border-border/50 bg-muted/20 hover:border-border hover:bg-muted/40',
                )}
              >
                <input
                  type="radio"
                  name="office-task-create-origin"
                  value="standalone"
                  checked={origin === 'standalone'}
                  data-testid="office-task-create-origin-standalone"
                  className="sr-only"
                  onChange={() => {
                    setOrigin('standalone');
                    setSpawnGroupId(null);
                  }}
                />
                <span className="text-xs font-semibold leading-tight">{t('taskForm.originStandalone')}</span>
                <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
                  {t('taskForm.originStandaloneHint')}
                </span>
              </label>
            </div>
          </div>

          {fixedGroups.length === 0 ? (
            <p className="rounded-lg border border-amber-200/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
              {t('taskForm.originNeedFixedGroup')}
            </p>
          ) : null}

          {origin === 'spawn' && fixedGroups.length > 0 ? (
            <div className="space-y-2.5">
              <Label>{t('taskForm.selectFixedGroupForSpawn')}</Label>
              <div className="max-h-48 space-y-1.5 overflow-y-auto rounded-xl border border-border/50 bg-muted/10 p-2">
                {fixedGroups.map((g) => {
                  const active = spawnGroupId === g.id;
                  return (
                    <label
                      key={g.id}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 transition-all',
                        active
                          ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/20'
                          : 'border-transparent hover:border-border/60 hover:bg-muted/30',
                      )}
                      data-testid={`office-task-create-origin-group-${g.id}`}
                    >
                      <input
                        type="radio"
                        name="office-task-create-spawn-group"
                        value={g.id}
                        checked={active}
                        className="sr-only"
                        onChange={() => setSpawnGroupId(g.id)}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{g.name}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {t('taskForm.originGroupAgentCount', { count: g.agentIds.length })}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          {mode === 'spawn' && group ? (
            <div
              className="rounded-lg border border-border/40 bg-muted/10 px-3 py-2"
              data-testid="office-task-create-inherited-mode"
            >
              <p className="text-[11px] text-muted-foreground">{t('taskForm.inheritedExecutionMode')}</p>
              <p className="mt-1 inline-flex items-center text-xs font-semibold">
                {fixedGroupExecutionMode(group) === 'smart'
                  ? (
                    <>
                      {t('taskForm.runnerModeSmart')}
                      <OfficeExecutionModeAlphaBadge />
                    </>
                  )
                  : t('taskForm.runnerModeDag')}
              </p>
            </div>
          ) : (
            <TaskRunnerModeField
              value={runnerMode}
              disabled={saving}
              onChange={(nextMode: TaskRunnerMode) => {
                const { executionMode, workflowEngine } = taskRunnerModeToFields(nextMode);
                if (nextMode === 'smart') {
                  patchForm({
                    executionMode,
                    workflowEngine,
                    workflow: emptyWorkflow('dag'),
                  });
                  return;
                }
                if (nextMode === 'langgraph' && ENABLE_LANGGRAPH) {
                  setForm((prev) => ({
                    ...prev,
                    executionMode,
                    workflowEngine,
                    langGraphTab: 'custom',
                    langGraphWorkflowBundle:
                      prev.workflowEngine === 'langgraph' ? prev.langGraphWorkflowBundle : undefined,
                  }));
                  return;
                }
                patchForm({
                  executionMode,
                  workflowEngine,
                  langGraphWorkflowBundle: undefined,
                });
              }}
            />
          )}

          <TaskFormField>
            <Label htmlFor="office-task-create-title">{t('taskForm.title')}</Label>
            <Input
              id="office-task-create-title"
              ref={titleInputRef}
              value={form.title}
              className={officeFormFieldClass('h-9')}
              onChange={(e) => patchForm({ title: e.target.value })}
              data-testid="office-task-create-title"
            />
          </TaskFormField>
          <TaskFormField>
            <Label htmlFor="office-task-create-feature">{t('taskForm.featureDescription')}</Label>
            <Textarea
              id="office-task-create-feature"
              value={form.featureDescription}
              className={officeFormFieldClass('min-h-[4.5rem] resize-y')}
              onChange={(e) => patchForm({ featureDescription: e.target.value })}
              rows={2}
              placeholder={t('taskForm.featureDescriptionPlaceholder')}
              data-testid="office-task-create-feature-description"
            />
          </TaskFormField>
          {showMemberPicker ? (
              <AgentPoolPicker
                agents={pickerAgents}
                selectedAgentIds={form.agentIds}
                coordinatorAgentId={form.coordinatorAgentId}
                agentBindings={agentBindings}
                disabled={saving}
                layout="split"
                onChange={({ agentIds: nextAgentIds, coordinatorAgentId: nextCoordinatorId, removedAgentIds }) => {
                  if (removedAgentIds?.length) {
                    setForm((prev) => ({
                      ...stripAgentIdsFromOfficeWorkflowRefs(prev, removedAgentIds),
                      agentIds: nextAgentIds,
                      coordinatorAgentId: nextCoordinatorId,
                    }));
                    return;
                  }
                  patchForm({
                    agentIds: nextAgentIds,
                    coordinatorAgentId: nextCoordinatorId,
                  });
                }}
              />
            ) : memberAgentIds.length > 0 ? (
              <TaskTeamAgentsDisplay
                agentIds={memberAgentIds}
                coordinatorAgentId={coordinatorId}
                agents={agents}
              />
            ) : null}
            {workflowMode && memberAgentIds.length > 0 ? <TaskFormWorkflowSeparator /> : null}
            {showOrchestrationMode ? (
              <WorkflowOrchestrationModeField
                value={effectiveOrchestrationMode}
                locked={orchestrationModeLocked}
                disabled={saving}
                onChange={(workflowOrchestrationMode) => patchForm({ workflowOrchestrationMode })}
              />
            ) : null}
            {workflowMode && showHeuristicDescription ? (
              <TaskWorkflowDescriptionField
                executionMode={form.executionMode}
                value={
                  form.workflowEngine === 'dag'
                    ? form.heuristicWorkflowDescription
                    : form.description
                }
                disabled={saving}
                required={
                  form.workflowEngine === 'dag'
                    ? workflowDescriptionRequired
                    : mode !== 'spawn' && langGraphDescriptionRequired
                }
                id="office-task-create-desc"
                testId="office-task-create-description"
                enhanceAgentId={coordinatorId}
                onChange={(next) => {
                  if (form.workflowEngine === 'dag') {
                    patchForm({ heuristicWorkflowDescription: next });
                    return;
                  }
                  patchForm({ description: next });
                }}
              />
          ) : null}
          {workflowMode && structuredOrchestration && showStepDrafts && memberAgentIds.length > 0 ? (
            <OfficeStructuredWorkflowPanel
              stepDrafts={(
                <WorkflowStepDraftsField
                  rows={form.workflowStepDrafts}
                  memberAgentIds={memberAgentIds}
                  agents={agents}
                  disabled={saving}
                  embedded
                  userCheckpointEditable={form.workflowEngine === 'dag'}
                  testId="office-task-create-step-drafts"
                  onChange={patchWorkflowStepDrafts}
                />
              )}
              preview={(
                <ScenarioWorkflowSection
                  workflow={form.workflow}
                  teamMembers={teamMembers}
                  agentIds={memberAgentIds}
                  coordinatorAgentId={coordinatorId}
                  taskTitle={form.title}
                  taskFeatureDescription={form.featureDescription}
                  taskDescription=""
                  workflowStepDrafts={form.workflowStepDrafts}
                  workflowEngine={form.workflowEngine}
                  structuredOrchestration
                  embedded
                  sectionHintKey="workflow.sectionHintStructured"
                  disabled={saving}
                  orchestrationMode={effectiveOrchestrationMode}
                  dagPreview={form.workflowEngine === 'dag' ? dagPreviewBinding : undefined}
                  onGeneratingChange={setLangGraphGenerating}
                  onChange={({ workflow }) => patchForm({ workflow })}
                />
              )}
            />
          ) : null}

          {memberAgentIds.length === 0 ? (
            <p className="rounded-lg border border-amber-200/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
              {t('agentPool.needAgentsFirst')}
            </p>
          ) : null}

          {memberAgentIds.length > 0 && workflowMode && !structuredOrchestration ? (
            <div className="office-form-scroll-section space-y-4">
              {ENABLE_LANGGRAPH && form.workflowEngine === 'langgraph' ? (
                <LangGraphWorkflowSection
                  workflow={form.workflow}
                  langGraphWorkflowBundle={form.langGraphWorkflowBundle}
                  teamMembers={teamMembers}
                  disabled={saving}
                  onChange={({ workflow, langGraphTab, langGraphWorkflowBundle, langGraphCustomJsonDraft }) =>
                    patchForm({
                      workflow,
                      langGraphTab,
                      langGraphWorkflowBundle,
                      langGraphCustomJsonDraft,
                    })
                  }
                  langGraphCustomJsonDraft={form.langGraphCustomJsonDraft}
                />
              ) : (
                <ScenarioWorkflowSection
                  workflow={form.workflow}
                  teamMembers={teamMembers}
                  agentIds={memberAgentIds}
                  coordinatorAgentId={coordinatorId}
                  taskTitle={form.title}
                  taskFeatureDescription={form.featureDescription}
                  taskDescription={
                    structuredOrchestration ? '' : form.heuristicWorkflowDescription
                  }
                  workflowStepDrafts={structuredOrchestration ? form.workflowStepDrafts : undefined}
                  workflowEngine={form.workflowEngine}
                  structuredOrchestration={structuredOrchestration}
                  sectionHintKey={
                    structuredOrchestration
                      ? 'workflow.sectionHintStructured'
                      : undefined
                  }
                  disabled={saving}
                  orchestrationMode={effectiveOrchestrationMode}
                  dagPreview={form.workflowEngine === 'dag' ? dagPreviewBinding : undefined}
                  onGeneratingChange={setLangGraphGenerating}
                  onChange={({ workflow }) => patchForm({ workflow })}
                />
              )}
            </div>
          ) : null}
        </div>
      )}
    </TaskFormDialogShell>
  );
}

export const TaskCreateDialog = memo(TaskCreateDialogInner);
