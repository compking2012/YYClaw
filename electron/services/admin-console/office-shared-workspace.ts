import { createHash } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  lstat,
  writeFile,
} from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { getOpenClawConfigDir } from '../../utils/paths';
import { listAgentsSnapshot } from '../../utils/agent-config';
import { logger } from '../../utils/logger';

const MANIFEST_FILE = '.admin-shared-workspace.json';
const DEFAULT_CHUNK_SIZE = 1024 * 1024;
const MAX_CHUNK_SIZE = 8 * 1024 * 1024;
const MAX_FILE_SIZE = 512 * 1024 * 1024;
const MAX_RUN_BYTES = 2 * 1024 * 1024 * 1024;

type WorkspaceOp =
  | 'prepare'
  | 'pull_chunk'
  | 'push_chunk'
  | 'commit'
  | 'snapshot'
  | 'list'
  | 'read'
  | 'cleanup';

export type OfficeSharedWorkspaceErrorCode =
  | 'INVALID_PAYLOAD'
  | 'UNKNOWN_AGENT'
  | 'INVALID_PATH'
  | 'INVALID_CHUNK'
  | 'HASH_MISMATCH'
  | 'SIZE_LIMIT'
  | 'FILE_NOT_FOUND'
  | 'WORKSPACE_IO_ERROR';

export type OfficeSharedWorkspaceRpcError = {
  code: OfficeSharedWorkspaceErrorCode;
  message: string;
};

export type OfficeSharedWorkspaceFile = {
  path: string;
  size: number;
  sha256?: string;
  mtime_ms?: number;
  deleted?: boolean;
  is_directory?: boolean;
  content_base64?: string;
};

export type OfficeSharedWorkspaceChunk = {
  file_id?: string;
  path: string;
  offset: number;
  size?: number;
  sha256?: string;
  total_size?: number;
  is_last_chunk?: boolean;
  content_base64?: string;
};

export type OfficeSharedWorkspaceRpcRequest = {
  op: WorkspaceOp;
  workspace_id: string;
  task_id?: string;
  run_id?: string;
  agent_id: string;
  revision?: string;
  base_revision?: string;
  files?: OfficeSharedWorkspaceFile[];
  chunks?: OfficeSharedWorkspaceChunk[];
  paths?: string[];
  path?: string;
  offset?: number;
  size?: number;
  payload?: Record<string, unknown>;
};

export type OfficeSharedWorkspaceRpcResponse = {
  ok: boolean;
  workspace_id: string;
  revision?: string;
  project_root?: string;
  files?: OfficeSharedWorkspaceFile[];
  chunks?: OfficeSharedWorkspaceChunk[];
  error?: OfficeSharedWorkspaceRpcError;
};

type Manifest = {
  workspace_id: string;
  agent_id?: string;
  task_id?: string;
  run_id?: string;
  revision?: string;
  base_revision?: string;
  updated_at: string;
  files: Record<string, { size: number; sha256: string; mtime_ms: number }>;
};

export class OfficeSharedWorkspaceRpcException extends Error {
  code: OfficeSharedWorkspaceErrorCode;

