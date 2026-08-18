import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import {
  emptyProjectNotebook,
  formatProjectNotebookPromptBlock,
  projectNotebookFileName,
  sanitizeNotebookDirName,
  type ProjectNotebook,
} from '../../../src/lib/office-project-notebook';
import type { ProjectAgentRef } from '../../../src/lib/office-workflow-node';
import { OPENCLAW_HOME } from '../../utils/openclaw-paths';
import {
  readProjectProgress,
  syncCoordinatorProgressFromTask,
  writeProjectProgress,
} from './coordinator-project-fs';
import {
  resolveCoordinatorAgentId,
  resolveCoordinatorPathContext,
  type CoordinatorPathContext,
} from './project-context-paths';
import { membersForAgentIds } from './office-member-resolve';
import type { OfficeFixedGroup, OfficeTempProject, WorkflowNode } from './types';
import { getFixedGroup, listProjectAgents } from './store';

/** @deprecated Legacy path; new data lives under office/project/. */
const LEGACY_NOTEBOOKS_ROOT = join(OPENCLAW_HOME, 'office', 'notebooks');

export function projectNotebookAbsolutePath(taskTitle: string, taskId: string): string {
  const dir = join(LEGACY_NOTEBOOKS_ROOT, sanitizeNotebookDirName(taskTitle));
  return join(dir, projectNotebookFileName(taskId));
}

export async function readProjectNotebook(
  taskTitle: string,
  taskId: string,
  pathCtx?: CoordinatorPathContext,
): Promise<ProjectNotebook | null> {
  if (!pathCtx) return null;
  return readProjectProgress(pathCtx, taskTitle, taskId);
}

export async function writeProjectNotebook(
  notebook: ProjectNotebook,
  pathCtx: CoordinatorPathContext,
): Promise<void> {
  await writeProjectProgress(pathCtx, notebook);
}

export async function clearProjectNotebook(
  taskTitle: string,
  taskId: string,
  pathCtx?: CoordinatorPathContext,
): Promise<void> {
  if (pathCtx) {
    const empty = emptyProjectNotebook(taskId, taskTitle);
    await writeProjectProgress(pathCtx, empty);
  }
  try {
    await rm(projectNotebookAbsolutePath(taskTitle, taskId), { force: true });
  } catch {
    // ignore
  }
}

export async function syncProjectNotebookFromTask(params: {
  groupId: string;
  project: OfficeTempProject;
  workflowNodes: WorkflowNode[];
  members: ProjectAgentRef[];
  group: Pick<OfficeFixedGroup, 'coordinatorAgentId' | 'agentIds'>;
}): Promise<ProjectNotebook> {
  const coord = resolveCoordinatorAgentId(params.project, params.group);
  if (!coord) {
    return emptyProjectNotebook(params.project.id, params.project.title);
  }
  const allMembers = await listProjectAgents();
  return syncCoordinatorProgressFromTask({
    coordinatorAgentId: coord.coordinatorAgentId,
    teamRoles: allMembers,
    task: params.project,
    workflowNodes: params.workflowNodes,
    roles: params.members.map((m) => ({ id: m.agentId, name: m.displayName })),
  });
}

/** @deprecated Role sections use role-work-status-fs NDJSON. */
export async function updateRoleProjectNotebookSection(): Promise<void> {
  return;
}

export async function loadProjectNotebookPromptBlock(params: {
  groupId: string;
  project: OfficeTempProject;
  workflowNodes: WorkflowNode[];
  members: ProjectAgentRef[];
  group: Pick<OfficeFixedGroup, 'coordinatorAgentId' | 'agentIds' | 'workflow'>;
  viewerAgentId: string;
  isCoordinator: boolean;
}): Promise<string | null> {
  const { loadProjectNotebookPromptForViewer } = await import('./project-context-load');
  return loadProjectNotebookPromptForViewer({
    groupId: params.groupId,
    project: params.project,
    group: params.group,
    workflowNodes: params.workflowNodes,
    members: params.members,
    viewerAgentId: params.viewerAgentId,
    isCoordinator: params.isCoordinator,
    roomMessages: await (await import('./store')).getRoomMessages(params.project.id),
  });
}

export { formatProjectNotebookPromptBlock };

export async function resolveCoordinatorPathContextForTask(
  project: Pick<OfficeTempProject, 'id' | 'title' | 'coordinatorAgentId' | 'agentIds' | 'parentGroupId'>,
  group?: Pick<OfficeFixedGroup, 'coordinatorAgentId' | 'agentIds'> | null,
): Promise<CoordinatorPathContext | null> {
  const resolvedGroup =
    group
    ?? (project.parentGroupId ? await getFixedGroup(project.parentGroupId) : null);
  const agentIds = resolvedGroup?.agentIds ?? project.agentIds;
  const members = await membersForAgentIds(agentIds);
  const coord = resolveCoordinatorAgentId(project, resolvedGroup);
  if (!coord) return null;
  return resolveCoordinatorPathContext(coord, members);
}
