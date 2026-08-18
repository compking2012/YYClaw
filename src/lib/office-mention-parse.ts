import type { ProjectAgentRef } from '@/lib/office-workflow-node';
import {
  asTeamMemberArray,
  normalizeTeamMember,
  type LegacyTeamMember,
} from '@/lib/office-agent-id-resolve';
import { agentMentionToken } from '@/lib/office-project-members';
import { roleMentionToken } from '@/lib/office-mention';

type LegacyMentionMember = ProjectAgentRef & { id?: string; name?: string };

function normalizeMentionMember(member: LegacyMentionMember): ProjectAgentRef {
  const agentId = (member.agentId ?? member.id ?? '').trim();
  const displayName = (member.displayName ?? member.name ?? agentId).trim();
  return { agentId, displayName };
}

function normalizeMentionTeam(
  teamMembers: LegacyMentionMember[] | LegacyMentionMember | null | undefined,
): ProjectAgentRef[] {
  return asTeamMemberArray(teamMembers).map(normalizeMentionMember).filter((m) => m.agentId);
}

const MENTION_RE = /[@＠]([\w\u4e00-\u9fa5][\w\u4e00-\u9fa5.-]*)/gu;

export const ROOM_MENTION_ALL = 'all';

const ALL_MENTION_TOKENS = new Set([ROOM_MENTION_ALL, '所有人', '全体']);

/**
 * Tolerate mistaken @测试角色-style tokens for dispatch; agents must still write @测试 per ROOM_MENTION_AT_FORMAT_RULE.
 */
const MENTION_ROLE_SUFFIX_RE = /(?:角色|同学|同事|侧|团队|那边)$/u;

export function normalizeMentionTokenForMatch(token: string): string {
  return token.trim().toLowerCase().replace(MENTION_ROLE_SUFFIX_RE, '');
}

export function parseMentions(text: string): string[] {
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(MENTION_RE.source, 'g');
  while ((m = re.exec(text)) !== null) {
    if (m[1]) found.add(m[1].toLowerCase());
  }
  return [...found];
}

export function isAllMentionToken(token: string): boolean {
  const lower = token.toLowerCase();
  return ALL_MENTION_TOKENS.has(lower) || ALL_MENTION_TOKENS.has(token);
}

/** 成员向协调者汇报时允许的通用 @ 词（不限于 roster 显示名，如 PM）。 */
export function isGenericCoordinatorMentionToken(token: string): boolean {
  const t = normalizeMentionTokenForMatch(token);
  return t === '协调者' || t === 'coordinator';
}

export function mentionsIncludeAll(mentions: string[]): boolean {
  return mentions.some(isAllMentionToken);
}

export function agentMatchesMentionToken(member: ProjectAgentRef, token: string): boolean {
  if (isAllMentionToken(token)) return false;
  const normalized = normalizeMentionMember(member as LegacyMentionMember);
  const raw = token.toLowerCase().trim();
  const t = normalizeMentionTokenForMatch(token);
  if (!raw && !t) return false;
  const id = normalized.agentId.toLowerCase();
  const name = normalized.displayName.toLowerCase();
  const candidates = new Set([raw, t].filter(Boolean));
  for (const key of candidates) {
    if (id === key || name === key) return true;
    if (key.length >= 2) {
      if (id.length >= 2 && (id.startsWith(key) || key.startsWith(id))) return true;
      if (name.length >= 2 && (name.startsWith(key) || key.startsWith(name))) return true;
    }
  }
  return false;
}

/** @deprecated Use agentMatchesMentionToken */
export const roleMatchesMentionToken = agentMatchesMentionToken;

export function resolveMentionTargets(
  mentions: string[],
  teamMembers: LegacyMentionMember[],
  options?: { coordinatorAgentId?: string; /** @deprecated */ coordinatorRoleId?: string },
): ProjectAgentRef[] {
  const members = normalizeMentionTeam(teamMembers);
  const coordinatorAgentId = options?.coordinatorAgentId ?? options?.coordinatorRoleId;
  if (mentions.some(isAllMentionToken)) {
    return [...members];
  }

  const targets: ProjectAgentRef[] = [];
  for (const token of mentions) {
    if (isAllMentionToken(token)) continue;
    for (const member of members) {
      if (
        agentMatchesMentionToken(member, token)
        && !targets.some((x) => x.agentId === member.agentId)
      ) {
        targets.push(member);
      }
    }
  }
  const coordId = coordinatorAgentId?.trim();
  if (coordId && mentions.some(isGenericCoordinatorMentionToken)) {
    const coord = members.find((m) => m.agentId === coordId);
    if (coord && !targets.some((x) => x.agentId === coord.agentId)) {
      targets.push(coord);
    }
  }
  return targets;
}

export function findUnresolvedMentionTokens(
  mentions: string[],
  teamMembers: LegacyMentionMember[],
  options?: { coordinatorAgentId?: string; /** @deprecated */ coordinatorRoleId?: string },
): string[] {
  if (mentionsIncludeAll(mentions)) return [];
  const targets = resolveMentionTargets(mentions, teamMembers, options);
  const coordinatorAgentId = options?.coordinatorAgentId ?? options?.coordinatorRoleId;
  return mentions.filter((token) => {
    if (isAllMentionToken(token)) return false;
    if (coordinatorAgentId && isGenericCoordinatorMentionToken(token)) {
      return false;
    }
    return !targets.some((m) => agentMatchesMentionToken(m, token));
  });
}

export function handoffMentionLine(nextMembers: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[]): string {
  if (nextMembers.length === 0) return '';
  return nextMembers.map((m) => `@${agentMentionToken(m)}`).join(' ');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type MentionMemberWithEmoji = Pick<ProjectAgentRef, 'agentId' | 'displayName'> & {
  emoji?: string;
  id?: string;
  name?: string;
};

/**
 * Normalize mistaken @emoji 角色名 → @角色名 (e.g. @🤖 产品 → @产品).
 * Does not alter @all / @角色名角色 tolerated suffixes (handled elsewhere).
 */
export function normalizeStrictAtMentionText(
  text: string,
  teamMembers: MentionMemberWithEmoji[],
): string {
  let out = text;
  for (const raw of teamMembers) {
    const member = normalizeTeamMember(raw as LegacyTeamMember);
    const token = roleMentionToken(member);
    const name = member.displayName.trim();
    if (!name) continue;
    const emoji = raw.emoji?.trim();
    if (emoji) {
      const emojiGap = new RegExp(
        `[@＠]\\s*${escapeRegExp(emoji)}\\s+${escapeRegExp(name)}`,
        'gu',
      );
      out = out.replace(emojiGap, `@${token}`);
      const emojiTight = new RegExp(
        `[@＠]\\s*${escapeRegExp(emoji)}${escapeRegExp(name)}`,
        'gu',
      );
      out = out.replace(emojiTight, `@${token}`);
    }
    if (token !== name) {
      const idGap = new RegExp(`[@＠]\\s*${escapeRegExp(member.agentId)}\\s+`, 'gu');
      out = out.replace(idGap, `@${token} `);
    }
  }
  return out;
}
