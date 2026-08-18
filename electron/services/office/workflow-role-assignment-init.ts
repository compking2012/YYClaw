import { workflowNodeRoleIds } from '../../../src/lib/office-workflow-node';
import { loadProjectEpoch } from './project-context-load';
import { resolveCoordinatorAgentId } from './project-context-paths';
import { appendRoleWorkStatus, readLastRoleWorkStatus } from './role-work-status-fs';
import type { OfficeRole, OfficeScenario, OfficeTask, WorkflowNode } from './types';

function resolveCoordPack(
  task: OfficeTask,
  scenario: Pick<OfficeScenario, 'coordinatorRoleId' | 'roleIds'>,
  teamRoles: OfficeRole[],
) {
  return resolveCoordinatorAgentId(task, scenario, teamRoles);
}

/** Workflow 启动后按工作流节点为各角色写入初始分工（进展可为「无」）。 */
export async function initWorkflowRoleAssignmentsOnStart(params: {
  task: OfficeTask;
  scenario: Pick<OfficeScenario, 'coordinatorRoleId' | 'roleIds'>;
  nodes: WorkflowNode[];
  teamRoles: OfficeRole[];
}): Promise<void> {
  const coord = resolveCoordPack(params.task, params.scenario, params.teamRoles);
  if (!coord) return;
  const epochPack = await loadProjectEpoch({
    task: params.task,
    scenario: params.scenario,
    roles: params.teamRoles,
  });
  const epoch = epochPack?.epoch ?? 1;
  const roleById = new Map(params.teamRoles.map((r) => [r.id, r]));

  for (const node of params.nodes) {
    const title = node.title?.trim() || '工作流步骤';
    for (const roleId of workflowNodeRoleIds(node)) {
      const role = roleById.get(roleId);
      if (!role) continue;
      const progress = `分工：${title}；进展：无`;
      await appendRoleWorkStatus({
        coordinatorAgentId: coord.coordinatorAgentId,
        coordinatorRoleId: coord.coordinatorRoleId,
        teamRoles: params.teamRoles,
        role,
        task: params.task,
        progress,
        epoch,
      });
    }
  }
}

/** 工作流批次即将执行时，为节点上的角色写入/更新分工（不依赖群聊 @）。 */
export async function assignWorkflowRolesForRunnableNodes(params: {
  task: OfficeTask;
  scenario: Pick<OfficeScenario, 'coordinatorRoleId' | 'roleIds'>;
  nodes: WorkflowNode[];
  teamRoles: OfficeRole[];
}): Promise<void> {
  const coord = resolveCoordPack(params.task, params.scenario, params.teamRoles);
  if (!coord) return;
  const epochPack = await loadProjectEpoch({
    task: params.task,
    scenario: params.scenario,
    roles: params.teamRoles,
  });
  const epoch = epochPack?.epoch ?? 1;
  const roleById = new Map(params.teamRoles.map((r) => [r.id, r]));

  for (const node of params.nodes) {
    const title = node.title?.trim() || '工作流步骤';
    for (const roleId of workflowNodeRoleIds(node)) {
      const role = roleById.get(roleId);
      if (!role) continue;
      await appendRoleWorkStatus({
        coordinatorAgentId: coord.coordinatorAgentId,
        coordinatorRoleId: coord.coordinatorRoleId,
        teamRoles: params.teamRoles,
        role,
        task: params.task,
        progress: `分工：${title}；进展：工作流已自动指派，执行中`,
        epoch,
      });
    }
  }
}

/** resume/single 时补写缺失的节点分工（不覆盖已有记录）。 */
export async function ensureWorkflowRoleAssignments(params: {
  task: OfficeTask;
  scenario: Pick<OfficeScenario, 'coordinatorRoleId' | 'roleIds'>;
  nodes: WorkflowNode[];
  teamRoles: OfficeRole[];
}): Promise<void> {
  const coord = resolveCoordPack(params.task, params.scenario, params.teamRoles);
  if (!coord) return;
  const epochPack = await loadProjectEpoch({
    task: params.task,
    scenario: params.scenario,
    roles: params.teamRoles,
  });
  const epoch = epochPack?.epoch ?? 1;
  const roleById = new Map(params.teamRoles.map((r) => [r.id, r]));
  const seen = new Set<string>();

  for (const node of params.nodes) {
    const title = node.title?.trim() || '工作流步骤';
    for (const roleId of workflowNodeRoleIds(node)) {
      if (seen.has(roleId)) continue;
      seen.add(roleId);
      const role = roleById.get(roleId);
      if (!role) continue;
      const last = await readLastRoleWorkStatus({
        coordinatorAgentId: coord.coordinatorAgentId,
        coordinatorRoleId: coord.coordinatorRoleId,
        teamRoles: params.teamRoles,
        taskTitle: params.task.title,
        taskId: params.task.id,
        roleId: role.id,
        roleName: role.name,
        epoch,
      });
      if (last?.工作进展?.trim()) continue;
      await appendRoleWorkStatus({
        coordinatorAgentId: coord.coordinatorAgentId,
        coordinatorRoleId: coord.coordinatorRoleId,
        teamRoles: params.teamRoles,
        role,
        task: params.task,
        progress: `分工：${title}；进展：无`,
        epoch,
      });
    }
  }
}
