import type { OfficeScenario } from '@/types/office';

export function compareOfficeScenariosBySequence(a: OfficeScenario, b: OfficeScenario): number {
  const sa = a.sequence ?? Number.MAX_SAFE_INTEGER;
  const sb = b.sequence ?? Number.MAX_SAFE_INTEGER;
  if (sa !== sb) return sa - sb;
  return a.createdAt - b.createdAt;
}

export function sortOfficeScenariosBySequence(scenarios: OfficeScenario[]): OfficeScenario[] {
  return [...scenarios].sort(compareOfficeScenariosBySequence);
}
