import { shouldScheduleSmartBroadcastCoordinatorWatch } from '../../../src/lib/office-execution-mode-policy';
import { mentionsIncludeAll } from './room-mentions';
import type { GatewayManager } from '../../gateway/manager';
import type { ProjectAgentRef } from '../../../src/lib/office-workflow-node';
import type { OfficeFixedGroup, OfficeTempProject, OfficeTaskExecutionMode, RoomMessage } from './types';
import { getRoomMessages, getFixedGroup } from './store';
import { membersForFixedGroup } from './office-member-resolve';
import { parseMentions, resolveMentionTargets } from './room-mentions';
import { isSubstantiveRoomMentionReply } from './room-mention-reply-policy';

export const UNMENTIONED_RESPONSE_WAIT_MS = 15_000;

type WatchParams = {
  gateway: GatewayManager;
  scenarioId: string;
  coordinatorRoleId: string;
  coordinatorAgentId: string;
  scenarioName: string;
  focusTask: OfficeTempProject | null;
  group: Pick<OfficeFixedGroup, 'workflow' | 'coordinatorAgentId' | 'agentIds'> | null;
  replyQuote: { fromLabel: string; preview: string } | null;
  roomContext: string | null;
  speakerLabel: string;
  content: string;
  triggerMsg: RoomMessage;
  teamMembers: ProjectAgentRef[];
  allMembers: ProjectAgentRef[];
};

type ActiveWatch = {
  generation: number;
  triggerMsgId: string;
  timer: NodeJS.Timeout;
};

const watches = new Map<string, ActiveWatch>();
let generationSeq = 0;

export function coordinatorDecidedNoReply(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^(HEARTBEAT_OK|NO_REPLY)\s*$/iu.test(t)) return true;
  if (/【判定】\s*无需|无需回应|不必回应|无需处理|不用回应|无须回应/u.test(t)) return true;
  if (/进展通报|自言自语|仅作?记录|知悉即可/u.test(t) && !/@/u.test(t)) return true;
  return false;
}

import { classifyRoomMessageKind } from './room-dispatch-policy';

export function shouldScheduleUnmentionedCoordinatorWatch(params: {
  isAllMention?: boolean;
  replyTargetCount: number;
  mentionTokens: string[];
  resolvedTeamMentionCount?: number;
  coordinatorRoleId?: string;
  fromRoleId?: string;
  from: RoomMessage['from'];
  content: string;
  /** Smart 专用；Workflow 由 runner 推进，传 workflow 时不调度。 */
  executionMode?: OfficeTaskExecutionMode;
}): boolean {
  if (mentionsIncludeAll(params.mentionTokens)) return false;
  const kind = classifyRoomMessageKind(params.mentionTokens);
  return shouldScheduleSmartBroadcastCoordinatorWatch({
    executionMode: params.executionMode ?? 'smart',
    kind,
    replyTargetCount: params.replyTargetCount,
    resolvedTeamMentionCount: params.resolvedTeamMentionCount,
    coordinatorRoleId: params.coordinatorRoleId,
    fromRoleId: params.fromRoleId,
    from: params.from as 'user' | 'agent' | 'system' | undefined,
    content: params.content,
  });
}

function teamAgentIdSet(members: ProjectAgentRef[]): Set<string> {
  return new Set(members.map((m) => m.agentId));
}

function unmentionedWatchKey(msg: Pick<RoomMessage, 'scenarioId' | 'groupId' | 'projectId'>): string {
  return (msg.scenarioId ?? msg.groupId ?? msg.projectId ?? '').trim();
}

/** Resolve watch key for register/cancel — prefers trigger message ids, falls back to scenarioId param. */
export function resolveUnmentionedWatchKey(
  triggerMsg: Pick<RoomMessage, 'scenarioId' | 'groupId' | 'projectId'>,
  scenarioId?: string,
): string {
  return unmentionedWatchKey(triggerMsg) || (scenarioId ?? '').trim();
}

function unmentionedWatchAliasKeys(
  msg: Pick<RoomMessage, 'scenarioId' | 'groupId' | 'projectId'>,
  scenarioId?: string,
): string[] {
  const keys = new Set<string>();
  const primary = unmentionedWatchKey(msg);
  if (primary) keys.add(primary);
  if (msg.projectId?.trim()) keys.add(msg.projectId.trim());
  if (msg.groupId?.trim()) keys.add(msg.groupId.trim());
  if (msg.scenarioId?.trim()) keys.add(msg.scenarioId.trim());
  if (scenarioId?.trim()) keys.add(scenarioId.trim());
  return [...keys];
}

function findUnmentionedWatchKey(msg: RoomMessage): string | undefined {
  for (const k of unmentionedWatchAliasKeys(msg)) {
    if (watches.has(k)) return k;
  }
  return undefined;
}

function registerUnmentionedWatch(keys: string[], entry: ActiveWatch): void {
  for (const k of keys) watches.set(k, entry);
}

