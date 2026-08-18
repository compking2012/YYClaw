import { describe, expect, it } from 'vitest';
import {
  applyAgentSelectorGlobalPromptChoice,
  detectAgentSelectorGlobalPrompt,
  planAgentSelectorPersistActions,
  resolveAgentSelectorDraftAgentIds,
  resolveAgentSelectorOpenAgentIds,
  resolveSkillEnabledAfterAgentMapping,
  shouldRehydrateAgentSelectorOnAgentsArrival,
  resolveAgentSelectorSaveToastKey,
} from '@/lib/agent-selector-draft';

describe('agent-selector-draft', () => {
  describe('resolveAgentSelectorOpenAgentIds', () => {
    it('reopens global + full opt-out as empty selection (does not force-select all)', () => {
      expect(resolveAgentSelectorOpenAgentIds({
        baselineAgentIds: [],
      })).toEqual([]);
    });

    it('reopens with the actual opted-in agents only', () => {
      expect(resolveAgentSelectorOpenAgentIds({
        baselineAgentIds: ['main'],
      })).toEqual(['main']);
    });
  });

  describe('resolveAgentSelectorDraftAgentIds', () => {
    it('selects all agents when user drafts global on', () => {
      expect(resolveAgentSelectorDraftAgentIds({
        draftIsGlobal: true,
        baselineAgentIds: ['main'],
        allAgentIds: ['main', 'coding', 'writer'],
        openedAsGlobal: false,
      })).toEqual(['coding', 'main', 'writer']);
    });

    it('clears all agents when demoting a skill that opened as global', () => {
      expect(resolveAgentSelectorDraftAgentIds({
        draftIsGlobal: false,
        baselineAgentIds: ['main', 'coding', 'writer'],
        allAgentIds: ['main', 'coding', 'writer'],
        openedAsGlobal: true,
      })).toEqual([]);
    });

    it('restores baseline when undoing an in-dialog promote', () => {
      expect(resolveAgentSelectorDraftAgentIds({
        draftIsGlobal: false,
        baselineAgentIds: ['main'],
        allAgentIds: ['main', 'coding', 'writer'],
        openedAsGlobal: false,
      })).toEqual(['main']);
    });
  });

  describe('shouldRehydrateAgentSelectorOnAgentsArrival', () => {
    it('rehydrates when skill had agents but catalog was empty at bind time', () => {
      // Regression: draftSessionKey locked an empty baseline while agents=[], then
      // catalog arrived — without rehydrate, Save with [] can wipe real assignments.
      expect(shouldRehydrateAgentSelectorOnAgentsArrival({
        skillAgentIds: ['main', 'coding'],
        availableAgentCount: 2,
        boundBaselineAgentIds: [],
        currentSelectedAgentIds: [],
      })).toBe(true);
    });

    it('does not rehydrate true full opt-out (skill.agents already empty)', () => {
      expect(shouldRehydrateAgentSelectorOnAgentsArrival({
        skillAgentIds: [],
        availableAgentCount: 2,
        boundBaselineAgentIds: [],
        currentSelectedAgentIds: [],
      })).toBe(false);
    });

    it('does not rehydrate after user already edited selection', () => {
      expect(shouldRehydrateAgentSelectorOnAgentsArrival({
        skillAgentIds: ['main', 'coding'],
        availableAgentCount: 2,
        boundBaselineAgentIds: [],
        currentSelectedAgentIds: ['main'],
      })).toBe(false);
    });

    it('does not rehydrate when baseline already bound with agents', () => {
      expect(shouldRehydrateAgentSelectorOnAgentsArrival({
        skillAgentIds: ['main', 'coding'],
        availableAgentCount: 2,
        boundBaselineAgentIds: ['main'],
        currentSelectedAgentIds: ['main'],
      })).toBe(false);
    });
  });

  describe('resolveSkillEnabledAfterAgentMapping', () => {
    it('keeps enabled true when agentIds empty but skill remains in global defaults', () => {
      // Regression: store used enabled: agentIds.length > 0 and falsely disabled
      // keep-global + full opt-out until fetchSkills repaired it.
      expect(resolveSkillEnabledAfterAgentMapping({
        agentIds: [],
        skillKeys: ['docx', 'office-docx'],
        defaultAgentSkills: ['pdf', 'docx'],
      })).toBe(true);
    });

    it('disables when agentIds empty and skill not in global defaults', () => {
      expect(resolveSkillEnabledAfterAgentMapping({
        agentIds: [],
        skillKeys: ['docx'],
        defaultAgentSkills: ['pdf'],
      })).toBe(false);
    });

    it('enables when any agent remains assigned', () => {
      expect(resolveSkillEnabledAfterAgentMapping({
        agentIds: ['main'],
        skillKeys: ['docx'],
        defaultAgentSkills: [],
      })).toBe(true);
    });
  });

  describe('detectAgentSelectorGlobalPrompt', () => {
    const all = ['main', 'coding'];

    it('prompts promote when non-global crosses into all selected', () => {
      expect(detectAgentSelectorGlobalPrompt({
        draftIsGlobal: false,
        previousAgentIds: ['main'],
        nextAgentIds: ['main', 'coding'],
        allAgentIds: all,
      })).toBe('promote-to-global');
    });

    it('does not prompt promote when already all selected', () => {
      expect(detectAgentSelectorGlobalPrompt({
        draftIsGlobal: false,
        previousAgentIds: ['main', 'coding'],
        nextAgentIds: ['main', 'coding'],
        allAgentIds: all,
      })).toBeNull();
    });

    it('does not prompt promote when already drafting global', () => {
      expect(detectAgentSelectorGlobalPrompt({
        draftIsGlobal: true,
        previousAgentIds: ['main'],
        nextAgentIds: ['main', 'coding'],
        allAgentIds: all,
      })).toBeNull();
    });

    it('prompts demote when global crosses into zero selected', () => {
      expect(detectAgentSelectorGlobalPrompt({
        draftIsGlobal: true,
        previousAgentIds: ['main'],
        nextAgentIds: [],
        allAgentIds: all,
      })).toBe('demote-from-global');
    });

    it('does not prompt demote when already empty', () => {
      expect(detectAgentSelectorGlobalPrompt({
        draftIsGlobal: true,
        previousAgentIds: [],
        nextAgentIds: [],
        allAgentIds: all,
      })).toBeNull();
    });

    it('does not prompt demote when not drafting global', () => {
      expect(detectAgentSelectorGlobalPrompt({
        draftIsGlobal: false,
        previousAgentIds: ['main'],
        nextAgentIds: [],
        allAgentIds: all,
      })).toBeNull();
    });
  });

  describe('applyAgentSelectorGlobalPromptChoice', () => {
    it('promote set-global turns draft global on', () => {
      expect(applyAgentSelectorGlobalPromptChoice({
        kind: 'promote-to-global',
        choice: 'set-global',
      })).toEqual({ cancel: false, draftIsGlobal: true });
    });

    it('promote assign-only keeps non-global', () => {
      expect(applyAgentSelectorGlobalPromptChoice({
        kind: 'promote-to-global',
        choice: 'assign-only',
      })).toEqual({ cancel: false, draftIsGlobal: false });
    });

    it('demote remove-global turns draft global off', () => {
      expect(applyAgentSelectorGlobalPromptChoice({
        kind: 'demote-from-global',
        choice: 'remove-global',
      })).toEqual({ cancel: false, draftIsGlobal: false });
    });

    it('demote keep-global-opt-out keeps global', () => {
      expect(applyAgentSelectorGlobalPromptChoice({
        kind: 'demote-from-global',
        choice: 'keep-global-opt-out',
      })).toEqual({ cancel: false, draftIsGlobal: true });
    });

    it('cancel restores via caller (no draft change)', () => {
      expect(applyAgentSelectorGlobalPromptChoice({
        kind: 'demote-from-global',
        choice: 'cancel',
      })).toEqual({ cancel: true });
      expect(applyAgentSelectorGlobalPromptChoice({
        kind: 'promote-to-global',
        choice: 'cancel',
      })).toEqual({ cancel: true });
    });
  });

  describe('resolveAgentSelectorSaveToastKey', () => {
    it('uses short promote/demote/saved keys', () => {
      expect(resolveAgentSelectorSaveToastKey({
        updateGlobal: true,
        draftIsGlobal: true,
      })).toBe('promotedToGlobal');
      expect(resolveAgentSelectorSaveToastKey({
        updateGlobal: true,
        draftIsGlobal: false,
      })).toBe('demotedFromGlobal');
      expect(resolveAgentSelectorSaveToastKey({
        updateGlobal: false,
        draftIsGlobal: false,
      })).toBe('skillAgentDialogSaved');
    });
  });

  describe('planAgentSelectorPersistActions', () => {
    it('demote-from-global with all agents still selected must still rewrite agent assignments', () => {
      const plan = planAgentSelectorPersistActions({
        currentlyGlobal: true,
        draftIsGlobal: false,
        draftAgentIds: ['main', 'coding'],
        effectivePersistedAgentIds: ['main', 'coding'],
      });

      expect(plan).toEqual({
        updateGlobal: true,
        updateAgents: true,
      });
    });

    it('keep-global with empty agents is a no-op when already fully opted out', () => {
      const plan = planAgentSelectorPersistActions({
        currentlyGlobal: true,
        draftIsGlobal: true,
        draftAgentIds: [],
        effectivePersistedAgentIds: [],
      });

      expect(plan).toEqual({
        updateGlobal: false,
        updateAgents: false,
      });
    });
  });
});
