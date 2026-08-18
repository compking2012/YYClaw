/**
 * Guards for severe prompt dismiss semantics (no convert-to-explicit path).
 */
import { describe, expect, it } from 'vitest';
import {
  applyAgentSelectorGlobalPromptChoice,
  resolveAgentSelectorDraftAgentIds,
} from '@/lib/agent-selector-draft';

const ALL = ['main', 'coding', 'writer'] as const;

describe('agent-selector severe guards', () => {
  it('dismiss/cancel ≠ keep-global-opt-out', () => {
    expect(applyAgentSelectorGlobalPromptChoice({
      kind: 'demote-from-global',
      choice: 'cancel',
    })).toEqual({ cancel: true });
    expect(applyAgentSelectorGlobalPromptChoice({
      kind: 'demote-from-global',
      choice: 'keep-global-opt-out',
    })).toEqual({ cancel: false, draftIsGlobal: true });
  });

  it('opened-as-global 移出全局 strip-clears (align top-bar)', () => {
    expect(resolveAgentSelectorDraftAgentIds({
      draftIsGlobal: false,
      baselineAgentIds: [...ALL],
      allAgentIds: [...ALL],
      openedAsGlobal: true,
    })).toEqual([]);
  });

  it('in-dialog promote then demote restores baseline', () => {
    expect(resolveAgentSelectorDraftAgentIds({
      draftIsGlobal: false,
      baselineAgentIds: ['main', 'writer'],
      allAgentIds: [...ALL],
      openedAsGlobal: false,
    })).toEqual(['main', 'writer']);
  });
});
