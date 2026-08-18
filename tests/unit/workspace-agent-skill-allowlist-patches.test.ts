import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/clawx-workspace-skill-sync-${suffix}`,
    testUserData: `/tmp/clawx-workspace-skill-sync-user-${suffix}`,
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
  { id: 'docx', name: 'docx', description: '', enabled: true, source: 'openclaw-managed' },
];

vi.mock('@electron/services/skills/local-skill-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@electron/services/skills/local-skill-service')>();
  return {
    ...actual,
    listLocalSkills: vi.fn().mockResolvedValue(catalog),
    directoryContainsSkillManifest: vi.fn().mockResolvedValue(false),
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

describe('applyPerAgentWorkspaceSkillAllowlistPatches', () => {
  beforeEach(async () => {
    vi.resetModules();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('removes per-agent workspace skill without clearing agents.defaults.skills', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: { skills: ['docx'] },
        list: [
          { id: 'main', name: 'Main', default: true, skills: ['docx'] },
          { id: 'writer', name: 'Writer', skills: ['docx'] },
        ],
      },
      skills: { entries: { docx: { enabled: true } } },
    });

    const { applyPerAgentWorkspaceSkillAllowlistPatches } = await import('@electron/utils/agent-config');
    await applyPerAgentWorkspaceSkillAllowlistPatches([
      { agentId: 'writer', remove: ['docx'] },
    ]);

    const written = await readOpenClawJson();
    const agents = written.agents as {
      defaults?: { skills?: string[] };
      list: Array<{ id: string; skills?: string[] }>;
    };
    expect(agents.defaults?.skills).toEqual(['docx']);
    expect(agents.list.find((entry) => entry.id === 'main')?.skills).toEqual(['docx']);
    expect(agents.list.find((entry) => entry.id === 'writer')?.skills).toEqual([]);
  });

  it('does not clear defaults when batch mapping would have used empty agentIds', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: { skills: ['docx'] },
        list: [
          { id: 'writer', name: 'Writer', skills: ['docx'] },
        ],
      },
      skills: { entries: { docx: { enabled: true } } },
    });

    const { applyBatchSkillAgentsMapping, applyPerAgentWorkspaceSkillAllowlistPatches } = await import('@electron/utils/agent-config');

    await applyPerAgentWorkspaceSkillAllowlistPatches([
      { agentId: 'writer', remove: ['docx'] },
    ]);
    let written = await readOpenClawJson();
    let agents = written.agents as { defaults?: { skills?: string[] }; list: Array<{ id: string; skills?: string[] }> };
    expect(agents.defaults?.skills).toEqual(['docx']);

    await writeOpenClawJson({
      agents: {
        defaults: { skills: ['docx'] },
        list: [
          { id: 'writer', name: 'Writer', skills: ['docx'] },
        ],
      },
      skills: { entries: { docx: { enabled: true } } },
    });

    await applyBatchSkillAgentsMapping([{ skillId: 'docx', agentIds: [] }]);
    written = await readOpenClawJson();
    agents = written.agents as { defaults?: { skills?: string[] }; list: Array<{ id: string; skills?: string[] }> };
    expect(agents.defaults?.skills).toEqual(['docx']);
    expect(agents.list.find((entry) => entry.id === 'writer')?.skills).toEqual([]);
  });
});
