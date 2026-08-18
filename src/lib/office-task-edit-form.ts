import {
  heuristicDescriptionForForm,
  orchestrationModeFromGroup,
  orchestrationModeFromProject,
  type WorkflowOrchestrationMode,
} from '@/lib/office-workflow-orchestration-mode';
import { spawnedProjectOrchestrationModeLocked, isFixedGroupSpawnedProject } from '@/lib/office-fixed-group';
import { projectShowsArchivedRestartBadge } from '@/lib/office-project-source-badge';
import { isSmartTask, taskExecutionMode } from '@/lib/office-task-execution-mode';
import {
  isWorkflowRunnerMode,
  taskRunnerModeFromFields,
} from '@/lib/office-task-runner-mode';
import {
  langGraphWorkflowDescriptionRequired,
  resolveLangGraphBranchWorkflow,
} from '@/lib/office-langgraph-workflow-bundle';
import {
  isWorkflowDescriptionSatisfied,
  displayAgentsForProject,
  workflowDescriptionForProject,
  workflowForProject,
  workflowStepDraftsForProject,
} from '@/lib/office-task-workflow';
import { shouldUseWorkflowFreezeSnapshot } from '@/lib/office-spawned-workflow-ownership';
import { taskWorkflowEngine } from '@/lib/office-workflow-engine';
import { emptyWorkflow } from '@/lib/office-workflow-roles';
import { projectMembersFromIds } from '@/lib/office-project-members';
import {
  buildSessionStripWorkflowSnapshot,
  ensureMissingCoordinatorInRoster,
  missingDraftRowAgentIds,
  sanitizeOfficeWorkflowRefsOnEditOpen,
  type OfficeAgentRefEntity,
  type SessionStripWorkflowSnapshot,
} from '@/lib/office-missing-agents';
import {
  resolveWorkflowStepDraftRows,
  workflowStepDraftsGenerationKey,
} from '@/lib/office-workflow-step-drafts';
import type {
  LangGraphWorkflowBundle,
  LangGraphWorkflowSource,
  OfficeFixedGroup,
  OfficeTempProject,
  OfficeTaskExecutionMode,
  OfficeWorkflowEngine,
  WorkflowDefinition,
  WorkflowStepDraftRow,
} from '@/types/office';

export type TaskEditFormState = {
  title: string;
  featureDescription: string;
  description: string;
  executionMode: OfficeTaskExecutionMode;
  workflowEngine: OfficeWorkflowEngine;
  workflow: WorkflowDefinition;
  langGraphTab: LangGraphWorkflowSource;
  langGraphWorkflowBundle?: LangGraphWorkflowBundle;
  langGraphCustomJsonDraft?: string;
  workflowStepDrafts: WorkflowStepDraftRow[];
  workflowOrchestrationMode: WorkflowOrchestrationMode;
  heuristicWorkflowDescription: string;
  stepMissingAgentIds?: string[][];
  sessionStripSnapshot?: SessionStripWorkflowSnapshot;
  /** Pre-strip refs for missing-agents saveGate / node badges. */
  openAgentRefSnapshot?: OfficeAgentRefEntity;
};

export function projectWorkflowForForm(
  project: OfficeTempProject,
  group?: Pick<OfficeFixedGroup, 'workflow'> | null,
): WorkflowDefinition {
  const wf = workflowForProject(project, group);
  return wf.nodes.length > 0 ? { ...wf, mode: 'dag' } : emptyWorkflow('dag');
}

