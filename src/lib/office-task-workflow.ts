import { isSmartTask } from '@/lib/office-task-execution-mode';
import { syncWorkflowEdges } from '@/lib/office-workflow-edges';
import {
  ensureRuleWorkflowFromStepDrafts,
} from '@/lib/office-workflow-orchestration-mode';
import type { ProjectAgentRef } from '@/lib/office-workflow-node';
import {
  hasWorkflowStepDraftContent,
} from '@/lib/office-workflow-step-drafts';
import {
  orchestrationModeFromGroup,
  orchestrationModeFromProject,
  type WorkflowOrchestrationMode,
} from '@/lib/office-workflow-orchestration-mode';
import { spawnedProjectOrchestrationModeLocked } from '@/lib/office-fixed-group';
import { ensureCoordinatorInTeam } from '@/lib/office-workflow-roles';
import {
  clearWorkflowFreezeForRerun,
  decideInheritsGroupTemplateOnSave,
  EMPTY_OWNED_WORKFLOW,
  noOwnWorkflowPersistFields,
  projectHasNoOwnWorkflow,
  projectOwnsWorkflow,
  resolveEffectiveWorkflow,
  shouldInheritGroupWorkflowOnSpawn as shouldInheritGroupWorkflowOnSpawnOwned,
  shouldPersistResolvedWorkflowToOwnedProject,
  shouldSyncInheritingChildOnGroupUpdate,
  shouldUseWorkflowFreezeSnapshot,
  workflowsStructurallyEqual as workflowsStructurallyEqualOwned,
} from '@/lib/office-spawned-workflow-ownership';
import type {
  OfficeFixedGroup,
  OfficeTempProject,
  WorkflowDefinition,
  WorkflowStepDraftRow,
} from '@/types/office';

const EMPTY_WORKFLOW: WorkflowDefinition = EMPTY_OWNED_WORKFLOW;

export {
  decideInheritsGroupTemplateOnSave,
  noOwnWorkflowPersistFields,
  projectHasNoOwnWorkflow,
  projectOwnsWorkflow,
  resolveEffectiveWorkflow,
  shouldSyncInheritingChildOnGroupUpdate,
  spawnedWorkflowDirtyVsGroup,
} from '@/lib/office-spawned-workflow-ownership';

/** Spawn from fixed group: inherit when form is not dirty vs group (materialized DAG allowed). */
export function shouldInheritGroupWorkflowOnSpawn(
  form: {
    executionMode: OfficeTempProject['executionMode'];
    workflowEngine?: OfficeTempProject['workflowEngine'];
    workflow: WorkflowDefinition;
    description: string;
    heuristicWorkflowDescription?: string;
    workflowStepDrafts?: WorkflowStepDraftRow[];
    workflowOrchestrationMode?: WorkflowOrchestrationMode;
    agentIds?: string[];
    coordinatorAgentId?: string;
  },
  group?: Pick<
    OfficeFixedGroup,
    | 'workflowOrchestrationMode'
    | 'workflowDescription'
    | 'workflowStepDrafts'
    | 'workflow'
    | 'agentIds'
    | 'coordinatorAgentId'
  > | null,
): boolean {
  return shouldInheritGroupWorkflowOnSpawnOwned(form, group ?? undefined);
}

export function workflowsStructurallyEqual(a: WorkflowDefinition, b: WorkflowDefinition): boolean {
  return workflowsStructurallyEqualOwned(a, b);
}

/** 派出项目是否已 materialize 自有 workflow 节点（非空 DAG）。 */
export function spawnedProjectHasOwnWorkflow(
  project: Pick<OfficeTempProject, 'workflow'>,
): boolean {
  return (project.workflow?.nodes?.length ?? 0) > 0;
}

/** 派出项目是否仍继承固定组模板（未自定义工作流）。 */
export function projectInheritsGroupTemplate(
  project: Pick<
    OfficeTempProject,
    'inheritsGroupTemplate' | 'workflow' | 'executionMode' | 'origin' | 'parentGroupId'
  >,
): boolean {
  return projectHasNoOwnWorkflow(project);
}

/**
 * Before fresh/continue for no-own spawned projects: drop terminal freeze and
 * align roster to the live group. Terminal children skip group sync, so rerun
 * would otherwise materialize the new DAG while still loading stale agentIds.
 *
 * Clearing a completion freeze also demotes `completed` → `pending` so
 * resolveEffectiveWorkflow follows the live group instead of EMPTY.
 */
