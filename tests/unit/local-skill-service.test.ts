import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { homedirMock } = vi.hoisted(() => ({
  homedirMock: vi.fn(),
}));
const listAgentsSnapshotMock = vi.fn();
const getOpenClawSkillsDirMock = vi.fn();
const getOpenClawResolvedDirMock = vi.fn();
const getAllSkillConfigsMock = vi.fn();

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: () => homedirMock(),
  };
});

vi.mock('@electron/utils/agent-config', () => ({
  listAgentsSnapshot: () => listAgentsSnapshotMock(),
}));

vi.mock('@electron/utils/paths', () => ({
  expandPath: (value: string) => value,
  getOpenClawConfigDir: () => join(homedirMock(), '.openclaw'),
  getOpenClawSkillsDir: () => getOpenClawSkillsDirMock(),
  getOpenClawResolvedDir: () => getOpenClawResolvedDirMock(),
}));

vi.mock('@electron/utils/skill-config', () => ({
  getAllSkillConfigs: () => getAllSkillConfigsMock(),
}));

describe('local skill service', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    const homeDir = mkdtempSync(join(tmpdir(), 'clawx-local-skills-home-'));
    homedirMock.mockReturnValue(homeDir);
    vi.stubEnv('HOME', homeDir);
    vi.stubEnv('USERPROFILE', homeDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('includes bundled skill-creator but filters out other bundled openclaw skills', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clawx-local-skills-'));
    const managedRoot = join(root, 'managed');
    const bundledRoot = join(root, 'openclaw');

    mkdirSync(join(managedRoot, 'pdf'), { recursive: true });
    writeFileSync(join(managedRoot, 'pdf', 'SKILL.md'), '---\nname: pdf\ndescription: managed pdf\n---\n');

    mkdirSync(join(bundledRoot, 'skills', 'skill-creator'), { recursive: true });
    writeFileSync(join(bundledRoot, 'skills', 'skill-creator', 'SKILL.md'), '---\nname: skill-creator\ndescription: bundled creator\n---\n');

    mkdirSync(join(bundledRoot, 'skills', 'other-bundled'), { recursive: true });
    writeFileSync(join(bundledRoot, 'skills', 'other-bundled', 'SKILL.md'), '---\nname: other-bundled\ndescription: should not appear\n---\n');

    listAgentsSnapshotMock.mockResolvedValue({ agents: [] });
    getOpenClawSkillsDirMock.mockReturnValue(managedRoot);
    getOpenClawResolvedDirMock.mockReturnValue(bundledRoot);
    getAllSkillConfigsMock.mockResolvedValue({});

    const { listLocalSkills } = await import('@electron/services/skills/local-skill-service');
    const skills = await listLocalSkills();

    expect(skills.map((skill) => skill.id)).toEqual(['pdf', 'skill-creator']);
    expect(skills.find((skill) => skill.id === 'skill-creator')).toMatchObject({
      source: 'openclaw-bundled',
      isBundled: true,
      enabled: true,
    });
    expect(skills.find((skill) => skill.id === 'other-bundled')).toBeUndefined();
  });

  it('does not invent a default version when local metadata has no version', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clawx-local-skills-versionless-'));
    const managedRoot = join(root, 'managed');

    mkdirSync(join(managedRoot, 'self-improvement'), { recursive: true });
    writeFileSync(join(managedRoot, 'self-improvement', 'SKILL.md'), '---\nname: self-improvement\ndescription: versionless skill\n---\n');

    listAgentsSnapshotMock.mockResolvedValue({ agents: [] });
    getOpenClawSkillsDirMock.mockReturnValue(managedRoot);
    getOpenClawResolvedDirMock.mockReturnValue(join(root, 'openclaw'));
    getAllSkillConfigsMock.mockResolvedValue({});

    const { listLocalSkills } = await import('@electron/services/skills/local-skill-service');
    const skills = await listLocalSkills();

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({ id: 'self-improvement', version: undefined });
  });

  it('shows manifest versions and ignores preinstalled hash-only versions', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clawx-local-skills-placeholder-version-'));
    const managedRoot = join(root, 'managed');

    mkdirSync(join(managedRoot, 'pdf'), { recursive: true });
    writeFileSync(join(managedRoot, 'pdf', 'SKILL.md'), '---\nname: pdf\ndescription: placeholder version skill\n---\n');
    writeFileSync(join(managedRoot, 'pdf', 'manifest.json'), JSON.stringify({ slug: 'pdf', version: '1.0.0' }));

    mkdirSync(join(managedRoot, 'docx'), { recursive: true });
    writeFileSync(join(managedRoot, 'docx', 'SKILL.md'), '---\nname: docx\ndescription: preinstalled hash version skill\n---\n');
    writeFileSync(join(managedRoot, 'docx', '.clawx-preinstalled.json'), JSON.stringify({ slug: 'docx', version: 'da20c92503b2e8ff1cf28ca81a0df4673debdbf7' }));

    mkdirSync(join(managedRoot, 'custom-skill'), { recursive: true });
    writeFileSync(join(managedRoot, 'custom-skill', 'SKILL.md'), '---\nname: custom-skill\ndescription: custom version skill\n---\n');
    writeFileSync(join(managedRoot, 'custom-skill', 'manifest.json'), JSON.stringify({ slug: 'custom-skill', version: '0.1.3' }));

    listAgentsSnapshotMock.mockResolvedValue({ agents: [] });
    getOpenClawSkillsDirMock.mockReturnValue(managedRoot);
    getOpenClawResolvedDirMock.mockReturnValue(join(root, 'openclaw'));
    getAllSkillConfigsMock.mockResolvedValue({});

    const { listLocalSkills } = await import('@electron/services/skills/local-skill-service');
    const skills = await listLocalSkills();

    expect(skills.find((skill) => skill.id === 'pdf')?.version).toBe('1.0.0');
    expect(skills.find((skill) => skill.id === 'docx')?.version).toBeUndefined();
    expect(skills.find((skill) => skill.id === 'custom-skill')?.version).toBe('0.1.3');
  });

  it('recursively finds a nested SKILL.md and reports its full path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clawx-local-skills-nested-'));
    const managedRoot = join(root, 'managed');

    const installDir = join(managedRoot, 'deep-skill');
    const nestedDir = join(installDir, 'deep-skill', 'inner');
    mkdirSync(nestedDir, { recursive: true });
    const nestedManifest = join(nestedDir, 'SKILL.md');
    writeFileSync(nestedManifest, '---\nname: deep-skill\ndescription: nested manifest\nversion: 2.1.0\n---\n');

    listAgentsSnapshotMock.mockResolvedValue({ agents: [] });
    getOpenClawSkillsDirMock.mockReturnValue(managedRoot);
    getOpenClawResolvedDirMock.mockReturnValue(join(root, 'openclaw'));
    getAllSkillConfigsMock.mockResolvedValue({});

    const { listLocalSkills } = await import('@electron/services/skills/local-skill-service');
    const skills = await listLocalSkills();

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      id: 'deep-skill',
      name: 'deep-skill',
      version: '2.1.0',
      filePath: nestedManifest,
    });
  });

  it('reads server marketplace metadata so installed skills can be matched in the install sheet', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clawx-local-skills-server-marketplace-'));
    const managedRoot = join(root, 'managed');

    mkdirSync(join(managedRoot, 'enterprise-storage-memory'), { recursive: true });
    writeFileSync(
      join(managedRoot, 'enterprise-storage-memory', 'SKILL.md'),
      '---\nname: enterprise-storage-memory\ndescription: enterprise memory\nversion: 1.0.0\n---\n',
    );
    writeFileSync(
      join(managedRoot, 'enterprise-storage-memory', '.clawx-server-marketplace.json'),
      JSON.stringify({
        provider: 'server',
        slug: 'enterprise-storage-memory-1_0_0',
        installedVersion: '1.0.0',
        versionBase: 'enterprise-storage-memory',
        archiveHash: 'hash-71',
        listingRevision: '71',
      }),
    );

    listAgentsSnapshotMock.mockResolvedValue({ agents: [] });
    getOpenClawSkillsDirMock.mockReturnValue(managedRoot);
    getOpenClawResolvedDirMock.mockReturnValue(join(root, 'openclaw'));
    getAllSkillConfigsMock.mockResolvedValue({});

    const { listLocalSkills } = await import('@electron/services/skills/local-skill-service');
    const skills = await listLocalSkills();

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      id: 'enterprise-storage-memory',
      version: '1.0.0',
      marketplace: {
        provider: 'server',
        slug: 'enterprise-storage-memory-1_0_0',
        installedVersion: '1.0.0',
        versionBase: 'enterprise-storage-memory',
        archiveHash: 'hash-71',
        listingRevision: '71',
      },
    });
  });

  it('treats all plugin-skills directory entries as built-in', async () => {
    const homeDir = homedirMock();
    const pluginSkillsRoot = join(homeDir, '.openclaw', 'plugin-skills');
    mkdirSync(join(pluginSkillsRoot, 'feishu-calendar'), { recursive: true });
    writeFileSync(
      join(pluginSkillsRoot, 'feishu-calendar', 'SKILL.md'),
      '---\nname: feishu-calendar\ndescription: calendar\n---\n',
    );
    mkdirSync(join(pluginSkillsRoot, 'browser-automation'), { recursive: true });
    writeFileSync(
      join(pluginSkillsRoot, 'browser-automation', 'SKILL.md'),
      '---\nname: browser-automation\ndescription: browser\n---\n',
    );

    listAgentsSnapshotMock.mockResolvedValue({ agents: [] });
    getOpenClawSkillsDirMock.mockReturnValue(join(homeDir, '.openclaw', 'skills'));
    getOpenClawResolvedDirMock.mockReturnValue(join(homeDir, '.openclaw', 'openclaw'));
    getAllSkillConfigsMock.mockResolvedValue({});

    const { listLocalSkills } = await import('@electron/services/skills/local-skill-service');
    const skills = await listLocalSkills();

    expect(skills.map((skill) => skill.id).sort()).toEqual(['browser-automation', 'feishu-calendar']);
    expect(skills.every((skill) => skill.isBundled)).toBe(true);
    expect(skills.every((skill) => skill.source === 'openclaw-plugin')).toBe(true);
  });

  it('includes extension skills from openclaw extensions/*/skills (P3)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clawx-local-skills-ext-'));
    const managedRoot = join(root, 'managed');
    const bundledRoot = join(root, 'openclaw');
    const extSkills = join(bundledRoot, 'extensions', 'wecom', 'skills');

    mkdirSync(managedRoot, { recursive: true });
    mkdirSync(join(extSkills, 'wecom-meeting'), { recursive: true });
    writeFileSync(
      join(extSkills, 'wecom-meeting', 'SKILL.md'),
      '---\nname: wecom-meeting\ndescription: extension skill\n---\n',
    );

    listAgentsSnapshotMock.mockResolvedValue({ agents: [] });
    getOpenClawSkillsDirMock.mockReturnValue(managedRoot);
    getOpenClawResolvedDirMock.mockReturnValue(bundledRoot);
    getAllSkillConfigsMock.mockResolvedValue({});

    const { listLocalSkills } = await import('@electron/services/skills/local-skill-service');
    const skills = await listLocalSkills();

    expect(skills.map((skill) => skill.id)).toContain('wecom-meeting');
    expect(skills.find((skill) => skill.id === 'wecom-meeting')).toMatchObject({
      source: 'openclaw-extension',
      isBundled: true,
      description: 'extension skill',
    });
  });

  it('does not scan workspace or ~/.agents skills roots', async () => {
    const homeDir = homedirMock();
    const managedRoot = join(homeDir, '.openclaw', 'skills');
    const workspaceSkills = join(homeDir, 'workspace', 'skills');
    const agentsSkills = join(homeDir, '.agents', 'skills');

    mkdirSync(join(managedRoot, 'managed-only'), { recursive: true });
    writeFileSync(
      join(managedRoot, 'managed-only', 'SKILL.md'),
      '---\nname: managed-only\ndescription: from managed\n---\n',
    );
    mkdirSync(join(workspaceSkills, 'workspace-skill'), { recursive: true });
    writeFileSync(
      join(workspaceSkills, 'workspace-skill', 'SKILL.md'),
      '---\nname: workspace-skill\ndescription: must not appear\n---\n',
    );
    mkdirSync(join(agentsSkills, 'agents-skill'), { recursive: true });
    writeFileSync(
      join(agentsSkills, 'agents-skill', 'SKILL.md'),
      '---\nname: agents-skill\ndescription: must not appear\n---\n',
    );

    listAgentsSnapshotMock.mockResolvedValue({
      agents: [{ id: 'main', workspace: join(homeDir, 'workspace') }],
    });
    getOpenClawSkillsDirMock.mockReturnValue(managedRoot);
    getOpenClawResolvedDirMock.mockReturnValue(join(homeDir, 'openclaw-pkg'));
    getAllSkillConfigsMock.mockResolvedValue({});

    const { listLocalSkills } = await import('@electron/services/skills/local-skill-service');
    const skills = await listLocalSkills({
      agentWorkspaces: [join(homeDir, 'workspace')],
    });

    expect(skills.map((skill) => skill.id)).toEqual(['managed-only']);
  });

  it('dedupes managed over bundled when SKILL.md names match', async () => {
    const root = mkdtempSync(join(tmpdir(), 'clawx-local-skills-dedupe-'));
    const managedRoot = join(root, 'managed');
    const bundledRoot = join(root, 'openclaw');

    mkdirSync(join(managedRoot, 'user-skill-creator'), { recursive: true });
    writeFileSync(
      join(managedRoot, 'user-skill-creator', 'SKILL.md'),
      '---\nname: skill-creator\ndescription: user managed copy\n---\n',
    );
    mkdirSync(join(bundledRoot, 'skills', 'skill-creator'), { recursive: true });
    writeFileSync(
      join(bundledRoot, 'skills', 'skill-creator', 'SKILL.md'),
      '---\nname: skill-creator\ndescription: bundled copy\n---\n',
    );

    listAgentsSnapshotMock.mockResolvedValue({ agents: [] });
    getOpenClawSkillsDirMock.mockReturnValue(managedRoot);
    getOpenClawResolvedDirMock.mockReturnValue(bundledRoot);
    getAllSkillConfigsMock.mockResolvedValue({});

    const { listLocalSkills } = await import('@electron/services/skills/local-skill-service');
    const skills = await listLocalSkills();

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      name: 'skill-creator',
      description: 'user managed copy',
      source: 'openclaw-managed',
    });
  });
});
