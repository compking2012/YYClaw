import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  PROJECT_DEFINITION_FILE,
  PROJECT_MANIFEST_FILE,
  PROJECT_PROGRESS_FILE,
} from '../../../src/lib/office-project-context';
import { tempProjectRoot } from './office-project-paths';
import type { OfficeTask } from './types';

export class OfficeProjectWorkspaceMigrateError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'OfficeProjectWorkspaceMigrateError';
  }
}

async function patchTaskTitleInProjectFiles(projectRoot: string, taskTitle: string): Promise<void> {
  for (const file of [PROJECT_MANIFEST_FILE, PROJECT_DEFINITION_FILE, PROJECT_PROGRESS_FILE] as const) {
    const path = join(projectRoot, file);
    try {
      const raw = await readFile(path, 'utf8');
      const parsed = JSON.parse(raw) as { taskTitle?: string };
      if (typeof parsed.taskTitle !== 'string') continue;
      parsed.taskTitle = taskTitle;
      await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    } catch {
      // missing or corrupt — skip
    }
  }
}

async function pathExistsAsDirectory(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function projectRootForTask(task: Pick<OfficeTask, 'id' | 'title'>): string {
  return tempProjectRoot(task.title, task.id);
}

/** id-only 目录：标题变更不再触发目录迁移，仅更新落盘文件中的 taskTitle。 */
export function taskProjectPathNeedsMigration(
  previousTask: Pick<OfficeTask, 'id' | 'title'>,
  nextTask: Pick<OfficeTask, 'id' | 'title'>,
): boolean {
  void previousTask;
  void nextTask;
  return false;
}

/**
 * 项目标题变更：目录名不变（仅 projectId），更新 manifest/definition/progress 中的 taskTitle，
 * 并移除旧标题命名的结项 zip（zip 文件名仍用项目标题）。
 */
export async function migrateProjectWorkspaceOnTaskPathChange(params: {
  previousTask: Pick<OfficeTask, 'id' | 'title'>;
  nextTask: Pick<OfficeTask, 'id' | 'title'>;
}): Promise<void> {
  if (params.previousTask.id !== params.nextTask.id) return;
  if (params.previousTask.title.trim() === params.nextTask.title.trim()) return;

  const root = projectRootForTask(params.nextTask);
  if (!(await pathExistsAsDirectory(root))) return;

  try {
    await patchTaskTitleInProjectFiles(root, params.nextTask.title);
    const { removeProjectDeliverablesBundle } = await import('./project-deliverables-bundle');
    await removeProjectDeliverablesBundle(params.previousTask.title, params.previousTask.id);
    await removeProjectDeliverablesBundle(params.nextTask.title, params.nextTask.id);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new OfficeProjectWorkspaceMigrateError(
      `项目标题更新失败，未更新保存内容：${detail}`,
      { cause: err },
    );
  }
}

/** v2：协调者变更不影响项目路径，保留为空操作以兼容旧调用方。 */
export async function migrateScenarioTasksOnCoordinatorChange(_params: {
  previousScenario: { id: string };
  nextScenario: { id: string };
  roles?: unknown[];
  tasks?: Pick<OfficeTask, 'id' | 'title' | 'scenarioId'>[];
}): Promise<void> {
  void _params;
}
