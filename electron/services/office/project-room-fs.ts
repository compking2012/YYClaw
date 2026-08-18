import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  filterRecordsByEpoch,
  parseNdjsonLines,
  PROJECT_MANIFEST_FILE,
  PROJECT_ROOM_MIRROR_FILE,
  type RoomMirrorLine,
} from '../../../src/lib/office-project-context';
import { roomMessageFromAgentId } from '../../../src/lib/office-agent-id-resolve';
import { tempProjectRoot } from './office-project-paths';
import { withOfficeProjectDirLock } from './office-project-dir-lock';
import { ensureOfficeProjectDirectory } from './project-context-paths';
import type { OfficeFixedGroup, OfficeTempProject, RoomMessage } from './types';

/** 同 project room.jsonl 读-改-写串行，避免并行 append 互相覆盖（如多人同时极速回复）。 */
const roomWriteChains = new Map<string, Promise<unknown>>();

function withProjectRoomWriteLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const trimmed = projectId.trim();
  const prev = roomWriteChains.get(trimmed) ?? Promise.resolve();
  const next = prev.then(fn, fn).finally(() => {
    if (roomWriteChains.get(trimmed) === next) {
      roomWriteChains.delete(trimmed);
    }
  });
  roomWriteChains.set(trimmed, next);
  return next as Promise<T>;
}

export type ProjectRoomStorageContext = {
  project: OfficeTempProject;
  group?: OfficeFixedGroup;
  epoch: number;
};

type TempProjectManifest = {
  projectId: string;
  projectTitle: string;
  epoch: number;
  startedAt: number;
  coordinatorAgentId: string;
};

function roomFilePath(projectTitle: string, projectId: string): string {
  return join(tempProjectRoot(projectTitle, projectId), PROJECT_ROOM_MIRROR_FILE);
}

function manifestFilePath(projectTitle: string, projectId: string): string {
  return join(tempProjectRoot(projectTitle, projectId), PROJECT_MANIFEST_FILE);
}

