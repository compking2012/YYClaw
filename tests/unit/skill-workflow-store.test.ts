import { beforeEach, describe, expect, it } from 'vitest';
import { useSkillWorkflowStore } from '@/stores/skill-workflow';
import type { QuickAccessSkill } from '@/types/skill';

function makeSkill(over: Partial<QuickAccessSkill>): QuickAccessSkill {
  return {
    name: 'travel-planner',
    description: '',
    source: 'openclaw',
    sourceLabel: 'OpenClaw',
    manifestPath: '/Users/me/.openclaw/skills/travel-planner/SKILL.md',
    baseDir: '/Users/me/.openclaw/skills/travel-planner',
    workflow: true,
    workflowSteps: [{ title: '理解需求' }, { title: '制定计划' }],
    workflowTitle: '旅行规划',
    ...over,
  };
}

describe('useSkillWorkflowStore', () => {
  beforeEach(() => {
    useSkillWorkflowStore.setState({ byName: {}, loadedForAgentDir: null });
  });

  it('ingest + getWorkflowSkill by (normalized) name', () => {
    useSkillWorkflowStore.getState().ingest([makeSkill({})]);
    const meta = useSkillWorkflowStore.getState().getWorkflowSkill('Travel-Planner');
    expect(meta?.workflow).toBe(true);
    expect(meta?.title).toBe('旅行规划');
    expect(meta?.manifestPath).toContain('travel-planner/SKILL.md');
  });

  it('getWorkflowSkillByReadPath matches the exact manifest path', () => {
    useSkillWorkflowStore.getState().ingest([makeSkill({})]);
    const hit = useSkillWorkflowStore.getState().getWorkflowSkillByReadPath('/Users/me/.openclaw/skills/travel-planner/SKILL.md');
    expect(hit?.name).toBe('travel-planner');
    expect(hit?.workflow).toBe(true);
  });

  it('getWorkflowSkillByReadPath falls back to /<name>/SKILL.md basename', () => {
    useSkillWorkflowStore.getState().ingest([makeSkill({ manifestPath: '/somewhere/else.md' })]);
    const hit = useSkillWorkflowStore.getState().getWorkflowSkillByReadPath('/other/root/travel-planner/SKILL.md');
    expect(hit?.name).toBe('travel-planner');
  });

  it('getWorkflowSkillByReadPath matches any .md whose parent dir is a known skill', () => {
    useSkillWorkflowStore.getState().ingest([makeSkill({ manifestPath: '/somewhere/else.md' })]);
    // A non-SKILL.md file directly under the skill dir still attributes to the skill.
    const hit = useSkillWorkflowStore.getState().getWorkflowSkillByReadPath('/x/travel-planner/reference.md');
    expect(hit?.name).toBe('travel-planner');
  });

  it('getWorkflowSkillByReadPath ignores non-.md reads and unrelated dirs', () => {
    useSkillWorkflowStore.getState().ingest([makeSkill({})]);
    expect(useSkillWorkflowStore.getState().getWorkflowSkillByReadPath('/x/travel-planner/data.json')).toBeUndefined();
    expect(useSkillWorkflowStore.getState().getWorkflowSkillByReadPath('/x/other-dir/notes.md')).toBeUndefined();
  });
});
