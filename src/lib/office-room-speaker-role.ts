import { agentMatchesMentionToken } from '@/lib/office-mention-parse';
import type { ProjectAgentRef } from '@/lib/office-workflow-node';
import type { RoomMessage } from '@/types/office';

type TeamMemberRef = Pick<ProjectAgentRef, 'agentId' | 'displayName'>;

function memberByAgentId(teamMembers: TeamMemberRef[], agentId: string): TeamMemberRef | undefined {
  const id = agentId.trim();
  if (!id) return undefined;
  return teamMembers.find((m) => m.agentId.trim() === id);
}

function memberById(teamMembers: TeamMemberRef[], id: string | undefined): TeamMemberRef | undefined {
  const t = id?.trim();
  if (!t) return undefined;
  return memberByAgentId(teamMembers, t);
}

/** 从群聊消息正文行首解析发言角色名（如 `👔 【PM】👉 …`），不匹配「协调者」等职能词。 */
export function parseRoomMessageSpeakerNameFromContent(content: string): string | null {
  const line =
    content
      .trim()
      .split('\n')
      .map((l) => l.trim())
      .find(Boolean) ?? '';
  const m = line.match(/【\s*([^】\s]+)\s*】/u);
  return m?.[1]?.trim() || null;
}

function memberByDisplayName(teamMembers: TeamMemberRef[], name: string): TeamMemberRef | undefined {
  const n = name.trim();
  if (!n) return undefined;
  const lower = n.toLowerCase();
  return teamMembers.find(
    (m) =>
      m.displayName === n
      || (m.displayName?.toLowerCase() ?? '') === lower
      || m.agentId === n
      || m.agentId.toLowerCase() === lower
      || agentMatchesMentionToken(m, n),
  );
}

/**
 * 解析群聊发言者 agent id：优先 fromAgentId / from(agentId)，否则按正文 【显示名】 与团队 roster 匹配。
 */
export function resolveRoomMessageSpeakerAgentId(
  message: Pick<RoomMessage, 'from' | 'fromAgentId' | 'content'>,
  teamMembers: TeamMemberRef[],
): string | undefined {
  const fromMember = memberById(teamMembers, message.fromAgentId);
  if (fromMember) return fromMember.agentId;

  if (message.from && message.from !== 'user' && message.from !== 'system') {
    const fromAgent = memberById(teamMembers, message.from);
    if (fromAgent) return fromAgent.agentId;
  }

  const parsedName = parseRoomMessageSpeakerNameFromContent(message.content ?? '');
  if (parsedName) {
    const byName = memberByDisplayName(teamMembers, parsedName);
    if (byName) return byName.agentId;
  }

  return undefined;
}

/** @deprecated Use resolveRoomMessageSpeakerAgentId */
export const resolveRoomMessageSpeakerRoleId = resolveRoomMessageSpeakerAgentId;

/** 发言者是否为该项目的协调者 agent。 */
export function isProjectCoordinatorSpeaker(
  speakerAgentId: string | undefined,
  coordinatorAgentId: string,
): boolean {
  const speaker = speakerAgentId?.trim();
  const coord = coordinatorAgentId?.trim();
  if (!speaker || !coord) return false;
  return speaker === coord;
}

/** @deprecated Use isProjectCoordinatorSpeaker */
export const isTaskCoordinatorSpeaker = isProjectCoordinatorSpeaker;
