import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const getOpenClawSkillsDirMock = vi.fn();
const migrateManagedSkillReplacementConfigMock = vi.fn();

vi.mock('@electron/utils/paths', () => ({
  getOpenClawSkillsDir: () => getOpenClawSkillsDirMock(),
}));

vi.mock('@electron/services/skills/skill-gateway-fs-guard', () => ({
  withGatewayHotSkillFilesystem: async (
    _gateway: unknown,
    operation: () => Promise<unknown>,
  ) => operation(),
}));

vi.mock('@electron/utils/agent-config', () => ({
  migrateManagedSkillReplacementConfig: (...args: unknown[]) => (
    migrateManagedSkillReplacementConfigMock(...args)
  ),
}));

function writeSkill(root: string, folder: string, name: string): string {
  const dir = join(root, folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\n---\n`, 'utf8');
  return dir;
}

describe('managed skill winner reconciliation', () => {
  let skillsRoot: string;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    skillsRoot = mkdtempSync(join(tmpdir(), 'clawx-managed-winner-'));
    getOpenClawSkillsDirMock.mockReturnValue(skillsRoot);
    migrateManagedSkillReplacementConfigMock.mockResolvedValue({});
  });

  afterEach(() => {
    rmSync(skillsRoot, { recursive: true, force: true });
  });

  it('keeps the latest P1 install and quarantines older same-name directories', async () => {
    const oldDir = writeSkill(skillsRoot, 'frontend-old', 'Frontend Design');
    const newDir = writeSkill(skillsRoot, 'frontend-new', 'Frontend Design');
    writeFileSync(join(oldDir, '.clawx-install.json'), JSON.stringify({
      installedAt: '2026-07-01T00:00:00.000Z',
      canonicalName: 'Frontend Design',
    }));
    const { writeManagedSkillInstallMetadata, reconcileManagedSkillWinners } = await import(
      '@electron/services/skills/managed-skill-winner'
    );
    writeManagedSkillInstallMetadata(newDir, {
      installedAt: '2026-07-02T00:00:00.000Z',
      source: 'server',
      canonicalName: 'Frontend Design',
      slug: 'frontend',
    });

    const result = await reconcileManagedSkillWinners();

    expect(existsSync(newDir)).toBe(true);
    expect(existsSync(oldDir)).toBe(false);
    expect(result.quarantined).toHaveLength(1);
    expect(readFileSync(join(result.quarantined[0]!, 'SKILL.md'), 'utf8')).toContain('Frontend Design');
    expect(migrateManagedSkillReplacementConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        staleAliases: expect.arrayContaining(['frontend-old']),
        newCanonicalSkillId: 'Frontend Design',
      }),
    );
  });

  it('keeps distinct canonical names active', async () => {
    const frontend = writeSkill(skillsRoot, 'frontend', 'Frontend Design');
    const review = writeSkill(skillsRoot, 'review', 'Code Review');
    const { reconcileManagedSkillWinners } = await import(
      '@electron/services/skills/managed-skill-winner'
    );

    expect(await reconcileManagedSkillWinners()).toEqual({ quarantined: [] });
    expect(existsSync(frontend)).toBe(true);
    expect(existsSync(review)).toBe(true);
  });

  it('resolves nested SKILL.md files before choosing a P1 winner', async () => {
    const oldDir = join(skillsRoot, 'nested-old');
    const newDir = join(skillsRoot, 'nested-new');
    mkdirSync(join(oldDir, 'package'), { recursive: true });
    mkdirSync(join(newDir, 'package'), { recursive: true });
    writeFileSync(join(oldDir, 'package', 'SKILL.md'), '---\nname: Nested Skill\n---\n');
    writeFileSync(join(newDir, 'package', 'SKILL.md'), '---\nname: Nested Skill\n---\n');
    writeFileSync(join(oldDir, '.clawx-install.json'), JSON.stringify({
      installedAt: '2026-07-01T00:00:00.000Z',
      canonicalName: 'Nested Skill',
    }));
    writeFileSync(join(newDir, '.clawx-install.json'), JSON.stringify({
      installedAt: '2026-07-02T00:00:00.000Z',
      canonicalName: 'Nested Skill',
    }));

    const { reconcileManagedSkillWinners } = await import(
      '@electron/services/skills/managed-skill-winner'
    );
    const result = await reconcileManagedSkillWinners();

    expect(existsSync(newDir)).toBe(true);
    expect(existsSync(oldDir)).toBe(false);
    expect(result.quarantined).toHaveLength(1);
  });

  it('serializes concurrent reconcile calls that see the same duplicate pair', async () => {
    const oldDir = writeSkill(skillsRoot, 'concurrent-old', 'Concurrent Skill');
    const newDir = writeSkill(skillsRoot, 'concurrent-new', 'Concurrent Skill');
    writeFileSync(join(oldDir, '.clawx-install.json'), JSON.stringify({
      installedAt: '2026-07-01T00:00:00.000Z',
    }));
    writeFileSync(join(newDir, '.clawx-install.json'), JSON.stringify({
      installedAt: '2026-07-02T00:00:00.000Z',
    }));

    const { reconcileManagedSkillWinners } = await import(
      '@electron/services/skills/managed-skill-winner'
    );
    const [first, second] = await Promise.all([
      reconcileManagedSkillWinners(),
      reconcileManagedSkillWinners(),
    ]);

    expect(existsSync(newDir)).toBe(true);
    expect(existsSync(oldDir)).toBe(false);
    expect(first.quarantined.length + second.quarantined.length).toBe(1);
  });

  it('restores losers when winner config migration fails', async () => {
    const oldDir = writeSkill(skillsRoot, 'migration-old', 'Migration Skill');
    const newDir = writeSkill(skillsRoot, 'migration-new', 'Migration Skill');
    writeFileSync(join(oldDir, '.clawx-install.json'), JSON.stringify({
      installedAt: '2026-07-01T00:00:00.000Z',
    }));
    writeFileSync(join(newDir, '.clawx-install.json'), JSON.stringify({
      installedAt: '2026-07-02T00:00:00.000Z',
    }));
    migrateManagedSkillReplacementConfigMock.mockRejectedValueOnce(new Error('config write failed'));

    const { reconcileManagedSkillWinners } = await import(
      '@electron/services/skills/managed-skill-winner'
    );
    await expect(reconcileManagedSkillWinners()).rejects.toThrow('config write failed');

    expect(existsSync(oldDir)).toBe(true);
    expect(existsSync(newDir)).toBe(true);
  });

  it('does not migrate an unrelated manifest name as a loser alias', async () => {
    const oldDir = writeSkill(skillsRoot, 'old-folder', 'Duplicate');
    const newDir = writeSkill(skillsRoot, 'new-folder', 'Duplicate');
    writeFileSync(join(oldDir, 'manifest.json'), JSON.stringify({
      slug: 'old-skill-slug',
      name: 'unrelated-config-key',
    }));
    writeFileSync(join(oldDir, '.clawx-install.json'), JSON.stringify({
      installedAt: '2026-07-01T00:00:00.000Z',
    }));
    writeFileSync(join(newDir, '.clawx-install.json'), JSON.stringify({
      installedAt: '2026-07-02T00:00:00.000Z',
    }));

    const { reconcileManagedSkillWinners } = await import(
      '@electron/services/skills/managed-skill-winner'
    );
    await reconcileManagedSkillWinners();

    const migration = migrateManagedSkillReplacementConfigMock.mock.calls.at(-1)?.[0] as {
      staleAliases: string[];
    };
    expect(migration.staleAliases).toContain('old-skill-slug');
    expect(migration.staleAliases).not.toContain('unrelated-config-key');
  });
});
