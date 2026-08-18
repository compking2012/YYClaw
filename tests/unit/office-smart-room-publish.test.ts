import { describe, expect, it } from 'vitest';
import {
  buildSmartCoordinatorRoomPublishTextFromJson,
  buildSmartMemberRoomPublishText,
  buildSmartRoomPublishText,
  formatSmartDeliverableItemsRoomSummary,
  smartCoordinatorRoomMirrorTextFromJson,
  smartMemberRoomMirrorTextFromJson,
} from '@/lib/office-smart-room-publish';
import type {
  SmartCoordinatorJsonOutput,
  SmartMemberJsonOutput,
} from '@/lib/office-smart-json-schema';

describe('office-smart-room-publish', () => {
  it('formatSmartDeliverableItemsRoomSummary uses basename labels', () => {
    expect(formatSmartDeliverableItemsRoomSummary([])).toBe('');
    expect(
      formatSmartDeliverableItemsRoomSummary(['交付物-开发/a-开发.md', '  ']),
    ).toBe('交付物：a-开发.md');
    expect(
      formatSmartDeliverableItemsRoomSummary(['C:\\proj\\b.html\\']),
    ).toBe('交付物：b.html');
  });

  it('buildSmartMemberRoomPublishText joins understanding, deliverable and dispatch', () => {
    const json: SmartMemberJsonOutput = {
      role: '开发',
      taskUnderstanding: '完成模块实现',
      inputValidation: '无',
      deliverable: { items: ['交付物-开发/x-开发.md'], outputValidation: '无' },
      roomReply: '',
      action: 'report',
      dispatch: [{ role: 'PM', task: '@PM 请验收。' }],
    };
    const text = buildSmartMemberRoomPublishText(json);
    expect(text).toContain('完成模块实现');
    expect(text).toContain('交付物：x-开发.md');
    expect(text).toContain('@PM');
  });

  it('buildSmartCoordinatorRoomPublishTextFromJson omits empty sections', () => {
    const json: SmartCoordinatorJsonOutput = {
      role: 'PM',
      taskUnderstanding: '  ',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
      roomReply: '',
      action: 'assign',
      dispatch: [{ role: '开发', task: '@开发 请实现。' }],
    };
    expect(buildSmartCoordinatorRoomPublishTextFromJson(json)).toContain('@开发');
  });

  it('mirror helpers prefer legacy roomReply when present', () => {
    const coord: SmartCoordinatorJsonOutput = {
      role: 'PM',
      taskUnderstanding: '理解',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
      roomReply: '群聊镜像段',
      action: 'assign',
      dispatch: [],
    };
    const member: SmartMemberJsonOutput = {
      role: '开发',
      taskUnderstanding: '理解',
      inputValidation: '无',
      deliverable: { items: ['a.md'], outputValidation: '无' },
      roomReply: '成员镜像',
      action: 'report',
      dispatch: [],
    };
    expect(smartCoordinatorRoomMirrorTextFromJson(coord)).toBe('群聊镜像段');
    expect(smartMemberRoomMirrorTextFromJson(member)).toBe('成员镜像');
  });

  it('buildSmartRoomPublishText routes by coordinator flag', () => {
    const memberJson: SmartMemberJsonOutput = {
      role: '开发',
      taskUnderstanding: '成员理解',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
      roomReply: '',
      action: 'report',
      dispatch: [],
    };
    const coordJson: SmartCoordinatorJsonOutput = {
      role: 'PM',
      taskUnderstanding: '协调者理解',
      inputValidation: '无',
      deliverable: { items: [], outputValidation: '无' },
      roomReply: '',
      action: 'assign',
      dispatch: [],
    };
    expect(buildSmartRoomPublishText(memberJson, false)).toContain('成员理解');
    expect(buildSmartRoomPublishText(coordJson, true)).toContain('协调者理解');
  });
});
