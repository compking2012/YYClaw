// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';

const { testHome, resourcesDir } = vi.hoisted(() => ({
  testHome: `/tmp/clawx-skill-config-${Math.random().toString(36).slice(2)}`,
  resourcesDir: `/tmp/clawx-skill-config-resources-${Math.random().toString(36).slice(2)}`,
}));

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = {
    ...actual,
    homedir: () => testHome,
  };
  return {
    ...mocked,
    default: mocked,
  };
});

vi.mock('@electron/utils/paths', () => ({
  getResourcesDir: () => resourcesDir,
  getOpenClawDir: () => join(testHome, '.openclaw'),
  getOpenClawResolvedDir: () => join(testHome, '.openclaw'),
  resolveOpenClawConfigPath: () => join(testHome, '.openclaw', 'openclaw.json'),
}));

describe('skill-config', () => {
  beforeEach(async () => {
    vi.resetModules();
    await rm(testHome, { recursive: true, force: true });
    await rm(resourcesDir, { recursive: true, force: true });
    await mkdir(join(testHome, '.openclaw'), { recursive: true });
  });

  it('getAllSkillConfigs should return empty object when file does not exist', async () => {
    const { getAllSkillConfigs } = await import('../../electron/utils/skill-config');
    const configs = await getAllSkillConfigs();
    expect(configs).toEqual({});
  });

  it('getAllSkillConfigs should return entries when file exists', async () => {
    await writeFile(
      join(testHome, '.openclaw', 'openclaw.json'),
      JSON.stringify({
        skills: {
          entries: {
            'test-skill': { enabled: true, apiKey: 'test-key' },
          },
        },
      }),
      'utf-8',
    );

    const { getAllSkillConfigs } = await import('../../electron/utils/skill-config');
    const configs = await getAllSkillConfigs();
    expect(configs).toEqual({
      'test-skill': { enabled: true, apiKey: 'test-key' },
    });
  });

  it('updateSkillConfig should update entry', async () => {
    await writeFile(
      join(testHome, '.openclaw', 'openclaw.json'),
      JSON.stringify({
        skills: {
          entries: {
            'test-skill': { enabled: true },
          },
        },
      }),
      'utf-8',
    );

    const { updateSkillConfig } = await import('../../electron/utils/skill-config');
    const result = await updateSkillConfig('test-skill', { apiKey: 'new-key' });
    expect(result.success).toBe(true);

    const raw = await readFile(join(testHome, '.openclaw', 'openclaw.json'), 'utf-8');
    const writtenConfig = JSON.parse(raw);
    expect(writtenConfig.skills.entries['test-skill'].apiKey).toBe('new-key');
  });

  it('ensureBundledLarkCliInstalled writes bundled markers for shipped skills', async () => {
    const bundledSkillDir = join(resourcesDir, 'skills-bundled', 'lark-approval');
    mkdirSync(bundledSkillDir, { recursive: true });
    writeFileSync(join(bundledSkillDir, 'SKILL.md'), '---\nname: lark-approval\ndescription: bundled lark skill\n---\n');

    const { ensureBundledLarkCliInstalled } = await import('../../electron/utils/skill-config');
    await ensureBundledLarkCliInstalled();

    const targetDir = join(testHome, '.openclaw', 'skills', 'lark-approval');
    expect(existsSync(join(targetDir, 'SKILL.md'))).toBe(true);
    const marker = JSON.parse(
      await readFile(join(targetDir, '.clawx-preinstalled.json'), 'utf-8'),
    ) as { source?: string; slug?: string };
    expect(marker).toMatchObject({
      source: 'clawx-preinstalled',
      slug: 'lark-approval',
    });
  });

  it('ensurePreinstalledSkillsInstalled gates by platform and records npx origin/url', async () => {
    // Manifest: one all-platform npx skill, one restricted to a platform that
    // is never the current test env ("aix") so it must be skipped.
    const manifestDir = join(resourcesDir, 'skills');
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(
      join(manifestDir, 'preinstalled-manifest.json'),
      JSON.stringify({
        skills: [
          { slug: 'always-in', source: 'npx', url: 'https://clawhub.ai/steipete/skills/always-in' },
          { slug: 'never-in', source: 'npx', url: 'https://clawhub.ai/steipete/skills/never-in', platform: ['aix'] },
        ],
      }),
      'utf-8',
    );

    // Vendored source root with both skill dirs + lock versions.
    const sourceRoot = join(resourcesDir, 'preinstalled-skills');
    for (const slug of ['always-in', 'never-in']) {
      mkdirSync(join(sourceRoot, slug), { recursive: true });
      writeFileSync(join(sourceRoot, slug, 'SKILL.md'), `---\nname: ${slug}\ndescription: test skill\n---\n`);
    }
    writeFileSync(
      join(sourceRoot, '.preinstalled-lock.json'),
      JSON.stringify({
        skills: [
          { slug: 'always-in', version: '1.0.0' },
          { slug: 'never-in', version: '1.0.0' },
        ],
      }),
      'utf-8',
    );

    const { ensurePreinstalledSkillsInstalled } = await import('../../electron/utils/skill-config');
    await ensurePreinstalledSkillsInstalled();

    const skillsRoot = join(testHome, '.openclaw', 'skills');
    expect(existsSync(join(skillsRoot, 'always-in', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(skillsRoot, 'never-in'))).toBe(false);

    const marker = JSON.parse(
      await readFile(join(skillsRoot, 'always-in', '.clawx-preinstalled.json'), 'utf-8'),
    ) as { origin?: string; url?: string; version?: string };
    expect(marker).toMatchObject({
      origin: 'npx',
      url: 'https://clawhub.ai/steipete/skills/always-in',
      version: '1.0.0',
    });
  });
});
