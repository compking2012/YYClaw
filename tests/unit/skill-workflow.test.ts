import { describe, expect, it } from 'vitest';
import {
  frontmatterOptsIntoWorkflow,
  isWorkflowSkillContent,
  looksLikeWorkflowText,
  parseWorkflowSteps,
  stripFrontmatter,
} from '@shared/workflow/skill-workflow';

describe('looksLikeWorkflowText', () => {
  it('detects sequencing prose (首先…然后…最后)', () => {
    expect(looksLikeWorkflowText('首先抓取数据，然后汇总，最后给出建议')).toBe(true);
  });
  it('detects numbered lists of 2+ items', () => {
    expect(looksLikeWorkflowText('1. 调研市场\n2. 写方案\n3. 输出报告')).toBe(true);
  });
  it('rejects short one-shot text', () => {
    expect(looksLikeWorkflowText('今天几号')).toBe(false);
  });
  it('rejects a single short sequencing cue', () => {
    expect(looksLikeWorkflowText('先吃饭再睡觉')).toBe(false);
  });
});

describe('frontmatterOptsIntoWorkflow', () => {
  it('honors an explicit workflow: true (nested under metadata)', () => {
    const md = ['---', 'name: demo', 'metadata:', '  workflow: true', '---', 'body'].join('\n');
    expect(frontmatterOptsIntoWorkflow(md)).toBe(true);
  });
  it('honors a top-level workflow: true', () => {
    const md = ['---', 'name: demo', 'workflow: true', '---', 'body'].join('\n');
    expect(frontmatterOptsIntoWorkflow(md)).toBe(true);
  });
  it('is false without the opt-in', () => {
    const md = ['---', 'name: demo', 'description: x', '---', 'body'].join('\n');
    expect(frontmatterOptsIntoWorkflow(md)).toBe(false);
  });
});

describe('stripFrontmatter', () => {
  it('removes the leading YAML block', () => {
    const md = ['---', 'name: demo', '---', 'the body', 'more'].join('\n');
    expect(stripFrontmatter(md)).toBe('the body\nmore');
  });
  it('returns content unchanged when there is no frontmatter', () => {
    expect(stripFrontmatter('just body')).toBe('just body');
  });
});

describe('parseWorkflowSteps', () => {
  it('extracts a numbered list from the body', () => {
    const md = ['---', 'name: demo', '---', '1. 调研市场', '2. 写方案', '3. 输出报告'].join('\n');
    expect(parseWorkflowSteps(md).map((s) => s.title)).toEqual(['调研市场', '写方案', '输出报告']);
  });
  it('falls back to sequencing prose', () => {
    const md = '首先收集需求，然后设计原型，最后评审上线。';
    const titles = parseWorkflowSteps(md).map((s) => s.title);
    expect(titles.length).toBeGreaterThanOrEqual(2);
  });
  it('returns [] when there is no multi-step shape', () => {
    expect(parseWorkflowSteps('a single sentence with no steps')).toEqual([]);
  });
});

describe('isWorkflowSkillContent', () => {
  it('is true via body heuristic', () => {
    const md = ['---', 'name: demo', '---', '1. a\n2. b\n3. c'].join('\n');
    expect(isWorkflowSkillContent(md)).toBe(true);
  });
  it('is true via explicit frontmatter flag even with a plain body', () => {
    const md = ['---', 'metadata:', '  workflow: true', '---', 'plain body'].join('\n');
    expect(isWorkflowSkillContent(md)).toBe(true);
  });
  it('is false for a plain non-workflow skill', () => {
    const md = ['---', 'name: demo', 'description: does one thing', '---', 'Just do the thing.'].join('\n');
    expect(isWorkflowSkillContent(md)).toBe(false);
  });
});