export function alignNoOwnSpawnedProjectForRerun(
  project: OfficeTempProject,
  group: Pick<OfficeFixedGroup, 'agentIds' | 'coordinatorAgentId'> | null | undefined,
): OfficeTempProject {
  if (!projectHasNoOwnWorkflow(project)) return project;
  const hadFreeze = Boolean(project.workflowFreezeSnapshot);
  const cleared = clearWorkflowFreezeForRerun(project);
  // Dropping completion freeze: leave completed so materialize/resolve see EMPTY.
  const statusAdjusted =
    hadFreeze && cleared.status === 'completed'
      ? { ...cleared, status: 'pending' as const }
      : cleared;
  if (!group) return statusAdjusted;
  const agentIds = [...group.agentIds];
  const coordinatorAgentId = ensureCoordinatorInTeam(group.coordinatorAgentId, agentIds);
  const rosterChanged =
    statusAdjusted.agentIds.join('\0') !== agentIds.join('\0')
    || statusAdjusted.coordinatorAgentId !== coordinatorAgentId;
  if (!hadFreeze && !rosterChanged) return statusAdjusted;
  return {
    ...statusAdjusted,
    agentIds,
    coordinatorAgentId,
    updatedAt: Date.now(),
  };
}

/** 固定组更新前：判断子项目是否应随组模板同步。 */
export function childInheritsGroupTemplate(
  project: Pick<
    OfficeTempProject,
    | 'inheritsGroupTemplate'
    | 'workflow'
    | 'executionMode'
    | 'origin'
    | 'parentGroupId'
    | 'description'
    | 'workflowStepDrafts'
    | 'status'
    | 'lifecycle'
    | 'workflowFreezeSnapshot'
  >,
  _prevGroup?: Pick<
    OfficeFixedGroup,
    'workflow' | 'workflowDescription' | 'workflowStepDrafts' | 'workflowOrchestrationMode'
  >,
): boolean {
  void _prevGroup;
  return shouldSyncInheritingChildOnGroupUpdate(project);
}

export function displayAgentsForProject(
  project: Pick<
    OfficeTempProject,
    | 'agentIds'
    | 'coordinatorAgentId'
    | 'origin'
    | 'parentGroupId'
    | 'inheritsGroupTemplate'
    | 'workflow'
    | 'executionMode'
  > & Partial<Pick<OfficeTempProject, 'status' | 'workflowFreezeSnapshot'>>,
  group?: Pick<OfficeFixedGroup, 'agentIds' | 'coordinatorAgentId'> | null,
): { agentIds: string[]; coordinatorAgentId: string } {
  if (group && projectInheritsGroupTemplate(project)) {
    if (shouldUseWorkflowFreezeSnapshot(project)) {
      const freeze = project.workflowFreezeSnapshot!;
      if (freeze.agentIds?.length) {
        return {
          agentIds: [...freeze.agentIds],
          coordinatorAgentId: freeze.coordinatorAgentId,
        };
      }
    }
    return {
      agentIds: [...group.agentIds],
      coordinatorAgentId: group.coordinatorAgentId,
    };
  }
  return {
    agentIds: [...project.agentIds],
    coordinatorAgentId: project.coordinatorAgentId,
  };
}

/**
 * 派出项目保存时是否仍继承固定组模板。
 * 已拥有 → 永不退回；未拥有 → 相对当前组 dirty 判定。
 */
export function projectInheritsGroupTemplateOnSave(
  group: Pick<
    OfficeFixedGroup,
    | 'workflowDescription'
    | 'workflow'
    | 'workflowStepDrafts'
    | 'workflowOrchestrationMode'
    | 'agentIds'
    | 'coordinatorAgentId'
  > | null | undefined,
  params: {
    parentGroupId?: string;
    executionMode: OfficeTempProject['executionMode'];
    description: string;
    workflowStepDrafts?: WorkflowStepDraftRow[];
    workflow: WorkflowDefinition;
    workflowOrchestrationMode?: WorkflowOrchestrationMode;
    agentIds?: string[];
    coordinatorAgentId?: string;
    /** When true, project already owns workflow — sticky, never re-inherit. */
    previousOwnsWorkflow?: boolean;
  },
): boolean {
  return decideInheritsGroupTemplateOnSave({
    previousOwnsWorkflow: params.previousOwnsWorkflow ?? false,
    group,
    parentGroupId: params.parentGroupId,
    input: {
      executionMode: params.executionMode,
      workflow: params.workflow,
      description: params.description,
      workflowStepDrafts: params.workflowStepDrafts,
      workflowOrchestrationMode: params.workflowOrchestrationMode,
      agentIds: params.agentIds,
      coordinatorAgentId: params.coordinatorAgentId,
    },
  });
}

