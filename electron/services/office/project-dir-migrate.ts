import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import {
  legacyProjectDirSegment,
  PROJECT_MANIFEST_FILE,
  projectDirSegment,
  type ProjectContextManifest,
} from '../../../src/lib/office-project-context';
import { OPENCLAW_HOME } from '../../utils/openclaw-paths';
import { expandPath } from '../../utils/paths';
import { OFFICE_PROJECT_DIR } from './office-project-paths';
import { migrateDirToDestination, removeStaleRenamePaths } from './workspace-dir-rename';

async function pathIsExistingDirectory(path: string): Promise<boolean> {
  try {
    const { stat } = await import('node:fs/promises');
    const info = await stat(path);
    return info.isDirectory();
  } catch {
    return false;
  }
}

function officeProjectParentDir(): string {
  return join(OPENCLAW_HOME, 'office', OFFICE_PROJECT_DIR);
}

function canonicalProjectRoot(projectTitle: string, projectId: string): string {
  return join(officeProjectParentDir(), projectDirSegment(projectTitle, projectId));
}

/** 路径末级是否为旧版 `{title}-{id}` 目录。 */
export function isLegacyProjectRootPath(absPath: string, projectId: string): boolean {
  const id = projectId.trim();
  const name = basename(absPath).trim();
  if (!id || !name || name === id) return false;
  return name.endsWith(`-${id}`);
}

async function readManifestTaskId(dir: string): Promise<string | null> {
  try {
    const raw = await readFile(join(dir, PROJECT_MANIFEST_FILE), 'utf8');
    const manifest = JSON.parse(raw) as ProjectContextManifest;
    const taskId = manifest.taskId?.trim();
    return taskId || null;
  } catch {
    return null;
  }
}

/**
 * Legacy dirs to migrate for this project.
 * Wildcard `*-{id}` matches require manifest.taskId === projectId to avoid suffix collisions
 * (e.g. id `task-1` must not absorb `…-long-task-1`).
 */
async function listLegacyProjectRootCandidates(
  projectTitle: string,
  projectId: string,
): Promise<string[]> {
  const parent = officeProjectParentDir();
  const id = projectId.trim();
  const out = new Set<string>();
  const exactLegacy = join(parent, legacyProjectDirSegment(projectTitle, id));
  out.add(exactLegacy);

  try {
    const entries = await readdir(parent);
    for (const name of entries) {
      if (name === id) continue;
      if (!name.endsWith(`-${id}`)) continue;
      const candidate = join(parent, name);
      if (!(await pathIsExistingDirectory(candidate))) continue;
      if (resolve(candidate) === resolve(exactLegacy)) continue;
      const manifestTaskId = await readManifestTaskId(candidate);
      if (manifestTaskId === id) {
        out.add(candidate);
      }
    }
  } catch {
    // parent missing
  }
  return [...out];
}

async function patchManifestProjectRootPathIfLegacy(
  projectRoot: string,
  projectId: string,
): Promise<void> {
  const manifestPath = join(projectRoot, PROJECT_MANIFEST_FILE);
  try {
    const raw = await readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(raw) as ProjectContextManifest;
    const recorded = manifest.projectRootPath?.trim();
    const canonical = expandPath(projectRoot);
    if (!recorded) {
      manifest.projectRootPath = canonical;
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      return;
    }
    const expanded = expandPath(recorded);
    if (expanded === canonical) return;
    if (isLegacyProjectRootPath(expanded, projectId)) {
      manifest.projectRootPath = canonical;
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    }
  } catch {
    // no manifest
  }
}

/**
 * 将 `office/project/{title}-{id}` 迁移为 `office/project/{id}`。
 * 新目录已存在则合并/清理旧目录；manifest.projectRootPath 仅在仍为旧路径时更新。
 */
export async function migrateLegacyProjectDirToIdOnly(
  projectTitle: string,
  projectId: string,
): Promise<string> {
  const id = projectId.trim();
  if (!id) throw new Error('project id required for project directory');

  const parent = officeProjectParentDir();
  const canonicalRoot = canonicalProjectRoot(projectTitle, id);
  const legacyRoots = await listLegacyProjectRootCandidates(projectTitle, id);

  await mkdir(parent, { recursive: true });

  for (const legacyRoot of legacyRoots) {
    if (resolve(legacyRoot) === resolve(canonicalRoot)) continue;
    if (!(await pathIsExistingDirectory(legacyRoot))) continue;

    await migrateDirToDestination(legacyRoot, canonicalRoot);
    await removeStaleRenamePaths([legacyRoot], canonicalRoot);
  }

  await patchManifestProjectRootPathIfLegacy(canonicalRoot, id);
  return canonicalRoot;
}
