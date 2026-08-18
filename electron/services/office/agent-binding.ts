import type {
  AgentBindingRecord,
  OfficeDataStore,
  OfficeFixedGroup,
  OfficeTempProject,
} from './types';
import { isOfficeProjectExecuting } from '../../../src/lib/office-room-sidebar';
import { completionFollowUpForArchivedCompletedReopen } from '../../../src/lib/office-project-completion-follow-up';
import { shouldPreserveArchivedCompletedExecution, shouldPreserveArchivedWorkflowProgress } from '../../../src/lib/office-project-archive';
import { hasActiveParentFixedGroup } from '../../../src/lib/office-fixed-group';
import { syncSpawnedProjectAgentsWithGroup } from '../../../src/lib/office-spawned-project-agent-sync';
import { promoteOrphanGroupChildToStandalone } from '../../../src/lib/office-task-workflow';
import {
  missingAgentsForOfficeEntity,
  entityHasUnassignedActiveWorkflowAgents,
  type OfficeAgentRefEntity,
} from '../../../src/lib/office-missing-agents';

export type AgentBindingErrorCode =
  | 'AGENT_NOT_IDLE'
  | 'AGENT_NOT_FOUND'
  | 'AGENT_NOT_IN_GROUP'
  | 'AGENT_ALREADY_BOUND'
  | 'GROUP_HAS_ACTIVE_CHILD_PROJECT'
  | 'GROUP_SPAWN_LIMIT'
  | 'PROJECT_ARCHIVED'
  | 'PROJECT_STILL_RUNNING'
  | 'COORDINATOR_NOT_IN_TEAM'
  | 'INVALID_ORIGIN';

export class AgentBindingError extends Error {
  constructor(
    readonly code: AgentBindingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AgentBindingError';
  }
}

const RUNNING_STATUSES = new Set(['pending', 'running', 'blocked']);

/** 未归档的临时项目（含 failed/aborted，仍占用 Agent）。 */
export function isTempProjectActive(project: OfficeTempProject): boolean {
  return (project.lifecycle ?? 'active') === 'active';
}

export function isTempProjectArchived(project: OfficeTempProject): boolean {
  return (project.lifecycle ?? 'active') !== 'active';
}

export function assertProjectNotArchived(project: Pick<OfficeTempProject, 'title' | 'lifecycle'>): void {
  if (isTempProjectArchived(project as OfficeTempProject)) {
    throw new AgentBindingError('PROJECT_ARCHIVED', `项目「${project.title}」已归档，不可修改或删除`);
  }
}

export function isProjectCurrentlyRunning(project: OfficeTempProject): boolean {
  return isTempProjectActive(project) && RUNNING_STATUSES.has(project.status);
}

export function activeChildProjectForGroup(
  groupId: string,
  projects: OfficeTempProject[],
): OfficeTempProject | undefined {
  const trimmedGroupId = groupId.trim();
  return projects.find(
    (p) =>
      p.parentGroupId?.trim() === trimmedGroupId
      && isTempProjectActive(p),
  );
}

/**
 * 从固定组 + 未归档临时项目重建 Agent 绑定表（每 Agent 一行，临时项目优先于固定组）。
 */
export function rebuildAgentBindings(
  store: Pick<OfficeDataStore, 'fixedGroups' | 'tempProjects'>,
): Record<string, AgentBindingRecord> {
  const bindings: Record<string, AgentBindingRecord> = {};
  const now = Date.now();

  for (const group of store.fixedGroups) {
    for (const agentId of group.agentIds) {
      bindings[agentId] = {
        agentId,
        kind: 'fixed_group',
        entityId: group.id,
        entityName: group.name,
        updatedAt: now,
      };
    }
  }

  for (const project of store.tempProjects) {
    if (!isTempProjectActive(project)) continue;
    for (const agentId of project.agentIds) {
      bindings[agentId] = {
        agentId,
        kind: 'temp_project',
        entityId: project.id,
        entityName: project.title,
        parentGroupId: project.parentGroupId,
        updatedAt: now,
      };
    }
  }

  return bindings;
}

