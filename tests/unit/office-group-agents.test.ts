import { describe, expect, it } from 'vitest';
import {
  filterKnownAgentIds,
  orderedBoundAgentIds,
} from '@/lib/office-group-agents';

describe('office-group-agents', () => {
  const agents = [
    { id: 'b', name: 'Beta' },
    { id: 'a', name: 'Alpha' },
    { id: 'c', name: 'Coord' },
  ];

  it('filterKnownAgentIds drops deleted agents', () => {
    expect(filterKnownAgentIds(['a', 'gone', 'b'], agents)).toEqual(['a', 'b']);
  });

  it('orderedBoundAgentIds puts coordinator first', () => {
    expect(orderedBoundAgentIds(['b', 'a', 'c'], 'c', agents)).toEqual(['c', 'a', 'b']);
  });
});