export function buildTaskEditFormStateFromProject(
  project: OfficeTempProject,
  group?: Pick<
    OfficeFixedGroup,
    | 'workflow'
    | 'workflowDescription'
    | 'workflowStepDrafts'
    | 'workflowOrchestrationMode'
    | 'agentIds'
    | 'coordinatorAgentId'
  > | null,
  memberLookup: (id: string) => string | undefined = () => undefined,
  catalogAgentIds?: string[],
): TaskEditFormState {
  const bundle = project.langGraphWorkflowBundle;
  const customBranch = resolveLangGraphBranchWorkflow(bundle, 'custom');
  const heuristicBranch = resolveLangGraphBranchWorkflow(bundle, 'heuristic');
  const wf = projectWorkflowForForm(project, group);
  const display = displayAgentsForProject(project, group);
  const memberIds = display.agentIds;
  const effectiveDescription = workflowDescriptionForProject(project, group);
  const workflowOrchestrationMode = shouldUseWorkflowFreezeSnapshot(project)
    ? (
      project.workflowFreezeSnapshot?.workflowOrchestrationMode
      ?? orchestrationModeFromProject(project, group)
    )
    : group && spawnedProjectOrchestrationModeLocked(group)
      ? orchestrationModeFromGroup(group)
      : (
        orchestrationModeFromProject(project, group)
      );
  const draftsBefore =
    workflowOrchestrationMode === 'rule'
      ? resolveWorkflowStepDraftRows(
        workflowStepDraftsForProject(project, group),
        undefined,
        projectMembersFromIds(memberIds, memberLookup),
      )
      : [];
  const catalog = catalogAgentIds ?? memberIds;
  const stepMissingAgentIds = draftsBefore.map((row) =>
    missingDraftRowAgentIds(row.agentIds, catalog),
  );
  const workflowBefore = customBranch
    ? structuredClone(customBranch)
    : heuristicBranch
      ? structuredClone(heuristicBranch)
      : structuredClone(wf);
  const draftsSnapshot = structuredClone(draftsBefore);
  const workflowSnapshot = structuredClone(workflowBefore);
  const bundleSnapshot = bundle ? structuredClone(bundle) : undefined;
  const openAgentRefSnapshot: OfficeAgentRefEntity = {
    agentIds: [...memberIds],
    coordinatorAgentId: display.coordinatorAgentId,
    // Avoid double-counting LangGraph branch as both `workflow` and bundle in edit gate.
    // Must NOT substitute the legacy/persisted DAG mirror field here: it is only
    // resynced on save and can retain stale ghost refs unrelated to the currently
    // active LangGraph branch, which would leak into confirmMissingIds/saveGate
    // with no way for the user to see or fix it in the LangGraph editor.
    workflow: taskWorkflowEngine(project) === 'langgraph'
      ? emptyWorkflow('dag')
      : workflowSnapshot,
    workflowStepDrafts: draftsSnapshot,
    langGraphWorkflowBundle: bundleSnapshot,
    agentNameHints: project.agentNameHints ? { ...project.agentNameHints } : undefined,
  };
  const langGraphTab = bundle?.activeSource ?? 'heuristic';
  const sanitized = sanitizeOfficeWorkflowRefsOnEditOpen(
    {
      workflow: workflowBefore,
      workflowStepDrafts: draftsBefore,
      langGraphWorkflowBundle: bundleSnapshot,
      langGraphTab,
    },
    catalog,
  );
  const openWorkflow = sanitized.workflow ?? workflowBefore;
  const openDrafts =
    workflowOrchestrationMode === 'rule'
      ? (sanitized.workflowStepDrafts ?? [])
      : [];
  return {
    title: project.title,
    featureDescription: project.featureDescription ?? '',
    description: effectiveDescription,
    heuristicWorkflowDescription: heuristicDescriptionForForm({
      orchestrationMode: workflowOrchestrationMode,
      storedDescription: effectiveDescription,
    }),
    workflowStepDrafts: openDrafts,
    workflowOrchestrationMode,
    executionMode: taskExecutionMode(project),
    workflowEngine: taskWorkflowEngine(project),
    workflow: openWorkflow,
    langGraphTab,
    langGraphWorkflowBundle: sanitized.langGraphWorkflowBundle ?? bundleSnapshot,
    langGraphCustomJsonDraft:
      customBranch?.nodes?.length
        ? JSON.stringify(customBranch, null, 2)
        : '',
    stepMissingAgentIds,
    openAgentRefSnapshot,
    sessionStripSnapshot: buildSessionStripWorkflowSnapshot({
      persistedWorkflow: workflowSnapshot,
      persistedWorkflowStepDrafts: draftsSnapshot,
      openWorkflow,
      openWorkflowStepDrafts: openDrafts,
    }),
  };
}

export type ComputeTaskEditDirtyParams = {
  form: TaskEditFormState;
  project: OfficeTempProject;
  group?: Pick<
    OfficeFixedGroup,
    | 'workflow'
    | 'workflowDescription'
    | 'workflowStepDrafts'
    | 'workflowOrchestrationMode'
    | 'coordinatorAgentId'
    | 'agentIds'
  > | null;
  memberAgentIds: string[];
  memberCoordinatorId?: string;
  canEditMembers: boolean;
  /** Spawned workflow: X on missing chips counts as dirty even when full edit is locked. */
  canUnbindMissingMembers?: boolean;
  executionModeLocked: boolean;
  orchestrationModeLocked: boolean;
  archivedRestartLocked: boolean;
  lookup: (id: string) => string | undefined;
  /** Current agent catalog ids — must match buildTaskEditFormStateFromProject sanitize. */
  catalogAgentIds?: string[];
};

