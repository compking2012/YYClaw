/**
 * Active @mention at cursor: the rightmost `@` before cursor whose fragment has no whitespace/@.
 * Supports multiple mentions in one message (e.g. `@PM 请 @设计` or `@PM@` with cursor after 2nd @).
 */
import { normalizeTeamMember, type LegacyTeamMember } from '@/lib/office-agent-id-resolve';

export function getActiveMention(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  const before = text.slice(0, cursor);
  let searchEnd = before.length;
  while (searchEnd >= 0) {
    const at = before.lastIndexOf('@', searchEnd);
    if (at === -1) return null;
    const query = before.slice(at + 1, cursor);
    if (/[\s@]/.test(query)) {
      searchEnd = at - 1;
      continue;
    }
    const justTypedAt = cursor === at + 1;
    if (query.length > 0 && at > 0 && !/\s/.test(before[at - 1]!)) {
      searchEnd = at - 1;
      continue;
    }
    if (!justTypedAt && at > 0 && !/\s/.test(before[at - 1]!)) {
      searchEnd = at - 1;
      continue;
    }
    return { start: at, query };
  }
  return null;
}

export const ROOM_MENTION_ALL_ID = '__room_mention_all__';
export const ROOM_MENTION_ALL_TOKEN = 'all';

export type OfficeMentionMember = { agentId: string; displayName: string; emoji?: string };

export function isRoomMentionAllRole(role: { agentId: string }): boolean {
  return role.agentId === ROOM_MENTION_ALL_ID;
}

export function filterMentionRoles<T extends OfficeMentionMember & { id?: string; name?: string }>(
  roles: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return roles;
  return roles.filter(
    (r) => {
      const agentId = (r.agentId ?? r.id ?? '').toLowerCase();
      const displayName = (r.displayName ?? r.name ?? '').toLowerCase();
      return agentId.includes(q) || displayName.includes(q);
    },
  );
}

/** Picker options: @all (everyone in team) plus members matching query. */
export function buildRoomMentionPickerRoles<T extends OfficeMentionMember>(
  teamRoles: T[],
  query: string,
): T[] {
  if (teamRoles.length === 0) return [];

  const q = query.trim().toLowerCase();
  const allEntry = {
    agentId: ROOM_MENTION_ALL_ID,
    displayName: ROOM_MENTION_ALL_TOKEN,
    emoji: '👥',
  } as T;

  const matchesAll =
    !q || ROOM_MENTION_ALL_TOKEN.startsWith(q) || q === ROOM_MENTION_ALL_TOKEN;

  const members = filterMentionRoles(teamRoles, query);

  if (matchesAll) return [allEntry, ...members];
  return members;
}

/** Token inserted into chat text (prefer agent display name, e.g. @PM). */
export function roleMentionToken(
  role: Pick<OfficeMentionMember, 'agentId' | 'displayName'> | LegacyTeamMember,
): string {
  const member = normalizeTeamMember(role);
  if (isRoomMentionAllRole(member)) return ROOM_MENTION_ALL_TOKEN;
  const name = member.displayName.trim();
  if (name && /^[\w\u4e00-\u9fa5.-]+$/u.test(name)) return name;
  return member.agentId;
}

export function insertMentionToken(
  text: string,
  start: number,
  role: Pick<OfficeMentionMember, 'agentId' | 'displayName'> | LegacyTeamMember,
): string {
  const token = roleMentionToken(role);
  const before = text.slice(0, start);
  const after = text.slice(start).replace(/^@[^\s]*/, '');
  return `${before}@${token} ${after}`;
}
