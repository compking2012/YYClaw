import AdmZip from 'adm-zip';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { dirname, relative } from 'node:path';
import { join } from 'node:path';
import type { GatewayManager } from '../../gateway/manager';
import { roomMessageProjectId } from '../../../src/lib/office-agent-id-resolve';
import { compressPathToTilde } from '../../../src/lib/office-workflow-closure-deliverables';
import {
  projectBundleZipFileName,
} from '../../../src/lib/office-workflow-project-deliverable';
import { expandPath } from '../../utils/paths';
import {
  appendRoomMessage,
  getTempProject,
  listFixedGroups,
  getRoomMessages,
} from './store';
import { roomMessageReplyPreview } from '../../../src/lib/office-room-reply';
import { MAX_PROJECT_BUNDLE_BYTES, tempProjectBundleZipPath, tempProjectRoot } from './office-project-paths';
import { resolveOfficeProjectRootForSessionMd } from './project-context-paths';
import { collectAllSubstantiveDeliverableFiles } from './workflow-project-deliverable-fs';
import type { OfficeTempProject, RoomMessage, RoomMessageAttachment, TaskStatus } from './types';

/** @deprecated 展示用旧名；结项 zip 现为 `<项目名>.zip`。 */
export function projectDeliverablesBundleBaseName(projectTitle: string): string {
  return projectBundleZipFileName(projectTitle).replace(/\.zip$/iu, '');
}

export function projectDeliverablesBundleFileName(projectTitle: string): string {
  return projectBundleZipFileName(projectTitle);
}

export function projectDeliverablesBundleAbsPath(
  projectTitle: string,
  projectId: string,
): string {
  return tempProjectBundleZipPath(projectTitle, projectId);
}

/** 删除项目目录下的结项交付物 zip（项目重新执行前调用）。 */
export async function removeProjectDeliverablesBundle(
  projectTitle: string,
  projectId: string,
): Promise<void> {
  const bundlePath = projectDeliverablesBundleAbsPath(projectTitle, projectId);
  try {
    await unlink(bundlePath);
  } catch {
    // absent
  }
}

export type ProjectDeliverablesBundleResult = {
  zipAbsPath: string;
  displayName: string;
  fileCount: number;
  zipBytes: number;
  truncated?: boolean;
};

export async function buildProjectDeliverablesZipArchive(params: {
  projectTitle: string;
  projectId: string;
  projectRoot?: string;
}): Promise<ProjectDeliverablesBundleResult | null> {
  const root = expandPath(
    params.projectRoot ?? tempProjectRoot(params.projectTitle, params.projectId),
  );
  const bundleName = projectBundleZipFileName(params.projectTitle);
  const bundlePath = join(root, bundleName);

  const files = await collectAllSubstantiveDeliverableFiles(root, {
    excludeAbsPaths: new Set([expandPath(bundlePath)]),
    projectTitle: params.projectTitle,
  });
  if (files.length === 0) return null;

  try {
    await unlink(bundlePath);
  } catch {
    // no prior bundle
  }

  const zip = new AdmZip();
  let included = 0;
  let totalBytes = 0;
  let truncated = false;
  for (const absPath of files) {
    let size: number;
    try {
      size = (await stat(absPath)).size;
    } catch {
      continue;
    }
    if (totalBytes + size > MAX_PROJECT_BUNDLE_BYTES) {
      truncated = true;
      continue;
    }
    const rel = relative(root, absPath);
    const zipDir = dirname(rel);
    zip.addLocalFile(absPath, zipDir === '.' ? '' : zipDir);
    totalBytes += size;
    included += 1;
  }
  if (included === 0) return null;

  await mkdir(root, { recursive: true });
  zip.writeZip(bundlePath);

  const st = await stat(bundlePath);
  return {
    zipAbsPath: bundlePath,
    displayName: bundleName,
    fileCount: included,
    zipBytes: st.size,
    truncated,
  };
}

function formatZipSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 结项后系统交付物下载消息正文（醒目、与协调者结项正文分离）。 */
export function buildDeliverablesBundleRoomContent(params: {
  taskTitle: string;
  bundle: ProjectDeliverablesBundleResult;
}): string {
  const { taskTitle, bundle } = params;
  const tildePath = compressPathToTilde(bundle.zipAbsPath);
  const lines = [
    '════════════════════════════════',
    '📦 【可下载】项目交付物已打包',
    '════════════════════════════════',
    '',
    `项目「${taskTitle}」已结项。系统已将各成员 \`交付物-Agent/\` 目录下的交付物打包为 zip（不含 session、status/群聊镜像等系统文件）。`,
    '',
    `▸ 文件名：${bundle.displayName}`,
    `▸ 体积：${formatZipSize(bundle.zipBytes)} · 共 ${bundle.fileCount} 个文件`,
    bundle.truncated
      ? `▸ 说明：部分文件因超过 ${Math.round(MAX_PROJECT_BUNDLE_BYTES / (1024 * 1024))}MB 上限未纳入 zip`
      : null,
    `▸ 路径：${tildePath}`,
    '',
    '👇 请使用本消息下方附件点击「另存为」下载 zip。',
  ].filter(Boolean);
  return lines.join('\n');
}

/** 结项后无 substantive 交付物时的系统说明（仍排在结项之后，与 zip 消息区分）。 */
export function buildNoDeliverablesBundleRoomContent(projectTitle: string): string {
  const lines = [
    '════════════════════════════════',
    '📦 【结项说明】暂无可打包的项目交付物',
    '════════════════════════════════',
    '',
    `项目「${projectTitle}」已结项。系统未在项目目录的 \`交付物-Agent/\` 目录中发现可打包的交付文件（不含 session、status/群聊镜像等系统文件）。`,
    '',
    '若应有交付物，请确认各成员已将产出写入协调者项目目录后联系管理员排查。',
  ];
  return lines.join('\n');
}

export type DeliverablesBundlePublishOutcome =
  | { status: 'published'; message: RoomMessage }
  | { status: 'no_files'; message: RoomMessage }
  | { status: 'already_announced'; message: RoomMessage }
  | { status: 'closure_missing' }
  | { status: 'root_missing' };

const CLOSURE_ROOM_WAIT_MS = 40;
const CLOSURE_ROOM_MAX_ATTEMPTS = 8;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** 协调者在群内发布的结项说明（Smart **结项** / Workflow project_closure）。 */
export function isCoordinatorClosureRoomMessage(
  message: Pick<RoomMessage, 'fromAgentId' | 'smartCoordinatorEnd' | 'phase'>,
  coordinatorAgentId: string,
): boolean {
  if (!coordinatorAgentId || message.fromAgentId !== coordinatorAgentId) return false;
  return message.smartCoordinatorEnd === true || message.phase === 'project_closure';
}

/** Smart 结项锚点：仅 JSON action=end（smartCoordinatorEnd）或正文含【结项】，不接受 phase 推断。 */
export function isSmartCoordinatorClosureAnchor(
  message: Pick<RoomMessage, 'fromAgentId' | 'smartCoordinatorEnd' | 'content' | 'progressText'>,
  coordinatorAgentId: string,
): boolean {
  if (!coordinatorAgentId || message.fromAgentId !== coordinatorAgentId) return false;
  if (message.smartCoordinatorEnd === true) return true;
  const body = `${message.content ?? ''}\n${message.progressText ?? ''}`.trim();
  return /【结项】/u.test(body);
}

export function roomMessageLooksLikeCoordinatorClosure(
  message: Pick<RoomMessage, 'fromAgentId' | 'smartCoordinatorEnd' | 'phase' | 'content' | 'progressText'>,
  coordinatorAgentId: string,
): boolean {
  if (isSmartCoordinatorClosureAnchor(message, coordinatorAgentId)) return true;
  if (isCoordinatorClosureRoomMessage(message, coordinatorAgentId)) return true;
  return false;
}

/** 等待协调者结项消息落盘（结项发布与打包消息之间可能有写盘延迟）。 */
export async function waitForCoordinatorClosureRoomMessage(
  projectId: string,
  afterMessageId: string,
  coordinatorAgentId: string,
): Promise<RoomMessage | null> {
  const anchorId = afterMessageId.trim();
  if (!anchorId || !coordinatorAgentId) return null;

  for (let attempt = 0; attempt < CLOSURE_ROOM_MAX_ATTEMPTS; attempt += 1) {
    const messages = await getRoomMessages(projectId);
    const hit = messages.find((m) => m.id === anchorId);
    if (hit && roomMessageLooksLikeCoordinatorClosure(hit, coordinatorAgentId)) {
      return hit;
    }
    if (attempt < CLOSURE_ROOM_MAX_ATTEMPTS - 1) {
      await sleepMs(CLOSURE_ROOM_WAIT_MS);
    }
  }
  return null;
}

