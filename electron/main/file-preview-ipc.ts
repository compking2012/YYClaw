/**
 * Sandboxed file:* IPC handlers powering the inline file preview pipeline
 * (FilePreviewBody, workspace browser, viewers).  All access is constrained
 * to agent workspace / agent directories (read-write) plus the bundled skills
 * root (read-only); any path outside these roots is rejected with
 * `outsideSandbox`.
 *
 * Contract shapes mirror the renderer wrappers in `src/lib/api-client.ts`
 * (ReadTextFileResult / ReadBinaryFileResult / WriteTextFileResult /
 * StatFileResult / ListDirResult / ListTreeResult / TreeNode).
 */
import { ipcMain } from 'electron';
import { readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { join, resolve, relative, extname, sep, basename } from 'node:path';
import { homedir } from 'node:os';
import { listAgentsSnapshot } from '../utils/agent-config';
import { getOpenClawSkillsDir } from '../utils/paths';

/** Text preview ceiling — mirrors the host-api workspace route (5MB). */
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
/** Binary/rich preview ceiling — mirrors FilePreviewBody's RICH_PREVIEW_MAX_BYTES. */
const MAX_BINARY_BYTES = 50 * 1024 * 1024;
/** Directory tree node cap to keep huge trees from locking the UI. */
const MAX_TREE_NODES = 5000;
const MAX_TREE_DEPTH = 12;
/** Directories never surfaced regardless of includeHidden. */
const ALWAYS_SKIP_DIRS = new Set(['node_modules', '__pycache__', '.git']);

function expandPath(p: string): string {
  return p.startsWith('~') ? p.replace('~', homedir()) : p;
}

/** True when `target` resolves to `root` itself or a descendant of it. */
function isWithinRoot(root: string, target: string): boolean {
  const r = resolve(root);
  const t = resolve(target);
  return t === r || t.startsWith(r + sep);
}

interface SandboxRoots {
  writable: string[];
  readonly: string[];
}

async function resolveSandboxRoots(): Promise<SandboxRoots> {
  const writable: string[] = [];
  try {
    const snapshot = await listAgentsSnapshot();
    for (const agent of snapshot.agents) {
      if (agent.workspace) writable.push(resolve(expandPath(agent.workspace)));
      if (agent.agentDir) writable.push(resolve(expandPath(agent.agentDir)));
    }
  } catch {
    // No agents resolvable — leave writable empty; readonly skills root still applies.
  }
  const readonly = [resolve(getOpenClawSkillsDir())];
  return { writable, readonly };
}

type SandboxVerdict =
  | { allowed: true; readOnly: boolean }
  | { allowed: false };

async function classifyPath(absPath: string): Promise<SandboxVerdict> {
  const target = resolve(expandPath(absPath));
  const roots = await resolveSandboxRoots();
  if (roots.writable.some((root) => isWithinRoot(root, target))) {
    return { allowed: true, readOnly: false };
  }
  if (roots.readonly.some((root) => isWithinRoot(root, target))) {
    return { allowed: true, readOnly: true };
  }
  return { allowed: false };
}

const MIME_BY_EXT: Record<string, string> = {
  '.md': 'text/markdown', '.txt': 'text/plain', '.json': 'application/json',
  '.yaml': 'text/yaml', '.yml': 'text/yaml', '.toml': 'text/plain',
  '.xml': 'application/xml', '.csv': 'text/csv', '.html': 'text/html',
  '.htm': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.ts': 'text/plain', '.tsx': 'text/plain', '.jsx': 'text/plain',
  '.py': 'text/x-python', '.sh': 'text/x-shellscript',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp', '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
};

function mimeForExt(filePath: string): string {
  return MIME_BY_EXT[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

interface TreeNodePayload {
  name: string;
  relPath: string;
  absPath: string;
  isDir: boolean;
  size?: number;
  mtime?: number;
  children?: TreeNodePayload[];
}

async function buildTree(
  rootPath: string,
  dirPath: string,
  includeHidden: boolean,
  counter: { count: number },
  depth: number,
): Promise<TreeNodePayload[]> {
  if (depth >= MAX_TREE_DEPTH || counter.count >= MAX_TREE_NODES) return [];

  let entries;
  try {
    entries = await readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return a.name.localeCompare(b.name);
  });

  const nodes: TreeNodePayload[] = [];
  for (const entry of entries) {
    if (ALWAYS_SKIP_DIRS.has(entry.name)) continue;
    if (!includeHidden && entry.name.startsWith('.')) continue;
    if (counter.count >= MAX_TREE_NODES) break;
    counter.count += 1;

    const absPath = join(dirPath, entry.name);
    const node: TreeNodePayload = {
      name: entry.name,
      relPath: relative(rootPath, absPath),
      absPath,
      isDir: entry.isDirectory(),
    };
    if (entry.isDirectory()) {
      node.children = await buildTree(rootPath, absPath, includeHidden, counter, depth + 1);
    }
    nodes.push(node);
  }
  return nodes;
}

export function registerFilePreviewHandlers(): void {
  ipcMain.handle('file:readText', async (_, path: string) => {
    const verdict = await classifyPath(path);
    if (!verdict.allowed) return { ok: false, error: 'outsideSandbox' };
    try {
      const info = await stat(resolve(expandPath(path)));
      if (!info.isFile()) return { ok: false, error: 'notFound' };
      if (info.size > MAX_TEXT_BYTES) return { ok: false, error: 'tooLarge', size: info.size };
      const content = await readFile(resolve(expandPath(path)), 'utf-8');
      return { ok: true, content, mimeType: mimeForExt(path), size: info.size, readOnly: verdict.readOnly };
    } catch {
      return { ok: false, error: 'notFound' };
    }
  });

  ipcMain.handle('file:readBinary', async (_, path: string, opts?: { maxBytes?: number }) => {
    const verdict = await classifyPath(path);
    if (!verdict.allowed) return { ok: false, error: 'outsideSandbox' };
    try {
      const info = await stat(resolve(expandPath(path)));
      if (!info.isFile()) return { ok: false, error: 'notFound' };
      const cap = Math.min(opts?.maxBytes ?? MAX_BINARY_BYTES, MAX_BINARY_BYTES);
      if (info.size > cap) return { ok: false, error: 'tooLarge', size: info.size };
      const buffer = await readFile(resolve(expandPath(path)));
      return {
        ok: true,
        data: new Uint8Array(buffer),
        mimeType: mimeForExt(path),
        size: info.size,
        readOnly: verdict.readOnly,
      };
    } catch {
      return { ok: false, error: 'notFound' };
    }
  });

  ipcMain.handle('file:writeText', async (_, path: string, content: string) => {
    const verdict = await classifyPath(path);
    if (!verdict.allowed) return { ok: false, error: 'outsideSandbox' };
    if (verdict.readOnly) return { ok: false, error: 'readOnlyRoot' };
    try {
      await writeFile(resolve(expandPath(path)), content, 'utf-8');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'invalidContent' };
    }
  });

  ipcMain.handle('file:stat', async (_, path: string) => {
    const verdict = await classifyPath(path);
    if (!verdict.allowed) return { ok: false, error: 'outsideSandbox' };
    try {
      const info = await stat(resolve(expandPath(path)));
      return {
        ok: true,
        size: info.size,
        mtime: info.mtimeMs,
        isFile: info.isFile(),
        isDir: info.isDirectory(),
        readOnly: verdict.readOnly,
      };
    } catch {
      return { ok: false, error: 'notFound' };
    }
  });

  ipcMain.handle('file:listDir', async (_, path: string) => {
    const verdict = await classifyPath(path);
    if (!verdict.allowed) return { ok: false, error: 'outsideSandbox' };
    const base = resolve(expandPath(path));
    try {
      const dirents = await readdir(base, { withFileTypes: true });
      const entries = await Promise.all(
        dirents.map(async (entry) => {
          const abs = join(base, entry.name);
          let size = 0;
          try {
            if (entry.isFile()) size = (await stat(abs)).size;
          } catch {
            // ignore unreadable entry size
          }
          return { name: entry.name, path: abs, isDir: entry.isDirectory(), size };
        }),
      );
      return { ok: true, entries };
    } catch {
      return { ok: false, error: 'notDirectory' };
    }
  });

  ipcMain.handle('file:listTree', async (_, path: string, opts?: { includeHidden?: boolean }) => {
    const verdict = await classifyPath(path);
    if (!verdict.allowed) return { ok: false, error: 'outsideSandbox' };
    const rootAbs = resolve(expandPath(path));
    try {
      const info = await stat(rootAbs);
      if (!info.isDirectory()) return { ok: false, error: 'notDirectory' };
      const counter = { count: 0 };
      const children = await buildTree(rootAbs, rootAbs, Boolean(opts?.includeHidden), counter, 0);
      const root: TreeNodePayload = {
        name: basename(rootAbs),
        relPath: '',
        absPath: rootAbs,
        isDir: true,
        children,
      };
      return { ok: true, root, truncated: counter.count >= MAX_TREE_NODES };
    } catch {
      return { ok: false, error: 'notFound' };
    }
  });
}
