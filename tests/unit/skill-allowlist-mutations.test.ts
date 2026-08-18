import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/clawx-skill-allowlist-${suffix}`,
    testUserData: `/tmp/clawx-skill-allowlist-user-${suffix}`,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  const mocked = { ...actual, homedir: () => testHome };
  return { ...mocked, default: mocked };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => testUserData,
    getVersion: () => '0.0.0-test',
  },
}));

vi.mock('@electron/utils/openclaw-cli', () => ({
  execOpenclaw: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

vi.mock('@electron/services/providers/provider-store', () => ({
  listProviderAccounts: vi.fn().mockResolvedValue([]),
}));

const catalog = [
  { id: 'find-skills', name: 'find-skills', description: '', enabled: true, source: 'openclaw-managed' },
  { id: 'browser-use', name: 'browser-use', description: '', enabled: true, source: 'openclaw-managed' },
];

vi.mock('@electron/services/skills/local-skill-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@electron/services/skills/local-skill-service')>();
  return {
    ...actual,
    listLocalSkills: vi.fn().mockResolvedValue(catalog),
  };
});

async function writeOpenClawJson(config: unknown): Promise<void> {
  const openclawDir = join(testHome, '.openclaw');
  await mkdir(openclawDir, { recursive: true });
  await writeFile(join(openclawDir, 'openclaw.json'), JSON.stringify(config, null, 2), 'utf8');
}

async function readOpenClawJson(): Promise<Record<string, unknown>> {
  const content = await readFile(join(testHome, '.openclaw', 'openclaw.json'), 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

describe('skill allowlist mutations', () => {
  beforeEach(async () => {
    vi.resetModules();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('applySkillAgentsMapping updates all agents in one write', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: { skills: ['find-skills'] },
        list: [
          { id: 'main', name: 'Main', default: true, skills: ['find-skills'] },
          { id: 'bot-a', name: 'Bot A', skills: [] },
        ],
      },
      skills: { entries: { 'find-skills': { enabled: true } } },
    });

    const { applySkillAgentsMapping } = await import('@electron/utils/agent-config');
    await applySkillAgentsMapping('browser-use', ['main', 'bot-a']);

    const written = await readOpenClawJson();
    const list = (written.agents as { list: Array<{ id: string; skills: string[] }> }).list;
    expect(list.find((entry) => entry.id === 'main')?.skills).toEqual(
      expect.arrayContaining(['find-skills', 'browser-use']),
    );
    expect(list.find((entry) => entry.id === 'bot-a')?.skills).toEqual(['browser-use']);
  });

  it('purgeSkillFromAgentAllowlists removes skill from agents and defaults', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: { skills: ['find-skills', 'browser-use'] },
        list: [
          { id: 'main', name: 'Main', default: true, skills: ['find-skills', 'browser-use'] },
          { id: 'bot-a', name: 'Bot A', skills: ['find-skills'] },
        ],
      },
      skills: {
        entries: {
          'find-skills': { enabled: true },
          'browser-use': { enabled: true },
        },
      },
    });

    const { purgeSkillFromAgentAllowlists } = await import('@electron/utils/agent-config');
    await purgeSkillFromAgentAllowlists('find-skills');

    const written = await readOpenClawJson();
    const agents = written.agents as {
      defaults: { skills: string[] };
      list: Array<{ id: string; skills: string[] }>;
    };
    expect(agents.defaults.skills).toEqual(['browser-use']);
    expect(agents.list.find((entry) => entry.id === 'main')?.skills).toEqual(['browser-use']);
    expect(agents.list.find((entry) => entry.id === 'bot-a')?.skills).toEqual([]);
    const entries = (written.skills as { entries: Record<string, { enabled?: boolean }> }).entries;
    expect(entries['find-skills']?.enabled).toBe(false);
  });

  it('migrates stale replacement aliases and entries in one config transaction', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: { skills: ['old-folder', 'browser-use'] },
        list: [
          { id: 'main', name: 'Main', default: true, skills: ['old-folder'] },
          { id: 'bot-a', name: 'Bot A', skills: ['browser-use', 'old-folder'] },
        ],
      },
      skills: {
        entries: {
          'old-folder': { enabled: true, apiKey: 'old-key', env: { OLD: '1' } },
          'browser-use': { enabled: true },
        },
      },
    });

    const { migrateManagedSkillReplacementConfig } = await import('@electron/utils/agent-config');
    await migrateManagedSkillReplacementConfig({
      staleAliases: ['old-folder'],
      newCanonicalSkillId: 'find-skills',
    });

    const written = await readOpenClawJson();
    const agents = written.agents as {
      defaults: { skills: string[] };
      list: Array<{ id: string; skills: string[] }>;
    };
    expect(agents.defaults.skills).toEqual(['browser-use', 'find-skills']);
    expect(agents.list.find((entry) => entry.id === 'main')?.skills).toEqual(['find-skills']);
    expect(agents.list.find((entry) => entry.id === 'bot-a')?.skills).toEqual([
      'browser-use',
      'find-skills',
    ]);

    const skillEntries = (written.skills as {
      entries: Record<string, { enabled?: boolean; apiKey?: string; env?: Record<string, string> }>;
    }).entries;
    expect(skillEntries['old-folder']).toBeUndefined();
    expect(skillEntries['find-skills']).toMatchObject({
      enabled: true,
      apiKey: 'old-key',
      env: { OLD: '1' },
    });
  });

  it('does not persist partial replacement config when its single write fails', async () => {
    const original = {
      agents: {
        defaults: { skills: ['old-folder'] },
        list: [
          { id: 'main', name: 'Main', default: true, skills: ['old-folder'] },
        ],
      },
      skills: {
        entries: {
          'old-folder': { enabled: true, apiKey: 'old-key' },
        },
      },
    };
    await writeOpenClawJson(original);

    const channelConfig = await import('@electron/utils/channel-config');
    const writeSpy = vi.spyOn(channelConfig, 'writeOpenClawConfig')
      .mockRejectedValueOnce(new Error('simulated config write failure'));
    const { migrateManagedSkillReplacementConfig } = await import('@electron/utils/agent-config');

    await expect(migrateManagedSkillReplacementConfig({
      staleAliases: ['old-folder'],
      newCanonicalSkillId: 'find-skills',
    })).rejects.toThrow('simulated config write failure');

    expect(await readOpenClawJson()).toEqual(original);
    writeSpy.mockRestore();
  });

  it('applySkillAgentsMapping keeps global defaults when all agents opt out', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: { skills: ['find-skills', 'browser-use'] },
        list: [
          { id: 'main', name: 'Main', default: true, skills: ['find-skills', 'browser-use'] },
          { id: 'bot-a', name: 'Bot A', skills: ['find-skills', 'browser-use'] },
        ],
      },
      skills: {
        entries: {
          'find-skills': { enabled: true },
          'browser-use': { enabled: true },
        },
      },
    });

    const { applySkillAgentsMapping } = await import('@electron/utils/agent-config');
    await applySkillAgentsMapping('browser-use', []);

    const written = await readOpenClawJson();
    const agents = written.agents as {
      defaults: { skills: string[] };
      list: Array<{ id: string; skills: string[] }>;
    };
    expect(agents.defaults.skills).toEqual(['find-skills', 'browser-use']);
    expect(agents.list.find((entry) => entry.id === 'main')?.skills).toEqual(['find-skills']);
    expect(agents.list.find((entry) => entry.id === 'bot-a')?.skills).toEqual(['find-skills']);
    const entries = (written.skills as { entries: Record<string, { enabled?: boolean }> }).entries;
    expect(entries['browser-use']?.enabled).toBe(true);
  });

  it('applyBatchSkillAgentsMapping updates multiple skills in one write', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: { skills: ['find-skills', 'browser-use'] },
        list: [
          { id: 'main', name: 'Main', default: true, skills: ['find-skills', 'browser-use'] },
          { id: 'bot-a', name: 'Bot A', skills: ['find-skills', 'browser-use'] },
        ],
      },
      skills: {
        entries: {
          'find-skills': { enabled: true },
          'browser-use': { enabled: true },
        },
      },
    });

    const { applyBatchSkillAgentsMapping } = await import('@electron/utils/agent-config');
    await applyBatchSkillAgentsMapping([
      { skillId: 'find-skills', agentIds: [] },
      { skillId: 'browser-use', agentIds: [] },
    ]);

    const written = await readOpenClawJson();
    const agents = written.agents as {
      defaults: { skills: string[] };
      list: Array<{ id: string; skills: string[] }>;
    };
    expect(agents.defaults.skills).toEqual(['find-skills', 'browser-use']);
    expect(agents.list.find((entry) => entry.id === 'main')?.skills).toEqual([]);
    expect(agents.list.find((entry) => entry.id === 'bot-a')?.skills).toEqual([]);
  });

  it('ensureLarkSkillsInGlobalDefaults preserves per-agent global opt-outs', async () => {
    const larkSkills = ['lark-doc', 'lark-im', 'lark-calendar'];
    await writeOpenClawJson({
      agents: {
        defaults: { skills: larkSkills },
        list: [
          { id: 'main', name: 'Main', default: true, skills: larkSkills },
          { id: 'wen-zi-mi-shu', name: '文字秘书', skills: [] },
        ],
      },
      skills: {
        entries: Object.fromEntries(larkSkills.map((skill) => [skill, { enabled: true }])),
      },
    });

    const { ensureLarkSkillsInGlobalDefaults } = await import('@electron/utils/skill-config');
    // Startup bootstrap re-applies the same bundled lark set (no new slugs).
    await ensureLarkSkillsInGlobalDefaults(larkSkills);

    const written = await readOpenClawJson();
    const agents = written.agents as {
      defaults?: { skills?: string[] };
      list?: Array<{ id: string; skills?: string[] }>;
    };
    expect(agents.defaults?.skills?.sort()).toEqual(larkSkills.sort());
    expect(agents.list?.find((entry) => entry.id === 'main')?.skills?.sort()).toEqual(larkSkills.sort());
    expect(agents.list?.find((entry) => entry.id === 'wen-zi-mi-shu')?.skills).toEqual([]);
  });

  it('ensureLarkSkillsInGlobalDefaults does not re-add removed global skills on startup', async () => {
    const bundledLark = ['lark-approval', 'lark-doc', 'lark-im'];
    const userGlobals = ['lark-doc', 'lark-im'];
    await writeOpenClawJson({
      agents: {
        defaults: { skills: userGlobals },
        list: [{ id: 'main', name: 'Main', default: true, skills: userGlobals }],
      },
      skills: {
        entries: Object.fromEntries(userGlobals.map((skill) => [skill, { enabled: true }])),
      },
    });

    const { ensureLarkSkillsInGlobalDefaults } = await import('@electron/utils/skill-config');
    await ensureLarkSkillsInGlobalDefaults(bundledLark);

    const written = await readOpenClawJson();
    const defaults = (written.agents as { defaults?: { skills?: string[] } }).defaults?.skills;
    expect(defaults?.sort()).toEqual(userGlobals.sort());
    expect(defaults).not.toContain('lark-approval');
  });

  it('ensureLarkSkillsInGlobalDefaults seeds lark only before allowlist is established', async () => {
    await writeOpenClawJson({
      agents: {
        list: [{ id: 'main', name: 'Main', default: true }],
      },
      skills: { entries: {} },
    });

    const { ensureLarkSkillsInGlobalDefaults } = await import('@electron/utils/skill-config');
    await ensureLarkSkillsInGlobalDefaults(['lark-doc', 'lark-im']);

    const written = await readOpenClawJson();
    const agents = written.agents as {
      defaults?: { skills?: string[] };
      list?: Array<{ id: string; skills?: string[] }>;
    };
    expect(agents.defaults?.skills?.sort()).toEqual(['lark-doc', 'lark-im']);
    expect(agents.list?.[0]?.skills?.sort()).toEqual(['lark-doc', 'lark-im']);
  });

  it('filterPreinstallSlugsForBootstrapDisable skips allowlisted global skills', async () => {
    const { filterPreinstallSlugsForBootstrapDisable } = await import('@electron/utils/skill-config');
    const { buildSkillAliasToCanonicalIdMap } = await import('@electron/utils/skill-entries-sync');
    const aliasToId = buildSkillAliasToCanonicalIdMap(catalog);

    expect(
      filterPreinstallSlugsForBootstrapDisable(
        ['find-skills', 'pdf', 'lark-doc'],
        ['find-skills'],
        aliasToId,
      ),
    ).toEqual(['pdf']);
  });

  it('applyBulkSkillEnabledState enables skill in defaults and every agent', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true, skills: [] },
          { id: 'bot-a', name: 'Bot A', skills: [] },
        ],
      },
      skills: { entries: {} },
    });

    const { applyBulkSkillEnabledState } = await import('@electron/utils/agent-config');
    await applyBulkSkillEnabledState(['browser-use'], true);

    const written = await readOpenClawJson();
    const agents = written.agents as {
      defaults: { skills: string[] };
      list: Array<{ id: string; skills: string[] }>;
    };
    expect(agents.defaults.skills).toEqual(['browser-use']);
    expect(agents.list.find((entry) => entry.id === 'main')?.skills).toEqual(['browser-use']);
    expect(agents.list.find((entry) => entry.id === 'bot-a')?.skills).toEqual(['browser-use']);
    const entries = (written.skills as { entries: Record<string, { enabled?: boolean }> }).entries;
    expect(entries['browser-use']?.enabled).toBe(true);
  });
});