export function computeTaskEditDirty(params: ComputeTaskEditDirtyParams): boolean {
  const {
    form,
    project,
    group,
    memberAgentIds,
    memberCoordinatorId,
    canEditMembers,
    canUnbindMissingMembers = false,
    executionModeLocked,
    orchestrationModeLocked,
    archivedRestartLocked,
    lookup,
    catalogAgentIds,
  } = params;

  const catalog = catalogAgentIds ?? project.agentIds;
  // Match TaskEditDialog open-time roster push so missing coordinator alone is not dirty.
  // Spawned inheriting projects open with the group roster (displayAgentsForProject).
  const openDisplayAgents = displayAgentsForProject(project, group);
  const baselineMemberAgentIds = ensureMissingCoordinatorInRoster(
    openDisplayAgents.agentIds,
    openDisplayAgents.coordinatorAgentId,
  );
  const baselineMemberCoordinatorId = openDisplayAgents.coordinatorAgentId ?? '';
  const baselineWorkflowRaw = projectWorkflowForForm(project, group);
  const baselineCustomBranchRaw = resolveLangGraphBranchWorkflow(project.langGraphWorkflowBundle, 'custom');
  const baselineCustomBranch = baselineCustomBranchRaw
    ? sanitizeOfficeWorkflowRefsOnEditOpen(
      { workflow: structuredClone(baselineCustomBranchRaw) },
      catalog,
    ).workflow ?? baselineCustomBranchRaw
    : undefined;
  const baselineWorkflow =
    sanitizeOfficeWorkflowRefsOnEditOpen(
      { workflow: structuredClone(baselineWorkflowRaw) },
      catalog,
    ).workflow ?? baselineWorkflowRaw;
  const baselineCustomJsonDraft =
    baselineCustomBranch?.nodes?.length
      ? JSON.stringify(baselineCustomBranch, null, 2)
      : '';
  const baselineDescription = workflowDescriptionForProject(project, group);
  const baselineOrchestrationMode = shouldUseWorkflowFreezeSnapshot(project)
    ? (
      project.workflowFreezeSnapshot?.workflowOrchestrationMode
      ?? orchestrationModeFromProject(project, group)
    )
    : orchestrationModeLocked && group
      ? orchestrationModeFromGroup(group)
      : orchestrationModeFromProject(project, group);
  const baselineStepDraftsRaw = resolveWorkflowStepDraftRows(
    workflowStepDraftsForProject(project, group),
    baselineDescription,
    projectMembersFromIds(project.agentIds, lookup),
  );
  const baselineStepDrafts =
    sanitizeOfficeWorkflowRefsOnEditOpen(
      { workflowStepDrafts: baselineStepDraftsRaw },
      catalog,
    ).workflowStepDrafts ?? baselineStepDraftsRaw;

  return (
    (!archivedRestartLocked && form.title.trim() !== project.title.trim()) ||
    form.featureDescription.trim() !== (project.featureDescription ?? '').trim() ||
    form.description !== baselineDescription ||
    form.heuristicWorkflowDescription !== heuristicDescriptionForForm({
      orchestrationMode: baselineOrchestrationMode,
      storedDescription: baselineDescription,
    }) ||
    (!orchestrationModeLocked
      && form.workflowOrchestrationMode !== baselineOrchestrationMode) ||
    workflowStepDraftsGenerationKey(form.workflowStepDrafts)
      !== workflowStepDraftsGenerationKey(baselineStepDrafts) ||
    (!executionModeLocked
      && !archivedRestartLocked
      && (form.executionMode !== taskExecutionMode(project)
        || form.workflowEngine !== taskWorkflowEngine(project))) ||
    JSON.stringify(form.langGraphWorkflowBundle) !== JSON.stringify(project.langGraphWorkflowBundle) ||
    JSON.stringify(form.workflow) !== JSON.stringify(baselineCustomBranch ?? baselineWorkflow) ||
    form.langGraphCustomJsonDraft !== baselineCustomJsonDraft ||
    ((canEditMembers || canUnbindMissingMembers)
      && (memberAgentIds.join(',') !== baselineMemberAgentIds.join(',')
        || (memberCoordinatorId ?? '') !== baselineMemberCoordinatorId))
  );
}

export type TaskEditSaveDisabledParams = ComputeTaskEditDirtyParams & {
  previewBusy: boolean;
  displayAgentIds: string[];
  readOnly?: boolean;
  /** When set, overrides computeTaskEditDirty for save enablement. */
  hasUnsavedChanges?: boolean;
};

