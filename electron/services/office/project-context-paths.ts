import { homedir } from 'node:os';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { agentDefaultWorkspaceDirName } from '../../../src/lib/office-agent-workspace';
import { OPENCLAW_HOME } from '../../utils/openclaw-paths';
import { projectDirSegment, PROJECT_MANIFEST_FILE, type ProjectContextManifest } from '../../../src/lib/office-project-context';
import type { OfficeFixedGroup, OfficeTempProject } from './types';
import { tempProjectRoot } from './office-project-paths';
import { resolveProjectCoordinatorAgentId } from '../../../src/lib/office-task-coordinator';
import type { ProjectAgentRef } from '../../../src/lib/office-workflow-node';
import { expandPath } from '../../utils/paths';
import { withOfficeProjectDirLock } from './office-project-dir-lock';
import { migrateLegacyProjectDirToIdOnly, isLegacyProjectRootPath } from './project-dir-migrate';

export type ProjectPathContext = {
  coordinatorAgentId: string;
  projectMembers: ProjectAgentRef[];
};

export function buildProjectPathContext(
  project: Pick<OfficeTempProject, 'coordinatorAgentId' | 'agentIds'>,
  members: ProjectAgentRef[],
): ProjectPathContext {
  return {
    coordinatorAgentId: project.coordinatorAgentId.trim(),
    projectMembers: members,
  };
}

/** 临时项目唯一根目录：~/.openclaw/office/project/<projectId>/ */
export function projectRoot(projectTitle: string, projectId: string): string {
  return tempProjectRoot(projectTitle, projectId);
}

/** @deprecated 兼容 (ctx, title, id) 三参数调用。 */
export function coordinatorProjectRoot(
  projectTitleOrCtx: string | ProjectPathContext,
  projectIdOrTitle?: string,
  projectId?: string,
): string {
  if (typeof projectTitleOrCtx === 'string') {
    return projectRoot(projectTitleOrCtx, projectIdOrTitle ?? '');
  }
  return projectRoot(projectIdOrTitle ?? '', projectId ?? '');
}

/** @deprecated alias */
export const officeProjectRoot = projectRoot;

export async function ensureOfficeProjectDirectory(
  projectOrCtx: Pick<OfficeTempProject, 'id' | 'title'> | ProjectPathContext,
  taskTitle?: string,
  taskId?: string,
): Promise<string> {
  const title = taskTitle ?? (projectOrCtx as OfficeTempProject).title;
  const id = taskId ?? (projectOrCtx as OfficeTempProject).id;
  return withOfficeProjectDirLock(id, async () => {
    const root = await migrateLegacyProjectDirToIdOnly(title, id);
    const parent = dirname(root);
    try {
      const info = await stat(parent);
      if (!info.isDirectory()) {
        throw new Error(`ENOTDIR: office project parent is not a directory: ${parent}`);
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') {
        await mkdir(parent, { recursive: true });
      } else {
        throw err;
      }
    }
    await mkdir(root, { recursive: true });
    return root;
  });
}

/** 项目启动时写入 manifest.projectRootPath，并返回已展开的项目根目录。 */
export async function recordProjectRootAtStart(
  project: Pick<OfficeTempProject, 'id' | 'title'>,
): Promise<string> {
  return withOfficeProjectDirLock(project.id, async () => {
    const root = expandPath(await ensureOfficeProjectDirectory(project));
    const manifestPath = join(root, PROJECT_MANIFEST_FILE);
    let manifest: ProjectContextManifest | null;
    try {
      const raw = await readFile(manifestPath, 'utf8');
      manifest = JSON.parse(raw) as ProjectContextManifest;
    } catch {
      manifest = null;
    }
    if (manifest?.projectRootPath?.trim() === root) {
      return root;
    }
    const next: ProjectContextManifest = manifest
      ? { ...manifest, projectRootPath: root }
      : {
          taskId: project.id,
          taskTitle: project.title,
          epoch: 1,
          startedAt: Date.now(),
          coordinatorAgentId: '',
          coordinatorRoleId: '',
          projectRootPath: root,
        };
    await writeFile(manifestPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    return root;
  });
}

/** 读取项目建立时记录的项目根目录（只读，运行期间不写 manifest / openclaw.json）。 */
export async function resolveRecordedProjectRoot(
  project: Pick<OfficeTempProject, 'id' | 'title' | 'projectRootPath'>,
): Promise<string | null> {
  const fromStore = project.projectRootPath?.trim();
  if (fromStore) {
    const expanded = expandPath(fromStore);
    if (await pathIsExistingDirectory(expanded)) {
      if (isLegacyProjectRootPath(expanded, project.id)) {
        return migrateLegacyProjectDirToIdOnly(project.title, project.id);
      }
      return expanded;
    }
  }

  const primary = projectRoot(project.title, project.id);
  const manifestPath = join(primary, PROJECT_MANIFEST_FILE);
  try {
    const raw = await readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(raw) as ProjectContextManifest;
    const recorded = manifest.projectRootPath?.trim();
    if (recorded) {
      const expanded = expandPath(recorded);
      if (await pathIsExistingDirectory(expanded)) {
        if (isLegacyProjectRootPath(expanded, project.id)) {
          return migrateLegacyProjectDirToIdOnly(project.title, project.id);
        }
        return expanded;
      }
    }
  } catch {
    // fall through
  }

  const existing = await resolveExistingOfficeProjectRoot(project.title, project.id);
  if (existing) {
    return expandPath(existing);
  }

  return null;
}

/** Session md 落盘路径：优先 manifest/store 记录的项目根，与交付物 lookup 一致。 */
export async function resolveOfficeProjectRootForSessionMd(
  project: Pick<OfficeTempProject, 'id' | 'title' | 'projectRootPath'>,
): Promise<string> {
  return (await resolveRecordedProjectRoot(project)) ?? projectRoot(project.title, project.id);
}

async function pathIsExistingDirectory(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isDirectory();
  } catch {
    return false;
  }
}

