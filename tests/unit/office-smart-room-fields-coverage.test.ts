import { describe, expect, it } from 'vitest';
import {
  extractSmartMemberRoomReplyFromRaw,
  extractSmartRoomReplyAndDispatch,
  hasSmartCoordinatorStructuredDispatch,
} from '../../src/lib/office-smart-room-fields';

describe('office-smart-room-fields coverage', () => {
  it('extracts smart JSON coordinator fields', () => {
    const raw = JSON.stringify({
      role: 'PM',
      taskUnderstanding: '派开发执行',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
      roomReply: '请开发继续实现核心模块。',
      action: 'assign',
      dispatch: [{ role: '开发', task: '@开发 请实现。' }],
    });
    const fields = extractSmartRoomReplyAndDispatch(raw);
    expect(fields.roomReply).toContain('请开发');
    expect(fields.dispatch).toContain('开发');
    expect(hasSmartCoordinatorStructuredDispatch(raw)).toBe(true);
  });

  it('extracts member room reply from bracket sections', () => {
    const raw = [
      '【任务理解】完成开发',
      '【输入校验】无',
      '【交付产物】无',
      '【群聊回复】@PM **开发已完成** 交付物已落盘。',
    ].join('\n');
    expect(extractSmartMemberRoomReplyFromRaw(raw)).toContain('@PM');
  });

  it('extracts member room reply from JSON with dispatch', () => {
    const raw = JSON.stringify({
      role: '开发',
      taskUnderstanding: '汇报',
      inputValidation: '无',
      deliverable: { items: ['交付物-开发/a-开发.md'], outputValidation: '无' },
      roomReply: '@PM 开发已完成。',
      action: 'report',
      dispatch: [{ role: 'PM', task: '请验收' }],
    });
    const text = extractSmartMemberRoomReplyFromRaw(raw);
    expect(text.length).toBeGreaterThan(0);
  });
});
