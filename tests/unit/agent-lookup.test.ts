import { describe, expect, it } from 'vitest';
import type { AgentSummary } from '@/types/agent';
import {
  countSelectedCatalogAgents,
  isCatalogAgentSelected,
  normalizeAgentIdsForPersist,
  resolveAgentIdSelection,
} from '@/lib/agent-lookup';

const agents: AgentSummary[] = [
  { id: 'main', name: 'Main', isDefault: true },
  { id: 'ceo-zhu-li', name: 'CEO助理' },
];

describe('agent-lookup', () => {
  it('resolves only catalog agent ids and drops orphans', () => {
    expect(resolveAgentIdSelection(['MAIN', 'missing-agent', 'ceo-zhu-li'], agents).sort()).toEqual([
      'ceo-zhu-li',
      'main',
    ]);
  });

  it('counts selected agents that exist in the catalog', () => {
    expect(countSelectedCatalogAgents(agents, ['main', 'missing'])).toBe(1);
    expect(countSelectedCatalogAgents(agents, ['main', 'ceo-zhu-li'])).toBe(2);
  });

  it('matches agent selection with normalized ids', () => {
    expect(isCatalogAgentSelected(agents[0], ['MAIN'], agents)).toBe(true);
    expect(isCatalogAgentSelected(agents[1], ['main'], agents)).toBe(false);
  });

  it('persists normalized lowercase agent ids', () => {
    expect(normalizeAgentIdsForPersist(['CEO-ZHU-LI', 'main'], agents)).toEqual([
      'ceo-zhu-li',
      'main',
    ]);
  });
});