function deliverablesBundlePublishTiming(closure: RoomMessage): {
  timestamp: number;
  replyToId: string;
  replyPreview: string;
} {
  return {
    timestamp: Math.max(Date.now(), closure.timestamp + 1),
    replyToId: closure.id,
    replyPreview: roomMessageReplyPreview(closure, 80),
  };
}

export async function deliverablesBundleAlreadyAnnounced(projectId: string): Promise<boolean> {
  const messages = await getRoomMessages(projectId);
  return messages.some((m) => m.phase === 'deliverable_bundle');
}

/** 已有 zip 系统消息是否已覆盖该结项锚点（replyToId 优先；结项更晚则需重新打包发布）。 */
export function deliverablesBundleCoversClosure(
  bundleMessage: Pick<RoomMessage, 'timestamp' | 'replyToId'>,
  closureMessage: Pick<RoomMessage, 'timestamp' | 'id'>,
): boolean {
  const closureId = closureMessage.id?.trim();
  const replyToId = bundleMessage.replyToId?.trim();
  if (closureId) {
    if (!replyToId) return false;
    return replyToId === closureId;
  }
  return bundleMessage.timestamp > closureMessage.timestamp;
}

export function findCoordinatorProjectClosureInRoomMessages(
  messages: RoomMessage[],
  projectId: string,
  coordinatorAgentId: string,
): RoomMessage | null {
  const sorted = messages
    .filter(
      (m) =>
        roomMessageProjectId(m) === projectId
        && m.fromAgentId === coordinatorAgentId
        && m.phase === 'project_closure',
    )
    .sort((a, b) => b.timestamp - a.timestamp);
  return sorted[0] ?? null;
}

export async function latestDeliverablesBundleMessage(
  projectId: string,
): Promise<RoomMessage | null> {
  const messages = await getRoomMessages(projectId);
  const bundles = messages.filter((m) => m.phase === 'deliverable_bundle');
  if (bundles.length === 0) return null;
  return bundles.sort((a, b) => b.timestamp - a.timestamp)[0] ?? null;
}

/** 项目由非 completed 进入 completed 时是否应尝试打包（执行中/待启动 → 已完成）。 */
export function shouldPublishDeliverablesBundleOnCompletion(
  project: Pick<OfficeTempProject, 'status'>,
  previousStatus?: TaskStatus,
): boolean {
  if (project.status !== 'completed') return false;
  if (previousStatus === 'completed') return false;
  if (previousStatus == null) return true;
  return (
    previousStatus === 'running'
    || previousStatus === 'pending'
    || previousStatus === 'blocked'
    || previousStatus === 'aborted'
    || previousStatus === 'failed'
  );
}

const deliverablesBundlePublishInflight = new Map<string, Promise<DeliverablesBundlePublishOutcome>>();

