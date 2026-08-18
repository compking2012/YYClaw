import type { ProjectAgentRef } from '@/lib/office-workflow-node';
import type { RoomMessage } from '@/types/office';

export type LegacyTeamMember = ProjectAgentRef & { id?: string; name?: string };

function isLegacyTeamMemberLike(value: unknown): value is LegacyTeamMember {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as LegacyTeamMember;
  return Boolean(
    row.agentId?.trim()
    || row.id?.trim()
    || row.displayName?.trim()
    || row.name?.trim(),
  );
}

/** 将名册入参规范为数组（防止单对象/非数组传入导致 `.map` 崩溃）。 */
export function asTeamMemberArray(
  teamMembers: LegacyTeamMember[] | LegacyTeamMember | null | undefined,
): LegacyTeamMember[] {
  if (teamMembers == null) return [];
  if (Array.isArray(teamMembers)) return teamMembers;
  return isLegacyTeamMemberLike(teamMembers) ? [teamMembers] : [];
}

export function normalizeTeamMember(member: LegacyTeamMember | null | undefined): ProjectAgentRef {
  if (!member) return { agentId: '', displayName: '' };
  const agentId = (member.agentId ?? member.id ?? '').trim();
  const displayName = (member.displayName ?? member.name ?? agentId).trim();
  return { agentId, displayName };
}

export function normalizeTeamMembers(
  teamMembers: LegacyTeamMember[] | LegacyTeamMember | null | undefined,
): ProjectAgentRef[] {
  return asTeamMemberArray(teamMembers).map(normalizeTeamMember).filter((m) => m.agentId);
}

/** Map legacy role id / display name / agent id to canonical agentId on the roster. */
export function resolveTeamAgentId(
  teamMembers: LegacyTeamMember[] | LegacyTeamMember | null | undefined,
  roleOrAgentId: string | null | undefined,
): string {
  const key = (roleOrAgentId ?? '').trim();
  if (!key) return '';
  const roster = asTeamMemberArray(teamMembers);
  const members = normalizeTeamMembers(roster);
  const direct = members.find((m) => m.agentId === key);
  if (direct) return direct.agentId;
  const keyLower = key.toLowerCase();
  for (const raw of roster) {
    const legacyId = raw.id?.trim();
    if (legacyId && (legacyId === key || legacyId.toLowerCase() === keyLower)) {
      return normalizeTeamMember(raw).agentId;
    }
    const name = (raw.displayName ?? raw.name ?? '').trim();
    if (name && (name === key || name.toLowerCase() === keyLower)) {
      return normalizeTeamMember(raw).agentId;
    }
  }
  return key;
}

export function resolveTeamAgentIds(
  teamMembers: LegacyTeamMember[],
  ids: Array<string | null | undefined>,
): string[] {
  return [...new Set(ids.map((id) => resolveTeamAgentId(teamMembers, id)).filter(Boolean))];
}

export function agentIdsMatch(
  teamMembers: LegacyTeamMember[],
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = resolveTeamAgentId(teamMembers, left);
  const b = resolveTeamAgentId(teamMembers, right);
  return Boolean(a && b && a === b);
}

type LegacyRoomMessage = RoomMessage & { taskId?: string; fromRoleId?: string };

export function roomMessageProjectId(message: LegacyRoomMessage): string {
  return (message.projectId ?? message.taskId ?? '').trim();
}

export function roomMessageFromAgentId(message: LegacyRoomMessage): string {
  const fromAgent = (message.fromAgentId ?? message.fromRoleId ?? '').trim();
  if (fromAgent) return fromAgent;
  const from = typeof message.from === 'string' ? message.from.trim() : '';
  if (from && from !== 'user' && from !== 'system') return from;
  return '';
}

export function roomMessageFromAgentMatches(
  message: LegacyRoomMessage,
  roleOrAgentId: string,
  teamMembers?: LegacyTeamMember[],
): boolean {
  const fromId = roomMessageFromAgentId(message);
  if (!fromId) return false;
  if (fromId === roleOrAgentId) return true;
  if (teamMembers?.length) {
    return agentIdsMatch(teamMembers, fromId, roleOrAgentId);
  }
  return false;
}
