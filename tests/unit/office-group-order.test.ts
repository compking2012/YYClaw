import { describe, expect, it } from 'vitest';
import {
  compareFixedGroupsBySequence,
  sortFixedGroupsBySequence,
} from '@/lib/office-group-order';
import type { OfficeFixedGroup } from '@/types/office';

function group(id: string, sequence?: number, createdAt = 1000): OfficeFixedGroup {
  return {
    id,
    name: id,
    agentIds: ['a1'],
    coordinatorAgentId: 'a1',
    executionMode: 'workflow',
    workflow: { mode: 'dag', nodes: [], edges: [] },
    sequence,
    createdAt,
    updatedAt: createdAt,
  } as OfficeFixedGroup;
}

describe('office-group-order', () => {
  it('sorts fixed groups by sequence then createdAt', () => {
    const sorted = sortFixedGroupsBySequence([
      group('b', 2, 200),
      group('a', 1, 300),
      group('c', undefined, 50),
    ]);
    expect(sorted.map((g) => g.id)).toEqual(['a', 'b', 'c']);
    expect(compareFixedGroupsBySequence(group('x', 1), group('y', 2))).toBeLessThan(0);
  });
});
