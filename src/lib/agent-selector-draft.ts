/**
 * Pure helpers for skill-agent dialog draft ↔ persist planning.
 * Keeps global-default preview in sync with agent checkboxes without writing config
 * until Save, and ensures Save rewrites agent assignments after defaults sync.
 */

function normalizeId(value: string): string {
  return value.trim().toLowerCase();
}

function sortedUniqueIds(ids: string[]): string[] {
  return [...new Set(ids.map(normalizeId).filter(Boolean))].sort();
}

function sameIdSet(left: string[], right: string[]): boolean {
  const a = sortedUniqueIds(left);
  const b = sortedUniqueIds(right);
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/**
 * Bind agent checkboxes when the dialog opens.
 * Always use the skill's actual per-agent assignments (`skill.agents`), even if the
 * skill is still in agents.defaults.skills. Global + full opt-out must reopen empty —
 * never force-select all just because isGlobal is true.
 */
export function resolveAgentSelectorOpenAgentIds(params: {
  baselineAgentIds: string[];
}): string[] {
  return sortedUniqueIds(params.baselineAgentIds);
}

/**
 * Preview when the user toggles「设为全局 / 移出全局」in the draft (not on open).
 * - Promote: select all agents
 * - Demote when opened as already-global: clear all (aligns top-bar strip end-state)
 * - Demote after an in-dialog promote: restore open-time baseline assignments
 */
export function resolveAgentSelectorDraftAgentIds(params: {
  draftIsGlobal: boolean;
  baselineAgentIds: string[];
  allAgentIds: string[];
  /** Whether the skill was already in agents.defaults.skills when the dialog opened. */
  openedAsGlobal: boolean;
}): string[] {
  if (params.draftIsGlobal) {
    return sortedUniqueIds(params.allAgentIds);
  }
  if (params.openedAsGlobal) {
    return [];
  }
  return sortedUniqueIds(params.baselineAgentIds);
}

/**
 * Decide which writes Save must perform.
 *
 * `setDefaultAgentSkills` mutates every agent's skills list when defaults change.
 * Therefore any global change must also rewrite per-agent assignments to match the
 * dialog draft — otherwise demote-with-all-selected leaves nobody assigned while
 * the UI still showed everyone checked.
 *
 * `effectivePersistedAgentIds` must be the real `skill.agents` snapshot (including
 * empty when all agents opted out of a still-global skill), not "all agents".
 */
export function planAgentSelectorPersistActions(params: {
  currentlyGlobal: boolean;
  draftIsGlobal: boolean;
  draftAgentIds: string[];
  effectivePersistedAgentIds: string[];
}): { updateGlobal: boolean; updateAgents: boolean } {
  const updateGlobal = params.draftIsGlobal !== params.currentlyGlobal;
  const agentsChanged = !sameIdSet(params.draftAgentIds, params.effectivePersistedAgentIds);
  return {
    updateGlobal,
    updateAgents: agentsChanged || updateGlobal,
  };
}

export type AgentSelectorGlobalPromptKind = 'promote-to-global' | 'demote-from-global';

/**
 * Prompt when selection *crosses* a threshold — not on Save, not on open hydrate.
 * - global + went from some → none: ask whether to remove from global
 * - non-global + went from not-all → all: ask whether to set as global
 */
export function detectAgentSelectorGlobalPrompt(params: {
  draftIsGlobal: boolean;
  previousAgentIds: string[];
  nextAgentIds: string[];
  allAgentIds: string[];
}): AgentSelectorGlobalPromptKind | null {
  const all = sortedUniqueIds(params.allAgentIds);
  if (all.length === 0) return null;

  const prev = sortedUniqueIds(params.previousAgentIds);
  const next = sortedUniqueIds(params.nextAgentIds);
  const prevEmpty = prev.length === 0;
  const nextEmpty = next.length === 0;
  const prevAll = sameIdSet(prev, all);
  const nextAll = sameIdSet(next, all);

  if (params.draftIsGlobal && !prevEmpty && nextEmpty) {
    return 'demote-from-global';
  }
  if (!params.draftIsGlobal && !prevAll && nextAll) {
    return 'promote-to-global';
  }
  return null;
}

/** Semantic choices for the threshold dialog (not bare yes/no). */
export type AgentSelectorGlobalChoice =
  | 'set-global'
  | 'assign-only'
  | 'remove-global'
  | 'keep-global-opt-out'
  | 'cancel';

export type AgentSelectorGlobalPromptResult =
  | { cancel: true }
  | { cancel: false; draftIsGlobal: boolean };

/**
 * Apply threshold-dialog choice.
 * - cancel: caller must restore previousAgentIds; draftIsGlobal unchanged
 * - promote set-global / assign-only: keep current (all) selection
 * - demote remove-global / keep-global-opt-out: keep current (empty) selection
 */
export function applyAgentSelectorGlobalPromptChoice(params: {
  kind: AgentSelectorGlobalPromptKind;
  choice: AgentSelectorGlobalChoice;
}): AgentSelectorGlobalPromptResult {
  if (params.choice === 'cancel') {
    return { cancel: true };
  }
  if (params.kind === 'promote-to-global') {
    if (params.choice === 'set-global') {
      return { cancel: false, draftIsGlobal: true };
    }
    if (params.choice === 'assign-only') {
      return { cancel: false, draftIsGlobal: false };
    }
  }
  if (params.kind === 'demote-from-global') {
    if (params.choice === 'remove-global') {
      return { cancel: false, draftIsGlobal: false };
    }
    if (params.choice === 'keep-global-opt-out') {
      return { cancel: false, draftIsGlobal: true };
    }
  }
  return { cancel: true };
}

/**
 * When the dialog bound while `agents=[]`, resolveAgentIdSelection drops every id.
 * If the catalog arrives later and the user still has an empty untouched selection,
 * rehydrate from skill.agents once — otherwise Save can wipe real assignments.
 */
export function shouldRehydrateAgentSelectorOnAgentsArrival(params: {
  skillAgentIds: readonly string[];
  availableAgentCount: number;
  boundBaselineAgentIds: readonly string[];
  currentSelectedAgentIds: readonly string[];
}): boolean {
  if (params.availableAgentCount <= 0) return false;
  if (params.skillAgentIds.length === 0) return false;
  if (params.boundBaselineAgentIds.length > 0) return false;
  if (params.currentSelectedAgentIds.length > 0) return false;
  return true;
}

/** Optimistic enabled flag must honor agents.defaults.skills, not only agentIds. */
export function resolveSkillEnabledAfterAgentMapping(params: {
  agentIds: readonly string[];
  skillKeys: readonly string[];
  defaultAgentSkills: readonly string[];
}): boolean {
  if (params.agentIds.some((id) => normalizeId(id))) return true;
  const defaults = new Set(
    params.defaultAgentSkills.map(normalizeId).filter(Boolean),
  );
  return params.skillKeys.some((key) => defaults.has(normalizeId(key)));
}

/**
 * Skills list Enabled→off must clear both layers when the skill is global.
 * Empty agent mapping alone no longer removes agents.defaults.skills.
 */
export function planSkillDisableActions(params: {
  currentlyGlobal: boolean;
}): { updateGlobal: boolean; updateAgents: boolean } {
  return {
    updateGlobal: params.currentlyGlobal,
    updateAgents: true,
  };
}

/**
 * New-agent create dialog pre-fills from defaults.skills.
 * Returns whether the skill should appear selected by default for a new agent.
 */
export function isSkillIncludedInNewAgentDefaults(params: {
  skillKeys: readonly string[];
  defaultAgentSkills: readonly string[];
}): boolean {
  return resolveSkillEnabledAfterAgentMapping({
    agentIds: [],
    skillKeys: params.skillKeys,
    defaultAgentSkills: params.defaultAgentSkills,
  });
}

/** Concise save toast key based on what was written. */
export function resolveAgentSelectorSaveToastKey(params: {
  updateGlobal: boolean;
  draftIsGlobal: boolean;
}): 'promotedToGlobal' | 'demotedFromGlobal' | 'skillAgentDialogSaved' {
  if (!params.updateGlobal) return 'skillAgentDialogSaved';
  return params.draftIsGlobal ? 'promotedToGlobal' : 'demotedFromGlobal';
}

