import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const migrateManagedSkillReplacementConfigMock = vi.fn();

vi.mock('@electron/utils/agent-config', () => ({
  migrateManagedSkillReplacementConfig: (...args: unknown[]) => (
    migrateManagedSkillReplacementConfigMock(...args)
  ),
}));

vi.mock('@electron/utils/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('@electron/utils/paths', () => ({
  getOpenClawSkillsDir: () => join(tmpdir(), 'unused-openclaw-skills'),
}));

describe('skill-same-name-overwrite', () => {
  let skillsRoot: string;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    migrateManagedSkillReplacementConfigMock.mockResolvedValue({});
    skillsRoot = mkdtempSync(join(tmpdir(), 'clawx-same-name-skills-'));
  });

  afterEach(() => {
    rmSync(skillsRoot, { recursive: true, force: true });
  });

  function writeManagedSkill(folder: string, name: string): string {
    const dir = join(skillsRoot, folder);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: test\n---\n`, 'utf8');
    return dir;
  }

  it('finds same-name dirs by metadata name even when folder differs', async () => {
    writeManagedSkill('foo-old', 'Demo Skill');
    writeManagedSkill('demo-skill--rev1', 'Demo Skill');
    writeManagedSkill('other', 'Other');

    const { findManagedSkillDirsMatchingInstallName } = await import(
      '@electron/services/skills/skill-same-name-overwrite'
    );
    const matches = findManagedSkillDirsMatchingInstallName('Demo Skill', skillsRoot);
    expect(matches.map((m) => m.folderName).sort()).toEqual(['demo-skill--rev1', 'foo-old']);
  });

  it('finds same-name dirs by marketplace/manifest slug when SKILL.md name differs', async () => {
    const dir = writeManagedSkill('demo-skill--71', 'Pretty Display Name');
    writeFileSync(
      join(dir, '.clawx-server-marketplace.json'),
      JSON.stringify({ provider: 'server', slug: 'demo-skill', versionBase: 'demo-skill' }),
    );

    const { findManagedSkillDirsMatchingInstallName, gateManagedSameNameInstall } = await import(
      '@electron/services/skills/skill-same-name-overwrite'
    );
    const matches = findManagedSkillDirsMatchingInstallName('demo-skill', skillsRoot);
    expect(matches.map((m) => m.folderName)).toEqual(['demo-skill--71']);

    const gated = gateManagedSameNameInstall({ skillName: 'demo-skill', skillsRoot });
    expect(gated.action).toBe('confirm');
  });

  it('matches an older versioned server skill through versionBase aliases', async () => {
    const dir = writeManagedSkill('demo-skill-1_0_0--71', 'Pretty Display Name');
    writeFileSync(
      join(dir, '.clawx-server-marketplace.json'),
      JSON.stringify({
        provider: 'server',
        slug: 'demo-skill-1_0_0',
        versionBase: 'demo-skill',
      }),
    );

    const { runManagedSameNameInstall, SAME_NAME_EXISTS_CODE } = await import(
      '@electron/services/skills/skill-same-name-overwrite'
    );
    const install = vi.fn(async () => undefined);
    const result = await runManagedSameNameInstall({
      skillName: 'demo-skill-2_0_0',
      skillAliases: ['demo-skill'],
      skillsRoot,
      install,
    });

    expect(result).toMatchObject({ ok: false, code: SAME_NAME_EXISTS_CODE });
    expect(install).not.toHaveBeenCalled();
    expect(existsSync(dir)).toBe(true);
  });

  it('does not treat an arbitrary name--suffix folder as same-name without metadata evidence', async () => {
    writeManagedSkill('my-slug--rev-a', 'Human Title');

    const { findManagedSkillDirsMatchingInstallName } = await import(
      '@electron/services/skills/skill-same-name-overwrite'
    );
    const matches = findManagedSkillDirsMatchingInstallName('my-slug', skillsRoot);
    expect(matches).toEqual([]);
  });

  it('does not use an exact folder name to replace a skill with a different manifest identity', async () => {
    writeManagedSkill('catalog-slug', 'Unrelated Manual Skill');

    const { gateManagedSameNameInstall } = await import(
      '@electron/services/skills/skill-same-name-overwrite'
    );
    const gate = gateManagedSameNameInstall({
      skillName: 'Actual Server Skill',
      skillAliases: ['catalog-slug'],
      skillsRoot,
    });

    expect(gate.action).toBe('proceed');
    expect(gate.matches).toEqual([]);
  });

  it('detects an existing nested manifest before allowing same-name install', async () => {
    const nestedDir = join(skillsRoot, 'archive-wrapper', 'package');
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(join(nestedDir, 'skill.md'), '---\nname: Nested Demo\n---\n', 'utf8');

    const { gateManagedSameNameInstall } = await import(
      '@electron/services/skills/skill-same-name-overwrite'
    );
    const gate = gateManagedSameNameInstall({
      skillName: 'Nested Demo',
      skillsRoot,
    });

    expect(gate.action).toBe('confirm');
    expect(gate.matches.map((match) => match.folderName)).toEqual(['archive-wrapper']);
  });

  it('gates install when same-name exists without overwrite flag', async () => {
    writeManagedSkill('demo', 'demo');
    const { gateManagedSameNameInstall, SAME_NAME_EXISTS_CODE } = await import(
      '@electron/services/skills/skill-same-name-overwrite'
    );
    const gated = gateManagedSameNameInstall({ skillName: 'demo', skillsRoot });
    expect(gated.action).toBe('confirm');
    if (gated.action === 'confirm') {
      expect(gated.code).toBe(SAME_NAME_EXISTS_CODE);
      expect(gated.existingIds).toContain('demo');
    }
  });

  it('proceeds when overwriteSameName is true and removes matching dirs', async () => {
    const oldDir = writeManagedSkill('demo--old', 'demo');
    writeManagedSkill('keep-me', 'keep-me');

    const { runManagedSameNameInstall } = await import(
      '@electron/services/skills/skill-same-name-overwrite'
    );
    const result = await runManagedSameNameInstall({
      skillName: 'demo',
      overwriteSameName: true,
      skillsRoot,
      install: async () => {
        writeManagedSkill('demo', 'demo');
      },
    });
    expect(existsSync(oldDir)).toBe(false);
    expect(existsSync(join(skillsRoot, 'keep-me'))).toBe(true);
    expect(result).toMatchObject({ ok: true, overwritten: true });
    expect(migrateManagedSkillReplacementConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        staleAliases: expect.arrayContaining(['demo--old']),
        newCanonicalSkillId: 'demo',
      }),
    );
  });

  it('preserves SKILL.md canonical allowlist key when install uses a different slug', async () => {
    const oldDir = writeManagedSkill('pretty-display--71', 'Pretty Display');
    writeFileSync(
      join(oldDir, '.clawx-server-marketplace.json'),
      JSON.stringify({ provider: 'server', slug: 'pretty-display', versionBase: 'pretty-display' }),
    );

    const { runManagedSameNameInstall } = await import(
      '@electron/services/skills/skill-same-name-overwrite'
    );
    await runManagedSameNameInstall({
      skillName: 'pretty-display',
      overwriteSameName: true,
      skillsRoot,
      install: async () => {
        const newDir = writeManagedSkill('pretty-display', 'Pretty Display');
        writeFileSync(
          join(newDir, '.clawx-server-marketplace.json'),
          JSON.stringify({ provider: 'server', slug: 'pretty-display' }),
        );
      },
    });

    expect(migrateManagedSkillReplacementConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        staleAliases: expect.arrayContaining(['pretty-display--71']),
        newCanonicalSkillId: 'pretty display',
      }),
    );
  });

  it('runManagedSameNameInstall returns SAME_NAME_EXISTS until overwrite is confirmed', async () => {
    writeManagedSkill('demo', 'demo');
    const { runManagedSameNameInstall, SAME_NAME_EXISTS_CODE } = await import(
      '@electron/services/skills/skill-same-name-overwrite'
    );
    const install = vi.fn(async () => {
      writeManagedSkill('demo', 'demo');
    });

    const blocked = await runManagedSameNameInstall({
      skillName: 'demo',
      skillsRoot,
      install,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe(SAME_NAME_EXISTS_CODE);
    }
    expect(install).not.toHaveBeenCalled();
    expect(existsSync(join(skillsRoot, 'demo'))).toBe(true);

    const allowed = await runManagedSameNameInstall({
      skillName: 'demo',
      overwriteSameName: true,
      skillsRoot,
      install,
    });
    expect(allowed.ok).toBe(true);
    expect(install).toHaveBeenCalledOnce();
    expect(existsSync(join(skillsRoot, 'demo'))).toBe(true);
  });

  it('restores the old skill when overwrite installation fails', async () => {
    const oldDir = writeManagedSkill('demo', 'demo');
    const { runManagedSameNameInstall } = await import(
      '@electron/services/skills/skill-same-name-overwrite'
    );

    await expect(runManagedSameNameInstall({
      skillName: 'demo',
      overwriteSameName: true,
      skillsRoot,
      install: async () => {
        expect(existsSync(oldDir)).toBe(false);
        throw new Error('download failed');
      },
    })).rejects.toThrow('download failed');

    expect(existsSync(oldDir)).toBe(true);
    expect(migrateManagedSkillReplacementConfigMock).not.toHaveBeenCalled();
  });

  it('commits overwrite cleanup only after installation succeeds', async () => {
    const oldDir = writeManagedSkill('demo--old', 'demo');
    const { runManagedSameNameInstall } = await import(
      '@electron/services/skills/skill-same-name-overwrite'
    );

    const result = await runManagedSameNameInstall({
      skillName: 'demo',
      overwriteSameName: true,
      skillsRoot,
      install: async () => {
        expect(existsSync(oldDir)).toBe(false);
        writeManagedSkill('demo', 'demo');
        return 'installed';
      },
    });

    expect(result).toMatchObject({ ok: true, value: 'installed' });
    expect(existsSync(oldDir)).toBe(false);
    expect(existsSync(join(skillsRoot, 'demo'))).toBe(true);
    expect(migrateManagedSkillReplacementConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({ staleAliases: expect.arrayContaining(['demo--old']) }),
    );
  });

  it('serializes the filesystem guard together with concurrent installs', async () => {
    const { runManagedSameNameInstall } = await import(
      '@electron/services/skills/skill-same-name-overwrite'
    );
    let guardsActive = 0;
    let maxGuardsActive = 0;
    const events: string[] = [];

    const run = (skillName: string) => runManagedSameNameInstall({
      skillName,
      skillsRoot,
      withFilesystemGuard: async (operation) => {
        guardsActive += 1;
        maxGuardsActive = Math.max(maxGuardsActive, guardsActive);
        events.push(`${skillName}:guard-start`);
        try {
          return await operation();
        } finally {
          events.push(`${skillName}:guard-end`);
          guardsActive -= 1;
        }
      },
      install: async () => {
        events.push(`${skillName}:install`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        writeManagedSkill(skillName, skillName);
      },
    });

    await Promise.all([run('alpha'), run('beta')]);

    expect(maxGuardsActive).toBe(1);
    expect(events).toEqual([
      'alpha:guard-start',
      'alpha:install',
      'alpha:guard-end',
      'beta:guard-start',
      'beta:install',
      'beta:guard-end',
    ]);
  });

  it('keeps a committed overwrite when winner convergence is deferred', async () => {
    const oldDir = writeManagedSkill('demo-old', 'demo');
    const { runManagedSameNameInstall } = await import(
      '@electron/services/skills/skill-same-name-overwrite'
    );

    const result = await runManagedSameNameInstall({
      skillName: 'demo',
      overwriteSameName: true,
      skillsRoot,
      install: async () => {
        writeManagedSkill('demo-new', 'demo');
      },
      afterCommit: async () => {
        throw new Error('winner convergence failed');
      },
    });

    expect(result).toMatchObject({ ok: true, overwritten: true });
    expect(existsSync(oldDir)).toBe(false);
    expect(existsSync(join(skillsRoot, 'demo-new'))).toBe(true);
    expect(migrateManagedSkillReplacementConfigMock).toHaveBeenCalled();
  });

  it('keeps a fresh install when winner convergence is deferred', async () => {
    const { runManagedSameNameInstall } = await import(
      '@electron/services/skills/skill-same-name-overwrite'
    );

    const result = await runManagedSameNameInstall({
      skillName: 'fresh',
      skillsRoot,
      install: async () => {
        writeManagedSkill('fresh', 'fresh');
      },
      afterCommit: async () => {
        throw new Error('winner convergence failed');
      },
    });

    expect(result).toMatchObject({ ok: true, overwritten: false });
    expect(existsSync(join(skillsRoot, 'fresh'))).toBe(true);
  });

  it('allows afterCommit to reconcile while the install mutation lock is held', async () => {
    const {
      runManagedSameNameInstall,
    } = await import('@electron/services/skills/skill-same-name-overwrite');
    const {
      reconcileManagedSkillWinnersWhileLocked,
    } = await import('@electron/services/skills/managed-skill-winner');

    const result = await runManagedSameNameInstall({
      skillName: 'fresh',
      skillsRoot,
      install: async () => {
        const dir = writeManagedSkill('fresh', 'fresh');
        writeFileSync(join(dir, '.clawx-install.json'), JSON.stringify({
          installedAt: '2026-07-02T00:00:00.000Z',
        }));
      },
      afterCommit: reconcileManagedSkillWinnersWhileLocked,
    });

    expect(result).toMatchObject({ ok: true, overwritten: false });
    expect(existsSync(join(skillsRoot, 'fresh'))).toBe(true);
  });
});