export function isAgentIdle(
  agentId: string,
  bindings: Record<string, AgentBindingRecord>,
): boolean {
  return !bindings[agentId.trim()];
}

export function listIdleAgentIds(
  allAgentIds: string[],
  bindings: Record<string, AgentBindingRecord>,
): string[] {
  return allAgentIds.filter((id) => isAgentIdle(id, bindings));
}

export function formatBindingLabel(record: AgentBindingRecord): string {
  if (record.kind === 'fixed_group') {
    return `固定组「${record.entityName}」`;
  }
  return `项目「${record.entityName}」`;
}

export function assertAgentsIdle(
  agentIds: string[],
  bindings: Record<string, AgentBindingRecord>,
  opts?: { excludeEntityId?: string },
): void {
  for (const agentId of agentIds) {
    const record = bindings[agentId.trim()];
    if (!record) continue;
    if (opts?.excludeEntityId && record.entityId === opts.excludeEntityId) continue;
    throw new AgentBindingError(
      'AGENT_NOT_IDLE',
      `Agent「${agentId}」已被${formatBindingLabel(record)}绑定，请先解除绑定`,
    );
  }
}

export function assertAgentsSubsetOfGroup(
  agentIds: string[],
  group: OfficeFixedGroup,
): void {
  for (const agentId of agentIds) {
    if (!group.agentIds.includes(agentId)) {
      throw new AgentBindingError(
        'AGENT_NOT_IN_GROUP',
        `Agent「${agentId}」不属于固定组「${group.name}」`,
      );
    }
  }
}

export function assertCoordinatorInTeam(
  coordinatorAgentId: string,
  agentIds: string[],
): void {
  if (!agentIds.includes(coordinatorAgentId.trim())) {
    throw new AgentBindingError(
      'COORDINATOR_NOT_IN_TEAM',
      '协调者必须是项目成员之一',
    );
  }
}

export function assertGroupCanEdit(
  groupId: string,
  projects: OfficeTempProject[],
): void {
  const executing = projects.find(
    (p) => p.parentGroupId === groupId && isOfficeProjectExecuting(p),
  );
  if (executing) {
    throw new AgentBindingError(
      'GROUP_HAS_ACTIVE_CHILD_PROJECT',
      `固定组有派出项目「${executing.title}」正在执行，暂时无法编辑`,
    );
  }
}

export function assertGroupCanDelete(
  groupId: string,
  projects: OfficeTempProject[],
): void {
  const active = activeChildProjectForGroup(groupId, projects);
  if (active) {
    throw new AgentBindingError(
      'GROUP_HAS_ACTIVE_CHILD_PROJECT',
      `固定组存在未归档的子项目「${active.title}」，无法删除`,
    );
  }
}

export function assertGroupCanSpawnProject(
  groupId: string,
  projects: OfficeTempProject[],
  options?: { forArchivedRestart?: boolean },
): void {
  const active = activeChildProjectForGroup(groupId, projects);
  if (active) {
    throw new AgentBindingError(
      'GROUP_SPAWN_LIMIT',
      options?.forArchivedRestart
        ? `该固定组下已有未归档派出项目「${active.title}」，无法重启此归档项目。请先归档或处理现有项目后再试。`
        : `固定组已有未归档的子项目「${active.title}」`,
    );
  }
}

export function assertProjectCanDissolve(project: OfficeTempProject): void {
  if (isProjectCurrentlyRunning(project)) {
    throw new AgentBindingError(
      'PROJECT_STILL_RUNNING',
      '请先中止项目运行，再解散项目',
    );
  }
}

