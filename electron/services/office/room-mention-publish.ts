import { agentIdsMatch } from '../../../src/lib/office-agent-id-resolve';
import { mentionReplyRoomMeta } from '../../../src/lib/office-mention-task-sync';
import { formatRoomReplyBody } from '../../../src/lib/office-room-reply-format';
import { roomMessageReplyPreview } from '../../../src/lib/office-room-reply';
import { isUnmirroredRoomSnippet, roomReplyProgressSnippet } from './room-mention-reply-policy';
import { appendRoomMessage, getRoomMessages, updateRoomMessage } from './store';
import type { OfficeRole, OfficeScenario, OfficeTask, RoomMessage, RoomMessagePhase } from './types';

import { loadFocusTaskForScenario } from './mention-task-context';
import { smartDiagLog } from './smart-diag-log';
import { taskExecutionMode } from './task-execution-mode';

function normalizePublishBody(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function resolvePublishAgentKey(role: Pick<OfficeRole, 'id' | 'agentId'>): string {
  return (role.agentId ?? role.id).trim();
}

async function isDuplicateRoomPublish(
  taskId: string,
  roleAgentKey: string,
  content: string,
  messageId: string,
  opts?: { smartMemberEnd?: boolean },
): Promise<boolean> {
  const recent = await getRoomMessages(taskId);
  const norm = normalizePublishBody(content);
  const now = Date.now();
  return recent.some((m) => {
    if (m.id === messageId) return true;
    const legacy = m as RoomMessage & { fromRoleId?: string };
    const fromKey = (m.fromAgentId ?? legacy.fromRoleId ?? '').trim();
    if (!fromKey || !agentIdsMatch([], fromKey, roleAgentKey)) return false;
    if (normalizePublishBody(m.content ?? '') !== norm) return false;
    if (opts?.smartMemberEnd === true && m.smartMemberEnd === true) return true;
    return now - m.timestamp < 10_000;
  });
}

export type PublishMentionRoleReplyResult = 'appended' | 'deduped' | 'skipped';

export async function publishMentionRoleReply(
  params: {
    scenarioId: string;
    scenario: Pick<OfficeScenario, 'workflow' | 'coordinatorRoleId' | 'roleIds'> | null;
    focusTask: OfficeTask | null;
  },
  role: OfficeRole,
  userMsg: RoomMessage,
  text: string,
  opts: {
    messageId: string;
    supplementary: boolean;
    runId?: string;
    forceAppend?: boolean;
    smartCoordinatorEnd?: boolean;
    smartMemberEnd?: boolean;
    smartJsonRaw?: string;
  },
): Promise<PublishMentionRoleReplyResult> {
  const trimmed = text.trim();
  if (!trimmed || isUnmirroredRoomSnippet(trimmed)) return 'skipped';
  const publishedContent = formatRoomReplyBody(trimmed, true);

  let phase: RoomMessagePhase | undefined;
  let nodeId: string | undefined;
  let progressText: string | undefined;

  const task = await loadFocusTaskForScenario(params.scenarioId, params.focusTask);
  if (task && params.scenario) {
    const meta = mentionReplyRoomMeta(task, params.scenario, role.id, trimmed);
    phase = meta.phase;
    nodeId = meta.nodeId;
    progressText = meta.progressSnippet;
  }

  const triggerPreview = roomMessageReplyPreview(userMsg);
  const legacyUserMsg = userMsg as RoomMessage & { taskId?: string; projectId?: string };
  const publishTaskId = (task?.id ?? legacyUserMsg.projectId ?? legacyUserMsg.taskId ?? '').trim();
  if (!publishTaskId) return 'skipped';

  const base: RoomMessage = {
    id: opts.messageId,
    groupId: params.scenarioId,
    projectId: publishTaskId,
    from: role.agentId,
    fromAgentId: role.agentId,
    content: publishedContent,
    mentions: [],
    timestamp: Date.now(),
    runIds: opts.runId ? [opts.runId] : undefined,
    phase,
    progressText,
    nodeId,
    replyToId: userMsg.id,
    replyPreview: triggerPreview,
    smartCoordinatorEnd: opts.smartCoordinatorEnd === true ? true : undefined,
    smartMemberEnd: opts.smartMemberEnd === true ? true : undefined,
    smartJsonRaw: opts.smartJsonRaw?.trim() || undefined,
  };

  if (
    await isDuplicateRoomPublish(
      publishTaskId,
      resolvePublishAgentKey(role),
      publishedContent,
      opts.messageId,
      { smartMemberEnd: opts.smartMemberEnd },
    )
  ) {
    return 'deduped';
  }

  if (opts.supplementary || opts.forceAppend) {
    await appendRoomMessage(base, {
      deferSideEffects: opts.supplementary === true || opts.forceAppend === true,
    });
    if (task && taskExecutionMode(task) === 'smart') {
      smartDiagLog('room-published', {
        taskId: publishTaskId,
        roleId: role.id,
        messageId: opts.messageId,
        supplementary: opts.supplementary === true,
        forceAppend: opts.forceAppend === true,
        chars: publishedContent.length,
      });
    }
    return 'appended';
  }

  const updated = await updateRoomMessage(publishTaskId, opts.messageId, {
    content: publishedContent,
    progressText: progressText ?? roomReplyProgressSnippet(trimmed),
    phase,
    projectId: publishTaskId,
    nodeId,
    replyToId: userMsg.id,
    replyPreview: triggerPreview,
    smartCoordinatorEnd: opts.smartCoordinatorEnd === true ? true : undefined,
    smartMemberEnd: opts.smartMemberEnd === true ? true : undefined,
    smartJsonRaw: opts.smartJsonRaw?.trim() || undefined,
    timestamp: Date.now(),
  });
  if (!updated) {
    await appendRoomMessage(base);
  }
  return 'appended';
}
