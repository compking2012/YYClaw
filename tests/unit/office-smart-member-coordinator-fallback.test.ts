import { describe, expect, it } from 'vitest';
import {
  canFallbackSmartMemberMissingCoordinatorMention,
  tryExtractSmartMemberReportForCoordinator,
} from '../../src/lib/office-smart-member-coordinator-fallback';

const coordinator = { agentId: 'agent-pm', displayName: 'PM' };

describe('office-smart-member-coordinator-fallback', () => {
  it('allows fallback after retry when missing coordinator mention', () => {
    expect(
      canFallbackSmartMemberMissingCoordinatorMention({
        executionMode: 'smart',
        isCoordinator: false,
        issues: ['smart_member_missing_coordinator', 'room_reply_too_short'],
        raw: JSON.stringify({
          role: '开发',
          taskUnderstanding: '汇报进度',
          inputValidation: '无',
          deliverable: { items: [], outputValidation: '无' },
          roomReply: '@PM 模块已完成，请验收。',
        }),
        retried: true,
      }),
    ).toBe(true);
  });

  it('rejects fallback when missing coordinator issue absent', () => {
    expect(
      canFallbackSmartMemberMissingCoordinatorMention({
        executionMode: 'smart',
        isCoordinator: false,
        issues: ['transport_timeout'],
        raw: '{"roomReply":"@PM hi"}',
        retried: true,
      }),
    ).toBe(false);
  });

  it('rejects fallback without retry', () => {
    expect(
      canFallbackSmartMemberMissingCoordinatorMention({
        executionMode: 'smart',
        isCoordinator: false,
        issues: ['smart_member_missing_coordinator'],
        raw: '{"roomReply":"@PM hi"}',
        retried: false,
      }),
    ).toBe(false);
  });

  it('extracts member report when structural completion fields fail but @PM present', () => {
    const raw = [
      '【任务理解】完成开发',
      '【输入校验】无',
      '【交付产物】无',
      '【群聊回复】@PM **开发已完成** 交付物已落盘。',
    ].join('\n');
    const text = tryExtractSmartMemberReportForCoordinator({
      executionMode: 'smart',
      isCoordinator: false,
      issues: ['smart_member_missing_subtask_done_marker'],
      raw,
      retried: true,
      coordinator,
    });
    expect(text).toContain('@PM');
    expect(text!.length).toBeGreaterThan(12);
  });

  it('returns null when member does not mention coordinator', () => {
    expect(
      tryExtractSmartMemberReportForCoordinator({
        executionMode: 'smart',
        isCoordinator: false,
        issues: ['invalid_json_schema'],
        raw: JSON.stringify({
          role: '开发',
          roomReply: '开发已完成但未点名协调者。',
        }),
        retried: true,
        coordinator,
      }),
    ).toBeNull();
  });
});
