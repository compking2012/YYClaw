import { describe, expect, it } from 'vitest';
import {
  canonicalizeSelectedAgentIds,
  isAgentIdSelected,
  partitionAgentPoolLists,
  removeAgentFromSelection,
} from '../../src/lib/office-agent-pool';
import type { AgentSummary } from '../../src/types/agent';

const agents = [
  { id: 'agent-1', name: 'Alpha', isDefault: false, modelDisplay: 'm1' },
  { id: 'agent-2', name: 'Beta', isDefault: false, modelDisplay: 'm2' },
] satisfies AgentSummary[];

describe('office-agent-pool', () => {
  it('canonicalizeSelectedAgentIds normalizes casing and dedupes', () => {
    expect(canonicalizeSelectedAgentIds(['Agent-1', 'agent-1', 'agent-2'], agents)).toEqual([
      'agent-1',
      'agent-2',
    ]);
  });

  it('isAgentIdSelected matches case-insensitively', () => {
    expect(isAgentIdSelected('agent-1', ['Agent-1'])).toBe(true);
    expect(isAgentIdSelected('agent-2', ['Agent-1'])).toBe(false);
  });

  it('removeAgentFromSelection removes by normalized id', () => {
    expect(removeAgentFromSelection(['Agent-1', 'agent-2'], 'agent-1')).toEqual(['agent-2']);
  });

  it('partitionAgentPoolLists keeps bound and available disjoint', () => {
    const { boundIds, availableIds } = partitionAgentPoolLists({
      selectedAgentIds: ['Agent-1'],
      coordinatorAgentId: 'Agent-1',
      agents,
    });
    expect(boundIds).toEqual(['agent-1']);
    expect(availableIds).toEqual(['agent-2']);
    expect(availableIds.some((id) => boundIds.includes(id))).toBe(false);
  });

  it('partitionAgentPoolLists after unbind moves agent to available only', () => {
    const nextSelected = removeAgentFromSelection(['Agent-1', 'agent-2'], 'agent-1');
    const { boundIds, availableIds } = partitionAgentPoolLists({
      selectedAgentIds: nextSelected,
      coordinatorAgentId: 'agent-2',
      agents,
    });
    expect(boundIds).toEqual(['agent-2']);
    expect(availableIds).toEqual(['agent-1']);
  });

  it('partitionAgentPoolLists excludes agents bound elsewhere from available', () => {
    const { availableIds } = partitionAgentPoolLists({
      selectedAgentIds: [],
      coordinatorAgentId: '',
      agents,
      agentBindings: {
        'agent-1': {
          agentId: 'agent-1',
          kind: 'fixed_group',
          entityId: 'group-other',
          entityName: 'Other',
          updatedAt: 1,
        },
      },
      bindingScope: { entityId: 'group-self' },
    });
    expect(availableIds).toEqual(['agent-2']);
  });
});
