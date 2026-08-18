import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAgentsStore } from '@/stores/agents';
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
import { TaskWorkflowDescriptionField } from '@/components/office/TaskWorkflowDescriptionField';
import { WorkflowStepDraftsField } from '@/components/office/WorkflowStepDraftsField';
import { OfficeStructuredWorkflowPanel } from '@/components/office/OfficeStructuredWorkflowPanel';
import { WorkflowOrchestrationModeField } from '@/components/office/WorkflowOrchestrationModeField';
import {
  orchestrationModeFromGroup,
  showHeuristicWorkflowDescriptionField,
  showWorkflowOrchestrationModeField,
  showWorkflowStepDraftsField,
} from '@/lib/office-workflow-orchestration-mode';
import { fixedGroupExecutionMode, isFixedGroupSpawnedProject, spawnedProjectOrchestrationModeLocked } from '@/lib/office-fixed-group';
import { projectShowsArchivedRestartBadge } from '@/lib/office-project-source-badge';
import { taskExecutionMode } from '@/lib/office-task-execution-mode';
import {
  isWorkflowRunnerMode,
  taskRunnerModeFromFields,
  taskRunnerModeToFields,
  type TaskRunnerMode,
} from '@/lib/office-task-runner-mode';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { requestCloseOfficeDraft } from '@/lib/office-unsaved-draft';
import { displayAgentsForProject, isWorkflowDescriptionSatisfied } from '@/lib/office-task-workflow';
import { shouldUseWorkflowFreezeSnapshot } from '@/lib/office-spawned-workflow-ownership';
import { filterKnownAgentIds } from '@/lib/office-group-agents';
import { taskWorkflowEngine } from '@/lib/office-workflow-engine';
import { emptyWorkflow } from '@/lib/office-workflow-roles';
import { officeFormFieldClass } from '@/lib/office-form-field-styles';
import { cn } from '@/lib/utils';
import { projectMembersFromIds } from '@/lib/office-project-members';
import { ENABLE_LANGGRAPH } from '@/lib/feature-langgraph';
import { orchestrationBaselineSnapshot } from '@/lib/office-orchestration-baseline';
import { isSmartTask } from '@/lib/office-task-execution-mode';
import {
  buildTaskEditFormStateFromProject,
  canEditProjectMembers,
  canUnbindMissingSpawnedProjectMembers,
  computeTaskEditDirty,
  isTaskEditSaveDisabled,
  projectWorkflowForForm,
  type TaskEditFormState,
} from '@/lib/office-task-edit-form';
import { orchestrationChangedFromBaseline } from '@/lib/office-workflow-preview-state';
import { resolveDagWorkflowForSave } from '@/lib/office-workflow-preview';
import {
  shouldFlagDagNodesRegeneratedOnSaveResolve,
  shouldMarkPreviewSyncedAfterMissingAgentsGate,
} from '@/lib/office-edit-save-workflow-sync';
import { useOfficeDagWorkflowPreview } from '@/hooks/useOfficeDagWorkflowPreview';
import { toast } from '@/lib/toast';
import {
  applySessionOnlyStripOnSave,
  buildOfficeMissingAgentsModel,
  ensureMissingCoordinatorInRoster,
  formatMissingAgentsLabelForIds,
  formatOfficeSaveBlockedMessage,
  hasMissingOfficeAgents,
  mergeAgentNameMaps,
  missingAgentsForOfficeEntity,
  nameMapFromAgents,
  nodeMissingBadgeByKey,
  preserveCoordinatorForSave,
  stripAgentIdsFromOfficeWorkflowRefs,
} from '@/lib/office-missing-agents';
import type {
  LangGraphWorkflowBundle,
  LangGraphWorkflowSource,
  OfficeFixedGroup,
  OfficeTempProject,
  OfficeTaskExecutionMode,
  OfficeWorkflowEngine,
  WorkflowDefinition,
  WorkflowStepDraftRow,
  WorkflowOrchestrationMode,
  AgentBindingRecord,
} from '@/types/office';

export type { TaskEditFormState } from '@/lib/office-task-edit-form';