/** PATCH/编辑前：与 UI `isOfficeProjectExecuting` 对齐。 */
export function assertProjectEditableForPatch(project: OfficeTempProject): void {
  if (isOfficeProjectExecuting(project)) {
    throw new AgentBindingError(
      'PROJECT_STILL_RUNNING',
      '项目执行中不可编辑',
    );
  }
}

/** 项目成员变更：新增 agent 须空闲；派出项目成员须在固定组内。 */
export function assertProjectMemberPatch(
  project: OfficeTempProject,
  nextAgentIds: string[],
  store: Pick<OfficeDataStore, 'agentBindings' | 'fixedGroups'>,
  parentGroup?: OfficeFixedGroup | null,
): void {
  const prev = new Set(project.agentIds);
  const added = nextAgentIds.filter((id) => !prev.has(id));
  if (added.length > 0) {
    assertAgentsIdle(added, store.agentBindings ?? {}, { excludeEntityId: project.id });
  }
  const group =
    parentGroup
    ?? (project.parentGroupId
      ? store.fixedGroups.find((g) => g.id === project.parentGroupId)
      : undefined);
  if (project.origin === 'fixed_group' && group) {
    assertAgentsSubsetOfGroup(nextAgentIds, group);
  }
}

/** 归档项目再次执行前：校验 Agent 可重新绑定。 */
export function assertAgentsAvailableForProjectRerun(
  project: OfficeTempProject,
  bindings: Record<string, AgentBindingRecord>,
  parentGroup?: OfficeFixedGroup | null,
): void {
  for (const agentId of project.agentIds) {
    const record = bindings[agentId];
    if (!record) continue;
    if (record.entityId === project.id && record.kind === 'temp_project') continue;
    if (
      project.origin === 'fixed_group'
      && parentGroup
      && record.kind === 'fixed_group'
      && record.entityId === parentGroup.id
    ) {
      continue;
    }
    throw new AgentBindingError(
      'AGENT_NOT_IDLE',
      `Agent「${agentId}」已被${formatBindingLabel(record)}绑定，无法重新执行该项目`,
    );
  }
}

export function assertProjectAgentsExist(
  agentIds: string[],
  knownAgentIds: ReadonlySet<string>,
): void {
  const missing = agentIds
    .map((id) => id.trim())
    .filter((id) => id && !knownAgentIds.has(id));
  if (missing.length > 0) {
    throw new AgentBindingError(
      'AGENT_NOT_FOUND',
      `以下 Agent 不存在：${missing.join('、')}`,
    );
  }
}

/** Roster + coordinator + workflow nodes + step drafts must all resolve in catalog. */
export function assertOfficeEntityAgentsExist(
  entity: OfficeAgentRefEntity,
  knownAgentIds: ReadonlySet<string>,
): void {
  const missing = missingAgentsForOfficeEntity(entity, knownAgentIds);
  if (missing.length > 0) {
    throw new AgentBindingError(
      'AGENT_NOT_FOUND',
      `以下 Agent 不存在：${missing.join('、')}`,
    );
  }
  if (entityHasUnassignedActiveWorkflowAgents(entity)) {
    throw new AgentBindingError(
      'AGENT_NOT_FOUND',
      '存在未指定负责人的工作流节点',
    );
  }
}

export function assertArchivedProjectCanRestart(project: OfficeTempProject): void {
  if (project.lifecycle === 'upgraded') {
    throw new AgentBindingError('PROJECT_ARCHIVED', '已升级为固定组的项目不可重启');
  }
  if (!isTempProjectArchived(project)) {
    throw new AgentBindingError('INVALID_ORIGIN', '仅已归档项目可重启');
  }
}

/**
 * 归档重启前：固定组仍存在则保持派出关系；固定组已删除则转为自建项目后再重启。
 */