async function publishProjectDeliverablesBundleMessageInner(
  _gateway: GatewayManager | null,
  params: {
    groupId?: string;
    project: Pick<OfficeTempProject, 'id' | 'title' | 'coordinatorAgentId'>;
    afterMessageId: string;
    coordinatorAgentId: string;
    /** 已解析的结项锚点（传入则跳过 wait）。 */
    closure?: RoomMessage | null;
  },
): Promise<DeliverablesBundlePublishOutcome> {
  const closure =
    params.closure
    ?? (await waitForCoordinatorClosureRoomMessage(
      params.project.id,
      params.afterMessageId,
      params.coordinatorAgentId,
    ));
  if (!closure) {
    console.warn(
      '[office] deliverables bundle: coordinator closure not in room yet',
      params.project.id,
      params.afterMessageId,
    );
    return { status: 'closure_missing' };
  }
  if (!roomMessageLooksLikeCoordinatorClosure(closure, params.coordinatorAgentId)) {
    console.warn(
      '[office] deliverables bundle: anchor is not a coordinator closure message',
      params.project.id,
      params.afterMessageId,
    );
    return { status: 'closure_missing' };
  }

  const roomMessages = await getRoomMessages(params.project.id);
  const bundleForClosure = roomMessages.find(
    (m) => m.phase === 'deliverable_bundle' && m.replyToId === closure.id,
  );
  if (bundleForClosure) {
    return { status: 'already_announced', message: bundleForClosure };
  }

  const existingBundle = await latestDeliverablesBundleMessage(params.project.id);
  if (existingBundle && deliverablesBundleCoversClosure(existingBundle, closure)) {
    return { status: 'already_announced', message: existingBundle };
  }

  const storedProject = await getTempProject(params.project.id);
  const projectRoot = storedProject
    ? await resolveOfficeProjectRootForSessionMd(storedProject)
    : tempProjectRoot(params.project.title, params.project.id);
  const bundle = await buildProjectDeliverablesZipArchive({
    projectTitle: params.project.title,
    projectId: params.project.id,
    projectRoot,
  });
  const timing = deliverablesBundlePublishTiming(closure);

  if (!bundle) {
    console.info('[office] deliverables bundle: no substantive files', params.project.id);
    const msg: RoomMessage = {
      id: `room-${timing.timestamp}-deliverable-bundle-empty`,
      groupId: params.groupId,
      projectId: params.project.id,
      from: 'system',
      content: buildNoDeliverablesBundleRoomContent(params.project.title),
      mentions: [],
      timestamp: timing.timestamp,
      phase: 'deliverable_bundle',
      progressText: '📦 【结项说明】暂无可打包的项目交付物',
      replyToId: timing.replyToId,
      replyPreview: timing.replyPreview,
    };
    // deferSideEffects: bundle append must not re-enter Smart finalize (deadlock with inflight closure).
    await appendRoomMessage(msg, { deferSideEffects: true });
    return { status: 'no_files', message: msg };
  }

  const attachments: RoomMessageAttachment[] = [
    {
      absPath: bundle.zipAbsPath,
      displayName: bundle.displayName,
      kind: 'zip',
      fileCount: bundle.fileCount,
      sizeBytes: bundle.zipBytes,
    },
  ];

  const content = buildDeliverablesBundleRoomContent({
    taskTitle: params.project.title,
    bundle,
  });

  const msg: RoomMessage = {
    id: `room-${timing.timestamp}-deliverable-bundle`,
    groupId: params.groupId,
    projectId: params.project.id,
    from: 'system',
    content,
    mentions: [],
    timestamp: timing.timestamp,
    phase: 'deliverable_bundle',
    progressText: '📦 【可下载】项目交付物已打包',
    attachments,
    replyToId: timing.replyToId,
    replyPreview: timing.replyPreview,
  };
  // deferSideEffects: bundle append must not re-enter Smart finalize (deadlock with inflight closure).
  await appendRoomMessage(msg, { deferSideEffects: true });
  return { status: 'published', message: msg };
}

/** 同一结项锚点并发打包时只执行一次（Smart / Workflow 共用）。 */
export async function publishProjectDeliverablesBundleMessage(
  gateway: GatewayManager | null,
  params: {
    groupId?: string;
    project: Pick<OfficeTempProject, 'id' | 'title' | 'coordinatorAgentId'>;
    afterMessageId: string;
    coordinatorAgentId: string;
    closure?: RoomMessage | null;
  },
): Promise<DeliverablesBundlePublishOutcome> {
  const anchorId = params.afterMessageId.trim();
  const inflightKey = `${params.project.id}:${anchorId}`;
  const existing = deliverablesBundlePublishInflight.get(inflightKey);
  if (existing) return existing;
  const work = publishProjectDeliverablesBundleMessageInner(gateway, params).finally(() => {
    deliverablesBundlePublishInflight.delete(inflightKey);
  });
  deliverablesBundlePublishInflight.set(inflightKey, work);
  return work;
}

export function deliverablesBundlePublishSucceeded(
  outcome: DeliverablesBundlePublishOutcome,
): outcome is
  | { status: 'published'; message: RoomMessage }
  | { status: 'no_files'; message: RoomMessage }
  | { status: 'already_announced'; message: RoomMessage } {
  return (
    outcome.status === 'published'
    || outcome.status === 'no_files'
    || outcome.status === 'already_announced'
  );
}

/**
 * Smart 结项：在任务标为 completed 之前发布系统交付物消息（zip 或无可打包说明）。
 */