export function explainTaskEditSaveDisabled(
  params: TaskEditSaveDisabledParams,
): { disabled: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (params.readOnly) reasons.push('readOnly');
  if (params.previewBusy) reasons.push('previewBusy');
  if (!params.form.title.trim()) reasons.push('emptyTitle');
  if (!params.form.featureDescription.trim()) reasons.push('emptyFeatureDescription');
  const hasUnsavedChanges = params.hasUnsavedChanges ?? computeTaskEditDirty(params);
  if (!hasUnsavedChanges) reasons.push('notDirty');
  if (params.displayAgentIds.length === 0) reasons.push('noDisplayAgents');

  const runnerMode = taskRunnerModeFromFields(params.form.executionMode, params.form.workflowEngine);
  const workflowMode = isWorkflowRunnerMode(runnerMode);
  const effectiveOrchestrationMode =
    params.orchestrationModeLocked && params.group
      ? orchestrationModeFromGroup(params.group)
      : params.form.workflowOrchestrationMode;
  const descriptionRequired =
    langGraphWorkflowDescriptionRequired(params.form.workflowEngine, params.form.langGraphTab)
    || (params.form.workflowEngine === 'dag' && effectiveOrchestrationMode === 'heuristic');
  const workflowDescriptionSatisfied =
    params.form.workflowEngine === 'dag' && effectiveOrchestrationMode === 'heuristic'
      ? Boolean(params.form.heuristicWorkflowDescription.trim())
      : isWorkflowDescriptionSatisfied(
        params.project,
        params.group,
        params.form.description,
        params.form.workflowStepDrafts,
      );
  if (workflowMode && descriptionRequired && !workflowDescriptionSatisfied) {
    reasons.push('workflowDescriptionUnsatisfied');
  }

  return { disabled: reasons.length > 0, reasons };
}

export function explainTaskEditDirty(params: ComputeTaskEditDirtyParams): Record<string, boolean> {
  const {
    form,
    project,
    group,
    memberAgentIds,
    memberCoordinatorId,
    canEditMembers,
    canUnbindMissingMembers = false,
    executionModeLocked,
    orchestrationModeLocked,
    archivedRestartLocked,
    lookup,
    catalogAgentIds,
  } = params;

  const catalog = catalogAgentIds ?? project.agentIds;
  // Match TaskEditDialog open-time roster push so missing coordinator alone is not dirty.
  // Spawned inheriting projects open with the group roster (displayAgentsForProject).
  const openDisplayAgents = displayAgentsForProject(project, group);
  const baselineMemberAgentIds = ensureMissingCoordinatorInRoster(
    openDisplayAgents.agentIds,
    openDisplayAgents.coordinatorAgentId,
  );
  const baselineMemberCoordinatorId = openDisplayAgents.coordinatorAgentId ?? '';
  const baselineWorkflowRaw = projectWorkflowForForm(project, group);
  const baselineCustomBranchRaw = resolveLangGraphBranchWorkflow(project.langGraphWorkflowBundle, 'custom');
  const baselineCustomBranch = baselineCustomBranchRaw
    ? sanitizeOfficeWorkflowRefsOnEditOpen(
      { workflow: structuredClone(baselineCustomBranchRaw) },
      catalog,
    ).workflow ?? baselineCustomBranchRaw
    : undefined;
  const baselineWorkflow =
    sanitizeOfficeWorkflowRefsOnEditOpen(
      { workflow: structuredClone(baselineWorkflowRaw) },
      catalog,
    ).workflow ?? baselineWorkflowRaw;
  const baselineCustomJsonDraft =
    baselineCustomBranch?.nodes?.length
      ? JSON.stringify(baselineCustomBranch, null, 2)
      : '';
  const baselineDescription = workflowDescriptionForProject(project, group);
  const baselineOrchestrationMode = shouldUseWorkflowFreezeSnapshot(project)
    ? (
      project.workflowFreezeSnapshot?.workflowOrchestrationMode
      ?? orchestrationModeFromProject(project, group)
    )
    : orchestrationModeLocked && group
      ? orchestrationModeFromGroup(group)
      : orchestrationModeFromProject(project, group);
  const baselineStepDraftsRaw = resolveWorkflowStepDraftRows(
    workflowStepDraftsForProject(project, group),
    baselineDescription,
    projectMembersFromIds(project.agentIds, lookup),
  );
  const baselineStepDrafts =
    sanitizeOfficeWorkflowRefsOnEditOpen(
      { workflowStepDrafts: baselineStepDraftsRaw },
      catalog,
    ).workflowStepDrafts ?? baselineStepDraftsRaw;

  return {
    title: !archivedRestartLocked && form.title.trim() !== project.title.trim(),
    featureDescription:
      form.featureDescription.trim() !== (project.featureDescription ?? '').trim(),
    description: form.description !== baselineDescription,
    heuristicDescription:
      form.heuristicWorkflowDescription !== heuristicDescriptionForForm({
        orchestrationMode: baselineOrchestrationMode,
        storedDescription: baselineDescription,
      }),
    orchestrationMode:
      !orchestrationModeLocked && form.workflowOrchestrationMode !== baselineOrchestrationMode,
    stepDrafts:
      workflowStepDraftsGenerationKey(form.workflowStepDrafts)
        !== workflowStepDraftsGenerationKey(baselineStepDrafts),
    execution:
      !executionModeLocked
      && !archivedRestartLocked
      && (form.executionMode !== taskExecutionMode(project)
        || form.workflowEngine !== taskWorkflowEngine(project)),
    langGraphBundle:
      JSON.stringify(form.langGraphWorkflowBundle) !== JSON.stringify(project.langGraphWorkflowBundle),
    workflow:
      JSON.stringify(form.workflow) !== JSON.stringify(baselineCustomBranch ?? baselineWorkflow),
    langGraphCustomJson: form.langGraphCustomJsonDraft !== baselineCustomJsonDraft,
    members:
      (canEditMembers || canUnbindMissingMembers)
      && (memberAgentIds.join(',') !== baselineMemberAgentIds.join(',')
        || (memberCoordinatorId ?? '') !== baselineMemberCoordinatorId),
  };
}

