import { membersForProject } from './office-member-resolve';
import {
  readProjectManifest,
  writeProjectManifest,
} from './coordinator-project-fs';
import {
  reinitializeCoordinatorProjectWorkspace,
  wipeLegacyProjectNotebookFiles,
  wipeMemberProjectWorkspaces,
} from './project-artifacts-fs';
import {
  resolveCoordinatorAgentId,
  resolveProjectPathContext,
} from './project-context-paths';
import type { OfficeTempProject } from './types';

/** 项目重新执行：递增 epoch，清空群聊镜像与各 workspace 交付物，恢复初始项目目录。 */
export async function resetProjectContextForProject(project: OfficeTempProject): Promise<number> {
  const members = await membersForProject(project);
  const coord = resolveCoordinatorAgentId(project, null);
  if (!coord) return 0;
  const pathCtx = await resolveProjectPathContext(project, members);

  try {
    const { removeProjectDeliverablesBundle } = await import('./project-deliverables-bundle');
    await removeProjectDeliverablesBundle(project.title, project.id);
  } catch (err) {
    console.warn('[office] remove deliverables bundle before reset failed:', project.id, err);
  }

  const prev = (await readProjectManifest(pathCtx, project.title, project.id)) ?? null;
  const epoch = (prev?.epoch ?? 0) + 1;
  const startedAt = Date.now();

  await reinitializeCoordinatorProjectWorkspace({
    coordinatorAgentId: coord.coordinatorAgentId,
    coordinatorRoleId: coord.coordinatorAgentId,
    teamRoles: members,
    task: project as never,
  });

  await writeProjectManifest({
    taskId: project.id,
    taskTitle: project.title,
    epoch,
    startedAt,
    coordinatorAgentId: coord.coordinatorAgentId,
    coordinatorRoleId: coord.coordinatorAgentId,
  }, pathCtx);

  await wipeMemberProjectWorkspaces({
    teamRoles: members.map((m) => ({
      id: m.agentId,
      agentId: m.agentId,
      name: m.displayName,
    })),
    taskTitle: project.title,
    taskId: project.id,
  });

  const { clearRoleWorkStatusCache } = await import('./role-work-status-fs');
  await clearRoleWorkStatusCache({
    coordinatorAgentId: coord.coordinatorAgentId,
    taskId: project.id,
    legacyMemberAgentIds: members.map((m) => m.agentId),
  });

  await wipeLegacyProjectNotebookFiles(project.title, project.id);

  return epoch;
}
