/**
 * Persona / workspace file helpers shared by the per-agent PersonaSettingsModal
 * and the Chat workspace sidebar. Lifted from the former Workspace page so the
 * page can be deleted without losing the system-file classification logic.
 */
import type { FilePreviewTarget } from '@/components/file-preview/types';
import { basenameOf, classifyFileExt, extnameOf, getMimeTypeForExt } from '@/lib/generated-files';

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
}

export interface WorkspaceAgent {
  id: string;
  name: string;
  workspace: string;
  isDefault: boolean;
}

/** Top-level files/dirs that make up an agent's persona and memory. */
export const SYSTEM_FILE_NAMES = new Set([
  'AGENTS.md',
  'IDENTITY.md',
  'SOUL.md',
  'TOOLS.md',
  'USER.md',
  'HEARTBEAT.md',
  'BOOT.md',
  'BOOTSTRAP.md',
  'MEMORY.md',
  'DREAMS.md',
]);

export function isSystemNode(node: FileTreeNode): boolean {
  if (node.path === node.name) {
    if (node.type === 'file' && SYSTEM_FILE_NAMES.has(node.name)) return true;
    if (node.type === 'directory' && node.name === 'memory') return true;
  }
  return false;
}

export function isSystemFilePath(path: string): boolean {
  if (SYSTEM_FILE_NAMES.has(path)) return true;
  if (path.startsWith('memory/')) return true;
  return false;
}

/** True for a top-level workspace entry that belongs to the persona/memory set. */
export function isTopLevelSystemEntry(name: string, isDir: boolean): boolean {
  if (isDir) return name === 'memory';
  return SYSTEM_FILE_NAMES.has(name);
}

/** Join an absolute workspace root with a relative file path (OS-aware). */
export function joinWorkspacePath(root: string, rel: string): string {
  const sep = root.includes('\\') && !root.includes('/') ? '\\' : '/';
  return `${root.replace(/[/\\]+$/, '')}${sep}${rel}`;
}

/** Build a FilePreviewTarget for the rich preview body from a workspace file. */
export function buildPreviewTarget(workspacePath: string, relPath: string): FilePreviewTarget {
  const ext = extnameOf(relPath);
  return {
    filePath: joinWorkspacePath(workspacePath, relPath),
    fileName: basenameOf(relPath),
    ext,
    mimeType: getMimeTypeForExt(ext),
    contentType: classifyFileExt(ext),
  };
}
