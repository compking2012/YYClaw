import { describe, expect, it } from 'vitest';
import { inferStepTitle, summarizeActionTitle } from '@/lib/office-workflow-generate';

describe('summarizeActionTitle', () => {
  it('keeps verb + head noun and drops attribute modifiers', () => {
    expect(summarizeActionTitle('编写漫画PPT策划案')).toBe('编写策划案');
  });

  it('keeps compound object nouns', () => {
    expect(summarizeActionTitle('编写项目预算')).toBe('编写项目预算');
    expect(summarizeActionTitle('评审需求说明书初稿，提出意见')).toBe('评审需求说明书');
  });

  it('handles tail-verb and collection phrasing', () => {
    expect(inferStepTitle('测试根据需求说明书进行测试用例编写', '测试')).toBe('测试用例编写');
    expect(
      inferStepTitle('数据搜集师 搜集相关权威材料和数据，输出为GPGPU相关信息', '数据收集师'),
    ).toBe('搜集相关权威');
  });

  it('never throws on empty/short/latin-heavy inputs', () => {
    const inputs = ['', 'a', '测试', '实现API模块', '部署Redis集群', '编写GPGPU技术报告', '组织全员kickoff'];
    for (const input of inputs) {
      expect(() => summarizeActionTitle(input)).not.toThrow();
      expect(typeof summarizeActionTitle(input)).toBe('string');
      expect(summarizeActionTitle(input).length).toBeGreaterThan(0);
    }
  });
});