  constructor(code: OfficeSharedWorkspaceErrorCode, message: string) {
    super(message);
    this.name = 'OfficeSharedWorkspaceRpcException';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readString(rec: Record<string, unknown>, key: string, required = true): string | undefined {
  const value = rec[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (required) {
    throw new OfficeSharedWorkspaceRpcException('INVALID_PAYLOAD', `office_workspace_rpc payload missing string "${key}"`);
  }
  return undefined;
}

function readNumber(rec: Record<string, unknown>, key: string): number | undefined {
  const value = rec[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new OfficeSharedWorkspaceRpcException('INVALID_PAYLOAD', `office_workspace_rpc payload optional "${key}" must be a non-negative number`);
  }
  return value;
}

function normalizeRequest(input: unknown): OfficeSharedWorkspaceRpcRequest {
  if (!isRecord(input)) {
    throw new OfficeSharedWorkspaceRpcException('INVALID_PAYLOAD', 'office_workspace_rpc expects a JSON object body');
  }
  const op = readString(input, 'op') as WorkspaceOp;
  const validOps: WorkspaceOp[] = ['prepare', 'pull_chunk', 'push_chunk', 'commit', 'snapshot', 'list', 'read', 'cleanup'];
  if (!validOps.includes(op)) {
    throw new OfficeSharedWorkspaceRpcException('INVALID_PAYLOAD', `Unsupported office workspace op: ${op}`);
  }
  return {
    op,
    workspace_id: readString(input, 'workspace_id')!,
    task_id: readString(input, 'task_id', false),
    run_id: readString(input, 'run_id', false),
    agent_id: readString(input, 'agent_id')!,
    revision: readString(input, 'revision', false),
    base_revision: readString(input, 'base_revision', false),
    files: Array.isArray(input.files) ? input.files as OfficeSharedWorkspaceFile[] : undefined,
    chunks: Array.isArray(input.chunks) ? input.chunks as OfficeSharedWorkspaceChunk[] : undefined,
    paths: Array.isArray(input.paths) ? input.paths.filter((p): p is string => typeof p === 'string') : undefined,
    path: readString(input, 'path', false),
    offset: readNumber(input, 'offset'),
    size: readNumber(input, 'size'),
    payload: isRecord(input.payload) ? input.payload : undefined,
  };
}

function validateWorkspaceId(workspaceId: string): string {
  const normalized = workspaceId.trim();
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(normalized)) {
    throw new OfficeSharedWorkspaceRpcException('INVALID_PAYLOAD', 'workspace_id may only contain letters, numbers, dot, underscore, and dash');
  }
  return normalized;
}

function normalizeRelativePath(filePath: string): string {
  const trimmed = filePath.trim();
  if (!trimmed || isAbsolute(trimmed)) {
    throw new OfficeSharedWorkspaceRpcException('INVALID_PATH', `Invalid workspace path: ${filePath}`);
  }
  const normalized = normalize(trimmed).replace(/\\/g, '/');
  if (normalized === '.' || normalized.startsWith('../') || normalized === '..' || normalized.includes('/../')) {
    throw new OfficeSharedWorkspaceRpcException('INVALID_PATH', `Path traversal not allowed: ${filePath}`);
  }
  if (normalized === MANIFEST_FILE || normalized.startsWith(`${MANIFEST_FILE}/`)) {
    throw new OfficeSharedWorkspaceRpcException('INVALID_PATH', `Reserved workspace path: ${filePath}`);
  }
  return normalized;
}

function isInside(root: string, target: string): boolean {
  const relativePath = relative(root, target);
  return relativePath === '' || (!!relativePath && !relativePath.startsWith('..') && !isAbsolute(relativePath));
}

async function ensureKnownAgent(agentId: string): Promise<void> {
  const snapshot = await listAgentsSnapshot();
  const agent = snapshot.agents.find((a) => a.id === agentId);
  if (!agent) {
    throw new OfficeSharedWorkspaceRpcException('UNKNOWN_AGENT', `Agent "${agentId}" not found`);
  }
}

async function getMirrorRoot(req: Pick<OfficeSharedWorkspaceRpcRequest, 'agent_id' | 'workspace_id'>): Promise<string> {
  await ensureKnownAgent(req.agent_id);
  return join(getOpenClawConfigDir(), 'office', 'admin-shared', validateWorkspaceId(req.workspace_id));
}

async function ensureMirrorRoot(req: OfficeSharedWorkspaceRpcRequest): Promise<string> {
  const root = await getMirrorRoot(req);
  await mkdir(root, { recursive: true });
  return realpath(root);
}

async function resolveWorkspacePath(root: string, filePath: string, options?: { forWrite?: boolean }): Promise<string> {
  const normalized = normalizeRelativePath(filePath);
  const target = resolve(root, normalized);
  if (!isInside(root, target)) {
    throw new OfficeSharedWorkspaceRpcException('INVALID_PATH', `Path escapes shared workspace: ${filePath}`);
  }
  if (options?.forWrite) {
    await mkdir(dirname(target), { recursive: true });
    const parentReal = await realpath(dirname(target));
    if (!isInside(root, parentReal)) {
      throw new OfficeSharedWorkspaceRpcException('INVALID_PATH', `Path parent escapes shared workspace: ${filePath}`);
    }
    try {
      const st = await lstat(target);
      if (st.isSymbolicLink()) {
        throw new OfficeSharedWorkspaceRpcException('INVALID_PATH', `Refusing to write symlink in shared workspace: ${filePath}`);
      }
    } catch (err) {
      if (err instanceof OfficeSharedWorkspaceRpcException) throw err;
    }
  } else {
    const parentReal = await realpath(dirname(target));
    if (!isInside(root, parentReal)) {
      throw new OfficeSharedWorkspaceRpcException('INVALID_PATH', `Path parent escapes shared workspace: ${filePath}`);
    }
  }
  return target;
}

function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function withoutChunkContent(chunk: OfficeSharedWorkspaceChunk): OfficeSharedWorkspaceChunk {
  const copy = { ...chunk };
  delete copy.content_base64;
  return copy;
}

async function hashFile(path: string): Promise<string> {
  const buffer = await readFile(path);
  return sha256(buffer);
}

async function loadManifest(root: string, req: OfficeSharedWorkspaceRpcRequest): Promise<Manifest> {
  const manifestPath = join(root, MANIFEST_FILE);
  try {
    const parsed = JSON.parse(await readFile(manifestPath, 'utf8')) as Manifest;
    if (parsed.workspace_id === req.workspace_id && parsed.files && typeof parsed.files === 'object') {
      return parsed;
    }
  } catch {
    // Missing or invalid manifests are recreated from the next commit.
  }
  return {
    workspace_id: req.workspace_id,
    agent_id: req.agent_id,
    task_id: req.task_id,
    run_id: req.run_id,
    revision: req.revision,
    base_revision: req.base_revision,
    updated_at: new Date().toISOString(),
    files: {},
  };
}

async function saveManifest(root: string, manifest: Manifest): Promise<void> {
  manifest.updated_at = new Date().toISOString();
  await writeFile(join(root, MANIFEST_FILE), JSON.stringify(manifest, null, 2), 'utf8');
}

async function walkFiles(root: string, dir = root): Promise<OfficeSharedWorkspaceFile[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: OfficeSharedWorkspaceFile[] = [];
  for (const entry of entries) {
    if (entry.name === MANIFEST_FILE) continue;
    const fullPath = join(dir, entry.name);
    const rel = relative(root, fullPath).split(sep).join('/');
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      out.push(...await walkFiles(root, fullPath));
      continue;
    }
    if (!entry.isFile()) continue;
    const st = await stat(fullPath);
    const digest = await hashFile(fullPath);
    out.push({ path: rel, size: st.size, sha256: digest, mtime_ms: st.mtimeMs });
  }
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

function enforceSizeLimits(fileSize: number, totalBytes?: number): void {
  if (fileSize > MAX_FILE_SIZE) {
    throw new OfficeSharedWorkspaceRpcException('SIZE_LIMIT', `Shared workspace file exceeds ${MAX_FILE_SIZE} bytes`);
  }
  if (totalBytes !== undefined && totalBytes > MAX_RUN_BYTES) {
    throw new OfficeSharedWorkspaceRpcException('SIZE_LIMIT', `Shared workspace snapshot exceeds ${MAX_RUN_BYTES} bytes`);
  }
}

async function writeInlineFile(root: string, file: OfficeSharedWorkspaceFile): Promise<void> {
  const filePath = normalizeRelativePath(file.path);
  if (typeof file.content_base64 !== 'string') return;
  const buffer = Buffer.from(file.content_base64, 'base64');
  enforceSizeLimits(buffer.length);
  const target = await resolveWorkspacePath(root, filePath, { forWrite: true });
  await writeFile(target, buffer);
  if (file.sha256 && sha256(buffer) !== file.sha256) {
    throw new OfficeSharedWorkspaceRpcException('HASH_MISMATCH', `Hash mismatch for shared workspace file: ${file.path}`);
  }
}

async function writeChunk(root: string, chunk: OfficeSharedWorkspaceChunk): Promise<OfficeSharedWorkspaceChunk> {
  const filePath = normalizeRelativePath(chunk.path);
  if (typeof chunk.content_base64 !== 'string') {
    throw new OfficeSharedWorkspaceRpcException('INVALID_CHUNK', `Chunk for "${chunk.path}" missing content_base64`);
  }
  if (!Number.isFinite(chunk.offset) || chunk.offset < 0) {
    throw new OfficeSharedWorkspaceRpcException('INVALID_CHUNK', `Chunk for "${chunk.path}" has invalid offset`);
  }
  const buffer = Buffer.from(chunk.content_base64, 'base64');
  if (chunk.size !== undefined && chunk.size !== buffer.length) {
    throw new OfficeSharedWorkspaceRpcException('INVALID_CHUNK', `Chunk size mismatch for "${chunk.path}"`);
  }
  if (buffer.length > MAX_CHUNK_SIZE) {
    throw new OfficeSharedWorkspaceRpcException('SIZE_LIMIT', `Chunk for "${chunk.path}" exceeds ${MAX_CHUNK_SIZE} bytes`);
  }
  const expectedTotal = chunk.total_size ?? chunk.offset + buffer.length;
  enforceSizeLimits(expectedTotal);
  const target = await resolveWorkspacePath(root, filePath, { forWrite: true });
  let handle: FileHandle;
  try {
    handle = await open(target, chunk.offset === 0 ? 'w' : 'r+');
  } catch {
    throw new OfficeSharedWorkspaceRpcException('INVALID_CHUNK', `Chunk for "${chunk.path}" arrived before the file was created`);
  }
  try {
    await handle.write(buffer, 0, buffer.length, chunk.offset);
  } finally {
    await handle.close();
  }
  if (chunk.is_last_chunk) {
    const st = await stat(target);
    if (chunk.total_size !== undefined && st.size !== chunk.total_size) {
      throw new OfficeSharedWorkspaceRpcException('INVALID_CHUNK', `Final chunk total size mismatch for "${chunk.path}"`);
    }
    const digest = await hashFile(target);
    if (chunk.sha256 && digest !== chunk.sha256) {
      throw new OfficeSharedWorkspaceRpcException('HASH_MISMATCH', `Hash mismatch for shared workspace file: ${chunk.path}`);
    }
    const rest = withoutChunkContent(chunk);
    return { ...rest, size: buffer.length, total_size: st.size, sha256: digest };
  }
  const rest = withoutChunkContent(chunk);
  return { ...rest, size: buffer.length };
}

async function readChunk(root: string, filePath: string, offset = 0, size = DEFAULT_CHUNK_SIZE): Promise<OfficeSharedWorkspaceChunk> {
  const normalized = normalizeRelativePath(filePath);
  if (size <= 0 || size > MAX_CHUNK_SIZE) {
    throw new OfficeSharedWorkspaceRpcException('INVALID_CHUNK', `Invalid chunk read size for "${filePath}"`);
  }
  const target = await resolveWorkspacePath(root, normalized);
  let st;
  try {
    st = await stat(target);
  } catch {
    throw new OfficeSharedWorkspaceRpcException('FILE_NOT_FOUND', `Shared workspace file not found: ${filePath}`);
  }
  if (!st.isFile()) {
    throw new OfficeSharedWorkspaceRpcException('INVALID_PATH', `Shared workspace path is not a file: ${filePath}`);
  }
  enforceSizeLimits(st.size);
  const handle = await open(target, constants.O_RDONLY);
  try {
    const readSize = Math.min(size, Math.max(0, st.size - offset));
    const buffer = Buffer.alloc(readSize);
    const result = await handle.read(buffer, 0, readSize, offset);
    const content = buffer.subarray(0, result.bytesRead);
    return {
      path: normalized,
      offset,
      size: result.bytesRead,
      total_size: st.size,
      sha256: await hashFile(target),
      is_last_chunk: offset + result.bytesRead >= st.size,
      content_base64: content.toString('base64'),
    };
  } finally {
    await handle.close();
  }
}

async function currentFileMap(root: string): Promise<Record<string, { size: number; sha256: string; mtime_ms: number }>> {
  const files = await walkFiles(root);
  const map: Record<string, { size: number; sha256: string; mtime_ms: number }> = {};
  for (const file of files) {
    if (!file.sha256 || file.deleted || file.is_directory) continue;
    map[file.path] = { size: file.size, sha256: file.sha256, mtime_ms: file.mtime_ms ?? 0 };
  }
  return map;
}

function diffFiles(
  current: Record<string, { size: number; sha256: string; mtime_ms: number }>,
  baseline: Record<string, { size: number; sha256: string; mtime_ms: number }>,
): OfficeSharedWorkspaceFile[] {
  const changed: OfficeSharedWorkspaceFile[] = [];
  for (const [path, file] of Object.entries(current)) {
    const prev = baseline[path];
    if (!prev || prev.sha256 !== file.sha256 || prev.size !== file.size) {
      changed.push({ path, ...file });
    }
  }
  for (const path of Object.keys(baseline)) {
    if (!current[path]) {
      changed.push({ path, size: 0, deleted: true });
    }
  }
  changed.sort((a, b) => a.path.localeCompare(b.path));
  return changed;
}

async function applyIncomingFiles(root: string, req: OfficeSharedWorkspaceRpcRequest): Promise<OfficeSharedWorkspaceChunk[]> {
  for (const file of req.files ?? []) {
    await writeInlineFile(root, file);
  }
  const writtenChunks: OfficeSharedWorkspaceChunk[] = [];
  for (const chunk of req.chunks ?? []) {
    writtenChunks.push(await writeChunk(root, chunk));
  }
  return writtenChunks;
}

function updateManifestIdentity(manifest: Manifest, req: OfficeSharedWorkspaceRpcRequest): void {
  manifest.task_id = req.task_id ?? manifest.task_id;
  manifest.run_id = req.run_id ?? manifest.run_id;
  manifest.base_revision = req.base_revision ?? manifest.base_revision;
  manifest.revision = req.revision ?? manifest.revision;
}

export function buildAdminSharedWorkspacePolicy(metadata: unknown): string | null {
  if (!isRecord(metadata)) return null;
  const shared = metadata.office_shared_workspace;
  if (!isRecord(shared)) return null;
  const workspaceId = typeof shared.workspace_id === 'string' ? shared.workspace_id.trim() : '';
  const projectRoot = typeof shared.project_root === 'string' ? shared.project_root.trim() : '';
  if (!workspaceId || !projectRoot) return null;
  const revision = typeof shared.revision === 'string' && shared.revision.trim()
    ? shared.revision.trim()
    : 'current';
  return [
    'Admin Console shared workspace policy:',
    `- This task uses shared workspace "${workspaceId}" at: ${projectRoot}`,
    '- Treat that directory as the project root for all reads, writes, commands, and deliverables.',
    '- Agents on this same client share this Admin workspace mirror for the run.',
    '- Do not create task artifacts in the normal local Office project workspace unless explicitly asked.',
    `- Workspace revision: ${revision}`,
  ].join('\n');
}

export function decorateChatSendParamsWithAdminSharedWorkspace(params: unknown): unknown {
  if (!isRecord(params)) return params;
  const { metadata: legacyMetadata, __admin_console_metadata: adminMetadata, ...gatewayParams } = params;
  const policy = buildAdminSharedWorkspacePolicy(adminMetadata ?? legacyMetadata);
  if (!policy) return gatewayParams;
  const message = typeof params.message === 'string'
    ? params.message
    : typeof params.content === 'string'
      ? params.content
      : '';
  const decorated = `${policy}\n\n${message}`.trim();
  if (typeof params.message === 'string') {
    return { ...gatewayParams, message: decorated };
  }
  if (typeof params.content === 'string') {
    return { ...gatewayParams, content: decorated };
  }
  return { ...gatewayParams, message: policy };
}

export async function handleOfficeSharedWorkspaceRpc(input: unknown): Promise<OfficeSharedWorkspaceRpcResponse> {
  let req: OfficeSharedWorkspaceRpcRequest;
  try {
    req = normalizeRequest(input);
    const root = await ensureMirrorRoot(req);
    const manifest = await loadManifest(root, req);
    updateManifestIdentity(manifest, req);

    if (req.op === 'cleanup') {
      await rm(root, { recursive: true, force: true });
      return { ok: true, workspace_id: req.workspace_id, revision: manifest.revision };
    }

    if (req.op === 'prepare') {
      const chunks = await applyIncomingFiles(root, req);
      manifest.files = await currentFileMap(root);
      await saveManifest(root, manifest);
      return { ok: true, workspace_id: req.workspace_id, revision: manifest.revision, project_root: root, chunks };
    }

    if (req.op === 'push_chunk') {
      const chunks = await applyIncomingFiles(root, req);
      manifest.files = await currentFileMap(root);
      await saveManifest(root, manifest);
      return { ok: true, workspace_id: req.workspace_id, revision: manifest.revision, project_root: root, chunks };
    }

    if (req.op === 'pull_chunk' || req.op === 'read') {
      const targetPath = req.path ?? req.paths?.[0];
      if (!targetPath) {
        throw new OfficeSharedWorkspaceRpcException('INVALID_PAYLOAD', `${req.op} requires "path"`);
      }
      const chunk = await readChunk(root, targetPath, req.offset ?? 0, req.size ?? DEFAULT_CHUNK_SIZE);
      return { ok: true, workspace_id: req.workspace_id, revision: manifest.revision, project_root: root, chunks: [chunk] };
    }

    if (req.op === 'list') {
      return { ok: true, workspace_id: req.workspace_id, revision: manifest.revision, project_root: root, files: await walkFiles(root) };
    }

    if (req.op === 'snapshot') {
      const current = await currentFileMap(root);
      const changed = diffFiles(current, manifest.files);
      const totalBytes = changed.reduce((sum, file) => sum + (file.deleted ? 0 : file.size), 0);
      enforceSizeLimits(0, totalBytes);
      return { ok: true, workspace_id: req.workspace_id, revision: manifest.revision, project_root: root, files: changed };
    }

    if (req.op === 'commit') {
      const chunks = await applyIncomingFiles(root, req);
      const current = await currentFileMap(root);
      const changed = diffFiles(current, manifest.files);
      manifest.files = current;
      manifest.revision = req.revision ?? manifest.revision;
      await saveManifest(root, manifest);
      return { ok: true, workspace_id: req.workspace_id, revision: manifest.revision, project_root: root, files: changed, chunks };
    }

    throw new OfficeSharedWorkspaceRpcException('INVALID_PAYLOAD', `Unsupported office workspace op: ${req.op}`);
  } catch (err) {
    const error = err instanceof OfficeSharedWorkspaceRpcException
      ? { code: err.code, message: err.message }
      : { code: 'WORKSPACE_IO_ERROR' as const, message: err instanceof Error ? err.message : String(err) };
    const workspaceId = isRecord(input) && typeof input.workspace_id === 'string' ? input.workspace_id : '';
    logger.error(`[admin-console] office_workspace_rpc failed: ${error.code} ${error.message}`);
    return { ok: false, workspace_id: workspaceId, error };
  }
}
