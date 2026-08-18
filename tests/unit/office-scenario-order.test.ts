import { describe, expect, it } from 'vitest';
import {
  compareOfficeScenariosBySequence,
  sortOfficeScenariosBySequence,
} from '@/lib/office-scenario-order';
import type { OfficeScenario } from '@/types/office';

function scenario(
  id: string,
  sequence?: number,
  createdAt = 1000,
): OfficeScenario {
  return {
    id,
    name: id,
    sequence,
    createdAt,
    updatedAt: createdAt,
    agentIds: ['a1'],
    coordinatorAgentId: 'a1',
    executionMode: 'workflow',
    workflow: { mode: 'dag', nodes: [], edges: [] },
  } as OfficeScenario;
}

describe('office-scenario-order', () => {
  it('compareOfficeScenariosBySequence orders by sequence then createdAt', () => {
    const a = scenario('a', 2, 200);
    const b = scenario('b', 1, 300);
    const c = scenario('c', undefined, 100);
    expect(compareOfficeScenariosBySequence(a, b)).toBeGreaterThan(0);
    expect(compareOfficeScenariosBySequence(b, a)).toBeLessThan(0);
    expect(compareOfficeScenariosBySequence(a, c)).toBeLessThan(0);
  });

  it('sortOfficeScenariosBySequence returns stable sorted copy', () => {
    const input = [
      scenario('late', 2, 500),
      scenario('first', 1, 400),
      scenario('no-seq', undefined, 100),
    ];
    const sorted = sortOfficeScenariosBySequence(input);
    expect(sorted.map((s) => s.id)).toEqual(['first', 'late', 'no-seq']);
    expect(input.map((s) => s.id)).toEqual(['late', 'first', 'no-seq']);
  });
});