/** Effective structured workflow steps: project field, else fixed-group template when inheriting. */
export function workflowStepDraftsForProject(
  project: Pick<
    OfficeTempProject,
    | 'workflowStepDrafts'
    | 'origin'
    | 'parentGroupId'
    | 'inheritsGroupTemplate'
    | 'workflow'
    | 'executionMode'
  > & Partial<Pick<OfficeTempProject, 'status' | 'workflowFreezeSnapshot'>>,
  group?: Pick<OfficeFixedGroup, 'workflowStepDrafts'> | null,
): WorkflowStepDraftRow[] | undefined {
  if (projectInheritsGroupTemplate(project)) {
    if (shouldUseWorkflowFreezeSnapshot(project)) {
      // Freeze present ⇒ use frozen drafts (including undefined) — never track live group.
      return project.workflowFreezeSnapshot!.workflowStepDrafts;
    }
    return group?.workflowStepDrafts;
  }
  if (hasWorkflowStepDraftContent(project.workflowStepDrafts)) {
    return project.workflowStepDrafts;
  }
  if (project.origin === 'fixed_group' || project.parentGroupId) {
    return group?.workflowStepDrafts;
  }
  return project.workflowStepDrafts;
}

export function workflowForProject(
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
  return resolveEffectiveWorkflow(project, group);
}

/**
 * 运行前解析 workflow：在 workflowForProject 基础上，对 rule 模式仅有 step drafts、尚无 DAG 节点的项目现场生成 DAG。
 */
export function materializeWorkflowForProjectRun(
  project: Pick<
    OfficeTempProject,
    | 'workflow'
    | 'executionMode'
    | 'inheritsGroupTemplate'
    | 'origin'
    | 'parentGroupId'
    | 'workflowOrchestrationMode'
    | 'description'
    | 'workflowStepDrafts'
    | 'status'
    | 'workflowFreezeSnapshot'
  >,
  group: Pick<
    OfficeFixedGroup,
    | 'workflow'
    | 'workflowOrchestrationMode'
    | 'workflowDescription'
    | 'workflowStepDrafts'
  > | null | undefined,
  members: ProjectAgentRef[],
): WorkflowDefinition {
  let workflow = syncWorkflowEdges(workflowForProject(project, group));
  if (workflow.nodes.length > 0 || isSmartTask(project as OfficeTempProject)) {
    return workflow;
  }
  if (orchestrationModeFromProject(project, group) !== 'rule') return workflow;
  const drafts = workflowStepDraftsForProject(project, group);
  if (!hasWorkflowStepDraftContent(drafts)) return workflow;
  const ensured = ensureRuleWorkflowFromStepDrafts({
    workflowStepDrafts: drafts ?? [],
    members,
    workflow,
  });
  return ensured.ok ? syncWorkflowEdges(ensured.workflow) : workflow;
}

