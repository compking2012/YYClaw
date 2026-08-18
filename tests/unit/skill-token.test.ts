import { describe, expect, it } from 'vitest';
import { parseLeadingSkillToken } from '@/lib/skill-token';

describe('parseLeadingSkillToken', () => {
  it('parses the picker token (/name + two spaces) at the start', () => {
    expect(parseLeadingSkillToken('/travel-planner  帮我生成去云南旅游的攻略')).toBe('travel-planner');
  });
  it('parses a manually typed /name with a single trailing space', () => {
    expect(parseLeadingSkillToken('/travel-planner do it')).toBe('travel-planner');
  });
  it('parses a bare /name at end of string', () => {
    expect(parseLeadingSkillToken('/travel-planner')).toBe('travel-planner');
  });
  it('strips the skill: namespace prefix', () => {
    expect(parseLeadingSkillToken('/skill:travel-planner go')).toBe('travel-planner');
  });
  it('returns null when there is no leading skill token', () => {
    expect(parseLeadingSkillToken('帮我生成去云南旅游的攻略')).toBeNull();
    expect(parseLeadingSkillToken('see https://example.com/path here')).toBeNull();
    expect(parseLeadingSkillToken('')).toBeNull();
  });
});
