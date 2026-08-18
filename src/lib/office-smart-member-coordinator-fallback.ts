/** Smart 成员多次重试仍未 @ 协调者时的兜底判定与正文提取（不改提示词）。 */

import { extractSmartMemberRoomReplyFromRaw } from '@/lib/office-smart-room-fields';
import { smartMemberReplyMentionsCoordinator } from '@/lib/office-smart-member-reply';

export type SmartMemberCoordinatorFallbackIssue = 'smart_member_missing_coordinator';

const TRANSPORT_ONLY_ISSUES = new Set([
  'empty',
  'transport_timeout',
  'transport_error',
  'model_error',
]);

const MEMBER_COMPLETION_STRUCTURAL_ISSUES = new Set([
  'smart_member_missing_subtask_done_marker',
  'invalid_json_schema',
  'invalid_json_missing_fields',
]);

function hasNonTransportIssues(issues: string[]): boolean {
  return issues.some((i) => !TRANSPORT_ONLY_ISSUES.has(i));
}

/** 重试耗尽且仍缺 @协调者：可走兜底，由协调者 LLM 理解成员正文。 */
export function canFallbackSmartMemberMissingCoordinatorMention(params: {
  executionMode: 'smart' | 'workflow';
  isCoordinator: boolean;
  issues: string[];
  raw: string;
  retried: boolean;
}): boolean {
  if (params.executionMode !== 'smart' || params.isCoordinator) return false;
  if (!params.retried) return false;
  if (!params.issues.includes('smart_member_missing_coordinator')) return false;
  if (!params.raw.trim()) return false;
  if (!hasNonTransportIssues(params.issues)) return false;
  return true;
}

/**
 * 成员已 @协调者且正文可发群，但仅因 end/**已完成** 等结构化完成字段不合格：
 * 仍视同汇报协调者并触发协调者 Session（避免群聊可见但协调者无 session 记录）。
 */
export function tryExtractSmartMemberReportForCoordinator(params: {
  executionMode: 'smart' | 'workflow';
  isCoordinator: boolean;
  issues: string[];
  raw: string;
  retried: boolean;
  coordinator: { id: string; name: string };
  minLen?: number;
}): string | null {
  if (params.executionMode !== 'smart' || params.isCoordinator) return null;
  if (!params.retried || !params.raw.trim()) return null;
  if (!hasNonTransportIssues(params.issues)) return null;
  if (!params.issues.some((i) => MEMBER_COMPLETION_STRUCTURAL_ISSUES.has(i))) return null;

  const minLen = params.minLen ?? 12;
  const roomReply = extractSmartMemberRoomReplyFromRaw(params.raw);
  if (!roomReply || roomReply.length < minLen) return null;
  if (
    !smartMemberReplyMentionsCoordinator(roomReply, {
      agentId: params.coordinator.id,
      displayName: params.coordinator.name,
    })
  ) {
    return null;
  }
  return roomReply;
}
