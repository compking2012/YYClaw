import { describe, expect, it } from 'vitest';
import {
  compactSmartMemberAssignmentSummary,
  isSmartMemberAcceptanceAckReply,
  isSmartMemberDeliverableReply,
  isSmartMemberHelpAction,
  isSmartMemberJsonRoomReplyDeliverableComplete,
  isSmartMemberSubtaskDoneMarker,
  isSmartMemberWaitingForPeerReply,
  isSmartSubtaskDoneBracketTitle,
  mentionClauseForRole,
  pickPeerMentionTokenForWaiting,
  smartCoordinatorMentionRef,
  smartCoordinatorReplyHasDirectMemberAssignment,
  smartMemberReplyDeclaresEnd,
  smartMemberReportKindLabel,
  stripProjectGateClauses,
  synthesizeBlockedMemberDependencyJson,
  synthesizeBlockedMemberDependencyReply,
} from '@/lib/office-smart-member-reply';

describe('office-smart-member-reply pure helpers', () => {
  const devRole = { agentId: 'dev-1', displayName: '开发' };
  const pmCoord = { agentId: 'pm-1', displayName: 'PM' };

  it('stripProjectGateClauses removes project gate wording', () => {
    const text = '开发已完成，待测试完成后即可结项。';
    expect(stripProjectGateClauses(text)).not.toContain('结项');
  });

  it('mentionClauseForRole extracts @ clause for role', () => {
    const line = '@PM 请验收。@开发 请继续实现核心模块并完成自测。';
    const clause = mentionClauseForRole(line, devRole);
    expect(clause).toContain('@开发');
  });

  it('compactSmartMemberAssignmentSummary compresses completed deliverable lines', () => {
    const long =
      '已完成编写并交付 index.html，请 @PM 验收。路径：`交付物-开发/index-开发.html`';
    const compact = compactSmartMemberAssignmentSummary(long);
    expect(compact).toContain('已交付');
    expect(compact!.length).toBeLessThanOrEqual(140);
  });

  it('pickPeerMentionTokenForWaiting skips self mention', () => {
    expect(
      pickPeerMentionTokenForWaiting('@开发 等待 @PM 交付需求文档。', devRole),
    ).toMatch(/^pm$/i);
  });

  it('synthesizeBlockedMemberDependencyJson/reply for blocked upstream', () => {
    const coordLine = JSON.stringify({
      role: 'PM',
      taskUnderstanding: '等待上游',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
      roomReply: '',
      action: 'assign',
      dispatch: [{ role: '开发', task: '等待产品交付后再开工。' }],
    });
    const json = synthesizeBlockedMemberDependencyJson('开发', pmCoord, coordLine, devRole);
    expect(json).toContain('help');
    expect(synthesizeBlockedMemberDependencyReply(pmCoord, coordLine, devRole)).toContain('依赖阻塞');
  });

  it('synthesizeBlockedMemberDependencyJson returns null when directly assigned', () => {
    const coordLine = JSON.stringify({
      role: 'PM',
      taskUnderstanding: '派工',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
      roomReply: '',
      action: 'assign',
      dispatch: [{ role: '开发', task: '@开发 请今日完成模块实现并提交代码。' }],
    });
    expect(synthesizeBlockedMemberDependencyJson('开发', pmCoord, coordLine, devRole)).toBeNull();
  });

  it('smartCoordinatorMentionRef returns mention token', () => {
    expect(smartCoordinatorMentionRef(pmCoord)).toMatch(/PM/);
  });

  it('classifies promise, dependency and acceptance replies', () => {
    expect(isSmartMemberWaitingForPeerReply('@PM 等待上游交付 HTML 后无法开展。')).toBe(true);
    expect(isSmartMemberAcceptanceAckReply('收到，已知悉验收结论，无新任务。')).toBe(true);
    expect(isSmartMemberSubtaskDoneMarker('**五子棋需求文档已完成**')).toBe(true);
    expect(isSmartSubtaskDoneBracketTitle('五子棋需求文档已完成')).toBe(true);
    expect(isSmartSubtaskDoneBracketTitle('群聊回复')).toBe(false);
  });

  it('detects JSON action end/help', () => {
    const endJson = JSON.stringify({
      role: '开发',
      taskUnderstanding: '完成',
      inputValidation: '无',
      deliverable: { items: ['a-开发.md'], outputValidation: '无' },
      roomReply: '@PM 完成',
      action: 'end',
      dispatch: [{ role: 'PM', task: '@PM 请验收' }],
    });
    const helpJson = endJson.replace('"end"', '"help"');
    expect(smartMemberReplyDeclaresEnd(endJson)).toBe(true);
    expect(isSmartMemberHelpAction(helpJson)).toBe(true);
  });

  it('smartMemberReportKindLabel maps kinds', () => {
    expect(smartMemberReportKindLabel('blocked_report')).toContain('阻塞');
    expect(smartMemberReportKindLabel('other')).toContain('其它');
  });

  it('deliverable completeness helpers', () => {
    const done =
      '@PM **模块A已完成** 已交付交付物-开发/a-开发.md，自测通过。';
    expect(isSmartMemberDeliverableReply(done)).toBe(true);
    expect(isSmartMemberJsonRoomReplyDeliverableComplete(done)).toBe(true);
    expect(isSmartMemberDeliverableReply('明白了，我现在开始干活。')).toBe(false);
  });

  it('smartCoordinatorReplyHasDirectMemberAssignment detects dispatch', () => {
    const json = JSON.stringify({
      role: 'PM',
      taskUnderstanding: '分工',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
      roomReply: '',
      action: 'assign',
      dispatch: [{ role: '开发', task: '@开发 请实现登录模块并完成自测。' }],
    });
    expect(smartCoordinatorReplyHasDirectMemberAssignment(json)).toBe(true);
  });
});
