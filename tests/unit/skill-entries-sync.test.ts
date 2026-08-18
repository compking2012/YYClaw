import { describe, expect, it } from 'vitest';
import {
  buildSkillAliasToCanonicalIdMap,
  collectAssignedCanonicalSkillIds,
  syncSkillsEntriesEnabledInConfig,
} from '@electron/utils/skill-entries-sync';
import type { LocalSkillRecord } from '@electron/services/skills/local-skill-service';

const catalog: LocalSkillRecord[] = [
  {
    id: 'find-skills',
    name: 'find-skills',
    description: 'find',
    enabled: true,
    source: 'openclaw-managed',
  },
  {
    id: 'self-improvement',
    slug: 'self-improving-agent',
    name: 'self-improvement',
    description: 'learns',
    enabled: true,
    source: 'openclaw-managed',
  },
];

describe('skill-entries-sync', () => {
  it('sets entries.enabled true when any agent lists the skill', () => {
    const aliasToId = buildSkillAliasToCanonicalIdMap(catalog);
    const config = {
      skills: {
        entries: {
          'find-skills': { enabled: false },
          'self-improving-agent': { enabled: false, apiKey: 'keep-me' },
        },
      },
    };
    const changed = syncSkillsEntriesEnabledInConfig(
      config,
      [{ skills: ['find-skills', 'self-improving-agent'] }],
      aliasToId,
    );
    expect(changed).toBe(true);
    expect(config.skills?.entries?.['find-skills']?.enabled).toBe(true);
    expect(config.skills?.entries?.['self-improving-agent']?.enabled).toBe(true);
  });

  it('sets entries.enabled false when skill is not assigned to any agent', () => {
    const aliasToId = buildSkillAliasToCanonicalIdMap(catalog);
    const config = {
      skills: {
        entries: {
          'find-skills': { enabled: true },
        },
      },
    };
    syncSkillsEntriesEnabledInConfig(config, [{ skills: [] }], aliasToId);
    expect(config.skills?.entries?.['find-skills']?.enabled).toBe(false);
  });

  it('resolves legacy slug keys on agents to canonical entry ids', () => {
    const aliasToId = buildSkillAliasToCanonicalIdMap(catalog);
    const assigned = collectAssignedCanonicalSkillIds(
      [{ skills: ['self-improving-agent'] }],
      aliasToId,
    );
    expect(assigned.has('self-improvement')).toBe(true);
  });

  it('creates entries for newly assigned skills without existing config keys', () => {
    const aliasToId = buildSkillAliasToCanonicalIdMap(catalog);
    const config: { skills?: { entries?: Record<string, { enabled?: boolean }> } } = {};
    const changed = syncSkillsEntriesEnabledInConfig(
      config,
      [{ skills: ['find-skills'] }],
      aliasToId,
      undefined,
      catalog,
    );
    expect(changed).toBe(true);
    expect(config.skills?.entries?.['find-skills']?.enabled).toBe(true);
  });

  it('creates entries with enabled false for installed skills not assigned to any agent', () => {
    const aliasToId = buildSkillAliasToCanonicalIdMap(catalog);
    const config: { skills?: { entries?: Record<string, { enabled?: boolean }> } } = {};
    const changed = syncSkillsEntriesEnabledInConfig(
      config,
      [{ skills: [] }],
      aliasToId,
      undefined,
      [catalog[0]],
    );
    expect(changed).toBe(true);
    expect(config.skills?.entries?.['find-skills']?.enabled).toBe(false);
  });

  it('sets entries.enabled true for global defaults without per-agent assignment', () => {
    const aliasToId = buildSkillAliasToCanonicalIdMap(catalog);
    const config = {
      skills: {
        entries: {
          'find-skills': { enabled: false },
        },
      },
    };
    syncSkillsEntriesEnabledInConfig(
      config,
      [{ skills: [] }],
      aliasToId,
      new Set(['find-skills']),
    );
    expect(config.skills?.entries?.['find-skills']?.enabled).toBe(true);
  });
});