export function prepareArchivedProjectForRestart(
  project: OfficeTempProject,
  store: Pick<OfficeDataStore, 'fixedGroups'>,
): OfficeTempProject {
  const parentGroupId = project.parentGroupId?.trim();
  const parentGroup = parentGroupId
    ? store.fixedGroups.find((g) => g.id === parentGroupId)
    : undefined;

  if (hasActiveParentFixedGroup(project, parentGroup) && parentGroup) {
    return syncSpawnedProjectAgentsWithGroup(project, parentGroup);
  }

  if (project.origin === 'fixed_group' || parentGroupId) {
    return promoteOrphanGroupChildToStandalone(project, parentGroupId ?? 'orphan');
  }

  return project;
}

export function validateArchivedProjectRestart(
  project: OfficeTempProject,
  store: Pick<OfficeDataStore, 'fixedGroups' | 'tempProjects' | 'agentBindings'>,
  _knownAgentIds: ReadonlySet<string>,
): OfficeFixedGroup | undefined {
  assertArchivedProjectCanRestart(project);
  const parentGroup = project.parentGroupId
    ? store.fixedGroups.find((g) => g.id === project.parentGroupId)
    : undefined;
  if (hasActiveParentFixedGroup(project, parentGroup)) {
    assertGroupCanSpawnProject(project.parentGroupId!, store.tempProjects, {
      forArchivedRestart: true,
    });
  }
  assertAgentsAvailableForProjectRerun(project, store.agentBindings ?? {}, parentGroup);
  for (const other of store.tempProjects) {
    if (!isTempProjectActive(other) || other.id === project.id) continue;
    if (!isOfficeProjectExecuting(other)) continue;
    const overlap = project.agentIds.some((id) => other.agentIds.includes(id));
    if (overlap) {
      throw new AgentBindingError(
        'AGENT_NOT_IDLE',
        `Agent 正在项目「${other.title}」中执行，无法重启`,
      );
    }
  }
  return parentGroup;
}

export function reactivateArchivedProjectRecord(project: OfficeTempProject): OfficeTempProject {
  const restartedAt = Date.now();
  if (shouldPreserveArchivedCompletedExecution(project)) {
    return {
      ...project,
      lifecycle: 'active',
      status: 'completed',
      archivedRestartedAt: restartedAt,
      ...completionFollowUpForArchivedCompletedReopen(project, restartedAt),
      updatedAt: restartedAt,
    };
  }
  if (shouldPreserveArchivedWorkflowProgress(project)) {
    return {
      ...project,
      lifecycle: 'active',
      status: 'aborted',
      archivedRestartedAt: restartedAt,
      updatedAt: restartedAt,
    };
  }
  return {
    ...project,
    lifecycle: 'active',
    status: 'pending',
    nodeRuns: [],
    workflowRunId: undefined,
    smartRevivedAt: undefined,
    archivedRestartedAt: restartedAt,
    lastRunCompletedAt: undefined,
    completionFollowUpHandledAt: undefined,
    updatedAt: restartedAt,
  };
}

/** @deprecated use isAgentIdle */
export function isAgentInPool(
  agentId: string,
  store: Pick<OfficeDataStore, 'agentBindings'>,
): boolean {
  return isAgentIdle(agentId, store.agentBindings ?? {});
}

/** @deprecated use listIdleAgentIds */
export function listPoolAgentIds(
  allAgentIds: string[],
  store: Pick<OfficeDataStore, 'agentBindings'>,
): string[] {
  return listIdleAgentIds(allAgentIds, store.agentBindings ?? {});
}

/** @deprecated use assertAgentsIdle */
export function assertAgentsInPool(
  agentIds: string[],
  store: Pick<OfficeDataStore, 'agentBindings'>,
): void {
  assertAgentsIdle(agentIds, store.agentBindings ?? {});
}

export function resolveAgentBinding(
  agentId: string,
  bindings: Record<string, AgentBindingRecord>,
): AgentBindingRecord | { state: 'pool' } {
  const record = bindings[agentId.trim()];
  return record ?? { state: 'pool' };
}
