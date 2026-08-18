import { roleMentionToken } from '@/lib/office-mention';
import {
  agentIdsMatch,
  normalizeTeamMember,
  roomMessageFromAgentId,
  type LegacyTeamMember,
} from '@/lib/office-agent-id-resolve';
import type { RoomMessage } from '@/types/office';

export type RoomAuthorMember = {
  agentId: string;
  displayName: string;
  emoji?: string;
  id?: string;
  name?: string;
};

function findRoomAuthorMember(
  message: RoomMessage,
  members: RoomAuthorMember[],
): RoomAuthorMember | undefined {
  const legacyTeam = members as LegacyTeamMember[];
  const fromId = roomMessageFromAgentId(message);
  return members.find((raw) => {
    const member = normalizeTeamMember(raw);
    return (
      (fromId && agentIdsMatch(legacyTeam, member.agentId, fromId))
      || member.agentId === message.from
      || member.displayName === message.from
    );
  });
}

function roomMessageProgressText(m: RoomMessage): string {
  return (m.progressText ?? m.content ?? '').trim();
}

export function roomMessageReplyPreview(message: RoomMessage, maxLen = 120): string {
  const raw = roomMessageProgressText(message) || message.content;
  const line = raw.split('\n').find((l) => l.trim())?.trim() ?? raw.trim();
  if (line.length <= maxLen) return line;
  return `${line.slice(0, maxLen)}…`;
}

export function roomMessageAuthorLabel(
  message: RoomMessage,
  members: RoomAuthorMember[],
  labels: { user: string; system: string },
): string {
  if (message.from === 'user') return labels.user;
  if (message.from === 'system') return labels.system;
  const member = findRoomAuthorMember(message, members);
  return member ? `${member.emoji ?? '🤖'} ${normalizeTeamMember(member).displayName}` : message.from;
}

/** Group-chat display: agent name without leading emoji icon. */
export function roomMessageAuthorPlainLabel(
  message: RoomMessage,
  members: RoomAuthorMember[],
  labels: { user: string; system: string },
): string {
  if (message.from === 'user') return labels.user;
  if (message.from === 'system') return labels.system;
  const member = findRoomAuthorMember(message, members);
  return member ? normalizeTeamMember(member).displayName : message.from;
}

/** Whether a room line was sent by the project/group coordinator. */
export function roomMessageFromCoordinator(
  message: RoomMessage,
  coordinatorAgentId: string | undefined | null,
): boolean {
  const coordId = coordinatorAgentId?.trim();
  if (!coordId || message.from === 'user' || message.from === 'system') return false;
  const fromId = roomMessageFromAgentId(message)?.trim()
    || (typeof message.from === 'string' && message.from !== 'user' && message.from !== 'system'
      ? message.from.trim()
      : '');
  return fromId === coordId;
}

export function roomMessageMentionSpeakerRef(
  message: RoomMessage,
  members: RoomAuthorMember[],
  labels: { user: string; system: string } = { user: '用户', system: '系统' },
): string {
  if (message.from === 'user') return labels.user;
  if (message.from === 'system') return labels.system;
  const member = findRoomAuthorMember(message, members);
  const normalized = member ? normalizeTeamMember(member) : null;
  return normalized
    ? roleMentionToken(normalized)
    : message.from;
}

export function roomMessageSpeakerLabel(
  message: RoomMessage,
  members: RoomAuthorMember[],
  labels: { user: string; system: string } = { user: '用户', system: '系统' },
): string {
  return roomMessageMentionSpeakerRef(message, members, labels);
}