export async function ensureDeliverablesBundleAfterCoordinatorClosure(
  gateway: GatewayManager | null,
  params: PublishDeliverablesBundleAfterClosureParams,
): Promise<DeliverablesBundlePublishOutcome> {
  const closure = await waitForCoordinatorClosureRoomMessage(
    params.project.id,
    params.afterMessageId,
    params.coordinatorAgentId,
  );
  if (!closure || !roomMessageLooksLikeCoordinatorClosure(closure, params.coordinatorAgentId)) {
    return { status: 'closure_missing' };
  }
  const existingBundle = await latestDeliverablesBundleMessage(params.project.id);
  if (existingBundle && deliverablesBundleCoversClosure(existingBundle, closure)) {
    return { status: 'already_announced', message: existingBundle };
  }
  return publishProjectDeliverablesBundleMessage(gateway, {
    groupId: params.groupId,
    project: params.project,
    afterMessageId: params.afterMessageId,
    coordinatorAgentId: params.coordinatorAgentId,
    closure,
  });
}

export type PublishDeliverablesBundleAfterClosureParams = {
  groupId?: string;
  project: Pick<OfficeTempProject, 'id' | 'title' | 'coordinatorAgentId' | 'status'>;
  /** 协调者结项群聊消息 id（必须先于本调用发布到群聊）。 */
  afterMessageId: string;
  coordinatorAgentId: string;
  /** 已解析的结项锚点（传入则跳过 wait）。 */
  closure?: RoomMessage | null;
};

/**
 * 协调者结项说明已出现在群聊后，由系统发布交付物下载消息（排在结项之后）。
 * @deprecated 新 Smart 结项请用 {@link ensureDeliverablesBundleAfterCoordinatorClosure}（先打包再标 completed）。
 */
export async function publishDeliverablesBundleAfterCoordinatorClosure(
  gateway: GatewayManager | null,
  params: PublishDeliverablesBundleAfterClosureParams,
): Promise<RoomMessage | null> {
  if (params.project.status !== 'completed') return null;
  const outcome = await ensureDeliverablesBundleAfterCoordinatorClosure(gateway, params);
  return deliverablesBundlePublishSucceeded(outcome) ? outcome.message : null;
}

export type PublishProjectDeliverablesBundleParams = PublishDeliverablesBundleAfterClosureParams & {
  previousStatus?: TaskStatus;
};

export async function maybePublishProjectDeliverablesBundle(
  gateway: GatewayManager | null,
  params: PublishProjectDeliverablesBundleParams,
): Promise<RoomMessage | null> {
  if (!shouldPublishDeliverablesBundleOnCompletion(params.project, params.previousStatus)) {
    return null;
  }
  return publishDeliverablesBundleAfterCoordinatorClosure(gateway, params);
}

/** @deprecated 使用 {@link publishDeliverablesBundleAfterCoordinatorClosure} */
export async function ensureProjectDeliverablesBundlePublished(
  gateway: GatewayManager | null,
  params: PublishDeliverablesBundleAfterClosureParams,
): Promise<RoomMessage | null> {
  return publishDeliverablesBundleAfterCoordinatorClosure(gateway, params);
}

/** Resolve group + project for hooks that only have ids. */
export async function maybePublishProjectDeliverablesBundleForProject(
  gateway: GatewayManager | null,
  projectId: string,
  previousStatus?: TaskStatus,
): Promise<RoomMessage | null> {
  const project = await getTempProject(projectId);
  if (!project) return null;
  const groups = await listFixedGroups();
  const parentGroup = project.parentGroupId
    ? groups.find((g) => g.id === project.parentGroupId)
    : undefined;
  const coordinatorAgentId = project.coordinatorAgentId;
  const closure = [...(await getRoomMessages(projectId))]
    .filter((m) => isCoordinatorClosureRoomMessage(m, coordinatorAgentId))
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  if (!closure) return null;
  return maybePublishProjectDeliverablesBundle(gateway, {
    groupId: parentGroup?.id,
    project,
    previousStatus,
    afterMessageId: closure.id,
    coordinatorAgentId,
  });
}

/** @deprecated alias */
export const maybePublishProjectDeliverablesBundleForTask = maybePublishProjectDeliverablesBundleForProject;
