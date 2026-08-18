import {
  ROOM_COORDINATOR_RECEIPT_ACK_TEXT,
  ROOM_FAST_ACK_TEXT,
  isRoomCoordinatorReceiptAckText,
  isRoomFastAckText,
} from '../../../src/lib/office-room-fast-ack';

export {
  ROOM_COORDINATOR_RECEIPT_ACK_TEXT,
  ROOM_FAST_ACK_TEXT,
  isRoomCoordinatorReceiptAckText,
  isRoomFastAckText,
};

/** 协调者广播介入等场景不发极速 ack；Smart 协调者/系统推进须实质回复。 */
export function shouldSkipRoomMentionFastAck(input: {
  isCoordinator: boolean;
  promptVariant?: string;
  executionMode?: 'smart' | 'workflow';
  /** 系统【引擎·推进】等点名：须实质【分工】@成员，禁止仅 fast ack */
  triggerFromSystem?: boolean;
}): boolean {
  if (input.triggerFromSystem) return true;
  if (input.executionMode === 'smart' && input.isCoordinator) return true;
  if (input.executionMode === 'smart') {
    return (
      input.promptVariant === 'coordinator_broadcast_unmentioned'
      || input.promptVariant === 'coordinator_user_mention_member'
      || input.promptVariant === 'coordinator_missing_mention'
    );
  }
  if (input.isCoordinator) return true;
  return (
    input.promptVariant === 'coordinator_broadcast_unmentioned'
    || input.promptVariant === 'coordinator_user_mention_member'
    || input.promptVariant === 'coordinator_missing_mention'
  );
}

/** 规则 6：群聊极速确认（仅短 ack；引用上下文由 replyTo / prompt 侧携带，不重复贴在正文前）。 */
export function buildFastAckRoomContent(_triggerPreview?: string): string {
  return ROOM_FAST_ACK_TEXT;
}
