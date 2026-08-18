import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  PROJECT_MANIFEST_FILE,
  PROJECT_PROGRESS_FILE,
  type ProjectContextManifest,
} from '../../../src/lib/office-project-context';
import {
  buildCoordinatorSummaryFromTask,
  emptyProjectNotebook,
  type ProjectNotebook,
} from '../../../src/lib/office-project-notebook';
import { parseMentions, roleMatchesMentionToken } from '../../../src/lib/office-mention-parse';
import { asTeamMemberArray } from '../../../src/lib/office-agent-id-resolve';
import {
  hasCoordinatorDirectAssignmentToRole,
  isSmartCoordinatorProgressSyncReply,
} from '../../../src/lib/office-smart-member-reply';
import {
  extractSmartCoordinatorDispatchOnlyText,
  hasSmartCoordinatorStructuredDispatch,
} from '../../../src/lib/office-smart-room-fields';
import type { OfficeRole, OfficeTask, WorkflowNode } from './types';
import {
  buildCoordinatorPathContext,
  coordinatorProjectRoot,
  recordProjectRootAtStart,
  type CoordinatorPathContext,
} from './project-context-paths';

const NOTEBOOK_SNIPPET_MAX = 400;
const COORD_SUMMARY_MAX = 800;

function truncateNotebookText(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

async function pathCtx(params: {
  coordinatorRoleId?: string;
  coordinatorAgentId: string;
  teamRoles?: CoordinatorPathContext['teamRoles'];
  teamMembers?: CoordinatorPathContext['teamRoles'];
}): Promise<CoordinatorPathContext> {
  const { resolveCoordinatorPathContext } = await import('./project-context-paths');
  const teamRoles = asTeamMemberArray(params.teamRoles ?? params.teamMembers);
  return resolveCoordinatorPathContext(
    { coordinatorAgentId: params.coordinatorAgentId },
    teamRoles,
  );
}

export async function readProjectManifest(
  ctx: CoordinatorPathContext,
  taskTitle: string,
  taskId: string,
): Promise<ProjectContextManifest | null> {
  const path = join(
    coordinatorProjectRoot(ctx, taskTitle, taskId),
    PROJECT_MANIFEST_FILE,
  );
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as ProjectContextManifest;
    if (!parsed?.taskId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function writeProjectManifest(
  manifest: ProjectContextManifest,
  pathCtx?: CoordinatorPathContext,
): Promise<void> {
  let ctx = pathCtx;
  if (!ctx) {
    const { getTempProject } = await import('./store');
    const { membersForProject } = await import('./office-member-resolve');

    const project = await getTempProject(manifest.taskId);
    const coordinatorAgentId =
      manifest.coordinatorAgentId?.trim()
      || project?.coordinatorAgentId?.trim()
      || '';
    let teamRoles: NonNullable<CoordinatorPathContext['teamRoles']>;
    if (project) {
      teamRoles = await membersForProject(project);
    } else if (coordinatorAgentId) {
      teamRoles = [{ agentId: coordinatorAgentId, displayName: coordinatorAgentId }];
    } else {
      teamRoles = [];
    }
    ctx = buildCoordinatorPathContext({ coordinatorAgentId }, teamRoles);
  }
  const root = coordinatorProjectRoot(ctx, manifest.taskTitle, manifest.taskId);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, PROJECT_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export async function ensureProjectManifest(params: {
  task: Pick<OfficeTask, 'id' | 'title'>;
  coordinatorAgentId: string;
  coordinatorRoleId: string;
  teamRoles: CoordinatorPathContext['teamRoles'];
}): Promise<ProjectContextManifest> {
  const ctx = await pathCtx(params);
  const root = await recordProjectRootAtStart(params.task);
  const existing = await readProjectManifest(ctx, params.task.title, params.task.id);
  if (existing) {
    if (existing.projectRootPath?.trim() !== root) {
      const patched = { ...existing, projectRootPath: root };
      await writeProjectManifest(patched, ctx);
      return patched;
    }
    return existing;
  }
  const manifest: ProjectContextManifest = {
    taskId: params.task.id,
    taskTitle: params.task.title,
    epoch: 1,
    startedAt: Date.now(),
    coordinatorAgentId: params.coordinatorAgentId,
    coordinatorRoleId: params.coordinatorRoleId,
    projectRootPath: root,
  };
  await writeProjectManifest(manifest, ctx);
  return manifest;
}

export async function readProjectProgress(
  ctx: CoordinatorPathContext,
  taskTitle: string,
  taskId: string,
): Promise<ProjectNotebook | null> {
  const path = join(
    coordinatorProjectRoot(ctx, taskTitle, taskId),
    PROJECT_PROGRESS_FILE,
  );
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw) as ProjectNotebook;
    if (!parsed?.taskId) return null;
    return {
      taskId: parsed.taskId,
      taskTitle: parsed.taskTitle ?? taskTitle,
      coordinatorSummary: parsed.coordinatorSummary ?? '',
      updatedAt: parsed.updatedAt ?? 0,
      roles:
        parsed.roles && typeof parsed.roles === 'object' && !Array.isArray(parsed.roles)
          ? parsed.roles
          : {},
    };
  } catch {
    return null;
  }
}

export async function writeProjectProgress(
  ctx: CoordinatorPathContext,
  notebook: ProjectNotebook,
): Promise<void> {
  const root = coordinatorProjectRoot(ctx, notebook.taskTitle, notebook.taskId);
  await mkdir(root, { recursive: true });
  const payload: ProjectNotebook = {
    taskId: notebook.taskId,
    taskTitle: notebook.taskTitle,
    coordinatorSummary: notebook.coordinatorSummary,
    updatedAt: Date.now(),
    roles:
      notebook.roles && typeof notebook.roles === 'object' && !Array.isArray(notebook.roles)
        ? notebook.roles
        : {},
  };
  await writeFile(join(root, PROJECT_PROGRESS_FILE), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export async function syncCoordinatorProgressFromTask(params: {
  coordinatorAgentId: string;
  coordinatorRoleId: string;
  teamRoles: CoordinatorPathContext['teamRoles'];
  task: OfficeTask;
  workflowNodes: WorkflowNode[];
  roles: Pick<OfficeRole, 'id' | 'name'>[];
}): Promise<ProjectNotebook> {
  const ctx = await pathCtx(params);
  const { getProjectRoomMessages } = await import('./project-room-fs');
  const roomMessages = await getProjectRoomMessages(params.task.id);
  const coordinatorSummary = buildCoordinatorSummaryFromTask({
    task: params.task,
    workflowNodes: params.workflowNodes,
    roomMessages,
    roles: params.roles,
  });
  const existing =
    (await readProjectProgress(ctx, params.task.title, params.task.id))
    ?? emptyProjectNotebook(params.task.id, params.task.title);

  const notebook: ProjectNotebook = {
    ...existing,
    taskId: params.task.id,
    taskTitle: params.task.title,
    coordinatorSummary,
    roles: existing.roles ?? {},
    updatedAt: Date.now(),
  };
  await writeProjectProgress(ctx, notebook);
  return notebook;
}

/** Smart：协调者群聊派活后写入项目进度 notebook，供 needsDecomposition 与成员分工查询。 */
export async function syncSmartCoordinatorNotebookFromRoomReply(params: {
  coordinatorAgentId: string;
  coordinatorRoleId?: string;
  teamRoles?: CoordinatorPathContext['teamRoles'];
  /** @deprecated */
  teamMembers?: CoordinatorPathContext['teamRoles'];
  task: Pick<OfficeTask, 'id' | 'title'>;
  replyText: string;
}): Promise<void> {
  const text = params.replyText.trim();
  if (!text || isSmartCoordinatorProgressSyncReply(text)) return;
  if (!hasSmartCoordinatorStructuredDispatch(text)) return;

  const dispatchBody = extractSmartCoordinatorDispatchOnlyText(text);
  if (!dispatchBody || /^无$/iu.test(dispatchBody)) return;

  const teamRoles = asTeamMemberArray(params.teamRoles ?? params.teamMembers);
  const ctx = await pathCtx({
    coordinatorAgentId: params.coordinatorAgentId,
    coordinatorRoleId: params.coordinatorRoleId ?? params.coordinatorAgentId,
    teamRoles,
  });
  const existing =
    (await readProjectProgress(ctx, params.task.title, params.task.id))
    ?? emptyProjectNotebook(params.task.id, params.task.title);

  const roles: Record<string, string> = { ...existing.roles };
  for (const role of teamRoles) {
    if (!hasCoordinatorDirectAssignmentToRole(dispatchBody, role)) continue;
    const tokens = parseMentions(dispatchBody);
    const hit = tokens.some((token) => roleMatchesMentionToken(role, token));
    if (!hit) continue;
    const roleKey =
      (role as { id?: string }).id?.trim()
      || role.agentId?.trim()
      || role.displayName?.trim();
    if (!roleKey) continue;
    roles[roleKey] = truncateNotebookText(dispatchBody, NOTEBOOK_SNIPPET_MAX);
  }

  const hasRoleLines = Object.values(roles).some((line) => line.trim().length > 0);
  const coordinatorSummary =
    hasRoleLines || existing.coordinatorSummary.trim().length >= 12
      ? existing.coordinatorSummary.trim()
        ? existing.coordinatorSummary
        : truncateNotebookText(text, COORD_SUMMARY_MAX)
      : truncateNotebookText(text, COORD_SUMMARY_MAX);

  await writeProjectProgress(ctx, {
    ...existing,
    taskId: params.task.id,
    taskTitle: params.task.title,
    coordinatorSummary,
    roles,
    updatedAt: Date.now(),
  });
}

export async function clearCoordinatorProjectFiles(params: {
  coordinatorAgentId: string;
  coordinatorRoleId: string;
  teamRoles: CoordinatorPathContext['teamRoles'];
  task: OfficeTask;
}): Promise<void> {
  const { reinitializeCoordinatorProjectWorkspace } = await import('./project-artifacts-fs');
  await reinitializeCoordinatorProjectWorkspace(params);
}
