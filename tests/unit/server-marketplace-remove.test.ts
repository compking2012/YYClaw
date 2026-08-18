import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdmZip from 'adm-zip';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const getOpenClawConfigDirMock = vi.fn();
const removeSkillConfigMock = vi.fn();
const proxyAwareFetchMock = vi.fn();

vi.mock('@electron/utils/paths', () => ({
  getOpenClawConfigDir: () => getOpenClawConfigDirMock(),
  // provider registry loads resources/config/providers.json at import time
  getResourcesDir: () => resolve(process.cwd(), 'resources'),
  ensureDir: (dir: string) => mkdirSync(dir, { recursive: true }),
}));

vi.mock('@electron/utils/skill-config', () => ({
  removeSkillConfig: (skillId: string) => Promise.resolve(removeSkillConfigMock(skillId)),
}));

vi.mock('@electron/utils/proxy-fetch', () => ({
  proxyAwareFetch: (...args: unknown[]) => proxyAwareFetchMock(...args),
}));

function writeServerSkill(skillDir: string, slug: string, name = slug): void {
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: ${name}\n---\n`);
  writeFileSync(join(skillDir, '.clawx-server-marketplace.json'), JSON.stringify({
    provider: 'server',
    slug,
  }));
}

describe('server marketplace local removal', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  function buildSkillZip(name: string): Buffer {
    const zip = new AdmZip();
    zip.addFile(`${name}/SKILL.md`, Buffer.from(`---\nname: ${name}\n---\n`, 'utf8'));
    return zip.toBuffer();
  }

  it('removes all same-slug server installs when a selected baseDir is provided', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'clawx-server-remove-'));
    const openclawDir = join(homeDir, '.openclaw');
    const skillsRoot = join(openclawDir, 'skills');
    const primaryDir = join(skillsRoot, 'ones-wiki');
    const revisionDir = join(skillsRoot, 'ones-wiki--66');

    writeServerSkill(primaryDir, 'ones-wiki');
    writeServerSkill(revisionDir, 'ones-wiki');
    getOpenClawConfigDirMock.mockReturnValue(openclawDir);

    const { removeServerMarketplaceSkillLocalInstall } = await import('../../electron/services/skills-marketplace-client');
    const result = await removeServerMarketplaceSkillLocalInstall({
      skillId: 'ones-wiki',
      displayName: 'ones-wiki',
      baseDir: revisionDir,
    });

    expect(result).toEqual({ removed: [revisionDir, primaryDir], failed: [] });
    expect(existsSync(revisionDir)).toBe(false);
    expect(existsSync(primaryDir)).toBe(false);
    expect(removeSkillConfigMock).toHaveBeenCalledWith('ones-wiki');
  });

  it('falls back to deleting same-slug directories when selected baseDir is stale', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'clawx-server-remove-stale-'));
    const openclawDir = join(homeDir, '.openclaw');
    const skillsRoot = join(openclawDir, 'skills');
    const primaryDir = join(skillsRoot, 'ones-wiki');
    const staleRevisionDir = join(skillsRoot, 'ones-wiki--66');

    writeServerSkill(primaryDir, 'ones-wiki');
    getOpenClawConfigDirMock.mockReturnValue(openclawDir);

    const { removeServerMarketplaceSkillLocalInstall } = await import('../../electron/services/skills-marketplace-client');
    const result = await removeServerMarketplaceSkillLocalInstall({
      skillId: 'ones-wiki',
      displayName: 'ones-wiki',
      baseDir: staleRevisionDir,
    });

    expect(result).toEqual({ removed: [primaryDir], failed: [] });
    expect(existsSync(primaryDir)).toBe(false);
    expect(removeSkillConfigMock).toHaveBeenCalledWith('ones-wiki');
  });

  it('removes the selected server install even when its stored slug is from another environment', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'clawx-server-remove-cross-env-'));
    const openclawDir = join(homeDir, '.openclaw');
    const skillDir = join(openclawDir, 'skills', 'hw-design-spec-standardizer');

    writeServerSkill(skillDir, 'dev-hw-design-spec-standardizer', 'hw-design-spec-standardizer');
    getOpenClawConfigDirMock.mockReturnValue(openclawDir);

    const { removeServerMarketplaceSkillLocalInstall } = await import('../../electron/services/skills-marketplace-client');
    const result = await removeServerMarketplaceSkillLocalInstall({
      skillId: 'hw-design-spec-standardizer',
      displayName: 'hw-design-spec-standardizer',
      baseDir: skillDir,
    });

    expect(result).toEqual({ removed: [skillDir], failed: [] });
    expect(existsSync(skillDir)).toBe(false);
  });

  it('cleans older same-slug server installs after a successful install', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'clawx-server-install-cleanup-'));
    const openclawDir = join(homeDir, '.openclaw');
    const skillsRoot = join(openclawDir, 'skills');
    const oldDir = join(skillsRoot, 'enterprise-storage-memory--38');
    const otherDir = join(skillsRoot, 'other-skill--1');

    writeServerSkill(oldDir, 'enterprise-storage-memory');
    writeServerSkill(otherDir, 'other-skill');
    getOpenClawConfigDirMock.mockReturnValue(openclawDir);
    proxyAwareFetchMock.mockResolvedValue(new Response(buildSkillZip('enterprise-storage-memory'), { status: 200 }));

    const { downloadAndInstallServerSkill } = await import('../../electron/services/skills-marketplace-client');
    await downloadAndInstallServerSkill('enterprise-storage-memory', 'hash-71', '71', '1.0.0', 'enterprise-storage-memory');

    expect(existsSync(oldDir)).toBe(false);
    expect(existsSync(otherDir)).toBe(true);
    expect(readdirSync(skillsRoot).sort()).toEqual(['enterprise-storage-memory', 'other-skill--1']);
  });
});
