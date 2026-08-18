import { rename } from 'node:fs/promises';
import { join } from 'node:path';
import {
  legacyRoleStatusFileName,
  roleStatusFileName,
} from '../../../src/lib/office-project-file-naming';
import { coordinatorProjectRoot } from './project-context-paths';
import type { OfficeRole, OfficeScenario, OfficeTask } from './types';
import type { ProjectAgentRef } from '../../../src/lib/office-workflow-node';

export async function renameRoleScopedArtifactsInCoordinatorProjects(params: {
  roleId: string;
  previousName: string;
  nextName: string;
  roles: Array<Pick<OfficeRole, 'id' | 'name' | 'agentId'>>;
  scenarios: Array<Pick<OfficeScenario, 'id' | 'coordinatorRoleId' | 'roleIds'>>;
  tasks: Array<Pick<OfficeTask, 'id' | 'title' | 'scenarioId' | 'coordinatorRoleId'>>;
}): Promise<void> {
  const role = params.roles.find((r) => r.id === params.roleId);
  if (!role) return;

  const coordinatorRole = params.roles.find((r) =>
    params.scenarios.some((s) => s.coordinatorRoleId === r.id),
  );
  const coordinatorAgentId = coordinatorRole?.agentId?.trim() || role.agentId;
  const teamRoles: ProjectAgentRef[] = params.roles.map((r) => ({
    agentId: r.agentId,
    displayName: r.name,
  }));

  for (const task of params.tasks) {
    const scenario = params.scenarios.find((s) => s.id === task.scenarioId);
    if (!scenario) continue;
    const coordRole = params.roles.find((r) => r.id === scenario.coordinatorRoleId);
    const projectRoot = coordinatorProjectRoot(task.title, task.id);
    const oldPath = join(projectRoot, roleStatusFileName(params.previousName));
    const newPath = join(projectRoot, roleStatusFileName(params.nextName));
    try {
      await rename(oldPath, newPath);
    } catch {
      const legacyOld = join(projectRoot, legacyRoleStatusFileName(params.roleId));
      try {
        await rename(legacyOld, newPath);
      } catch {
        // absent
      }
    }
    void coordinatorAgentId;
    void coordRole;
    void teamRoles;
  }
}
