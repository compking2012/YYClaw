import { describe, expect, it } from 'vitest';
import type { Skill } from '@/types/skill';
import {
  addCatalogSkillToSelection,
  agentSkillsSelectionChanged,
  countSelectedCatalogSkills,
  isCatalogSkillSelected,
  normalizeSkillsSelectionForPersist,
  removeCatalogSkillsFromSelection,
  resolveAgentSkillSelection,
} from '@/lib/skill-lookup-aliases';

const catalog: Skill[] = [
  {
    id: 'self-improvement',
    slug: 'self-improving-agent',
    name: 'self-improvement',
    description: 'learns',
    enabled: true,
    source: 'openclaw-managed',
    baseDir: '/tmp/self-improving-agent',
  },
  {
    id: 'find-skills',
    name: 'find-skills',
    description: 'find',
    enabled: true,
    source: 'openclaw-managed',
  },
];

describe('skill-lookup-aliases', () => {
  it('resolves legacy slug keys to canonical catalog ids', () => {
    expect(resolveAgentSkillSelection(['self-improving-agent', 'find-skills'], catalog).sort()).toEqual([
      'find-skills',
      'self-improvement',
    ]);
  });

  it('drops orphan keys that do not map to the catalog', () => {
    expect(resolveAgentSkillSelection(['missing-skill', 'legacy-slug'], catalog)).toEqual([]);
  });

  it('counts only catalog skills that are selected', () => {
    const selected = resolveAgentSkillSelection(
      ['self-improving-agent', 'missing-skill', 'find-skills'],
      catalog,
    );
    expect(countSelectedCatalogSkills(catalog, selected)).toBe(2);
    expect(countSelectedCatalogSkills(catalog, ['missing-skill'])).toBe(0);
  });

  it('matches catalog skills by slug alias in selection state', () => {
    const selfImprovement = catalog[0];
    expect(isCatalogSkillSelected(selfImprovement, ['self-improving-agent'], catalog)).toBe(true);
    expect(isCatalogSkillSelected(selfImprovement, [], catalog)).toBe(false);
  });

  it('adds and removes skills using canonical ids', () => {
    const selfImprovement = catalog[0];
    const added = addCatalogSkillToSelection(selfImprovement, [], catalog);
    expect(added).toEqual(['self-improvement']);
    const removed = removeCatalogSkillsFromSelection([selfImprovement], ['self-improving-agent'], catalog);
    expect(removed).toEqual([]);
  });

  it('detects persisted selection changes including orphan cleanup', () => {
    expect(agentSkillsSelectionChanged([], ['orphan-a', 'orphan-b'], catalog)).toBe(true);
    expect(agentSkillsSelectionChanged(['find-skills'], ['find-skills'], catalog)).toBe(false);
    expect(
      agentSkillsSelectionChanged(
        ['self-improvement'],
        ['self-improving-agent'],
        catalog,
      ),
    ).toBe(true);
  });

  it('normalizes persisted selection to canonical lowercase ids', () => {
    expect(normalizeSkillsSelectionForPersist(['self-improving-agent', 'FIND-SKILLS'], catalog)).toEqual([
      'find-skills',
      'self-improvement',
    ]);
  });

  it('resolves legacy name@version keys to canonical normalized names', () => {
    const versionedCatalog: Skill[] = [
      {
        id: 'pdf',
        name: 'pdf',
        version: '1.0.0',
        description: 'pdf',
        enabled: true,
        source: 'openclaw-managed',
      },
    ];
    expect(resolveAgentSkillSelection(['pdf@1.0.0'], versionedCatalog)).toEqual(['pdf']);
    expect(normalizeSkillsSelectionForPersist(['pdf@1.0.0'], versionedCatalog)).toEqual(['pdf']);
    expect(
      agentSkillsSelectionChanged(['pdf'], ['pdf@1.0.0'], versionedCatalog),
    ).toBe(true);
  });
});
