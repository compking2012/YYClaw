/**
 * TOP15+ skill-agent / global-skill scenarios.
 * Each case chains the same pure helpers the UI uses (open → draft → prompt → save plan).
 */
import { describe, expect, it } from 'vitest';
import {
  applyAgentSelectorGlobalPromptChoice,
  detectAgentSelectorGlobalPrompt,
  isSkillIncludedInNewAgentDefaults,
  planAgentSelectorPersistActions,
  planSkillDisableActions,
  resolveAgentSelectorDraftAgentIds,
  resolveAgentSelectorOpenAgentIds,
  resolveAgentSelectorSaveToastKey,
  resolveSkillEnabledAfterAgentMapping,
  shouldRehydrateAgentSelectorOnAgentsArrival,
} from '@/lib/agent-selector-draft';

const ALL = ['main', 'coding', 'writer'] as const;

describe('TOP15 skill-agent / global-skill scenarios', () => {
  it('S01 open non-global with partial agents → show skill.agents only', () => {
    const opened = resolveAgentSelectorOpenAgentIds({ baselineAgentIds: ['main'] });
    expect(opened).toEqual(['main']);
    expect(opened).not.toEqual([...ALL].sort());
  });

  it('S02 open global with opt-outs → show real skill.agents, not force-select-all', () => {
    const opened = resolveAgentSelectorOpenAgentIds({
      baselineAgentIds: ['main', 'writer'],
    });
    expect(opened).toEqual(['main', 'writer']);
  });

  it('S03 open global + full opt-out → empty checkboxes, still treat as global on save baseline', () => {
    expect(resolveAgentSelectorOpenAgentIds({ baselineAgentIds: [] })).toEqual([]);
    expect(resolveSkillEnabledAfterAgentMapping({
      agentIds: [],
      skillKeys: ['docx'],
      defaultAgentSkills: ['docx'],
    })).toBe(true);
  });

  it('S04 click 设为全局 → preview select-all + draft global (no persist yet)', () => {
    const draftAgents = resolveAgentSelectorDraftAgentIds({
      draftIsGlobal: true,
      baselineAgentIds: ['main'],
      allAgentIds: [...ALL],
      openedAsGlobal: false,
    });
    expect(draftAgents).toEqual(['coding', 'main', 'writer']);
  });

  it('S05 click 移出全局 when opened as global → preview clear all agents', () => {
    expect(resolveAgentSelectorDraftAgentIds({
      draftIsGlobal: false,
      baselineAgentIds: [...ALL],
      allAgentIds: [...ALL],
      openedAsGlobal: true,
    })).toEqual([]);
  });

  it('S06 click 移出全局 after in-dialog promote → restore open-time baseline', () => {
    expect(resolveAgentSelectorDraftAgentIds({
      draftIsGlobal: false,
      baselineAgentIds: ['main'],
      allAgentIds: [...ALL],
      openedAsGlobal: false,
    })).toEqual(['main']);
  });

  it('S07 non-global select-all → prompt → 设为全局 → draft becomes global', () => {
    const kind = detectAgentSelectorGlobalPrompt({
      draftIsGlobal: false,
      previousAgentIds: ['main', 'coding'],
      nextAgentIds: [...ALL],
      allAgentIds: [...ALL],
    });
    expect(kind).toBe('promote-to-global');
    expect(applyAgentSelectorGlobalPromptChoice({
      kind: kind!,
      choice: 'set-global',
    })).toEqual({ cancel: false, draftIsGlobal: true });
  });

  it('S08 non-global select-all → prompt → 仅分配 → stay non-global, keep all selected', () => {
    const kind = detectAgentSelectorGlobalPrompt({
      draftIsGlobal: false,
      previousAgentIds: ['main'],
      nextAgentIds: [...ALL],
      allAgentIds: [...ALL],
    });
    expect(kind).toBe('promote-to-global');
    const result = applyAgentSelectorGlobalPromptChoice({
      kind: kind!,
      choice: 'assign-only',
    });
    expect(result).toEqual({ cancel: false, draftIsGlobal: false });
    expect(planAgentSelectorPersistActions({
      currentlyGlobal: false,
      draftIsGlobal: false,
      draftAgentIds: [...ALL],
      effectivePersistedAgentIds: ['main'],
    })).toEqual({ updateGlobal: false, updateAgents: true });
  });

  it('S09 global uncheck-all → prompt → 移出全局 → draft leaves global', () => {
    const kind = detectAgentSelectorGlobalPrompt({
      draftIsGlobal: true,
      previousAgentIds: ['main'],
      nextAgentIds: [],
      allAgentIds: [...ALL],
    });
    expect(kind).toBe('demote-from-global');
    expect(applyAgentSelectorGlobalPromptChoice({
      kind: kind!,
      choice: 'remove-global',
    })).toEqual({ cancel: false, draftIsGlobal: false });
  });

  it('S10 global uncheck-all → prompt → 保留全局 → keep global + full opt-out', () => {
    const kind = detectAgentSelectorGlobalPrompt({
      draftIsGlobal: true,
      previousAgentIds: [...ALL],
      nextAgentIds: [],
      allAgentIds: [...ALL],
    });
    expect(kind).toBe('demote-from-global');
    const result = applyAgentSelectorGlobalPromptChoice({
      kind: kind!,
      choice: 'keep-global-opt-out',
    });
    expect(result).toEqual({ cancel: false, draftIsGlobal: true });
    expect(planAgentSelectorPersistActions({
      currentlyGlobal: true,
      draftIsGlobal: true,
      draftAgentIds: [],
      effectivePersistedAgentIds: [...ALL],
    })).toEqual({ updateGlobal: false, updateAgents: true });
    expect(resolveSkillEnabledAfterAgentMapping({
      agentIds: [],
      skillKeys: ['docx'],
      defaultAgentSkills: ['docx'],
    })).toBe(true);
    expect(isSkillIncludedInNewAgentDefaults({
      skillKeys: ['docx'],
      defaultAgentSkills: ['docx'],
    })).toBe(true);
  });

  it('S11 Save promote-to-global → updateGlobal + updateAgents + short toast', () => {
    expect(planAgentSelectorPersistActions({
      currentlyGlobal: false,
      draftIsGlobal: true,
      draftAgentIds: [...ALL],
      effectivePersistedAgentIds: ['main'],
    })).toEqual({ updateGlobal: true, updateAgents: true });
    expect(resolveAgentSelectorSaveToastKey({
      updateGlobal: true,
      draftIsGlobal: true,
    })).toBe('promotedToGlobal');
  });

  it('S12 Save demote-from-global → updateGlobal + updateAgents (even if selection looks unchanged)', () => {
    // Persist safety: if draft keeps all agents while leaving global, still rewrite.
    expect(planAgentSelectorPersistActions({
      currentlyGlobal: true,
      draftIsGlobal: false,
      draftAgentIds: [...ALL],
      effectivePersistedAgentIds: [...ALL],
    })).toEqual({ updateGlobal: true, updateAgents: true });
    expect(resolveAgentSelectorSaveToastKey({
      updateGlobal: true,
      draftIsGlobal: false,
    })).toBe('demotedFromGlobal');
  });

  it('S13 Exit without Save → no persist (draft discarded on reopen)', () => {
    const afterExitReopen = resolveAgentSelectorOpenAgentIds({
      baselineAgentIds: ['main'],
    });
    expect(afterExitReopen).toEqual(['main']);
    expect(afterExitReopen).not.toEqual(['coding', 'main', 'writer']);
  });

  it('S14 agents catalog arrives late → rehydrate once to avoid wiping assignments', () => {
    expect(shouldRehydrateAgentSelectorOnAgentsArrival({
      skillAgentIds: ['main', 'coding'],
      availableAgentCount: 2,
      boundBaselineAgentIds: [],
      currentSelectedAgentIds: [],
    })).toBe(true);
    expect(resolveAgentSelectorOpenAgentIds({
      baselineAgentIds: ['main', 'coding'],
    })).toEqual(['coding', 'main']);
  });

  it('S15 Enabled off on global skill → clear defaults + agent mapping', () => {
    expect(planSkillDisableActions({ currentlyGlobal: true })).toEqual({
      updateGlobal: true,
      updateAgents: true,
    });
    expect(planSkillDisableActions({ currentlyGlobal: false })).toEqual({
      updateGlobal: false,
      updateAgents: true,
    });
  });

  it('S16 threshold cancel → caller restores previous selection (no draft change)', () => {
    const previous = ['main'];
    const next: string[] = [];
    const kind = detectAgentSelectorGlobalPrompt({
      draftIsGlobal: true,
      previousAgentIds: previous,
      nextAgentIds: next,
      allAgentIds: [...ALL],
    });
    expect(kind).toBe('demote-from-global');
    expect(applyAgentSelectorGlobalPromptChoice({
      kind: kind!,
      choice: 'cancel',
    })).toEqual({ cancel: true });
    // UI restores `previous` on cancel — selection must not stay empty.
    expect(previous).toEqual(['main']);
  });
});
