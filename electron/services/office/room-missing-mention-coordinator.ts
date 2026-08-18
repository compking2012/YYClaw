import type { GatewayManager } from '../../gateway/manager';
import {
  findRolesReferencedButNotMentioned,
  messageExplicitlyAtMentionsRole,
} from '../../../src/lib/office-implicit-role-mention';
import { resolveTeamAgentIds, roomMessageFromAgentId } from '../../../src/lib/office-agent-id-resolve';
import type { ProjectAgentRef } from '../../../src/lib/office-workflow-node';
import type { OfficeRole, RoomMessage, RoomMessagePhase } from './types';

export const MISSING_MENTION_COORDINATOR_DELAY_MS = 2_000;

/** 工作流结构化群镜像（交付/交接等）正文中会自然出现角色名，不做隐式 @ 审计。 */
const SKIP_MISSING_MENTION_AUDIT_PHASES = new Set<RoomMessagePhase>([
  'task_received',
  'task_understanding',
  'task_running',
  'task_deliver',
  'task_handoff',
  'project_closure',
]);

const RECENT_HANDOFF_LOOKBACK_MS = 15_000;

type WatchEntry = {
  timer: NodeJS.Timeout;
  triggerMsgId: string;
};

const pending = new Map<string, WatchEntry>();

export function shouldAuditRoleMessageForMissingMentions(msg: RoomMessage): boolean {
  if (msg.from === 'system') return false;
  if (!roomMessageFromAgentId(msg)) return false;
  if (msg.phase && SKIP_MISSING_MENTION_AUDIT_PHASES.has(msg.phase)) return false;
  const text = msg.content?.trim() ?? '';
  return text.length >= 8;
}

/** 同角色在邻近消息中已 @ 或 mentions 记录的角色，不再视为漏 @。 */
export function filterMissingMentionTargetsWithRecentHandoffs(
  history: RoomMessage[],
  triggerMsg: RoomMessage,
  teamRoles: ProjectAgentRef[],
  missing: ProjectAgentRef[],
): ProjectAgentRef[] {
  if (missing.length === 0) return missing;
  const speakerId = roomMessageFromAgentId(triggerMsg);
  if (!speakerId) return missing;

  const covered = new Set<string>();
  const anchorTs = triggerMsg.timestamp;
  for (const m of history) {
    if (roomMessageFromAgentId(m) !== speakerId || m.id === triggerMsg.id) continue;
    if (Math.abs(m.timestamp - anchorTs) > RECENT_HANDOFF_LOOKBACK_MS) continue;
    if (m.phase !== 'task_handoff' && m.phase !== 'task_clarification') continue;
    for (const id of m.mentions ?? []) {
      for (const resolved of resolveTeamAgentIds(teamRoles, [id])) {
        covered.add(resolved);
      }
    }
    const body = m.content?.trim() ?? '';
    if (!body) continue;
    for (const role of teamRoles) {
      if (messageExplicitlyAtMentionsRole(body, role)) covered.add(role.agentId);
    }
  }

  return missing.filter((r) => !covered.has(r.agentId));
}

export function findMissingMentionTargets(
  text: string,
  teamRoles: ProjectAgentRef[],
  speakerRoleId: string,
  mentionedRoleIds: string[] = [],
): ProjectAgentRef[] {
  return findRolesReferencedButNotMentioned(text, teamRoles, speakerRoleId, {
    mentionedRoleIds: new Set(mentionedRoleIds.filter(Boolean)),
  });
}

export function scheduleMissingMentionCoordinatorAudit(
  scenarioId: string,
  triggerMsgId: string,
  run: () => Promise<void>,
): void {
  const key = `${scenarioId}:${triggerMsgId}`;
  const existing = pending.get(key);
  if (existing) clearTimeout(existing.timer);

  const timer = setTimeout(() => {
    pending.delete(key);
    void run().catch((err) => console.warn('[office] missing-mention audit failed:', err));
  }, MISSING_MENTION_COORDINATOR_DELAY_MS);

  pending.set(key, { timer, triggerMsgId });
}

export type MissingMentionInterventionParams = {
  gateway: GatewayManager;
  scenarioId: string;
  coordinatorRoleId: string;
  coordinatorAgentId: string;
  scenarioName: string;
  speakerRole: OfficeRole;
  triggerMsg: RoomMessage;
  missingRoles: OfficeRole[];
};
