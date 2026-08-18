/**
 * Spawned-project workflow ownership (fixed-group inherit vs own copy).
 *
 * ownsWorkflow ⇔ inheritsGroupTemplate === false (sticky once acquired).
 * No-own projects must not persist workflow payloads (except terminal freeze snapshot).
 */
import { isSmartTask } from '@/lib/office-task-execution-mode';
import { syncWorkflowEdges } from '@/lib/office-workflow-edges';
import { workflowNodeAgentIds } from '@/lib/office-workflow-node';
import {
  orchestrationModeFromGroup,
  orchestrationTemplateKey,
  type WorkflowOrchestrationMode,
} from '@/lib/office-workflow-orchestration-mode';
import { spawnedProjectOrchestrationModeLocked } from '@/lib/office-fixed-group';
import { isOfficeProjectArchived } from '@/lib/office-room-sidebar';
import type {
  LangGraphWorkflowBundle,
  OfficeFixedGroup,
  OfficeTempProject,
  TaskStatus,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowStepDraftRow,
} from '@/types/office';

export const EMPTY_OWNED_WORKFLOW: WorkflowDefinition = { mode: 'dag', nodes: [], edges: [] };

/**
 * Statuses that freeze the group workflow for no-own projects.
 * Only completed freezes; failed and user-aborted keep following the live group.
 */
export const SPAWNED_WORKFLOW_FREEZE_STATUSES: ReadonlySet<TaskStatus> = new Set([
  'completed',
]);

/** @deprecated Prefer {@link SPAWNED_WORKFLOW_FREEZE_STATUSES}; failed/aborted are no longer freeze-terminal. */
export const SPAWNED_WORKFLOW_TERMINAL_STATUSES: ReadonlySet<TaskStatus> = SPAWNED_WORKFLOW_FREEZE_STATUSES;

export type WorkflowFreezeSnapshot = {
  workflow: WorkflowDefinition;
  description: string;
  workflowStepDrafts?: WorkflowStepDraftRow[];
  workflowOrchestrationMode?: WorkflowOrchestrationMode;
  langGraphWorkflowBundle?: LangGraphWorkflowBundle;
  agentIds: string[];
  coordinatorAgentId: string;
  frozenAt: number;
  sourceGroupUpdatedAt?: number;
};

export type SpawnedWorkflowCompareInput = {
  executionMode?: OfficeTempProject['executionMode'];
  workflowEngine?: OfficeTempProject['workflowEngine'];
  workflow: WorkflowDefinition;
  description: string;
  heuristicWorkflowDescription?: string;
  workflowStepDrafts?: WorkflowStepDraftRow[];
  workflowOrchestrationMode?: WorkflowOrchestrationMode;
  agentIds?: string[];
  coordinatorAgentId?: string;
  langGraphWorkflowBundle?: LangGraphWorkflowBundle;
};

export function projectOwnsWorkflow(
  project: Pick<
    OfficeTempProject,
    'inheritsGroupTemplate' | 'workflow' | 'executionMode' | 'origin' | 'parentGroupId'
  >,
): boolean {
  // Explicit flag wins first (callers may omit origin on partial patches).
  if (project.inheritsGroupTemplate === false) return true;
  if (project.inheritsGroupTemplate === true) return false;
  if (isSmartTask(project as OfficeTempProject)) return true;
  const spawned = project.origin === 'fixed_group' || Boolean(project.parentGroupId?.trim());
  if (!spawned) return true;
  // Legacy spawned: non-empty DAG without flag ⇒ treated as owned.
  return (project.workflow?.nodes?.length ?? 0) > 0;
}

export function projectHasNoOwnWorkflow(
  project: Parameters<typeof projectOwnsWorkflow>[0],
): boolean {
  return !projectOwnsWorkflow(project);
}

export function isSpawnedWorkflowTerminalStatus(status: TaskStatus): boolean {
  return SPAWNED_WORKFLOW_FREEZE_STATUSES.has(status);
}

