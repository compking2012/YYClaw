import { describe, expect, it } from 'vitest';
import {
  compactOfficeDeliverableForRoomMirror,
  isOfficeDeliverableInlineWithinLimit,
  isOfficeDeliverableSectionWithinLimit,
  normalizeSmartDeliverableItemPath,
  officeDeliverableDeclaresFilePath,
  officeDeliverableInlineCharCount,
  validateOfficeFileDeliverableMessage,
  validateRoleScopedDeliverableFileNames,
  validateSmartJsonDeliverableItems,
  validateSmartMemberDeliverableItems,
  validateWorkflowAgentDeliverableSection,
  validateWorkflowDeliverableSection,
  validateWorkflowJsonExplicitDeliverablePaths,
  validateWorkflowRoleScopedDeliverablePaths,
} from '../../src/lib/office-deliverable-file-policy';

describe('office-deliverable-file-policy', () => {
  it('counts inline chars without path noise', () => {
    const text = '交付说明：模块已实现。路径 ~/office/projects/p/交付物-开发/report.html';
    expect(officeDeliverableInlineCharCount(text)).toBeLessThan(text.length);
    expect(isOfficeDeliverableInlineWithinLimit('简短交付说明足够长'.repeat(3))).toBe(true);
    expect(isOfficeDeliverableSectionWithinLimit('段落'.repeat(30))).toBe(true);
  });

  it('detects declared file paths in deliverable text', () => {
    expect(
      officeDeliverableDeclaresFilePath('见 ~/office/projects/demo/交付物-开发/a.html'),
    ).toBe(true);
    expect(officeDeliverableDeclaresFilePath('稍后交付')).toBe(false);
  });

  it('validates role-scoped deliverable file names', () => {
    expect(
      validateRoleScopedDeliverableFileNames('开发', '交付物-开发/report-开发.html'),
    ).toBe(true);
    expect(
      validateRoleScopedDeliverableFileNames('开发', 'report.html'),
    ).toBe(false);
  });

  it('validates smart json deliverable items', () => {
    expect(
      validateSmartJsonDeliverableItems('开发', ['交付物-开发/report-开发.html']),
    ).toBe(true);
    expect(normalizeSmartDeliverableItemPath('交付物-开发/a-开发.md', '开发')).toContain('开发');
  });

  it('validates smart member deliverable items', () => {
    expect(
      validateSmartMemberDeliverableItems('开发', ['report-开发.html']),
    ).toBe(true);
  });

  it('validates workflow deliverable sections and paths', () => {
    const section = '交付物-开发/report-开发.html 已落盘，摘要：实现登录模块。';
    expect(validateWorkflowDeliverableSection(section)).toEqual([]);
    expect(validateWorkflowAgentDeliverableSection(section)).toEqual([]);
    expect(
      validateWorkflowJsonExplicitDeliverablePaths('开发', '交付物-开发/report-开发.html'),
    ).toBe(true);
    expect(
      validateWorkflowRoleScopedDeliverablePaths('开发', section),
    ).toBe(true);
  });

  it('validates office file deliverable message and compacts mirror text', () => {
    const msg = '交付 ~/office/projects/p/交付物-开发/out-开发.html 已完成';
    expect(validateOfficeFileDeliverableMessage(msg)).toEqual([]);
    const compact = compactOfficeDeliverableForRoomMirror({
      deliverable: '交付物-开发/out-开发.html 摘要说明',
      outputValidation: 'ls -l 交付物-开发/out-开发.html',
      maxChars: 120,
    });
    expect(compact.length).toBeGreaterThan(0);
  });
});
