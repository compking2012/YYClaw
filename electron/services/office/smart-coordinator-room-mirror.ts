import type { GatewayManager } from '../../gateway/manager';
import { resolveMentionSessionAssistantReply } from './run-completion';
import {
  coerceCoordinatorDispatchRoomReply,
  isCoordinatorMentionFallbackReply,
  isSubstantiveRoomMentionReply,
  roomReplyProgressSnippet,
} from './room-mention-reply-policy';
import { updateRoomMessage } from './store';
import { taskExecutionMode } from './task-execution-mode';
import type { OfficeRole, OfficeScenario, OfficeTask, RoomMessage } from './types';

const SMART_COORDINATOR_MIRROR_MAX_MS = 900_000;
const SMART_COORDINATOR_MIRROR_POLL_MS = 2_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * After a placeholder coordinator line was posted, keep reading the DM session and
 * replace that room row once a substantive Smart dispatch is available.
 */
export function scheduleSmartCoordinatorRoomMirror(params: {
  gateway: GatewayManager;
  targetSessionKey: string;
  startedAtMs: number;
  scenarioId: string;
  taskId: string;
  roomMessageId: string;
  triggerUserMsg: RoomMessage;
  coordinator: OfficeRole;
  speakerLabel: string;
  teamRoles: OfficeRole[];
  focus: OfficeTask;
  scenario: Pick<OfficeScenario, 'workflow'> | null;
  onSubstantiveReply: (text: string) => Promise<void>;
}): void {
  if (taskExecutionMode(params.focus) !== 'smart') return;

  void (async () => {
    const deadline = Date.now() + SMART_COORDINATOR_MIRROR_MAX_MS;
    while (Date.now() < deadline) {
      await sleep(SMART_COORDINATOR_MIRROR_POLL_MS);
      try {
        const raw = await resolveMentionSessionAssistantReply(
          params.gateway,
          params.targetSessionKey,
          params.startedAtMs,
          { requireFreshUserTurn: true },
        );
        if (!raw?.trim()) continue;

        const finalText = coerceCoordinatorDispatchRoomReply(
          raw,
          params.coordinator.name,
          params.speakerLabel,
          'empty',
          params.teamRoles,
        );
        if (isCoordinatorMentionFallbackReply(finalText)) continue;
        if (!isSubstantiveRoomMentionReply(finalText)) continue;

        const updated = await updateRoomMessage(params.taskId, params.roomMessageId, {
          content: finalText,
          progressText: roomReplyProgressSnippet(finalText),
          taskId: params.taskId,
          replyToId: params.triggerUserMsg.id,
          replyPreview: params.triggerUserMsg.replyPreview,
          timestamp: Date.now(),
        });
        if (!updated) continue;

        await params.onSubstantiveReply(finalText);
        return;
      } catch (err) {
        console.warn('[office] smart coordinator room mirror poll failed:', err);
      }
    }
  })();
}