export async function resolveExistingOfficeProjectRoot(
  projectTitle: string,
  projectId: string,
): Promise<string | null> {
  const migrated = await migrateLegacyProjectDirToIdOnly(projectTitle, projectId);
  if (await pathIsExistingDirectory(migrated)) return migrated;
  return null;
}

export async function resolveOfficeProjectRoot(
  project: Pick<OfficeTempProject, 'id' | 'title' | 'coordinatorAgentId' | 'agentIds'>,
  _group?: Pick<OfficeFixedGroup, 'coordinatorAgentId' | 'agentIds'> | null,
): Promise<string | null> {
  void _group;
  return resolveExistingOfficeProjectRoot(project.title, project.id);
}

export function resolveCoordinatorAgentId(
  project: Pick<OfficeTempProject, 'coordinatorAgentId' | 'agentIds'>,
  group?: Pick<OfficeFixedGroup, 'coordinatorAgentId' | 'agentIds'> | null,
): { coordinatorAgentId: string } | null {
  const coordinatorAgentId = resolveProjectCoordinatorAgentId(project, group).trim();
  if (!coordinatorAgentId) return null;
  return { coordinatorAgentId };
}

export function agentWorkspaceRoot(agentId: string): string {
  return join(OPENCLAW_HOME, `workspace-${agentId.trim()}`);
}

function workspacePathToConfig(abs: string): string {
  const home = homedir();
  if (abs.startsWith(home)) {
    return `~${abs.slice(home.length)}`;
  }
  return abs;
}

export function agentWorkspaceConfigPath(agentId: string): string {
  return workspacePathToConfig(join(OPENCLAW_HOME, agentDefaultWorkspaceDirName(agentId)));
}

export async function resolveProjectPathContext(
  project: Pick<OfficeTempProject, 'coordinatorAgentId' | 'agentIds'>,
  members: ProjectAgentRef[],
): Promise<ProjectPathContext> {
  return buildProjectPathContext(project, members);
}

/** @deprecated use resolveProjectPathContext */
export async function resolveCoordinatorPathContext(
  coord: { coordinatorAgentId: string },
  members: ProjectAgentRef[],
): Promise<ProjectPathContext> {
  return buildProjectPathContext(
    { coordinatorAgentId: coord.coordinatorAgentId, agentIds: members.map((m) => m.agentId) },
    members,
  );
}

export type CoordinatorPathContext = ProjectPathContext & {
  coordinatorRoleId?: string;
  teamRoles?: ProjectAgentRef[];
};

export function buildCoordinatorPathContext(
  coord: { coordinatorAgentId: string },
  members: ProjectAgentRef[],
): CoordinatorPathContext {
  return {
    ...buildProjectPathContext(
      { coordinatorAgentId: coord.coordinatorAgentId, agentIds: members.map((m) => m.agentId) },
      members,
    ),
    teamRoles: members,
  };
}

export function projectMembersToRefs(members: ProjectAgentRef[]): ProjectAgentRef[] {
  return members;
}

export function workspaceRefsFromMembers(members: ProjectAgentRef[]): ProjectAgentRef[] {
  return members;
}

export function getAgentWorkspacePath(agentId: string): string {
  return agentWorkspaceRoot(agentId);
}

/** @deprecated */
export function getRoleWorkspacePath(
  member: Pick<ProjectAgentRef, 'agentId' | 'displayName'>,
): string {
  return agentWorkspaceRoot(member.agentId);
}

/** @deprecated */
export function roleRefFromOfficeRole(
  member: Pick<ProjectAgentRef, 'agentId' | 'displayName'>,
): ProjectAgentRef {
  return { agentId: member.agentId, displayName: member.displayName };
}

/** @deprecated */
export function workspaceRefsFromTeam(
  members: ProjectAgentRef[],
): ProjectAgentRef[] {
  return members;
}

/** 成员 workspace 下历史误建的项目目录（正式交付在 ~/.openclaw/office/project/…）。 */
export function memberProjectRoot(
  member: { agentId: string; name?: string; displayName?: string },
  _refs: ProjectAgentRef[],
  taskTitle: string,
  taskId: string,
): string {
  void _refs;
  const title = typeof taskTitle === 'string' ? taskTitle : String(taskTitle ?? '');
  const id = typeof taskId === 'string' ? taskId : String(taskId ?? '');
  return join(
    agentWorkspaceRoot(member.agentId),
    'office',
    'projects',
    projectDirSegment(title, id),
  );
}

/** @deprecated */
export function roleWorkspaceRoot(agentId: string): string {
  return agentWorkspaceRoot(agentId);
}

/** @deprecated */
export async function ensureRoleWorkspaceProjectsDir(agentId: string): Promise<string> {
  const root = join(agentWorkspaceRoot(agentId), 'office', 'projects');
  await mkdir(root, { recursive: true });
  return root;
}

/** @deprecated */
export async function ensureAgentWorkspaceProjectsDir(agentId: string): Promise<string> {
  return ensureRoleWorkspaceProjectsDir(agentId);
}

export { projectDirSegment };