export function isTaskEditSaveDisabled(params: TaskEditSaveDisabledParams): boolean {
  return explainTaskEditSaveDisabled(params).disabled;
}

export function canEditProjectMembers(
  project: Pick<OfficeTempProject, 'executionMode' | 'parentGroupId'>,
  opts: {
    readOnly?: boolean;
    archivedRestartLocked?: boolean;
    parentGroup?: Pick<OfficeFixedGroup, 'id'> | null;
  } = {},
): boolean {
  if (opts.readOnly) return false;
  const spawned = isFixedGroupSpawnedProject(project, opts.parentGroup);
  if (!spawned) return true;
  if (opts.archivedRestartLocked) return false;
  return isSmartTask(project);
}

/**
 * Spawned workflow projects lock the full member pool, but still allow removing
 * catalog-missing (ghost) roster chips while active and not running.
 *
 * `archivedRestartLocked` must NOT block this by itself: an active
 * archived-restarted project is still "活跃且非运行" for missing-agent unbind.
 * Running / archived lifecycles are gated via `readOnly` / lifecycle checks.
 * When `archivedRestartLocked` also locks full member edit (smart spawned),
 * this mode still applies so missing chips keep their X.
 */
export function canUnbindMissingSpawnedProjectMembers(
  project: Pick<OfficeTempProject, 'executionMode' | 'parentGroupId' | 'lifecycle'>,
  opts: {
    readOnly?: boolean;
    archivedRestartLocked?: boolean;
    parentGroup?: Pick<OfficeFixedGroup, 'id'> | null;
  } = {},
): boolean {
  if (opts.readOnly) return false;
  if (project.lifecycle === 'completed' || project.lifecycle === 'dissolved' || project.lifecycle === 'upgraded') {
    return false;
  }
  const spawned = isFixedGroupSpawnedProject(project, opts.parentGroup);
  if (!spawned) return false;
  // When full bind/unbind is already available, prefer `full` interactionMode.
  if (canEditProjectMembers(project, opts)) return false;
  return true;
}

export function taskEditDialogFlags(
  project: OfficeTempProject,
  group?: Pick<OfficeFixedGroup, 'id' | 'workflowOrchestrationMode' | 'workflowStepDrafts'> | null,
): {
  archivedRestartLocked: boolean;
  canEditMembers: boolean;
  executionModeLocked: boolean;
  orchestrationModeLocked: boolean;
} {
  const archivedRestartLocked = projectShowsArchivedRestartBadge(project);
  const executionModeLocked = isFixedGroupSpawnedProject(project, group);
  return {
    archivedRestartLocked,
    canEditMembers: canEditProjectMembers(project, { archivedRestartLocked, parentGroup: group }),
    executionModeLocked,
    orchestrationModeLocked:
      executionModeLocked && Boolean(group && spawnedProjectOrchestrationModeLocked(group)),
  };
}
