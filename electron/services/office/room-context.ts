import {
  buildRoomContextBlock,
  selectRoomContextMessages,
} from '../../../src/lib/office-room-context';
import type { OfficeRole, RoomMessage } from './types';
import { roomMessageAuthorLabel } from '../../../src/lib/office-room-reply';
import { roomContextLimitsForMention } from './room-context-limits';
import type { OfficeTaskExecutionMode } from './types';

export { roomMessageBodyForContext, selectRoomContextMessages } from '../../../src/lib/office-room-context';

const MAIN_ROOM_LABELS = { user: '用户', system: '系统' };

/** @deprecated 使用 {@link roomContextLimitsForMention} */
export const MEMBER_ROOM_CONTEXT_MAX_MESSAGES = 10;
/** @deprecated 使用 {@link roomContextLimitsForMention} */
export const MEMBER_ROOM_CONTEXT_MAX_CHARS = 4_000;

export function buildRoomContextForAgent(
  history: RoomMessage[],
  roles: OfficeRole[],
  upToMessageId: string,
  opts?: {
    coordinatorView?: boolean;
    triggerMessageId?: string;
    executionMode?: OfficeTaskExecutionMode;
  },
): string | null {
  const mode = opts?.executionMode ?? 'workflow';
  const isCoordinator = !!opts?.coordinatorView;
  const limits = roomContextLimitsForMention(mode, isCoordinator);
  const selected = selectRoomContextMessages(history, {
    upToMessageId,
    maxMessages: limits.maxMessages,
    maxChars: limits.maxChars,
  });
  return buildRoomContextBlock(selected, (m) => roomMessageAuthorLabel(m, roles, MAIN_ROOM_LABELS));
}
