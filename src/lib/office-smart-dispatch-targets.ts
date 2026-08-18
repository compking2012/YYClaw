import type { ProjectAgentRef } from '@/lib/office-workflow-node';
import {
  agentIdsMatch,
  resolveTeamAgentId,
  type LegacyTeamMember,
} from '@/lib/office-agent-id-resolve';
import { resolveMentionTargets } from '@/lib/office-mention-parse';
import { parseStructuredSmartDispatch } from '@/lib/office-smart-room-fields';

const MAX_DELEGATED = 6;

/** Smart 协调者单次 assign 最多派发的成员数。 */
export const SMART_COORDINATOR_MAX_DELEGATED = MAX_DELEGATED;

/**
 * Smart 协调者 assign 的统一派发目标解析（发布校验与 follow-up 共用）。
 * 仅认 structured `dispatch` 数组，不认 roomReply 中的 @。
 */
export function resolveSmartCoordinatorDispatchTargets(
  raw: string,
  teamMembers: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[],
  coordinatorAgentId: string,
): Pick<ProjectAgentRef, 'agentId' | 'displayName'>[] {
  const team = teamMembers as LegacyTeamMember[];
  const structured = parseStructuredSmartDispatch(raw, { routingOnly: true });
  if (!structured || structured.length === 0) return [];
  const coordId = resolveTeamAgentId(team, coordinatorAgentId);
  const out: Pick<ProjectAgentRef, 'agentId' | 'displayName'>[] = [];
  for (const item of structured) {
    const roleName = item.role.trim();
    if (!roleName || /^无$/iu.test(roleName)) continue;
    const resolved = resolveMentionTargets([roleName], team, { coordinatorAgentId: coordId });
    for (const member of resolved) {
      if (coordId && agentIdsMatch(team, member.agentId, coordId)) continue;
      if (out.length >= MAX_DELEGATED) return out;
      if (!out.some((x) => agentIdsMatch(team, x.agentId, member.agentId))) {
        out.push(member);
      }
    }
  }
  return out;
}

export function structuredSmartDispatchHasDelegableItems(raw: string): boolean {
  const structured = parseStructuredSmartDispatch(raw, { routingOnly: true });
  if (!structured?.length) return false;
  return structured.some((item) => {
    const roleName = item.role.trim();
    return Boolean(roleName) && !/^无$/iu.test(roleName);
  });
}
