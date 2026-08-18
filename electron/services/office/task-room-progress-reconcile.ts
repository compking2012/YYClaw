import type { OfficeTempProject } from './types';
import { getRoomMessages, getTempProject, listFixedGroups, persistTempProjectProgress } from './store';
import { isTempProjectArchived } from './agent-binding';
import { workflowForProject } from './workflow-graph';
import { reconcileTaskNodeRunsFromRoom } from '../../../src/lib/task-room-progress-reconcile';
import { isTaskUserAborted } from './task-run-abort-registry';
import { taskExecutionMode } from './task-execution-mode';

export async function persistProjectProgressReconciled(
  groupId: string | undefined,
  projectId: string,
): Promise<OfficeTempProject | null> {
  void groupId;
  if (isTaskUserAborted(projectId)) {
    return (await getTempProject(projectId)) ?? null;
  }

  const project = await getTempProject(projectId);
  if (!project) return null;
  if (isTempProjectArchived(project)) return project;

  const parentGroup = project.parentGroupId
    ? (await listFixedGroups()).find((g) => g.id === project.parentGroupId)
    : undefined;

  if (taskExecutionMode(project) === 'smart') {
    return project;
  }

  const room = await getRoomMessages(projectId);
  const workflow = workflowForProject(project, parentGroup);
  const reconciled = reconcileTaskNodeRunsFromRoom(project, workflow.nodes, room);
  return persistTempProjectProgress(reconciled);
}

/** @deprecated */
export const persistTaskProgressReconciled = persistProjectProgressReconciled;