interface TaskEditDialogProps {
  project: OfficeTempProject;
  group?: Pick<
    OfficeFixedGroup,
    | 'id'
    | 'workflow'
    | 'workflowDescription'
    | 'workflowStepDrafts'
    | 'workflowOrchestrationMode'
    | 'coordinatorAgentId'
    | 'agentIds'
    | 'executionMode'
    | 'updatedAt'
  > | null;
  agentBindings: Record<string, AgentBindingRecord>;
  agentIds: string[];
  t: (key: string, opts?: Record<string, unknown>) => string;
  saving?: boolean;
  readOnly?: boolean;
  unsavedCloseMessage: string;
  onClose: () => void;
  onSave: (patch: {
    title: string;
    featureDescription: string;
    description: string;
    workflowStepDrafts: WorkflowStepDraftRow[];
    workflowOrchestrationMode: WorkflowOrchestrationMode;
    heuristicWorkflowDescription: string;
    agentIds?: string[];
    coordinatorAgentId?: string;
    executionMode: OfficeTaskExecutionMode;
    workflowEngine: OfficeWorkflowEngine;
    workflow: WorkflowDefinition;
    langGraphTab: LangGraphWorkflowSource;
    langGraphWorkflowBundle?: LangGraphWorkflowBundle;
    langGraphCustomJsonDraft?: string;
  }) => Promise<void>;
}

