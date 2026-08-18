import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function writeLegacySkill(root: string, folder: string, name: string, manifestFilename = 'SKILL.md'): void {
  const skillDir = join(root, folder);
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, manifestFilename), `---\nname: ${name}\n---\n`, 'utf8');
}

describe('legacy skill config cleanup', () => {
  it('removes P5-only frontend references from agents, defaults, and skills.entries', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clawx-legacy-skill-cleanup-'));
    const workspace = join(root, 'workspace');
    writeLegacySkill(join(workspace, 'skills'), 'frontend', 'frontend');

    const { removeLegacySkillConfigReferences } = await import(
      '@electron/utils/legacy-skill-config-cleanup'
    );
    const config: Record<string, unknown> = {
      agents: {
        defaults: { skills: ['frontend', 'valid'] },
        list: [{ id: 'main', workspace, skills: ['frontend', 'valid'] }],
      },
      skills: {
        entries: {
          frontend: { enabled: true },
          valid: { enabled: true },
        },
      },
    };

    const result = await removeLegacySkillConfigReferences(config, [], {
      allowedAliases: [],
      legacyRoots: [join(workspace, 'skills')],
    });

    expect(result).toEqual({ removedAliases: ['frontend'], modified: true });
    const agents = config.agents as {
      defaults: { skills: string[] };
      list: Array<{ skills: string[] }>;
    };
    expect(agents.defaults.skills).toEqual(['valid']);
    expect(agents.list[0]?.skills).toEqual(['valid']);
    expect((config.skills as { entries: Record<string, unknown> }).entries).toEqual({
      valid: { enabled: true },
    });
    rmSync(root, { recursive: true, force: true });
  });

  it('keeps an alias when P1–P4 still provides that skill identity', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clawx-legacy-skill-allowed-'));
    const workspace = join(root, 'workspace');
    writeLegacySkill(join(workspace, 'skills'), 'frontend', 'frontend');

    const { removeLegacySkillConfigReferences } = await import(
      '@electron/utils/legacy-skill-config-cleanup'
    );
    const config: Record<string, unknown> = {
      agents: {
        defaults: { skills: ['frontend'] },
        list: [{ id: 'main', workspace, skills: ['frontend'] }],
      },
      skills: { entries: { frontend: { enabled: true } } },
    };

    const result = await removeLegacySkillConfigReferences(
      config,
      [],
      {
        allowedAliases: ['frontend'],
        legacyRoots: [join(workspace, 'skills')],
      },
    );

    expect(result).toEqual({ removedAliases: [], modified: false });
    expect((config.agents as { defaults: { skills: string[] } }).defaults.skills).toEqual(['frontend']);
    rmSync(root, { recursive: true, force: true });
  });

  it('cleans a P5 skill whose manifest uses lowercase skill.md', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clawx-legacy-skill-lowercase-'));
    const workspace = join(root, 'workspace');
    writeLegacySkill(join(workspace, 'skills'), 'presentation', 'presentation', 'skill.md');

    const { removeLegacySkillConfigReferences } = await import(
      '@electron/utils/legacy-skill-config-cleanup'
    );
    const config: Record<string, unknown> = {
      agents: {
        list: [{ id: 'main', workspace, skills: ['presentation'] }],
      },
      skills: { entries: { presentation: { enabled: true } } },
    };

    const result = await removeLegacySkillConfigReferences(config, [], {
      allowedAliases: [],
      legacyRoots: [join(workspace, 'skills')],
    });

    expect(result.removedAliases).toContain('presentation');
    expect((config.agents as { list: Array<{ skills: string[] }> }).list[0]?.skills).toEqual([]);
    expect((config.skills as { entries: Record<string, unknown> }).entries.presentation).toBeUndefined();
    rmSync(root, { recursive: true, force: true });
  });

  it('cleans nested P5 skills even without an explicit agents.list entry', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clawx-legacy-skill-nested-'));
    const defaultWorkspace = join(root, 'workspace');
    writeLegacySkill(
      join(defaultWorkspace, 'skills', 'archive-wrapper'),
      'nested-frontend',
      'nested-frontend',
    );

    const { removeLegacySkillConfigReferences } = await import(
      '@electron/utils/legacy-skill-config-cleanup'
    );
    const config: Record<string, unknown> = {
      agents: { defaults: { workspace: defaultWorkspace, skills: ['nested-frontend'] } },
      skills: { entries: { 'nested-frontend': { enabled: true } } },
    };

    const result = await removeLegacySkillConfigReferences(config, [], {
      allowedAliases: [],
      legacyRoots: [join(defaultWorkspace, 'skills')],
    });

    expect(result.removedAliases).toContain('nested-frontend');
    expect((config.agents as { defaults: { skills: string[] } }).defaults.skills).toEqual([]);
    expect((config.skills as { entries: Record<string, unknown> }).entries['nested-frontend']).toBeUndefined();
    rmSync(root, { recursive: true, force: true });
  });
});
