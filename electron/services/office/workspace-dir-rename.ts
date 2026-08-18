import { access, cp, readdir, rename, rm, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve } from 'node:path';

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * 是否仅为可替换的空壳（无 office/projects 子项、无其它顶层实体文件/目录）。
 */
export async function canReplaceDestinationWorkspace(dest: string): Promise<boolean> {
  try {
    const info = await stat(dest);
    if (!info.isDirectory()) return false;
  } catch {
    return false;
  }

  const projectsDir = join(dest, 'office', 'projects');
  try {
    const projects = await readdir(projectsDir);
    if (projects.length > 0) return false;
  } catch {
    // no projects dir — ok to replace
  }

  const top = await readdir(dest);
  for (const name of top) {
    if (name === 'office' || name === 'roles') continue;
    return false;
  }

  return true;
}

async function dirHasMeaningfulContent(dir: string): Promise<boolean> {
  return !(await canReplaceDestinationWorkspace(dir));
}

/**
 * 将 src 迁移到 dest：优先 rename；dest 为空壳则替换；双方都有数据则合并到 dest 后删除 src。
 * 保证不丢数据，且成功后只保留 dest（不长期并存两份）。
 */
export async function migrateDirToDestination(src: string, dest: string): Promise<boolean> {
  const from = resolve(src);
  const to = resolve(dest);
  if (from === to) return true;

  const fromExists = await pathExists(from);
  const toExists = await pathExists(to);

  if (!fromExists) return toExists;
  if (!toExists) {
    await rename(from, to);
    return true;
  }

  const fromMeaningful = await dirHasMeaningfulContent(from);
  const toMeaningful = await dirHasMeaningfulContent(to);

  if (!fromMeaningful) {
    await rm(from, { recursive: true, force: true });
    return true;
  }

  if (!toMeaningful) {
    await rm(to, { recursive: true, force: true });
    await rename(from, to);
    return true;
  }

  await cp(from, to, { recursive: true, force: true });
  await rm(from, { recursive: true, force: true });
  return true;
}

/** 迁移完成后移除除 keepDest 外的已知旧路径（空壳直接删，有内容则折入 keepDest）。 */
export async function removeStaleRenamePaths(
  stalePaths: string[],
  keepDest: string,
): Promise<void> {
  const keep = resolve(keepDest);
  if (!(await pathExists(keep))) return;

  const seen = new Set<string>();
  for (const p of stalePaths) {
    const resolved = resolve(p);
    if (resolved === keep || seen.has(resolved)) continue;
    seen.add(resolved);
    if (!(await pathExists(resolved))) continue;

    try {
      if (await canReplaceDestinationWorkspace(resolved)) {
        await rm(resolved, { recursive: true, force: true });
      } else {
        await migrateDirToDestination(resolved, keep);
      }
    } catch (err) {
      console.warn('[office] remove stale rename path failed:', resolved, err);
    }
  }
}

/** @deprecated 使用 {@link migrateDirToDestination} */
export async function renameDirIfSourceExists(src: string, dest: string): Promise<boolean> {
  return migrateDirToDestination(src, dest);
}
