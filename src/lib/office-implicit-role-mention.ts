import type { ProjectAgentRef } from '@/lib/office-workflow-node';
import { agentMentionToken } from '@/lib/office-project-members';
import {
  agentIdsMatch,
  normalizeTeamMember,
  normalizeTeamMembers,
  resolveTeamAgentId,
  type LegacyTeamMember,
} from '@/lib/office-agent-id-resolve';
import { parseMentions, resolveMentionTargets } from '@/lib/office-mention-parse';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Drop room broadcast header before implicit-mention prose scan. */
export function stripRoomMessageAuditBoilerplate(text: string): string {
  const lines = text.split('\n');
  if (lines.length <= 1) return text.trim();
  const first = lines[0]?.trim() ?? '';
  if (
    /^[\s\S]{0,8}【[^】]+】/u.test(first)
    || /协作询问|任务理解|交付|执行中/u.test(first)
  ) {
    return lines.slice(1).join('\n').trim();
  }
  return text.trim();
}

/** Plain-text @ token present (same rules as workflow clarification notify). */
export function messageExplicitlyAtMentionsAgent(
  text: string,
  member: ProjectAgentRef | LegacyTeamMember,
): boolean {
  const normalized = normalizeTeamMember(member);
  const token = agentMentionToken(normalized);
  const id = normalized.agentId.trim();
  const needles = [
    `@${token}`,
    `@${id}`,
    `＠${token}`,
    `＠${id}`,
    `@${token}角色`,
    `@${id}角色`,
    `＠${token}角色`,
    `＠${id}角色`,
  ];
  return needles.some((n) => text.includes(n));
}

/** @deprecated Use messageExplicitlyAtMentionsAgent */
export const messageExplicitlyAtMentionsRole = messageExplicitlyAtMentionsAgent;

/** Text implies an agent is needed without an @ token (e.g. 「需要PM支持」). */
export function textImpliesAgentWithoutAt(
  text: string,
  member: ProjectAgentRef | { agentId?: string; displayName?: string; id?: string; name?: string },
): boolean {
  const normalized = normalizeTeamMember(member as never);
  const name = normalized.displayName.trim();
  if (name.length < 2) return false;
  const escaped = escapeRegExp(name);
  const patterns = [
    new RegExp(`(?:需要|请|让|由|找|交给|转交|联系|协同|同步|求|烦请|麻烦)\\s*【?${escaped}】?`, 'iu'),
    new RegExp(
      `(?:请|需要|烦请|麻烦|让|由|找|交给)\\s*【?${escaped}】?\\s*(?:支持|协助|处理|确认|补充|跟进|参与|接手|完成|评审|看一下|帮忙|支持一下)`,
      'iu',
    ),
    new RegExp(`【?${escaped}】?\\s*(?:同学|同事|侧|那边|团队)`, 'iu'),
    new RegExp(`(?:${escaped})\\s*(?:同学|同事|侧|那边)`, 'iu'),
  ];
  return patterns.some((p) => p.test(text));
}

/** @deprecated Use textImpliesAgentWithoutAt */
export const textImpliesRoleWithoutAt = textImpliesAgentWithoutAt;

export type FindImplicitMentionOptions = {
  /** Agent ids already @'d (from message.mentions or dispatch). */
  mentionedAgentIds?: ReadonlySet<string>;
  /** @deprecated Use mentionedAgentIds */
  mentionedRoleIds?: ReadonlySet<string>;
};

/** Agents referenced in prose but not @'d in the same message. */
export function findAgentsReferencedButNotMentioned(
  text: string,
  teamMembers: (ProjectAgentRef | LegacyTeamMember)[],
  speakerAgentId?: string,
  options?: FindImplicitMentionOptions,
): ProjectAgentRef[] {
  const trimmed = stripRoomMessageAuditBoilerplate(text);
  if (!trimmed) return [];

  const legacyTeam = teamMembers as LegacyTeamMember[];
  const team = normalizeTeamMembers(legacyTeam);
  const speakerId = resolveTeamAgentId(legacyTeam, speakerAgentId);

  const mentionedIds = new Set<string>();
  for (const id of options?.mentionedAgentIds ?? []) {
    mentionedIds.add(resolveTeamAgentId(legacyTeam, id));
  }
  for (const id of options?.mentionedRoleIds ?? []) {
    mentionedIds.add(resolveTeamAgentId(legacyTeam, id));
  }

  const explicitIds = new Set(
    resolveMentionTargets(parseMentions(trimmed), legacyTeam).map((m) => m.agentId),
  );

  const out: ProjectAgentRef[] = [];
  for (const member of team) {
    if (speakerId && agentIdsMatch(legacyTeam, member.agentId, speakerId)) continue;
    if ([...mentionedIds].some((id) => agentIdsMatch(legacyTeam, member.agentId, id))) continue;
    if (explicitIds.has(member.agentId)) continue;
    if (messageExplicitlyAtMentionsAgent(trimmed, member)) continue;
    if (!textImpliesAgentWithoutAt(trimmed, member)) continue;
    if (!out.some((x) => x.agentId === member.agentId)) out.push(member);
    if (out.length >= 3) break;
  }
  return out;
}

/** @deprecated Use findAgentsReferencedButNotMentioned */
export const findRolesReferencedButNotMentioned = findAgentsReferencedButNotMentioned;
