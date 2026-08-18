import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  PROJECT_DEFINITION_FILE,
  type ProjectTaskDefinition,
} from '../../../src/lib/office-project-context';
import { taskExecutionMode } from './task-execution-mode';
import {
  coordinatorProjectRoot,
  type CoordinatorPathContext,
} from './project-context-paths';
import type { OfficeTask } from './types';
import { taskWorkflowEngine } from '@/lib/office-workflow-engine';

export function taskToProjectDefinition(
  task: OfficeTask,
  coordinatorRoleId: string,
): ProjectTaskDefinition {
  const mode = taskExecutionMode(task);
  const base: ProjectTaskDefinition = {
    taskId: task.id,
    taskTitle: task.title,
    executionMode: mode,
    workflowEngine: mode === 'workflow' ? taskWorkflowEngine(task) : undefined,
    featureDescription: task.featureDescription ?? '',
    description: task.description ?? '',
    coordinatorRoleId,
    updatedAt: task.updatedAt || Date.now(),
  };
  if (mode === 'workflow' && task.workflow?.nodes?.length) {
    return {
      ...base,
      workflow: task.workflow,
      langGraphWorkflowBundle: task.langGraphWorkflowBundle,
    };
  }
  return base;
}

export async function writeProjectTaskDefinition(
  ctx: CoordinatorPathContext,
  definition: ProjectTaskDefinition,
): Promise<void> {
  const root = coordinatorProjectRoot(ctx, definition.taskTitle, definition.taskId);
  if (!existsSync(root)) {
    await mkdir(root, { recursive: true });
  }
  await writeFile(
    join(root, PROJECT_DEFINITION_FILE),
    `${JSON.stringify(definition, null, 2)}\n`,
    'utf8',
  );
}

