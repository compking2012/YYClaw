import type { GatewayManager } from '../../gateway/manager';
import { buildDeliverablePathsRoomContent } from '../../../src/lib/office-room-deliver';
import {
  declaredDeliverablePathsFromSmartMemberJson,
  normalizeDeliverablePathForDisk,
} from '../../../src/lib/office-deliverable-disk-resolve';
import { normalizeSmartDeliverableItemPath } from '../../../src/lib/office-deliverable-file-policy';
import { postRoomAnnouncement } from './orchestrator';
import { resolveRecordedProjectRoot } from './project-context-paths';
import { getRoomMessages } from './store';
import type { OfficeFixedGroup, OfficeTempProject } from './types';
import { resolveDeliverablePathOnDisk } from './workflow-project-deliverable-fs';

const DELIVERABLE_PATHS_ROOM_MARKER = '📎 交付物完整路径';
const pathAnnounceInflight = new Map<string, Promise<void>>();

/**
 * 将 Smart JSON deliverable.items 解析为磁盘上已验证的绝对路径（与落盘校验同一套 lookup）。
 * 禁止 naive join：成员 items 可能缺角色目录前缀，须 normalize + resolveDeliverablePathOnDisk。
 */
export async function resolveSmartMemberVerifiedDeliverableAbsolutePaths(params: {
  project: Pick<OfficeTempProject, 'id' | 'title' | 'projectRootPath'>;
  memberDisplayName: string;
  raw: string;
}): Promise<string[]> {
  const root = await resolveRecordedProjectRoot(params.project);
  if (!root) return [];
  const roleName = params.memberDisplayName.trim();
  if (!roleName) return [];

  const declared = declaredDeliverablePathsFromSmartMemberJson(params.raw);
  if (declared.length === 0) return [];

  const resolved: string[] = [];
  for (const item of declared) {
    const normalized = normalizeSmartDeliverableItemPath(item, roleName);
    const rel = normalizeDeliverablePathForDisk(normalized);
    if (!rel) continue;
    const hit = await resolveDeliverablePathOnDisk(root, rel, roleName);
    if (hit) resolved.push(hit);
  }
  return [...new Set(resolved)];
}

async function deliverablePathsAlreadyAnnounced(params: {
  projectId: string;
  memberAgentId: string;
  afterMemberMessageId?: string;
}): Promise<boolean> {
  const messages = await getRoomMessages(params.projectId);
  const afterId = params.afterMemberMessageId?.trim();
  if (afterId && messages.some((m) => m.id === `${afterId}-deliverable-paths`)) {
    return true;
  }
  return messages.some((m) => {
    if (m.phase !== 'task_deliver') return false;
    if (m.fromAgentId !== params.memberAgentId) return false;
    if (!m.content?.includes(DELIVERABLE_PATHS_ROOM_MARKER)) return false;
    if (afterId) {
      return m.replyToId === afterId;
    }
    return true;
  });
}

/**
 * Smart：成员 action=end 任务完成后，在群聊同步 deliverable.items 对应的完整（绝对）路径。
 * 与 Workflow runner 在 deliver/report 后调用 announceDeliverablePaths 的行为对齐。
 */
export async function announceSmartMemberDeliverablePaths(params: {
  gateway: GatewayManager;
  group: Pick<OfficeFixedGroup, 'id' | 'coordinatorAgentId'>;
  project: Pick<OfficeTempProject, 'id' | 'title' | 'projectRootPath'>;
  memberAgentId: string;
  memberDisplayName: string;
  raw: string;
  /** 成员 action=end 群聊消息 id（用于去重与 replyToId 关联）。 */
  afterMemberMessageId?: string;
}): Promise<void> {
  const inflightKey = [
    params.project.id,
    params.memberAgentId,
    params.afterMemberMessageId ?? '',
  ].join(':');
  const inflight = pathAnnounceInflight.get(inflightKey);
  if (inflight) {
    await inflight;
    return;
  }

  const work = (async () => {
    if (
      await deliverablePathsAlreadyAnnounced({
        projectId: params.project.id,
        memberAgentId: params.memberAgentId,
        afterMemberMessageId: params.afterMemberMessageId,
      })
    ) {
      return;
    }

    const absolute = await resolveSmartMemberVerifiedDeliverableAbsolutePaths({
      project: params.project,
      memberDisplayName: params.memberDisplayName,
      raw: params.raw,
    });
    const content = buildDeliverablePathsRoomContent(
      { displayName: params.memberDisplayName },
      absolute,
    );
    if (!content) return;

    const messageId = params.afterMemberMessageId
      ? `${params.afterMemberMessageId}-deliverable-paths`
      : undefined;
    await postRoomAnnouncement(params.gateway, {
      scenarioId: params.group.id,
      coordinatorAgentId: params.group.coordinatorAgentId,
      fromAgentId: params.memberAgentId,
      content,
      phase: 'task_deliver',
      taskId: params.project.id,
      messageId,
      syncGateway: true,
    });
  })().finally(() => {
    pathAnnounceInflight.delete(inflightKey);
  });

  pathAnnounceInflight.set(inflightKey, work);
  await work;
}
