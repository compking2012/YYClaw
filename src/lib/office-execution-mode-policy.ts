import type { OfficeTaskExecutionMode } from '@/types/office';

/**
 * 执行模式策略（Workflow vs Smart）— 任务推进与群聊驱动的唯一事实来源。
 *
 * **Workflow**
 * - 推进：预置 DAG + runner 自动执行/回流子任务；群聊仅信息同步。
 * - 点名：runner 活跃时默认不触发成员/协调者群聊 LLM；例外：用户 @ 协调者；成员【协作询问】@ 直接前驱。
 * - 用户发言：无论是否 @、@ 谁，仅协调者 LLM 在群聊响应并判定是否续跑；成员不直接回复用户。
 *
 * **Smart**
 * - 推进：群聊点名为唯一驱动；成员完成后必须 @ 协调者；协调者拆解并 @ 执行者；被 @ 者须回复。
 * - 用户发言：成员不直接响应；立即由协调者介入；仅当协调者 @ 成员派活后将项目标为 running（未派活不改卡片状态）。
 * - 非用户无 @ 广播：仍用 15s 协调者兜底规则。
 */

export function isSmartRoomExecutionDriver(mode: OfficeTaskExecutionMode): boolean {
  return mode === 'smart';
}

export function isWorkflowRunnerDriven(mode: OfficeTaskExecutionMode): boolean {
  return mode === 'workflow';
}

/** Smart：用户在项目群发言 → 立即由协调者介入（成员不直接响应用户）。 */
export function shouldImmediateSmartUserRoomCoordinatorIntervention(params: {
  executionMode: OfficeTaskExecutionMode;
  from?: 'user' | 'agent' | 'system';
  hasFocusTask: boolean;
}): boolean {
  return (
    isSmartRoomExecutionDriver(params.executionMode)
    && params.from === 'user'
    && params.hasFocusTask
  );
}

/** Smart：非用户无 @ 广播后协调者兜底介入（15s 规则）。Workflow 不使用。 */
export function shouldScheduleSmartBroadcastCoordinatorWatch(params: {
  executionMode: OfficeTaskExecutionMode;
  kind: 'broadcast' | 'direct_mention';
  replyTargetCount: number;
  /** 消息 @ 已解析到团队成员（含协调者）时不再调度 15s 兜底，避免与点名回复重复。 */
  resolvedTeamMentionCount?: number;
  coordinatorAgentId?: string;
  coordinatorRoleId?: string;
  fromAgentId?: string;
  fromRoleId?: string;
  from?: 'user' | 'agent' | 'system';
  content: string;
}): boolean {
  if (!isSmartRoomExecutionDriver(params.executionMode)) return false;
  if (params.from === 'user') return false;
  if (params.from === 'system') return false;
  const coordinatorId = (params.coordinatorAgentId ?? params.coordinatorRoleId)?.trim();
  if (!coordinatorId) return false;
  if (params.kind !== 'broadcast') return false;
  if (params.replyTargetCount > 0) return false;
  if ((params.resolvedTeamMentionCount ?? 0) > 0) return false;
  const fromId = (params.fromAgentId ?? params.fromRoleId)?.trim();
  if (fromId === coordinatorId) return false;
  if (!params.content.trim()) return false;
  return true;
}

/** Workflow runner 活跃时，是否允许对该角色触发群聊点名 LLM。 */
export function shouldDispatchWorkflowRoomMentionLlm(params: {
  targetRoleId: string;
  coordinatorRoleId: string;
  messageFrom?: 'user' | 'agent' | 'system';
  /** 协作询问 @ 直接前驱（由上游 mention 模块判定后传入）。 */
  allowUpstreamClarification?: boolean;
}): boolean {
  if (params.allowUpstreamClarification) return true;
  if (params.messageFrom === 'user' && params.targetRoleId === params.coordinatorRoleId) {
    return true;
  }
  return false;
}
