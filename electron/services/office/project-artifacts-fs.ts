import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  PROJECT_ROOM_MIRROR_FILE,
} from '../../../src/lib/office-project-context';
import {
  emptyProjectNotebook,
  projectNotebookFileName,
  sanitizeNotebookDirName,
} from '../../../src/lib/office-project-notebook';
import { OPENCLAW_HOME } from '../../utils/openclaw-paths';
import {
  coordinatorProjectRoot,
  memberProjectRoot,
  resolveCoordinatorPathContext,
  workspaceRefsFromTeam,
  type CoordinatorPathContext,
} from './project-context-paths';
import { writeProjectProgress } from './coordinator-project-fs';
import { withOfficeProjectDirLock } from './office-project-dir-lock';
import { emptyOfficeProjectDirectory } from './office-project-dir-reset';
import { taskToProjectDefinition, writeProjectTaskDefinition } from './project-task-definition-fs';
import type { OfficeRole, OfficeTask } from './types';

const LEGACY_NOTEBOOKS_ROOT = join(OPENCLAW_HOME, 'office', 'notebooks');

/** 清理各成员 workspace 下误建的历史项目目录（正式交付仅保留在协调者目录）。 */
export async function wipeMemberProjectWorkspaces(params: {
  teamRoles: Pick<OfficeRole, 'id' | 'agentId' | 'name'>[];
  taskTitle: string;
  taskId: string;
}): Promise<void> {
  const { listProjectAgents } = await import('./store');
  const refs = workspaceRefsFromTeam(await listProjectAgents());
  await Promise.all(
    params.teamRoles.map((role) =>
      rm(
        memberProjectRoot(
          { agentId: role.agentId, name: role.name },
          refs,
          params.taskTitle,
          params.taskId,
        ),
        { recursive: true, force: true },
      ),
    ),
  );
}

export async function wipeLegacyProjectNotebookFiles(
  taskTitle: string,
  taskId: string,
): Promise<void> {
  try {
    await rm(legacyProjectNotebookAbsolutePath(taskTitle, taskId), { force: true });
  } catch {
    // ignore
  }
}

function legacyProjectNotebookAbsolutePath(taskTitle: string, taskId: string): string {
  const dir = join(LEGACY_NOTEBOOKS_ROOT, sanitizeNotebookDirName(taskTitle));
  return join(dir, projectNotebookFileName(taskId));
}

/**
 * 清空协调者 workspace 下本项目目录并写入空进度/群聊/任务定义（不含 manifest，由调用方写入 epoch）。
 * 保留项目根 inode（只清子项），并与 ensure/room 写路径共用 per-project 锁，避免 fresh 重跑竞态 ENOENT。
 */
export async function reinitializeCoordinatorProjectWorkspace(params: {
  coordinatorAgentId: string;
  coordinatorRoleId: string;
  teamRoles: CoordinatorPathContext['teamRoles'];
  task: OfficeTask;
}): Promise<void> {
  return withOfficeProjectDirLock(params.task.id, async () => {
    const pathCtx = await resolveCoordinatorPathContext(
      { coordinatorAgentId: params.coordinatorAgentId },
      params.teamRoles ?? [],
    );
    const root = coordinatorProjectRoot(pathCtx, params.task.title, params.task.id);
    await emptyOfficeProjectDirectory(root);
    await writeProjectProgress(
      pathCtx,
      emptyProjectNotebook(params.task.id, params.task.title),
    );
    await writeFile(join(root, PROJECT_ROOM_MIRROR_FILE), '', 'utf8');
    await writeProjectTaskDefinition(
      pathCtx,
      taskToProjectDefinition(params.task, params.coordinatorRoleId),
    );
  });
}
