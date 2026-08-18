import type { OfficeFixedGroup, OfficeTempProject } from '@/types/office';
import { ensureCoordinatorInTeam, emptyWorkflow } from '@/lib/office-workflow-roles';
import { orchestrationModeFromGroup } from '@/lib/office-workflow-orchestration-mode';

/**
 * 自建项目升级为固定组后：保留原 projectId 与执行历史，绑定为固定组派出项目。
 * 工作流字段继承固定组模板；dissolved 归档会恢复为 active 以便按派出项目展示。
 */
export function linkStandaloneProjectToFixedGroupSpawn(
  project: OfficeTempProject,
  group: OfficeFixedGroup,
): OfficeTempProject {
  const groupExecutionMode = group.executionMode === 'smart' ? 'smart' : 'workflow';
  const workflowFields =
    groupExecutionMode === 'smart'
      ? {
          inheritsGroupTemplate: false as const,
          workflow: emptyWorkflow('dag'),
        }
      : {
          inheritsGroupTemplate: true as const,
          workflow: emptyWorkflow('dag'),
          description:
            orchestrationModeFromGroup(group) === 'heuristic'
              ? (group.workflowDescription?.trim() ?? '')
              : '',
          workflowStepDrafts:
            orchestrationModeFromGroup(group) === 'rule'
              ? group.workflowStepDrafts
              : undefined,
          workflowOrchestrationMode: group.workflowOrchestrationMode,
        };

  const lifecycle = (() => {
    const current = project.lifecycle ?? 'active';
    if (current === 'dissolved') return 'active';
    // 已完成自建项目绑定为组内样板：归档以释放固定组派出名额（避免 GROUP_SPAWN_LIMIT）。
    if (project.status === 'completed' && current === 'active') return 'completed';
    return current;
  })();

  return {
    ...project,
    origin: 'fixed_group',
    parentGroupId: group.id,
    executionMode: groupExecutionMode,
    agentIds: [...group.agentIds],
    coordinatorAgentId: ensureCoordinatorInTeam(
      group.coordinatorAgentId,
      group.agentIds,
      project.coordinatorAgentId,
    ),
    upgradedToGroupId: undefined,
    ...workflowFields,
    lifecycle,
    updatedAt: Date.now(),
  };
}