/** 无固定组记录时，用项目字段合成组上下文（run / unblock / reconcile 共用）。 */
export function syntheticFixedGroupContextFromProject(
  project: OfficeTempProject,
  groupId?: string,
): OfficeFixedGroup {
  return {
    id: groupId ?? project.parentGroupId ?? project.id,
    name: project.title,
    agentIds: [...project.agentIds],
    coordinatorAgentId: project.coordinatorAgentId,
    workflow: project.workflow ?? EMPTY_WORKFLOW,
    workflowDescription: project.description?.trim() || undefined,
    workflowStepDrafts: project.workflowStepDrafts,
    workflowOrchestrationMode: orchestrationModeFromProject(project),
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

export function fixedGroupContextForProjectRecord(
  project: OfficeTempProject,
  groups: OfficeFixedGroup[],
): OfficeFixedGroup {
  const parentId = project.parentGroupId?.trim();
  if (parentId) {
    const group = groups.find((g) => g.id === parentId);
    if (group) return group;
  }
  return syntheticFixedGroupContextFromProject(project, parentId);
}

/** Effective workflow description: project field, else fixed-group template when spawned. */
export function workflowDescriptionForProject(
  project: Pick<
    OfficeTempProject,
    | 'description'
    | 'origin'
    | 'parentGroupId'
    | 'inheritsGroupTemplate'
    | 'workflow'
    | 'executionMode'
  > & Partial<Pick<OfficeTempProject, 'status' | 'workflowFreezeSnapshot'>>,
  group?: Pick<OfficeFixedGroup, 'workflowDescription'> | null,
): string {
  if (projectInheritsGroupTemplate(project)) {
    if (shouldUseWorkflowFreezeSnapshot(project)) {
      // Snapshot present ⇒ use frozen description even when empty (do not track live group).
      return project.workflowFreezeSnapshot!.description?.trim() ?? '';
    }
    return group?.workflowDescription?.trim()
      || project.description?.trim()
      || '';
  }
  const own = project.description?.trim() ?? '';
  if (own) return own;
  if (project.origin === 'fixed_group' || project.parentGroupId) {
    return group?.workflowDescription?.trim() ?? '';
  }
  return '';
}

/**
 * 固定组更新时：同步仍继承模板的派出项目的 workflow 相关字段。
 * 无自有 → 清空载荷以运行时读组；有自有 → 保留。
 */
export function groupChildWorkflowFieldsAfterGroupUpdate(
  project: Pick<
    OfficeTempProject,
    'workflow' | 'description' | 'workflowStepDrafts' | 'workflowOrchestrationMode' | 'inheritsGroupTemplate'
  >,
  group: Pick<
    OfficeFixedGroup,
    'workflowOrchestrationMode' | 'workflowDescription' | 'workflowStepDrafts'
  >,
): Pick<
  OfficeTempProject,
  'workflow' | 'description' | 'workflowStepDrafts' | 'workflowOrchestrationMode' | 'inheritsGroupTemplate'
> {
  // Sticky owns flag is authoritative on group-sync patches (partial project shapes).
  if (project.inheritsGroupTemplate === false) {
    return {
      inheritsGroupTemplate: false,
      workflow: project.workflow!,
      description: project.description,
      workflowStepDrafts: project.workflowStepDrafts,
      workflowOrchestrationMode: project.workflowOrchestrationMode,
    };
  }
  void group;
  const cleared = noOwnWorkflowPersistFields();
  return {
    inheritsGroupTemplate: cleared.inheritsGroupTemplate,
    workflow: cleared.workflow,
    description: cleared.description ?? '',
    workflowStepDrafts: cleared.workflowStepDrafts,
    workflowOrchestrationMode: cleared.workflowOrchestrationMode,
  };
}

/** Runner 解析出的 DAG 是否应写回项目记录（无自有 / 继承模板不落盘）。 */
export function shouldPersistResolvedWorkflowToProject(
  project: Pick<
    OfficeTempProject,
    'inheritsGroupTemplate' | 'workflow' | 'executionMode' | 'origin' | 'parentGroupId'
  >,
): boolean {
  return shouldPersistResolvedWorkflowToOwnedProject(project);
}

/** Build best-effort fixed-group snapshot from a spawned project when group record is gone. */
export function orphanGroupSnapshotFromProject(
  project: OfficeTempProject,
  groupId: string,
): OfficeFixedGroup {
  const mode = orchestrationModeFromProject(project);
  const freeze = project.workflowFreezeSnapshot;
  return {
    id: groupId,
    name: project.title,
    agentIds: freeze?.agentIds?.length ? [...freeze.agentIds] : [...project.agentIds],
    coordinatorAgentId: freeze?.coordinatorAgentId ?? project.coordinatorAgentId,
    workflowDescription: freeze?.description ?? project.description?.trim() ?? '',
    workflow: freeze?.workflow ?? project.workflow ?? EMPTY_WORKFLOW,
    workflowStepDrafts: freeze?.workflowStepDrafts ?? project.workflowStepDrafts,
    workflowOrchestrationMode: freeze?.workflowOrchestrationMode ?? mode,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

/** 固定组已不存在时：解除派出关系，并从项目快照 materialize 仍可用的模板字段。 */
export function promoteOrphanGroupChildToStandalone(
  project: OfficeTempProject,
  groupId: string,
): OfficeTempProject {
  return convertGroupChildProjectToStandalone(
    project,
    orphanGroupSnapshotFromProject(project, groupId),
  );
}

/** 固定组已不存在时：仅解除派出关系，保留项目已有字段。 */
export function detachGroupChildProjectToStandalone(
  project: OfficeTempProject,
): OfficeTempProject {
  return {
    ...project,
    origin: 'standalone',
    parentGroupId: undefined,
    inheritsGroupTemplate: false,
    workflowFreezeSnapshot: undefined,
    updatedAt: Date.now(),
  };
}

/** 固定组删除时：将派出项目转为自建项目，并 materialize 仍依赖固定组的模板字段。 */
export function convertGroupChildProjectToStandalone(
  project: OfficeTempProject,
  group: OfficeFixedGroup,
): OfficeTempProject {
  const agents = displayAgentsForProject(project, group);
  const description = workflowDescriptionForProject(project, group);
  const workflowStepDrafts = workflowStepDraftsForProject(project, group);
  // Detach must leave a concrete owned DAG. Prefer freeze (completed), else live group.
  let workflow: WorkflowDefinition = EMPTY_WORKFLOW;
  if (!isSmartTask(project)) {
    if (projectOwnsWorkflow(project)) {
      workflow = project.workflow ?? EMPTY_WORKFLOW;
    } else if (shouldUseWorkflowFreezeSnapshot(project) && project.workflowFreezeSnapshot?.workflow) {
      workflow = project.workflowFreezeSnapshot.workflow;
    } else {
      workflow = group.workflow ?? EMPTY_WORKFLOW;
    }
  }
  const inheriting = projectInheritsGroupTemplate(project);
  const workflowOrchestrationMode = inheriting
    ? (
      spawnedProjectOrchestrationModeLocked(group)
        ? orchestrationModeFromGroup(group)
        : (project.workflowOrchestrationMode
          ?? (shouldUseWorkflowFreezeSnapshot(project)
            ? project.workflowFreezeSnapshot?.workflowOrchestrationMode
            : undefined)
          ?? group.workflowOrchestrationMode)
    )
    : project.workflowOrchestrationMode;

  return {
    ...project,
    origin: 'standalone',
    parentGroupId: undefined,
    inheritsGroupTemplate: false,
    agentIds: agents.agentIds,
    coordinatorAgentId: agents.coordinatorAgentId,
    description,
    workflowStepDrafts: hasWorkflowStepDraftContent(workflowStepDrafts)
      ? workflowStepDrafts
      : undefined,
    workflow,
    workflowOrchestrationMode,
    workflowFreezeSnapshot: undefined,
    updatedAt: Date.now(),
  };
}

/** Whether workflow-mode save can proceed without the user typing a new description. */
export function isWorkflowDescriptionSatisfied(
  project: Pick<
    OfficeTempProject,
    | 'description'
    | 'origin'
    | 'parentGroupId'
    | 'workflow'
    | 'executionMode'
    | 'inheritsGroupTemplate'
  > & Partial<Pick<OfficeTempProject, 'status' | 'workflowFreezeSnapshot'>>,
  group: Pick<OfficeFixedGroup, 'workflowDescription' | 'workflow' | 'workflowStepDrafts'> | null | undefined,
  formDescription: string,
  formWorkflowStepDrafts?: WorkflowStepDraftRow[],
): boolean {
  if (hasWorkflowStepDraftContent(formWorkflowStepDrafts)) return true;
  const effective =
    formDescription.trim()
    || workflowDescriptionForProject(project, group);
  if (effective) return true;
  if (project.origin === 'fixed_group' || project.parentGroupId) {
    return workflowForProject(project, group).nodes.length > 0;
  }
  return false;
}

/** @deprecated Use workflowForProject */
export function workflowForTask(
  task: Pick<
    OfficeTempProject,
    'workflow' | 'executionMode' | 'inheritsGroupTemplate' | 'origin' | 'parentGroupId'
  > & Partial<Pick<OfficeTempProject, 'status' | 'workflowFreezeSnapshot'>>,
  scenario: Pick<OfficeFixedGroup, 'workflow'>,
): WorkflowDefinition {
  return workflowForProject(task, scenario);
}
