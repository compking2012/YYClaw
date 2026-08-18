import type { OfficeTaskExecutionMode } from './types';
import type { ProjectAgentRef } from '../../../src/lib/office-workflow-node';
import {
  agentIdsMatch,
  normalizeTeamMembers,
  resolveTeamAgentId,
  type LegacyTeamMember,
} from '../../../src/lib/office-agent-id-resolve';
import {
  isAllMentionToken,
  parseMentions,
  resolveMentionTargets,
} from './room-mentions';
import {
  type AllMentionSelectionParams,
  selectPrimaryRolesForAllMention,
} from './room-mention-all';
import { parseStructuredSmartDispatch } from '../../../src/lib/office-smart-room-fields';
import { resolveSmartCoordinatorDispatchTargets, SMART_COORDINATOR_MAX_DELEGATED } from '../../../src/lib/office-smart-dispatch-targets';
import { smartDispatchRoleTaskText } from '../../../src/lib/office-smart-json-schema';
import { smartMemberReplyMentionsCoordinator } from '../../../src/lib/office-smart-member-reply';

function pickRolesFromStructuredSmartDispatch(
  replyText: string,
  team: LegacyTeamMember[],
  coordinatorAgentId: string,
): Pick<ProjectAgentRef, 'agentId' | 'displayName'>[] {
  return resolveSmartCoordinatorDispatchTargets(
    replyText,
    team.map((m) => ({
      agentId: m.agentId ?? m.id ?? '',
      displayName: (m.displayName ?? m.name ?? m.agentId ?? m.id ?? '').trim(),
    })),
    coordinatorAgentId,
  );
}

/**
 * 群聊跟进 @ 目标：协调者回复中的 @成员；Smart 成员回复中的 @协调者（成员 @PM 汇报须触发 PM Session）。
 */
export function pickRolesDelegatedByCoordinator(
  replyText: string,
  teamMembers: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[] | LegacyTeamMember[],
  fromAgentId?: string,
  coordinatorAgentId?: string,
  options?: { executionMode?: OfficeTaskExecutionMode },
): Pick<ProjectAgentRef, 'agentId' | 'displayName'>[] {
  const team = teamMembers as LegacyTeamMember[];
  const tokens = parseMentions(replyText).filter((t) => !isAllMentionToken(t));
  const fromId = resolveTeamAgentId(team, fromAgentId);
  const coordId = resolveTeamAgentId(team, coordinatorAgentId);

  if (
    options?.executionMode === 'smart'
    && coordId
    && fromId
    && agentIdsMatch(team, fromId, coordId)
  ) {
    return pickRolesFromStructuredSmartDispatch(replyText, team, coordId);
  }

  const resolved = resolveMentionTargets(tokens, team, {
    coordinatorAgentId: coordId,
  }).filter((r) => !fromId || !agentIdsMatch(team, r.agentId, fromId));

  const smartMemberOnlyCoordinator =
    options?.executionMode === 'smart'
    && coordId
    && fromId
    && !agentIdsMatch(team, fromId, coordId);
  if (smartMemberOnlyCoordinator) {
    const structured = parseStructuredSmartDispatch(replyText, { routingOnly: true });
    if (!structured?.length) return [];
    const coordMember = team.find((m) => agentIdsMatch(team, m.agentId ?? m.id, coordId));
    if (!coordMember) return [];
    const dispatchText = smartDispatchRoleTaskText(structured);
    const coordRef = {
      agentId: coordMember.agentId ?? coordMember.id ?? coordId,
      displayName: (coordMember.displayName ?? coordMember.name ?? coordId).trim() || coordId,
    };
    if (!smartMemberReplyMentionsCoordinator(dispatchText, coordRef)) return [];
    return [{ agentId: coordRef.agentId, displayName: coordRef.displayName }];
  }

  const out: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[] = [];
  for (const member of resolved) {
    if (coordId && agentIdsMatch(team, member.agentId, coordId)) continue;
    if (out.length >= SMART_COORDINATOR_MAX_DELEGATED) break;
    if (!out.some((x) => x.agentId === member.agentId)) out.push(member);
  }
  return out;
}

/** @deprecated Use pickRolesDelegatedByCoordinator */
export const pickAgentsDelegatedByCoordinator = pickRolesDelegatedByCoordinator;

export function selectPrimaryMembersForAllMention(
  params: AllMentionSelectionParams & {
    teamMembers: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[];
  },
): Pick<ProjectAgentRef, 'agentId' | 'displayName'>[] {
  const legacyRoles = params.teamMembers.map((m) => ({
    id: m.agentId,
    name: m.displayName,
    agentId: m.agentId,
  }));
  const selected = selectPrimaryRolesForAllMention(legacyRoles as never, params);
  return selected.primary.map((r) => ({
    agentId: (r as { agentId?: string; id: string }).agentId ?? (r as { id: string }).id,
    displayName: (r as { name: string }).name,
  }));
}

/** @deprecated */
export const selectPrimaryRolesForAllMentionFromMembers = selectPrimaryMembersForAllMention;

function mapDelegatedToTeamMembers(
  team: LegacyTeamMember[],
  delegated: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[],
): LegacyTeamMember[] {
  return delegated.map((d) => {
    const hit = team.find((r) => agentIdsMatch(team, d.agentId, r.id ?? r.agentId));
    return hit ?? d;
  });
}

/** 协调者回复无 @ 时，按原 @all 消息 relevance 回退选人。 */
export function resolveReplyTargetsAfterCoordinator(
  coordinatorReplyText: string,
  teamRoles: LegacyTeamMember[],
  params: AllMentionSelectionParams,
): LegacyTeamMember[] {
  const delegated = pickRolesDelegatedByCoordinator(
    coordinatorReplyText,
    teamRoles,
    params.fromRoleId,
    params.coordinatorRoleId,
  );
  if (delegated.length > 0) {
    return mapDelegatedToTeamMembers(teamRoles, delegated);
  }
  const legacyTeam = teamRoles.map((r) => ({
    id: r.id ?? r.agentId,
    name: r.name ?? r.displayName ?? r.agentId,
    agentId: r.agentId ?? r.id ?? '',
    description: (r as { description?: string }).description,
    laneContract: (r as { laneContract?: string }).laneContract,
    createdAt: 0,
    updatedAt: 0,
  }));
  const { primary } = selectPrimaryRolesForAllMention(legacyTeam as never, params);
  return primary as LegacyTeamMember[];
}

/** @all 跟进时通知尚未被委派、且非协调者的成员。 */
export function notifyTargetsForAllMention(
  teamRoles: LegacyTeamMember[],
  delegated: LegacyTeamMember[],
  coordinatorRoleId: string,
): Pick<ProjectAgentRef, 'agentId' | 'displayName'>[] {
  const delegatedIds = new Set(
    delegated.map((d) => resolveTeamAgentId(teamRoles, d.id ?? d.agentId)),
  );
  return normalizeTeamMembers(teamRoles).filter(
    (m) =>
      !agentIdsMatch(teamRoles, m.agentId, coordinatorRoleId)
      && !delegatedIds.has(m.agentId),
  );
}