export function TaskEditDialog({
  project,
  group,
  agentBindings,
  t,
  saving = false,
  readOnly = false,
  unsavedCloseMessage,
  onClose,
  onSave,
}: TaskEditDialogProps) {
  const agents = useAgentsStore((s) => s.agents);
  const lookup = (id: string) => agents.find((a) => a.id === id)?.name;
  const archivedRestartLocked = projectShowsArchivedRestartBadge(project);
  const spawnedFromGroup = isFixedGroupSpawnedProject(project, group);
  const canEditMembers = canEditProjectMembers(project, { readOnly, archivedRestartLocked, parentGroup: group });
  const canUnbindMissingMembers = canUnbindMissingSpawnedProjectMembers(project, {
    readOnly,
    archivedRestartLocked,
    parentGroup: group,
  });
  const memberPoolInteractionMode = canEditMembers
    ? 'full'
    : canUnbindMissingMembers
      ? 'unbind-missing'
      : 'view';
  const [memberAgentIds, setMemberAgentIds] = useState(() => {
    const display = displayAgentsForProject(project, group);
    return ensureMissingCoordinatorInRoster(display.agentIds, display.coordinatorAgentId);
  });
  const [memberCoordinatorId, setMemberCoordinatorId] = useState(() =>
    displayAgentsForProject(project, group).coordinatorAgentId,
  );
  const pickerAgents = useMemo(() => {
    if (!canEditMembers || !spawnedFromGroup || !group) return agents;
    if (!isSmartTask(project)) return agents;
    const pool = new Set([...group.agentIds, ...memberAgentIds]);
    return agents.filter((a) => pool.has(a.id));
  }, [agents, canEditMembers, group, memberAgentIds, project, spawnedFromGroup]);
  // Live roster (incl. missing ghosts) — view / unbind-missing / full all share this state.
  const displayAgentIds = memberAgentIds;
  const knownDisplayAgentIds = filterKnownAgentIds(displayAgentIds, agents);
  const teamMembers = projectMembersFromIds(knownDisplayAgentIds, lookup);
  const displayCoordinatorId = preserveCoordinatorForSave({
    coordinatorId: memberCoordinatorId,
    agentIds: memberAgentIds,
    catalogAgentIds: agents.map((a) => a.id),
  });
  const showTeamMembersSection = displayAgentIds.length > 0;
  const [workflowGenerating, setWorkflowGenerating] = useState(false);
  const [savingLocal, setSavingLocal] = useState(false);
  const locked = saving || savingLocal || readOnly;
  const executionModeLocked = spawnedFromGroup;
  const orchestrationModeLocked =
    executionModeLocked && Boolean(group && spawnedProjectOrchestrationModeLocked(group));
  const runnerModeDisabled = locked || (archivedRestartLocked && spawnedFromGroup) || executionModeLocked;

  const [form, setForm] = useState<TaskEditFormState>(() =>
    buildTaskEditFormStateFromProject(
      project,
      group,
      lookup,
      useAgentsStore.getState().agents.map((a) => a.id),
    ),
  );
  const formRef = useRef(form);
  useEffect(() => {
    formRef.current = form;
  }, [form]);

  const [orchestrationBaseline, setOrchestrationBaseline] = useState(() => {
    const initial = buildTaskEditFormStateFromProject(
      project,
      group,
      lookup,
      useAgentsStore.getState().agents.map((a) => a.id),
    );
    return orchestrationBaselineSnapshot({
      orchestrationMode: initial.workflowOrchestrationMode,
      heuristicDescription: initial.heuristicWorkflowDescription,
      workflowStepDrafts: initial.workflowStepDrafts,
    });
  });

  useEffect(() => {
    const catalogIds = agents.map((a) => a.id);
    const next = buildTaskEditFormStateFromProject(project, group, lookup, catalogIds);
    setForm(next);
    setOrchestrationBaseline(
      orchestrationBaselineSnapshot({
        orchestrationMode: next.workflowOrchestrationMode,
        heuristicDescription: next.heuristicWorkflowDescription,
        workflowStepDrafts: next.workflowStepDrafts,
      }),
    );
    const openAgents = displayAgentsForProject(project, group);
    setMemberAgentIds(
      ensureMissingCoordinatorInRoster(openAgents.agentIds, openAgents.coordinatorAgentId),
    );
    setMemberCoordinatorId(openAgents.coordinatorAgentId);
    // Rebuild when switching projects or when parent group id resolves on open
    // (group may be null on first paint then load — still "open once").
    // Do NOT depend on group.updatedAt: mid-edit group sync would wipe unsaved edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional open-time sync keys
  }, [project.id, group?.id]);

  const dirtyParams = useMemo(
    () => ({
      form,
      project,
      group,
      memberAgentIds,
      memberCoordinatorId,
      canEditMembers,
      canUnbindMissingMembers,
      executionModeLocked,
      orchestrationModeLocked,
      archivedRestartLocked,
      lookup,
      catalogAgentIds: agents.map((a) => a.id),
    }),
    [
      form,
      project,
      group,
      memberAgentIds,
      memberCoordinatorId,
      canEditMembers,
      canUnbindMissingMembers,
      executionModeLocked,
      orchestrationModeLocked,
      archivedRestartLocked,
      lookup,
      agents,
    ],
  );

  const dirty = useMemo(() => computeTaskEditDirty(dirtyParams), [dirtyParams]);

  const effectiveOrchestrationMode =
    shouldUseWorkflowFreezeSnapshot(project)
      ? form.workflowOrchestrationMode
      : orchestrationModeLocked && group
        ? orchestrationModeFromGroup(group)
        : form.workflowOrchestrationMode;

  const runnerMode = taskRunnerModeFromFields(form.executionMode, form.workflowEngine);
  const workflowMode = isWorkflowRunnerMode(runnerMode);
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
  const spawnFromGroup = spawnedFromGroup;
  const baselineHasMaterializedWorkflow = useMemo(
    () => projectWorkflowForForm(project, group).nodes.length > 0,
    [project, group],
  );

  const dagPreviewCtrl = useOfficeDagWorkflowPreview({
    executionMode: form.executionMode,
    orchestrationMode: effectiveOrchestrationMode,
    workflowStepDrafts: form.workflowStepDrafts,
    heuristicDescription: form.heuristicWorkflowDescription,
    workflow: form.workflow,
    members: teamMembers,
    agentIds: displayAgentIds,
    coordinatorAgentId: displayCoordinatorId,
    taskTitle: form.title,
    featureDescription: form.featureDescription,
    orchestrationBaseline,
    baselineHasMaterializedWorkflow,
    enabled: workflowMode && form.workflowEngine === 'dag',
  });

  // Once the DAG has been (re)generated at least once, its node ids are fresh
  // (the generator only ever fills from the current known team) — the frozen
  // open-snapshot missing-agent badge is no longer meaningful for those nodes.
  // See `WorkflowVisualPreview`'s `nodesRegenerated` prop.
  const [dagWorkflowRegenerated, setDagWorkflowRegenerated] = useState(false);
  const dagPreviewBinding = useMemo(
    () => ({
      isStale: dagPreviewCtrl.isStale,
      isPreviewing: dagPreviewCtrl.isPreviewing,
      previewDisabled: locked,
      onPreview: async () => {
        const result = await dagPreviewCtrl.runPreview();
        if (result.ok) {
          setForm((prev) => ({ ...prev, workflow: result.workflow }));
          setWorkflowGenerating(false);
          setDagWorkflowRegenerated(true);
        }
        return result;
      },
    }),
    [dagPreviewCtrl, locked],
  );

  const usesDagPreview = workflowMode && form.workflowEngine === 'dag';
  const previewBusy =
    saving
    || savingLocal
    || (usesDagPreview ? dagPreviewCtrl.isPreviewing : workflowGenerating);
  const hasUnsavedChanges =
    dirty
    || orchestrationChangedFromBaseline(dagPreviewCtrl.orchestration, orchestrationBaseline);
  const catalogIds = useMemo(() => agents.map((a) => a.id), [agents]);
  // `workflowOverride` lets handleSaveClick re-evaluate the gate against the
  // just-resolved/regenerated DAG workflow (post `resolveDagWorkflowForSave`),
  // instead of the possibly-stale pre-regenerate `form.workflow` — this is what
  // makes "fix a step row → save" work without first requiring a manual click
  // on "预览工作流".
  const buildMissingSaveModelFor = useCallback((workflowOverride?: WorkflowDefinition) => {
    const openSnap = form.openAgentRefSnapshot ?? {
      agentIds: project.agentIds,
      coordinatorAgentId: project.coordinatorAgentId,
      workflow: form.sessionStripSnapshot?.persistedWorkflow,
      workflowStepDrafts: form.sessionStripSnapshot?.persistedWorkflowStepDrafts,
      langGraphWorkflowBundle: project.langGraphWorkflowBundle,
      agentNameHints: project.agentNameHints,
    };
    // LangGraph keeps the active branch in both `form.workflow` and the bundle;
    // gate collection must not count the mirrored branch twice.
    const currentWorkflow =
      form.workflowEngine === 'langgraph'
        ? emptyWorkflow('dag')
        : (workflowOverride ?? form.workflow);
    return buildOfficeMissingAgentsModel({
      entity: openSnap,
      currentEntity: {
        agentIds: memberAgentIds,
        coordinatorAgentId: memberCoordinatorId,
        workflow: currentWorkflow,
        workflowStepDrafts: form.workflowStepDrafts,
        langGraphWorkflowBundle: form.langGraphWorkflowBundle,
        agentNameHints: project.agentNameHints,
      },
      catalogAgentIds: catalogIds,
      langGraphActiveSource: form.langGraphTab,
    });
  }, [
    catalogIds,
    form.langGraphTab,
    form.langGraphWorkflowBundle,
    form.openAgentRefSnapshot,
    form.sessionStripSnapshot,
    form.workflow,
    form.workflowEngine,
    form.workflowStepDrafts,
    memberAgentIds,
    memberCoordinatorId,
    project.agentIds,
    project.agentNameHints,
    project.coordinatorAgentId,
    project.langGraphWorkflowBundle,
  ]);
  const missingSaveModel = useMemo(
    () => buildMissingSaveModelFor(),
    [buildMissingSaveModelFor],
  );
  const editGateMissingBadgeByKey = useMemo(
    () => nodeMissingBadgeByKey(missingSaveModel.nodes),
    [missingSaveModel.nodes],
  );
  const langGraphMissingKeySource = form.langGraphTab
    ?? form.langGraphWorkflowBundle?.activeSource
    ?? 'heuristic';
  const missingSaveNeedsConfirm = missingSaveModel.saveGate === 'confirm';
  // Missing-agents block/confirm no longer gray out the Save button — the
  // check now runs after the user clicks Save (see handleSaveClick), so it can
  // be evaluated against the freshly regenerated workflow instead of a
  // possibly-stale pre-preview snapshot. Only unrelated reasons (readOnly,
  // busy, required fields, no members, no changes) still disable the button.
  const effectiveUnsavedChanges = hasUnsavedChanges || missingSaveNeedsConfirm;
  const saveDisabled = isTaskEditSaveDisabled({
    ...dirtyParams,
    previewBusy,
    displayAgentIds,
    readOnly,
    hasUnsavedChanges: effectiveUnsavedChanges,
  });

  const patchWorkflowStepDrafts = useCallback((workflowStepDrafts: WorkflowStepDraftRow[]) => {
    setForm((prev) => ({ ...prev, workflowStepDrafts }));
  }, []);

  const willRegenerateOnSave = workflowMode && form.workflowEngine === 'dag' && dagPreviewCtrl.isStale;

  const langGraphMissingLabel = useMemo(() => {
    if (!ENABLE_LANGGRAPH || form.workflowEngine !== 'langgraph') return '';
    const entity = {
      agentIds: displayAgentIds,
      coordinatorAgentId: displayCoordinatorId,
      workflow: form.workflow,
      workflowStepDrafts: form.workflowStepDrafts,
      langGraphWorkflowBundle: form.langGraphWorkflowBundle,
      agentNameHints: project.agentNameHints,
    };
    if (!hasMissingOfficeAgents(entity, catalogIds)) return '';
    const nameById = mergeAgentNameMaps(project.agentNameHints, nameMapFromAgents(agents));
    return formatMissingAgentsLabelForIds(
      missingAgentsForOfficeEntity(entity, catalogIds),
      nameById,
      (key, options) => t(key, options),
    );
  }, [
    agents,
    catalogIds,
    displayAgentIds,
    displayCoordinatorId,
    form.langGraphWorkflowBundle,
    form.workflow,
    form.workflowEngine,
    form.workflowStepDrafts,
    project.agentNameHints,
    t,
  ]);

  const handleSaveClick = useCallback(async () => {
    if (previewBusy) return;
    if (!hasUnsavedChanges && !missingSaveNeedsConfirm) return;
    setSavingLocal(true);
    try {
      let workflow = form.workflow;
      let forcePersistCurrent = false;
      let resolvedForGate = false;
      if (workflowMode && form.workflowEngine === 'dag') {
        const previousWorkflow = form.workflow;
        const resolved = await resolveDagWorkflowForSave({
          executionMode: archivedRestartLocked && spawnedFromGroup ? taskExecutionMode(project) : form.executionMode,
          spawnFromGroup,
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
          workflow: form.workflow,
          members: teamMembers,
          agentIds: displayAgentIds,
          coordinatorAgentId: displayCoordinatorId,
          taskTitle: form.title,
          featureDescription: form.featureDescription,
        });
        if (!resolved.ok) {
          toast.error(t(resolved.errorKey));
          return;
        }
        if (willRegenerateOnSave) forcePersistCurrent = true;
        workflow = resolved.workflow;
        resolvedForGate = true;
        // Write back immediately so preview/gate share the resolved DAG. Do NOT
        // markPreviewSynced yet — only after the missing-agents gate clears.
        setForm((prev) => ({ ...prev, workflow: resolved.workflow }));
        if (shouldFlagDagNodesRegeneratedOnSaveResolve({
          willRegenerateOnSave,
          previousWorkflow,
          resolvedWorkflow: resolved.workflow,
        })) {
          setDagWorkflowRegenerated(true);
        }
      }

      // Missing-agents gate runs post-click, against the resolved workflow.
      const gateModel = buildMissingSaveModelFor(workflow);
      if (gateModel.saveGate === 'block') {
        toast.error(
          formatOfficeSaveBlockedMessage(gateModel.saveBlockReasons, (key) => t(key)),
        );
        return;
      }
      if (gateModel.saveGate === 'confirm') {
        const nameById = mergeAgentNameMaps(project.agentNameHints, nameMapFromAgents(agents));
        const label = formatMissingAgentsLabelForIds(
          gateModel.confirmMissingIds,
          nameById,
          (key, options) => t(key, options),
        );
        if (!window.confirm(t('missingAgents.confirmSave', { label }))) return;
      }

      if (
        resolvedForGate
        && shouldMarkPreviewSyncedAfterMissingAgentsGate(gateModel.saveGate, true)
      ) {
        dagPreviewCtrl.markPreviewSynced();
      }

      const restored = applySessionOnlyStripOnSave(
        {
          workflow,
          workflowStepDrafts: form.workflowStepDrafts,
        },
        form.sessionStripSnapshot,
        { forcePersistCurrent },
      );
      await onSave({
        title: archivedRestartLocked && spawnedFromGroup ? project.title.trim() : form.title.trim(),
        featureDescription: form.featureDescription,
        description: form.description,
        workflowStepDrafts: restored.workflowStepDrafts,
        workflowOrchestrationMode: effectiveOrchestrationMode,
        heuristicWorkflowDescription: form.heuristicWorkflowDescription,
        ...(canEditMembers || canUnbindMissingMembers
          ? {
            agentIds: memberAgentIds,
            coordinatorAgentId: preserveCoordinatorForSave({
              coordinatorId: memberCoordinatorId,
              agentIds: memberAgentIds,
              catalogAgentIds: agents.map((a) => a.id),
            }),
          }
          : {}),
        executionMode: archivedRestartLocked && spawnedFromGroup
          ? taskExecutionMode(project)
          : form.executionMode,
        workflowEngine: archivedRestartLocked && spawnedFromGroup
          ? taskWorkflowEngine(project)
          : form.workflowEngine,
        workflow: restored.workflow,
        langGraphTab: form.langGraphTab,
        langGraphWorkflowBundle: form.langGraphWorkflowBundle,
        langGraphCustomJsonDraft: form.langGraphCustomJsonDraft,
      });
    } finally {
      setSavingLocal(false);
    }
  }, [
    agents,
    archivedRestartLocked,
    buildMissingSaveModelFor,
    canEditMembers,
    canUnbindMissingMembers,
    dagPreviewCtrl,
    hasUnsavedChanges,
    displayAgentIds,
    displayCoordinatorId,
    effectiveOrchestrationMode,
    form,
    group?.workflow,
    memberAgentIds,
    memberCoordinatorId,
    missingSaveNeedsConfirm,
    onSave,
    orchestrationBaseline,
    previewBusy,
    project,
    spawnFromGroup,
    t,
    teamMembers,
    workflowMode,
    willRegenerateOnSave,
  ]);

  const workflowDescriptionSatisfied = form.workflowEngine === 'dag' && effectiveOrchestrationMode === 'heuristic'
    ? Boolean(form.heuristicWorkflowDescription.trim())
    : isWorkflowDescriptionSatisfied(
      project,
      group,
      form.description,
      form.workflowStepDrafts,
    );

  const handleRequestClose = () => {
    requestCloseOfficeDraft({
      dirty,
      onClose,
      message: unsavedCloseMessage,
    });
  };

  return (
    <TaskFormDialogShell
      testId="office-task-edit-dialog"
      size={workflowMode ? 'tall' : 'default'}
      title={
        <>
          {t('taskForm.editTitle')}
          {readOnly ? (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 align-middle text-[11px] font-sans font-normal text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
              {t('viewOnlyRunning')}
            </span>
          ) : null}
        </>
      }
      onClose={handleRequestClose}
      footer={
        <>
          <Button variant="outline" size="sm" onClick={handleRequestClose} disabled={previewBusy}>
            {readOnly ? t('close') : t('wizard.cancel')}
          </Button>
          {readOnly ? null : (
            <Button
              size="sm"
              disabled={saveDisabled}
              data-testid="office-task-edit-save"
              onClick={() => void handleSaveClick()}
            >
              {savingLocal && willRegenerateOnSave
                ? t('workflow.generateRunning')
                : previewBusy
                  ? t('taskForm.saving')
                  : t('taskForm.save')}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {executionModeLocked && !archivedRestartLocked ? (
          <div
            className="rounded-lg border border-border/40 bg-muted/10 px-3 py-2"
            data-testid="office-task-edit-inherited-mode"
          >
            <p className="text-[11px] text-muted-foreground">{t('taskForm.inheritedExecutionMode')}</p>
            <p className="mt-1 inline-flex items-center text-xs font-semibold">
              {(group ? fixedGroupExecutionMode(group) : taskExecutionMode(project)) === 'smart'
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
            disabled={runnerModeDisabled}
            onChange={(mode: TaskRunnerMode) => {
              const { executionMode, workflowEngine } = taskRunnerModeToFields(mode);
              if (mode === 'smart') {
                setForm((prev) => ({
                  ...prev,
                  executionMode,
                  workflowEngine,
                  workflow: emptyWorkflow('dag'),
                }));
                return;
              }
              if (mode === 'langgraph' && ENABLE_LANGGRAPH) {
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
              setForm((prev) => ({
                ...prev,
                executionMode,
                workflowEngine,
                langGraphWorkflowBundle: undefined,
              }));
            }}
          />
        )}

        <TaskFormField>
          <Label htmlFor="office-task-title">{t('taskForm.title')}</Label>
          <Input
            id="office-task-title"
            value={form.title}
            disabled={locked || (archivedRestartLocked && spawnedFromGroup)}
            className={officeFormFieldClass('h-9')}
            onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
            data-testid="office-task-edit-title"
          />
        </TaskFormField>
        <TaskFormField>
          <Label htmlFor="office-task-feature">{t('taskForm.featureDescription')}</Label>
          <Textarea
            id="office-task-feature"
            value={form.featureDescription}
            disabled={locked}
            className={officeFormFieldClass('min-h-[4.5rem] resize-y')}
            onChange={(e) => setForm((prev) => ({ ...prev, featureDescription: e.target.value }))}
            rows={2}
            data-testid="office-task-edit-feature-description"
          />
        </TaskFormField>
        {showTeamMembersSection ? (
          <div
            className={cn(
              // Dim only when the team strip is truly view-only. Unbind-missing
              // (incl. archived-restarted active projects) must remain clickable.
              archivedRestartLocked
                && memberPoolInteractionMode === 'view'
                && 'pointer-events-none opacity-60',
            )}
            data-testid={
              archivedRestartLocked && memberPoolInteractionMode === 'view'
                ? 'office-task-edit-team-locked'
                : undefined
            }
          >
            <AgentPoolPicker
              agents={pickerAgents}
              selectedAgentIds={memberAgentIds}
              coordinatorAgentId={memberCoordinatorId}
              agentBindings={agentBindings}
              bindingScope={{ kind: 'temp_project', entityId: project.id }}
              agentNameHints={project.agentNameHints}
              disabled={locked}
              interactionMode={memberPoolInteractionMode}
              layout="split"
              onChange={({ agentIds: nextAgentIds, coordinatorAgentId: nextCoordinatorId, removedAgentIds }) => {
                if (memberPoolInteractionMode === 'view') return;
                setMemberAgentIds(nextAgentIds);
                setMemberCoordinatorId(nextCoordinatorId);
                if (removedAgentIds && removedAgentIds.length > 0) {
                  const remove = new Set(removedAgentIds);
                  setForm((prev) => {
                    const stripped = stripAgentIdsFromOfficeWorkflowRefs(prev, removedAgentIds);
                    return {
                      ...stripped,
                      stepMissingAgentIds: (prev.stepMissingAgentIds ?? []).map((ids) =>
                        ids.filter((id) => !remove.has(id)),
                      ),
                    };
                  });
                }
              }}
            />
          </div>
        ) : null}
          {workflowMode && displayAgentIds.length > 0 ? <TaskFormWorkflowSeparator /> : null}
          {showOrchestrationMode ? (
            <WorkflowOrchestrationModeField
              value={effectiveOrchestrationMode}
              locked={orchestrationModeLocked}
              disabled={locked}
              onChange={(workflowOrchestrationMode) =>
                setForm((prev) => ({ ...prev, workflowOrchestrationMode }))}
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
              disabled={locked}
              required={!workflowDescriptionSatisfied}
              id="office-task-desc"
              testId="office-task-edit-description"
              enhanceAgentId={memberCoordinatorId}
              onChange={(next) => {
                if (form.workflowEngine === 'dag') {
                  setForm((prev) => ({ ...prev, heuristicWorkflowDescription: next }));
                  return;
                }
                setForm((prev) => ({ ...prev, description: next }));
              }}
            />
        ) : null}

        {workflowMode && structuredOrchestration && showStepDrafts && displayAgentIds.length > 0 ? (
          <OfficeStructuredWorkflowPanel
            stepDrafts={(
              <WorkflowStepDraftsField
                rows={form.workflowStepDrafts}
                memberAgentIds={knownDisplayAgentIds}
                agents={agents}
                disabled={locked}
                embedded
                userCheckpointEditable={form.workflowEngine === 'dag'}
                testId="office-task-edit-step-drafts"
                stepMissingAgentIds={form.stepMissingAgentIds}
                agentNameHints={project.agentNameHints}
                onClearStepMissing={(index) =>
                  setForm((prev) => ({
                    ...prev,
                    stepMissingAgentIds: (prev.stepMissingAgentIds ?? []).map((ids, i) =>
                      (i === index ? [] : ids),
                    ),
                  }))
                }
                onRemoveStepMissing={(index) =>
                  setForm((prev) => ({
                    ...prev,
                    stepMissingAgentIds: (prev.stepMissingAgentIds ?? []).filter((_, i) => i !== index),
                  }))
                }
                onChange={patchWorkflowStepDrafts}
              />
            )}
            preview={(
              <ScenarioWorkflowSection
                workflow={form.workflow}
                teamMembers={teamMembers}
                agentIds={displayAgentIds}
                coordinatorAgentId={displayCoordinatorId}
                taskTitle={form.title}
                taskFeatureDescription={form.featureDescription}
                taskDescription=""
                workflowStepDrafts={form.workflowStepDrafts}
                workflowEngine={form.workflowEngine}
                structuredOrchestration
                embedded
                sectionHintKey="workflow.sectionHintStructured"
                disabled={locked}
                orchestrationMode={effectiveOrchestrationMode}
                dagPreview={form.workflowEngine === 'dag' ? dagPreviewBinding : undefined}
                onGeneratingChange={setWorkflowGenerating}
                onChange={({ workflow }) => setForm((prev) => ({ ...prev, workflow }))}
                editGateMissingBadgeByKey={editGateMissingBadgeByKey}
                langGraphMissingKeySource={langGraphMissingKeySource}
                nodesRegenerated={dagWorkflowRegenerated}
              />
            )}
          />
        ) : null}

        {displayAgentIds.length === 0 ? (
          <p className="rounded-lg border border-amber-200/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
            {t('agentPool.needAgentsFirst')}
          </p>
        ) : null}

        {displayAgentIds.length > 0 && workflowMode && !structuredOrchestration ? (
          <div className="office-form-scroll-section space-y-4">
            {ENABLE_LANGGRAPH && form.workflowEngine === 'langgraph' ? (
              <div className="space-y-3">
                {langGraphMissingLabel ? (
                  <div
                    className="rounded-lg border border-destructive/50 bg-destructive/5 px-3 py-2 text-[11px] text-destructive"
                    data-testid="office-task-edit-langgraph-missing"
                  >
                    <p className="font-medium">{langGraphMissingLabel}</p>
                    <p className="mt-1 text-destructive/90">
                      {orchestrationModeLocked
                        ? t('missingAgents.langGraphHintLocked')
                        : t('missingAgents.langGraphHint')}
                    </p>
                  </div>
                ) : null}
                <LangGraphWorkflowSection
                  workflow={form.workflow}
                  langGraphWorkflowBundle={form.langGraphWorkflowBundle}
                  teamMembers={teamMembers}
                  disabled={locked}
                  editGateMissingBadgeByKey={editGateMissingBadgeByKey}
                  langGraphMissingKeySource={langGraphMissingKeySource}
                  onChange={({ workflow, langGraphTab, langGraphWorkflowBundle, langGraphCustomJsonDraft }) =>
                    setForm((prev) => ({
                      ...prev,
                      workflow,
                      langGraphTab,
                      langGraphWorkflowBundle,
                      langGraphCustomJsonDraft,
                    }))
                  }
                  langGraphCustomJsonDraft={form.langGraphCustomJsonDraft}
                />
              </div>
            ) : (
              <ScenarioWorkflowSection
                workflow={form.workflow}
                teamMembers={teamMembers}
                agentIds={displayAgentIds}
                coordinatorAgentId={displayCoordinatorId}
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
                disabled={locked}
                orchestrationMode={effectiveOrchestrationMode}
                dagPreview={form.workflowEngine === 'dag' ? dagPreviewBinding : undefined}
                onGeneratingChange={setWorkflowGenerating}
                onChange={({ workflow }) => setForm((prev) => ({ ...prev, workflow }))}
                editGateMissingBadgeByKey={editGateMissingBadgeByKey}
                langGraphMissingKeySource={langGraphMissingKeySource}
                nodesRegenerated={dagWorkflowRegenerated}
              />
            )}
          </div>
        ) : null}
      </div>
    </TaskFormDialogShell>
  );
}
