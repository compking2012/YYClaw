import type { ProjectAgentRef } from '@/lib/office-workflow-node';
import type { RoomMessage } from '@/types/office';

/** v2 测试夹具：仅 agentId + displayName，不再使用 OfficeRole。 */
export function agent(agentId: string, displayName: string): ProjectAgentRef {
  return { agentId, displayName };
}

/** Smart 测试常用 roster */
export const SMART_AGENTS = {
  coord: agent('a-coord', '协调者'),
  pm: agent('a-pm', 'PM'),
  dev: agent('a-dev', '开发'),
  product: agent('a-product', '产品'),
  qa: agent('a-qa', '测试'),
} as const;

export function smartTeamCore() {
  return [SMART_AGENTS.coord, SMART_AGENTS.pm, SMART_AGENTS.dev];
}

export function roomMsg(
  partial: Partial<RoomMessage> & Pick<RoomMessage, 'id' | 'content' | 'timestamp'>,
): RoomMessage {
  const legacy = partial as Partial<RoomMessage> & { taskId?: string; fromRoleId?: string };
  return {
    projectId: partial.projectId ?? legacy.taskId ?? 't1',
    from: partial.from ?? 'agent',
    fromAgentId: partial.fromAgentId ?? legacy.fromRoleId ?? (typeof partial.from === 'string' ? partial.from : undefined),
    mentions: partial.mentions ?? [],
    ...partial,
  };
}
