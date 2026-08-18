import { smartAssignFollowUpAlreadyDispatched } from './smart-assign-ledger';
import type { ProjectAgentRef } from '../../../src/lib/office-workflow-node';
import type { SmartLastAssignRecord } from './types';
import type { RoomMessage } from './types';
import type { OfficeTaskExecutionMode } from './types';

type FollowUpMentionRef = Pick<ProjectAgentRef, 'agentId' | 'displayName'>;

export type FilterFollowUpMentionTargetsParams = {
  executionMode: OfficeTaskExecutionMode;
  coordinatorRoleId: string;
  fromRoleId: string;
  delegated: FollowUpMentionRef[];
  replyText?: string;
  roomMessages?: RoomMessage[];
  taskId?: string;
  replyTimestamp?: number;
  /** @deprecated Smart 跟进不再按工作顺序收窄；保留兼容 orchestrator 传参 */
  smartNextExecutorRoleIds?: string[];
  /** 协调者 assign 源消息 id（follow-up 去重）。 */
  replyMessageId?: string;
  smartLastAssign?: SmartLastAssignRecord;
};

function roleMatchesCoordinatorRoleId(
  role: FollowUpMentionRef,
  coordinatorRoleId: string,
): boolean {
  const coord = coordinatorRoleId.trim();
  if (!coord) return false;
  return (role.agentId ?? '').trim() === coord;
}

/**
 * 群聊跟进 @ 目标过滤。
 * - **Workflow**：不做 Smart 规则，原样返回 `delegated`。
 * - **Smart**：见 {@link filterSmartFollowUpMentionTargets}。
 */
export function filterFollowUpMentionTargets(
  params: FilterFollowUpMentionTargetsParams,
): FollowUpMentionRef[] {
  if (params.executionMode !== 'smart') {
    return params.delegated;
  }
  return filterSmartFollowUpMentionTargets(params);
}

/**
 * Smart 专用：成员↔协调者、协调者↔协调者（自 @）点名跟进须原样送达 LLM。
 * 协调者发出的跟进不对正文做「进展同步 / 派活」等二次过滤，由上游解析出的
 * `delegated` 原样投递各角色 Session。
 */
export function filterSmartFollowUpMentionTargets(
  params: FilterFollowUpMentionTargetsParams,
): FollowUpMentionRef[] {
  if (params.fromRoleId === params.coordinatorRoleId) {
    const replyMessageId = params.replyMessageId?.trim();
    if (replyMessageId && smartAssignFollowUpAlreadyDispatched(params.smartLastAssign, replyMessageId)) {
      return [];
    }
    return params.delegated;
  }
  const coord = params.delegated.find((r) =>
    roleMatchesCoordinatorRoleId(r, params.coordinatorRoleId),
  );
  return coord ? [coord] : [];
}
