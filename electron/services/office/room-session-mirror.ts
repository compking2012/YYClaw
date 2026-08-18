import type { GatewayManager } from '../../gateway/manager';
import type { OfficeRole, RoomMessage } from './types';
import { updateRoomMessage } from './store';
import {
  resolveMentionSessionAssistantReply,
  waitForSessionReply,
} from './run-completion';
import {
  finalizeRoomMirrorReply,
  isUnmirroredRoomSnippet,
  roomReplyProgressSnippet,
} from './room-mention-reply-policy';

const DEFAULT_MIRROR_TIMEOUT_MS = 120_000;

/** Stream + finalize assistant output from a role DM session into a team room message row. */
export async function mirrorAgentSessionToRoomMessage(params: {
  gateway: GatewayManager;
  targetSessionKey: string;
  runId: string | undefined;
  scenarioId: string;
  messageId: string;
  startedAtMs: number;
  timeoutMs?: number;
  phase?: RoomMessage['phase'];
  taskId?: string;
  nodeId?: string;
  replyToId?: string;
  replyPreview?: string;
  teamRoles?: OfficeRole[];
}): Promise<string> {
  const timeoutMs = params.timeoutMs ?? DEFAULT_MIRROR_TIMEOUT_MS;

  let initial: Awaited<ReturnType<typeof waitForSessionReply>>;
  try {
    initial = await waitForSessionReply(params.gateway, {
      sessionKey: params.targetSessionKey,
      startedAtMs: params.startedAtMs,
      timeoutMs,
      runId: params.runId,
      allowUndatedFallback: true,
    });
  } finally {
    /* no streaming mirror — intermediate session text stays in DM only */
  }

  const historyFinal = await resolveMentionSessionAssistantReply(
    params.gateway,
    params.targetSessionKey,
    params.startedAtMs,
  );

  const rawFinal =
    historyFinal?.trim()
    || (initial.completed && initial.assistantText?.trim())
    || '';
  const finalText = finalizeRoomMirrorReply(rawFinal, params.teamRoles ?? []);

  if (finalText && !isUnmirroredRoomSnippet(finalText) && params.taskId?.trim()) {
    await updateRoomMessage(params.taskId.trim(), params.messageId, {
      content: finalText,
      progressText: roomReplyProgressSnippet(finalText),
      phase: params.phase,
      projectId: params.taskId,
      nodeId: params.nodeId,
      replyToId: params.replyToId,
      replyPreview: params.replyPreview,
      timestamp: Date.now(),
    });
  }

  return finalText;
}

export function roleRoomMirrorMessageId(prefix: string, role: Pick<OfficeRole, 'id'>, seed: string): string {
  return `${prefix}-${seed}-${role.id}`;
}