/** Cancel pending watch when a teammate posts in the room after an unmentioned line. */
export function onRoomMessageWrittenForUnmentionedWatch(
  msg: RoomMessage,
  teamAgentIds: Set<string>,
): void {
  const watchKey = findUnmentionedWatchKey(msg);
  if (!watchKey) return;
  const watch = watches.get(watchKey);
  if (!watch) return;
  if (msg.from === 'system') return;
  const fromAgentId = (msg.fromAgentId ?? '').trim();
  if (!fromAgentId || !teamAgentIds.has(fromAgentId)) return;
  if (msg.id === watch.triggerMsgId) return;
  if (msg.timestamp < Date.now() - UNMENTIONED_RESPONSE_WAIT_MS * 4) return;
  const text = msg.content?.trim() ?? '';
  if (text.length < 4) return;
  cancelUnmentionedWatch(watchKey, 'team_role_replied');
}

export function cancelUnmentionedWatch(scenarioId: string, _reason?: string): void {
  const trimmed = scenarioId.trim();
  if (!trimmed) return;
  const direct = watches.get(trimmed);
  if (!direct) return;
  clearTimeout(direct.timer);
  for (const [k, w] of [...watches.entries()]) {
    if (w === direct) watches.delete(k);
  }
}

/** @deprecated alias — orchestrator 用户介入等路径使用 */
export const cancelUnmentionedCoordinatorWatch = cancelUnmentionedWatch;

export function scheduleUnmentionedCoordinatorWatch(
  params: WatchParams,
  runIntervention: (p: WatchParams) => Promise<void>,
): void {
  const aliasKeys = unmentionedWatchAliasKeys(params.triggerMsg, params.scenarioId);
  for (const k of aliasKeys) cancelUnmentionedWatch(k, 'superseded');
  const generation = ++generationSeq;
  const triggerMsgId = params.triggerMsg.id;
  const primaryKey = aliasKeys[0] ?? params.scenarioId.trim();

  const timer = setTimeout(() => {
    void (async () => {
      const active = watches.get(primaryKey);
      if (!active || active.generation !== generation || active.triggerMsgId !== triggerMsgId) {
        return;
      }
      cancelUnmentionedWatch(primaryKey);

      const teamIds = teamAgentIdSet(params.teamMembers);
      const roomProjectId = (params.triggerMsg.projectId ?? params.triggerMsg.taskId ?? '').trim();
      if (!roomProjectId) return;
      const history = await getRoomMessages(roomProjectId);
      const trigger = history.find((m) => m.id === triggerMsgId);
      if (!trigger) return;

      const triggerFrom = (trigger.fromAgentId ?? trigger.fromRoleId ?? '').trim();
      const responded = history.some((m) => {
        if (m.id === triggerMsgId || m.timestamp <= trigger.timestamp) return false;
        if (m.from === 'system') return false;
        const fromId = (m.fromAgentId ?? m.fromRoleId ?? '').trim();
        if (!fromId || !teamIds.has(fromId)) return false;
        if (fromId === triggerFrom) return false;
        const text = m.content?.trim() ?? '';
        if (text.length < 4) return false;
        if (!isSubstantiveRoomMentionReply(text) && /^(OK|收到)/u.test(text)) return false;
        return true;
      });
      if (responded) return;

      await runIntervention(params);
    })().catch((err) => {
      console.warn('[office] unmentioned coordinator watch failed:', err);
    });
  }, UNMENTIONED_RESPONSE_WAIT_MS);

  registerUnmentionedWatch(aliasKeys.length > 0 ? aliasKeys : [params.scenarioId], {
    generation,
    triggerMsgId,
    timer,
  });
}

export async function teamMembersForGroup(groupId: string): Promise<{
  group: OfficeFixedGroup | undefined;
  teamMembers: ProjectAgentRef[];
  allMembers: ProjectAgentRef[];
}> {
  const group = await getFixedGroup(groupId);
  const allMembers = group ? await membersForFixedGroup(group) : [];
  const teamMembers = group ? await membersForFixedGroup(group) : allMembers;
  return { group, teamMembers, allMembers };
}

/** @deprecated use teamMembersForGroup */
export async function teamRolesForScenario(scenarioId: string): Promise<{
  scenario: OfficeFixedGroup | undefined;
  teamRoles: ProjectAgentRef[];
  allRoles: ProjectAgentRef[];
}> {
  const { group, teamMembers, allMembers } = await teamMembersForGroup(scenarioId);
  return { scenario: group, teamRoles: teamMembers, allRoles: allMembers };
}

export function parseCoordinatorDelegationTargets(
  replyBody: string,
  teamMembers: ProjectAgentRef[],
  coordinatorAgentId: string,
): ReturnType<typeof resolveMentionTargets> {
  const tokens = parseMentions(replyBody);
  return resolveMentionTargets(tokens, teamMembers).filter((m) => m.agentId !== coordinatorAgentId);
}