/** Whether effective preview/run should consume workflowFreezeSnapshot (completed only). */
export function shouldUseWorkflowFreezeSnapshot(
  project: Pick<
    OfficeTempProject,
    'inheritsGroupTemplate' | 'workflow' | 'executionMode' | 'origin' | 'parentGroupId'
  > & Partial<Pick<OfficeTempProject, 'status' | 'workflowFreezeSnapshot'>>,
): boolean {
  if (projectOwnsWorkflow(project)) return false;
  if (!hasWorkflowFreezeSnapshot(project)) return false;
  if (!project.status) return false;
  // failed / aborted must not keep a stale freeze; follow live group instead.
  if (project.status === 'failed' || project.status === 'aborted') return false;
  return SPAWNED_WORKFLOW_FREEZE_STATUSES.has(project.status);
}

export function hasWorkflowFreezeSnapshot(
  project: Pick<OfficeTempProject, 'workflowFreezeSnapshot'>,
): boolean {
  return Boolean(project.workflowFreezeSnapshot?.workflow);
}

export function workflowsStructurallyEqual(
  a: WorkflowDefinition,
  b: WorkflowDefinition,
): boolean {
  const left = canonicalizeWorkflowForCompare(a);
  const right = canonicalizeWorkflowForCompare(b);
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Normalize agentId vs agentIds and edges so form/group/freeze shapes compare equal. */
function canonicalizeWorkflowForCompare(wf: WorkflowDefinition): WorkflowDefinition {
  const synced = syncWorkflowEdges({ ...wf, mode: 'dag' });
  return {
    ...synced,
    nodes: synced.nodes.map((node): WorkflowNode => {
      const ids = workflowNodeAgentIds(node);
      const {
        agent: _agent,
        agents: _agents,
        role: _role,
        roles: _roles,
        roleId: _roleId,
        agentId: _agentId,
        agentIds: _agentIds,
        ...rest
      } = node as WorkflowNode & {
        agent?: string;
        agents?: string[];
        role?: string;
        roles?: string[];
        roleId?: string;
      };
      return {
        ...rest,
        agentId: ids[0] ?? '',
        ...(ids.length > 1 ? { agentIds: ids } : {}),
      };
    }),
  };
}

function rosterEqual(
  aIds: string[] | undefined,
  aCoord: string | undefined,
  bIds: string[],
  bCoord: string,
): boolean {
  if (!aIds) return true;
  const left = [...aIds].map((id) => id.trim()).filter(Boolean).sort();
  const right = [...bIds].map((id) => id.trim()).filter(Boolean).sort();
  if (left.join('\0') !== right.join('\0')) return false;
  return (aCoord ?? '').trim() === (bCoord ?? '').trim();
}

/**
 * True when save/spawn payload differs from the fixed group on any ownership field.
 * Empty DAG or DAG structurally equal to group is NOT dirty for the DAG dimension
 * (system materialization of group DAG must not count as ownership).
 */
export function spawnedWorkflowDirtyVsGroup(
  group: Pick<
    OfficeFixedGroup,
    | 'workflow'
    | 'workflowDescription'
    | 'workflowStepDrafts'
    | 'workflowOrchestrationMode'
    | 'agentIds'
    | 'coordinatorAgentId'
  > | null | undefined,
  input: SpawnedWorkflowCompareInput,
): boolean {
  if (!group) return true;
  if (input.executionMode === 'smart') return false;
  if (input.executionMode && input.executionMode !== 'workflow') return true;

  if (!rosterEqual(input.agentIds, input.coordinatorAgentId, group.agentIds, group.coordinatorAgentId)) {
    return true;
  }

  const saveMode = spawnedProjectOrchestrationModeLocked(group)
    ? orchestrationModeFromGroup(group)
    : input.workflowOrchestrationMode;

  const groupKey = orchestrationTemplateKey({
    workflowOrchestrationMode: group.workflowOrchestrationMode,
    workflowDescription: group.workflowDescription ?? '',
    workflowStepDrafts: group.workflowStepDrafts,
  });
  const saveKey = orchestrationTemplateKey({
    workflowOrchestrationMode: saveMode,
    workflowDescription: input.heuristicWorkflowDescription ?? input.description,
    workflowStepDrafts: input.workflowStepDrafts,
  });
  if (saveKey !== groupKey) return true;

  const wf = input.workflow ?? EMPTY_OWNED_WORKFLOW;
  if (wf.nodes.length > 0 && !workflowsStructurallyEqual(wf, group.workflow ?? EMPTY_OWNED_WORKFLOW)) {
    return true;
  }

  // LangGraph: dirty only when active branch DAG diverges from the group template.
  // A bundle that merely mirrors the group DAG must not force ownership (一字未改).
  const bundle = input.langGraphWorkflowBundle;
  if (bundle && (bundle.heuristic || bundle.custom)) {
    const active =
      bundle.activeSource === 'custom'
        ? (bundle.custom ?? bundle.heuristic)
        : (bundle.heuristic ?? bundle.custom);
    const branchWf = active?.workflow;
    if (
      branchWf
      && branchWf.nodes.length > 0
      && !workflowsStructurallyEqual(branchWf, group.workflow ?? EMPTY_OWNED_WORKFLOW)
    ) {
      return true;
    }
  }

  return false;
}

/** Persist shape for no-own projects (no workflow payload on disk). */
export function noOwnWorkflowPersistFields(
  group?: Pick<
    OfficeFixedGroup,
    'workflowOrchestrationMode' | 'workflowDescription' | 'workflowStepDrafts'
  > | null,
): Pick<
  OfficeTempProject,
  | 'inheritsGroupTemplate'
  | 'workflow'
  | 'description'
  | 'workflowStepDrafts'
  | 'workflowOrchestrationMode'
  | 'langGraphWorkflowBundle'
  | 'workflowFreezeSnapshot'
> {
  void group;
  return {
    inheritsGroupTemplate: true,
    workflow: EMPTY_OWNED_WORKFLOW,
    description: '',
    workflowStepDrafts: undefined,
    workflowOrchestrationMode: undefined,
    langGraphWorkflowBundle: undefined,
    workflowFreezeSnapshot: undefined,
  };
}

/** Full materialize when elevating to owned workflow. */
export function materializeOwnedWorkflowPayload(params: {
  workflow: WorkflowDefinition;
  description: string;
  workflowStepDrafts?: WorkflowStepDraftRow[];
  workflowOrchestrationMode?: WorkflowOrchestrationMode;
  langGraphWorkflowBundle?: LangGraphWorkflowBundle;
  agentIds: string[];
  coordinatorAgentId: string;
  group: Pick<
    OfficeFixedGroup,
    | 'workflow'
    | 'workflowDescription'
    | 'workflowStepDrafts'
    | 'workflowOrchestrationMode'
    | 'agentIds'
    | 'coordinatorAgentId'
  >;
}): Pick<
  OfficeTempProject,
  | 'inheritsGroupTemplate'
  | 'workflow'
  | 'description'
  | 'workflowStepDrafts'
  | 'workflowOrchestrationMode'
  | 'langGraphWorkflowBundle'
  | 'agentIds'
  | 'coordinatorAgentId'
  | 'workflowFreezeSnapshot'
> {
  const mode = spawnedProjectOrchestrationModeLocked(params.group)
    ? orchestrationModeFromGroup(params.group)
    : (params.workflowOrchestrationMode ?? orchestrationModeFromGroup(params.group));
  const workflow =
    params.workflow.nodes.length > 0
      ? syncWorkflowEdges({ ...params.workflow, mode: 'dag' })
      : syncWorkflowEdges({ ...(params.group.workflow ?? EMPTY_OWNED_WORKFLOW), mode: 'dag' });
  const description =
    (params.description ?? '').trim()
    || (params.group.workflowDescription ?? '').trim()
    || '';
  const drafts =
    params.workflowStepDrafts
    ?? params.group.workflowStepDrafts;
  return {
    inheritsGroupTemplate: false,
    workflow,
    description,
    workflowStepDrafts: drafts,
    workflowOrchestrationMode: mode,
    langGraphWorkflowBundle: params.langGraphWorkflowBundle,
    agentIds: [...params.agentIds],
    coordinatorAgentId: params.coordinatorAgentId,
    workflowFreezeSnapshot: undefined,
  };
}

/**
 * Decide inherits flag on save.
 * - Already owns → always false (sticky).
 * - Else → true iff not dirty vs current group.
 */
export function decideInheritsGroupTemplateOnSave(params: {
  previousOwnsWorkflow: boolean;
  group: Parameters<typeof spawnedWorkflowDirtyVsGroup>[0];
  input: SpawnedWorkflowCompareInput;
  parentGroupId?: string;
}): boolean {
  if (!params.parentGroupId || !params.group) return false;
  if (params.input.executionMode === 'smart') return false;
  if (params.previousOwnsWorkflow) return false;
  return !spawnedWorkflowDirtyVsGroup(params.group, params.input);
}

/** Spawn: inherit when form is not dirty vs group (system-materialized DAG allowed). */
export function shouldInheritGroupWorkflowOnSpawn(
  form: SpawnedWorkflowCompareInput,
  group?: Parameters<typeof spawnedWorkflowDirtyVsGroup>[0],
): boolean {
  if (form.executionMode === 'smart') return false;
  if (form.executionMode && form.executionMode !== 'workflow') return false;
  if (!group) {
    // Standalone-style: inherit only when there is no workflow content at all.
    if ((form.workflow?.nodes.length ?? 0) > 0) return false;
    const mode = form.workflowOrchestrationMode ?? 'heuristic';
    if (mode === 'rule') {
      return !(form.workflowStepDrafts?.some((r) => (r.task ?? '').trim()) ?? false);
    }
    return !(form.heuristicWorkflowDescription ?? form.description ?? '').trim();
  }
  return !spawnedWorkflowDirtyVsGroup(group, form);
}

export function buildWorkflowFreezeSnapshot(params: {
  group: Pick<
    OfficeFixedGroup,
    | 'workflow'
    | 'workflowDescription'
    | 'workflowStepDrafts'
    | 'workflowOrchestrationMode'
    | 'agentIds'
    | 'coordinatorAgentId'
    | 'updatedAt'
  >;
  langGraphWorkflowBundle?: LangGraphWorkflowBundle;
  now?: number;
}): WorkflowFreezeSnapshot {
  const g = params.group;
  return {
    workflow: syncWorkflowEdges({ ...(g.workflow ?? EMPTY_OWNED_WORKFLOW), mode: 'dag' }),
    description: g.workflowDescription?.trim() ?? '',
    workflowStepDrafts: g.workflowStepDrafts,
    workflowOrchestrationMode: g.workflowOrchestrationMode,
    langGraphWorkflowBundle: params.langGraphWorkflowBundle,
    agentIds: [...g.agentIds],
    coordinatorAgentId: g.coordinatorAgentId,
    frozenAt: params.now ?? Date.now(),
    sourceGroupUpdatedAt: g.updatedAt,
  };
}

export function shouldApplyTerminalWorkflowFreeze(
  project: Pick<
    OfficeTempProject,
    | 'inheritsGroupTemplate'
    | 'workflow'
    | 'executionMode'
    | 'origin'
    | 'parentGroupId'
    | 'status'
    | 'lifecycle'
    | 'workflowFreezeSnapshot'
  >,
): boolean {
  if (isSmartTask(project as OfficeTempProject)) return false;
  if (projectOwnsWorkflow(project)) return false;
  if (project.status === 'failed' || project.status === 'aborted') return false;
  if (!isSpawnedWorkflowTerminalStatus(project.status)) return false;
  if (hasWorkflowFreezeSnapshot(project)) return false;
  return true;
}

/**
 * Upsert gate: whether to (re)build workflowFreezeSnapshot from the live group.
 * Only when newly entering `completed`. Once already completed (with or without
 * freeze), never rebuild — otherwise rerun clear + prune upsert re-freezes live.
 */
export function shouldReapplyTerminalWorkflowFreezeOnUpsert(
  next: Parameters<typeof shouldApplyTerminalWorkflowFreeze>[0],
  previous?: Pick<OfficeTempProject, 'status' | 'workflowFreezeSnapshot'> | null,
): boolean {
  if (!shouldApplyTerminalWorkflowFreeze(next)) return false;
  if (previous?.status === 'completed') return false;
  return true;
}

/** Shape a freeze snapshot as the compare target for save dirty / inherit decisions. */
export function workflowFreezeSnapshotAsCompareGroup(
  freeze: WorkflowFreezeSnapshot,
): Pick<
  OfficeFixedGroup,
  | 'workflow'
  | 'workflowDescription'
  | 'workflowStepDrafts'
  | 'workflowOrchestrationMode'
  | 'agentIds'
  | 'coordinatorAgentId'
> {
  return {
    workflow: freeze.workflow,
    workflowDescription: freeze.description,
    workflowStepDrafts: freeze.workflowStepDrafts,
    workflowOrchestrationMode: freeze.workflowOrchestrationMode,
    agentIds: [...freeze.agentIds],
    coordinatorAgentId: freeze.coordinatorAgentId,
  };
}

export function shouldSyncInheritingChildOnGroupUpdate(
  project: Pick<
    OfficeTempProject,
    | 'inheritsGroupTemplate'
    | 'workflow'
    | 'executionMode'
    | 'origin'
    | 'parentGroupId'
    | 'status'
    | 'lifecycle'
    | 'workflowFreezeSnapshot'
  >,
): boolean {
  if (project.origin !== 'fixed_group' && !project.parentGroupId) return false;
  if (isSmartTask(project as OfficeTempProject)) return false;
  if (projectOwnsWorkflow(project)) return false;
  if (isOfficeProjectArchived(project)) return false;
  // completed freeze: do not sync. failed/aborted still follow the live group.
  if (project.status === 'completed') return false;
  if (shouldUseWorkflowFreezeSnapshot(project)) return false;
  return true;
}

/**
 * Effective workflow for preview/run.
 * Owned → project; no-own + freeze (completed) → snapshot; else → group.
 * failed / aborted no-own always track the live group (leftover freeze ignored).
 */
export function resolveEffectiveWorkflow(
  project: Pick<
    OfficeTempProject,
    | 'workflow'
    | 'executionMode'
    | 'inheritsGroupTemplate'
    | 'origin'
    | 'parentGroupId'
  > & Partial<Pick<OfficeTempProject, 'status' | 'workflowFreezeSnapshot'>>,
  group?: Pick<OfficeFixedGroup, 'workflow'> | null,
): WorkflowDefinition {
  if (isSmartTask(project as OfficeTempProject)) return EMPTY_OWNED_WORKFLOW;
  if (projectOwnsWorkflow(project)) {
    return project.workflow ?? EMPTY_OWNED_WORKFLOW;
  }
  if (shouldUseWorkflowFreezeSnapshot(project)) {
    return project.workflowFreezeSnapshot!.workflow;
  }
  // completed without freeze (legacy): do not silently track live group.
  if (project.status === 'completed') {
    return EMPTY_OWNED_WORKFLOW;
  }
  return group?.workflow ?? EMPTY_OWNED_WORKFLOW;
}

/** Drop nodeRuns that no longer exist after group workflow sync / freeze clear. */
export function pruneNodeRunsToWorkflow<T extends { nodeId: string }>(
  nodeRuns: T[],
  workflow: WorkflowDefinition,
): T[] {
  const ids = new Set(workflow.nodes.map((n) => n.id));
  return nodeRuns.filter((nr) => ids.has(nr.nodeId));
}

export function withTerminalWorkflowFreeze(
  project: OfficeTempProject,
  group: Pick<
    OfficeFixedGroup,
    | 'workflow'
    | 'workflowDescription'
    | 'workflowStepDrafts'
    | 'workflowOrchestrationMode'
    | 'agentIds'
    | 'coordinatorAgentId'
    | 'updatedAt'
  > | null | undefined,
): OfficeTempProject {
  if (!group || !shouldApplyTerminalWorkflowFreeze(project)) return project;
  return {
    ...project,
    ...noOwnWorkflowPersistFields(),
    status: project.status,
    workflowFreezeSnapshot: buildWorkflowFreezeSnapshot({ group }),
  };
}

/** Before rerun/continue for no-own: drop freeze so live group is used. */
export function clearWorkflowFreezeForRerun<T extends Pick<OfficeTempProject, 'workflowFreezeSnapshot'>>(
  project: T,
): T {
  if (!project.workflowFreezeSnapshot) return project;
  return { ...project, workflowFreezeSnapshot: undefined };
}

/** Whether resolved runner DAG may be written back to the project record. */
export function shouldPersistResolvedWorkflowToOwnedProject(
  project: Parameters<typeof projectOwnsWorkflow>[0],
): boolean {
  return projectOwnsWorkflow(project);
}
