import { parseMentions, resolveMentionTargets } from '@/lib/office-mention-parse';
import type { ProjectAgentRef } from '@/lib/office-workflow-node';
import type { WorkflowHandoffTarget } from '@/lib/office-workflow-handoff';

const HANDOFF_MIN_CHARS = 8;

/** 成员【交接】/@ 行是否包含对工作流下一角色的有效点名。 */
export function memberHandoffCoversExpected(
  handoffText: string,
  expected: WorkflowHandoffTarget[],
  teamRoles: ProjectAgentRef[],
): boolean {
  const text = handoffText.trim();
  if (!text || expected.length === 0) return false;
  if (text.length < HANDOFF_MIN_CHARS) return false;
  const tokens = parseMentions(text);
  if (tokens.length === 0) return false;
  const mentioned = resolveMentionTargets(tokens, teamRoles);
  if (mentioned.length === 0) return false;
  const expectedIds = new Set(expected.map((t) => t.roleId));
  return mentioned.some((r) => expectedIds.has(r.agentId));
}

/** 群聊 task_handoff 消息是否满足「有子任务说明 + @ 下一角色」。 */
export function isValidWorkflowHandoffRoomMessage(
  content: string,
  expected: WorkflowHandoffTarget[],
  teamRoles: ProjectAgentRef[],
): boolean {
  return memberHandoffCoversExpected(content, expected, teamRoles);
}

/** 交付后是否仍需协调者兜底（有下一跳但成员未有效交接）。 */
export function needsCoordinatorHandoffFallback(
  expected: WorkflowHandoffTarget[],
  memberHandoffOk: boolean,
): boolean {
  return expected.length > 0 && !memberHandoffOk;
}
