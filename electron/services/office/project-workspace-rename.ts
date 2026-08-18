import type { OfficeRole, OfficeScenario, OfficeTask } from './types';
import { migrateProjectWorkspaceOnTaskPathChange } from './project-workspace-migrate';

/**
 * 项目**标题**和/或**协调者**变更时迁移协调者 workspace 下的项目目录。
 * 迁移失败时抛错，store 不得先写入新标题/协调者。
 */
export async function renameProjectWorkspaceOnTitleChange(params: {
  previous: Pick<OfficeTask, 'id' | 'title' | 'coordinatorRoleId' | 'scenarioId'>;
  next: Pick<OfficeTask, 'id' | 'title' | 'coordinatorRoleId' | 'scenarioId'>;
  roles: Pick<OfficeRole, 'id' | 'agentId' | 'name'>[];
  scenarios: Pick<OfficeScenario, 'id' | 'coordinatorRoleId' | 'roleIds'>[];
}): Promise<void> {
  const previousScenario = params.scenarios.find((s) => s.id === params.previous.scenarioId);
  const nextScenario = params.scenarios.find((s) => s.id === params.next.scenarioId);
  if (!previousScenario || !nextScenario) return;

  await migrateProjectWorkspaceOnTaskPathChange({
    previousTask: params.previous,
    nextTask: params.next,
  });
}

export {
  migrateProjectWorkspaceOnTaskPathChange,
  migrateScenarioTasksOnCoordinatorChange,
  OfficeProjectWorkspaceMigrateError,
} from './project-workspace-migrate';