async function readTempProjectManifest(
  project: Pick<OfficeTempProject, 'id' | 'title'>,
): Promise<TempProjectManifest | null> {
  try {
    const raw = await readFile(manifestFilePath(project.title, project.id), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const projectId =
      typeof parsed.projectId === 'string'
        ? parsed.projectId
        : typeof parsed.taskId === 'string'
          ? parsed.taskId
          : '';
    if (!projectId) return null;
    return {
      projectId,
      projectTitle: String(parsed.projectTitle ?? parsed.taskTitle ?? project.title),
      epoch: typeof parsed.epoch === 'number' ? parsed.epoch : 1,
      startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : Date.now(),
      coordinatorAgentId: String(parsed.coordinatorAgentId ?? ''),
    };
  } catch {
    return null;
  }
}

async function ensureTempProjectManifest(project: OfficeTempProject): Promise<TempProjectManifest> {
  const existing = await readTempProjectManifest(project);
  if (existing) return existing;
  const manifest: TempProjectManifest = {
    projectId: project.id,
    projectTitle: project.title,
    epoch: 1,
    startedAt: Date.now(),
    coordinatorAgentId: project.coordinatorAgentId,
  };
  await ensureOfficeProjectDirectory(project);
  await writeFile(
    manifestFilePath(project.title, project.id),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  return manifest;
}

export async function resolveProjectRoomContext(
  projectId: string,
): Promise<ProjectRoomStorageContext | null> {
  const { getFixedGroup, getTempProject } = await import('./store');
  const project = await getTempProject(projectId);
  if (!project) return null;
  const group = project.parentGroupId
    ? await getFixedGroup(project.parentGroupId)
    : undefined;
  const manifest = await ensureTempProjectManifest(project);
  return {
    project,
    group,
    epoch: manifest.epoch,
  };
}

function normalizeRoomMessage(raw: Record<string, unknown>, projectId: string): RoomMessage | null {
  if (!raw?.id || typeof raw.id !== 'string') return null;
  const resolvedProjectId =
    typeof raw.projectId === 'string'
      ? raw.projectId
      : typeof raw.taskId === 'string'
        ? raw.taskId
        : projectId;
  return {
    id: raw.id,
    groupId:
      typeof raw.groupId === 'string'
        ? raw.groupId
        : typeof raw.scenarioId === 'string'
          ? raw.scenarioId
          : undefined,
    projectId: resolvedProjectId,
    from: (raw.from as RoomMessage['from']) ?? 'system',
    fromAgentId: (() => {
      const resolved = roomMessageFromAgentId({
        fromAgentId: typeof raw.fromAgentId === 'string' ? raw.fromAgentId : undefined,
        fromRoleId: typeof raw.fromRoleId === 'string' ? raw.fromRoleId : undefined,
        from: (raw.from as RoomMessage['from']) ?? 'system',
      } as Parameters<typeof roomMessageFromAgentId>[0]);
      return resolved || undefined;
    })(),
    content: String(raw.content ?? ''),
    mentions: Array.isArray(raw.mentions) ? (raw.mentions as string[]) : [],
    timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : Date.now(),
    runIds: Array.isArray(raw.runIds) ? (raw.runIds as string[]) : undefined,
    phase: raw.phase as RoomMessage['phase'],
    progressText: typeof raw.progressText === 'string' ? raw.progressText : undefined,
    nodeId: typeof raw.nodeId === 'string' ? raw.nodeId : undefined,
    replyToId: typeof raw.replyToId === 'string' ? raw.replyToId : undefined,
    replyPreview: typeof raw.replyPreview === 'string' ? raw.replyPreview : undefined,
    smartCoordinatorEnd: raw.smartCoordinatorEnd === true ? true : undefined,
    smartMemberEnd: raw.smartMemberEnd === true ? true : undefined,
    smartJsonRaw: typeof raw.smartJsonRaw === 'string' ? raw.smartJsonRaw : undefined,
    attachments: normalizeRoomAttachments(raw.attachments),
  };
}

function normalizeRoomAttachments(raw: unknown): RoomMessage['attachments'] {
  if (!Array.isArray(raw)) return undefined;
  const out: NonNullable<RoomMessage['attachments']> = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const absPath = typeof row.absPath === 'string' ? row.absPath.trim() : '';
    const displayName = typeof row.displayName === 'string' ? row.displayName.trim() : '';
    if (!absPath || !displayName) continue;
    const kind = row.kind === 'zip' ? 'zip' : 'zip';
    out.push({
      absPath,
      displayName,
      kind,
      fileCount: typeof row.fileCount === 'number' ? row.fileCount : undefined,
      sizeBytes: typeof row.sizeBytes === 'number' ? row.sizeBytes : undefined,
    });
  }
  return out.length > 0 ? out : undefined;
}

async function readAllRoomLines(
  projectTitle: string,
  projectId: string,
): Promise<RoomMirrorLine[]> {
  try {
    const raw = await readFile(roomFilePath(projectTitle, projectId), 'utf8');
    return parseNdjsonLines<RoomMirrorLine>(raw);
  } catch {
    return [];
  }
}

async function writeAllRoomLines(
  projectTitle: string,
  projectId: string,
  lines: RoomMirrorLine[],
): Promise<void> {
  return withOfficeProjectDirLock(projectId, async () => {
    const root = tempProjectRoot(projectTitle, projectId);
    await mkdir(root, { recursive: true });
    const body = lines.map((l) => JSON.stringify(l)).join('\n');
    await writeFile(roomFilePath(projectTitle, projectId), body ? `${body}\n` : '', 'utf8');
  });
}

/** Import legacy data.json room bucket once, then drop from store. */
async function migrateLegacyRoomMessagesToProject(projectId: string): Promise<void> {
  const ctx = await resolveProjectRoomContext(projectId);
  if (!ctx) return;

  const { loadStore, saveStore } = await import('./store');
  const s = await loadStore();
  const legacy = s.roomMessages[projectId];
  if (!legacy?.length) return;

  const existing = await readAllRoomLines(ctx.project.title, ctx.project.id);
  const currentEpochLines = filterRecordsByEpoch(existing, ctx.epoch);
  if (currentEpochLines.length > 0) {
    delete s.roomMessages[projectId];
    await saveStore(s);
    return;
  }

  const otherEpoch = existing.filter((l) => l.epoch !== ctx.epoch);
  const imported: RoomMirrorLine[] = legacy.map((m) => ({
    epoch: ctx.epoch,
    message: { ...m, projectId } as unknown as Record<string, unknown>,
  }));
  await writeAllRoomLines(ctx.project.title, ctx.project.id, [...otherEpoch, ...imported]);
  delete s.roomMessages[projectId];
  await saveStore(s);
}

export async function getProjectRoomMessages(projectId: string): Promise<RoomMessage[]> {
  const ctx = await resolveProjectRoomContext(projectId);
  if (!ctx) return [];

  await migrateLegacyRoomMessagesToProject(projectId);

  const lines = filterRecordsByEpoch(
    await readAllRoomLines(ctx.project.title, ctx.project.id),
    ctx.epoch,
  );
  const messages: RoomMessage[] = [];
  for (const line of lines) {
    const m = normalizeRoomMessage(line.message, projectId);
    if (m) messages.push(m);
  }
  return messages.sort((a, b) => a.timestamp - b.timestamp);
}

export async function appendProjectRoomMessage(msg: RoomMessage): Promise<RoomMessage> {
  const bucketId = msg.projectId?.trim();
  if (!bucketId) throw new Error('Room message requires projectId');
  return withProjectRoomWriteLock(bucketId, async () => {
    const ctx = await resolveProjectRoomContext(bucketId);
    if (!ctx) throw new Error(`Cannot resolve project room storage for project ${bucketId}`);

    const normalized: RoomMessage = { ...msg, projectId: bucketId };
    const all = await readAllRoomLines(ctx.project.title, ctx.project.id);
    const otherEpoch = all.filter((l) => l.epoch !== ctx.epoch);
    const current = filterRecordsByEpoch(all, ctx.epoch);
    const norm = (text: string) => text.replace(/\s+/g, ' ').trim();
    const now = Date.now();
    for (const line of current) {
      const prev = normalizeRoomMessage(line.message, bucketId);
      if (!prev || prev.id === normalized.id) continue;
      if (prev.fromAgentId !== normalized.fromAgentId) continue;
      if (norm(prev.content ?? '') !== norm(normalized.content ?? '')) continue;
      if (now - prev.timestamp < 10_000) return prev;
    }
    current.push({
      epoch: ctx.epoch,
      message: normalized as unknown as Record<string, unknown>,
    });
    await writeAllRoomLines(ctx.project.title, ctx.project.id, [...otherEpoch, ...current]);
    return normalized;
  });
}

export async function updateProjectRoomMessage(
  projectId: string,
  messageId: string,
  patch: Partial<
    Pick<
      RoomMessage,
      | 'content'
      | 'progressText'
      | 'timestamp'
      | 'mentions'
      | 'phase'
      | 'projectId'
      | 'nodeId'
      | 'smartCoordinatorEnd'
      | 'smartMemberEnd'
    >
  >,
): Promise<RoomMessage | null> {
  const trimmed = projectId.trim();
  if (!trimmed) return null;
  return withProjectRoomWriteLock(trimmed, async () => {
    const ctx = await resolveProjectRoomContext(trimmed);
    if (!ctx) return null;

    const all = await readAllRoomLines(ctx.project.title, ctx.project.id);
    let updated: RoomMessage | null = null;
    const next = all.map((line) => {
      if (line.epoch !== ctx.epoch) return line;
      const m = normalizeRoomMessage(line.message, trimmed);
      if (!m || m.id !== messageId) return line;
      updated = {
        ...m,
        ...patch,
        projectId: patch.projectId ?? m.projectId ?? trimmed,
        timestamp: patch.timestamp ?? Date.now(),
      };
      return { epoch: line.epoch, message: updated as unknown as Record<string, unknown> };
    });
    if (!updated) return null;
    await writeAllRoomLines(ctx.project.title, ctx.project.id, next);
    return updated;
  });
}

export async function clearProjectRoomMessages(
  projectId: string,
  opts?: { wipeAllEpochs?: boolean },
): Promise<void> {
  const ctx = await resolveProjectRoomContext(projectId);
  if (!ctx) return;
  if (opts?.wipeAllEpochs) {
    await writeAllRoomLines(ctx.project.title, ctx.project.id, []);
  } else {
    const all = await readAllRoomLines(ctx.project.title, ctx.project.id);
    const kept = all.filter((l) => l.epoch !== ctx.epoch);
    await writeAllRoomLines(ctx.project.title, ctx.project.id, kept);
  }

  const { loadStore, saveStore } = await import('./store');
  const s = await loadStore();
  if (s.roomMessages[projectId]) {
    delete s.roomMessages[projectId];
    await saveStore(s);
  }
}
