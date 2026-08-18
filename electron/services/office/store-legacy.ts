/**
 * v1 store API 适配层：将 roles/scenarios/tasks 映射到 v2 fixedGroups/tempProjects。
 * 供尚未迁移的调用方与历史单元测试使用。
 */
import type {
  OfficeDataStore,
  OfficeFixedGroup,
  OfficeRole,
  OfficeScenario,
  OfficeTask,
  OfficeTempProject,
  RoomMessage,
  WorkflowDefinition,
} from './types';

type LegacyStoreShape = Partial<OfficeDataStore> & {
  roles?: OfficeRole[];
  scenarios?: OfficeScenario[];
  tasks?: OfficeTask[];
};

export function defaultWorkflowForRoles(roleIds: string[]): WorkflowDefinition {
  const nodes = roleIds.map((agentId) => ({
    id: `node-${agentId}`,
    agentId,
    execution: 'serial' as const,
  }));
  const edges = roleIds.slice(1).map((agentId, i) => ({
    from: `node-${roleIds[i]}`,
    to: `node-${agentId}`,
    when: 'on_success' as const,
  }));
  return { mode: 'simple', nodes, edges };
}

function roleAgentId(role: Pick<OfficeRole, 'id' | 'agentId'>): string {
  return role.agentId?.trim() || role.id.trim();
}

function resolveRoleAgentId(roleId: string, roles: OfficeRole[]): string {
  const hit = roles.find((r) => r.id === roleId);
  return hit ? roleAgentId(hit) : roleId;
}

export function migrateLegacyStoreToV2(input: LegacyStoreShape): OfficeDataStore {
  if (input.version === 2 && Array.isArray(input.fixedGroups) && Array.isArray(input.tempProjects)) {
    return {
      version: 2,
      fixedGroups: input.fixedGroups,
      tempProjects: input.tempProjects,
      agentBindings: input.agentBindings ?? {},
      roomMessages: input.roomMessages ?? {},
      settings: {
        agentToAgentEnabled: false,
        agentToAgentAllow: [],
        ...(input.settings ?? {}),
      },
    };
  }

  const roles = Array.isArray(input.roles) ? input.roles : [];
  const scenarios = Array.isArray(input.scenarios) ? input.scenarios : [];
  const tasks = Array.isArray(input.tasks) ? input.tasks : [];

  const fixedGroups: OfficeFixedGroup[] = scenarios.map((s) => ({
    id: s.id,
    name: s.name,
    description: (s as { description?: string }).description,
    agentIds: (s.roleIds ?? []).map((rid) => resolveRoleAgentId(rid, roles)),
    coordinatorAgentId: resolveRoleAgentId(s.coordinatorRoleId ?? '', roles),
    workflow: s.workflow ?? { mode: 'simple', nodes: [], edges: [] },
    sequence: s.sequence,
    createdAt: s.createdAt ?? Date.now(),
    updatedAt: s.updatedAt ?? Date.now(),
  }));

  const tempProjects: OfficeTempProject[] = tasks.map((t) => taskToTempProject(t, roles));

  return {
    version: 2,
    fixedGroups,
    tempProjects,
    agentBindings: {},
    roomMessages: input.roomMessages ?? {},
    settings: {
      agentToAgentEnabled: input.settings?.agentToAgentEnabled ?? false,
      agentToAgentAllow: input.settings?.agentToAgentAllow ?? [],
    },
  };
}

export function tempProjectToTask(
  project: OfficeTempProject,
  roles: OfficeRole[] = [],
): OfficeTask {
  const roleIdForAgent = (agentId: string): string => {
    const hit = roles.find((r) => roleAgentId(r) === agentId);
    return hit?.id ?? agentId;
  };
  return {
    ...project,
    scenarioId: project.parentGroupId ?? '',
    assignedRoleIds: project.agentIds.map(roleIdForAgent),
    coordinatorRoleId: roleIdForAgent(project.coordinatorAgentId),
  } as OfficeTask;
}

export function taskToTempProject(task: OfficeTask, roles: OfficeRole[] = []): OfficeTempProject {
  const now = Date.now();
  const assigned = (task.assignedRoleIds ?? []).map((rid) => resolveRoleAgentId(rid, roles));
  const coordinatorAgentId = task.coordinatorRoleId
    ? resolveRoleAgentId(task.coordinatorRoleId, roles)
    : task.coordinatorAgentId?.trim()
      || assigned[0]
      || '';
  return {
    id: task.id,
    title: task.title,
    origin: task.scenarioId ? 'fixed_group' : 'standalone',
    parentGroupId: task.scenarioId || undefined,
    agentIds: assigned.length > 0 ? assigned : [coordinatorAgentId].filter(Boolean),
    coordinatorAgentId,
    lifecycle:
      task.status === 'completed'
        ? 'completed'
        : task.status === 'aborted'
          ? 'dissolved'
          : 'active',
    featureDescription: task.featureDescription ?? '',
    description: task.description ?? '',
    status: task.status ?? 'pending',
    executionMode: task.executionMode,
    workflowEngine: task.workflowEngine,
    smartRevivedAt: task.smartRevivedAt,
    workflow: task.workflow,
    langGraphWorkflowBundle: task.langGraphWorkflowBundle,
    workflowRunId: task.workflowRunId,
    nodeRuns: (task.nodeRuns ?? []).map((run) => ({
      ...run,
      agentId: run.agentId?.trim() || resolveRoleAgentId((run as { roleId?: string }).roleId ?? '', roles),
    })),
    workflowUserIntervention: task.workflowUserIntervention,
    roomSessionKey: task.roomSessionKey,
    sequence: task.sequence,
    createdAt: task.createdAt ?? now,
    updatedAt: task.updatedAt ?? now,
  };
}

export function fixedGroupToScenario(group: OfficeFixedGroup, roles: OfficeRole[] = []): OfficeScenario {
  const roleIdForAgent = (agentId: string): string => {
    const hit = roles.find((r) => roleAgentId(r) === agentId);
    return hit?.id ?? agentId;
  };
  return {
    ...group,
    roleIds: group.agentIds.map(roleIdForAgent),
    coordinatorRoleId: roleIdForAgent(group.coordinatorAgentId),
  } as OfficeScenario;
}

export function rolesFromStore(store: OfficeDataStore): OfficeRole[] {
  const ids = new Set<string>();
  for (const g of store.fixedGroups) {
    for (const id of g.agentIds) ids.add(id.trim());
  }
  for (const p of store.tempProjects) {
    for (const id of p.agentIds) ids.add(id.trim());
  }
  const now = Date.now();
  return [...ids].filter(Boolean).map((agentId) => ({
    id: agentId,
    agentId,
    name: agentId,
    displayName: agentId,
    createdAt: now,
    updatedAt: now,
  }));
}

export function normalizeRoomMessageLegacy(msg: RoomMessage): RoomMessage {
  const legacy = msg as RoomMessage & {
    taskId?: string;
    scenarioId?: string;
    fromRoleId?: string;
  };
  return {
    ...msg,
    projectId: msg.projectId || legacy.taskId || '',
    groupId: msg.groupId || legacy.scenarioId,
    fromAgentId: msg.fromAgentId || legacy.fromRoleId || (typeof msg.from === 'string' ? msg.from : undefined),
  };
}
