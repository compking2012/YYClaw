import { describe, expect, it } from 'vitest';
import { buildOfficeRoster } from '@/lib/office-roster';
import type { AgentSummary } from '@/types/agent';

function agent(id: string, name: string, isDefault = false): AgentSummary {
  return {
    id,
    name,
    isDefault,
    modelDisplay: 'm',
    modelRef: null,
    overrideModelRef: null,
    inheritedModel: false,
    workspace: '',
    agentDir: '',
    mainSessionKey: '',
    channelTypes: [],
  };
}

describe('office-roster', () => {
  it('buildOfficeRoster merges members and unbound agents with default-first sort', () => {
    const roster = buildOfficeRoster(
      [agent('a1', 'Alpha'), agent('a2', 'Beta', true), agent('a3', 'Charlie')],
      [
        { agentId: 'a1', displayName: '成员A' },
        { agentId: 'a2', displayName: '成员B' },
      ],
    );
    expect(roster.map((e) => e.agentId)).toEqual(['a2', 'a1', 'a3']);
    expect(roster.find((e) => e.agentId === 'a3')?.member).toBeNull();
    expect(roster.find((e) => e.agentId === 'a1')?.member?.displayName).toBe('成员A');
  });
});
