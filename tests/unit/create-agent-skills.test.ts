import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/clawx-create-agent-skills-${suffix}`,
    testUserData: `/tmp/clawx-create-agent-skills-user-${suffix}`,
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

vi.mock('@electron/services/skills/local-skill-service', () => ({
  listLocalSkills: vi.fn().mockResolvedValue([]),
}));

async function writeOpenClawJson(config: unknown): Promise<void> {
  const openclawDir = join(testHome, '.openclaw');
  await mkdir(openclawDir, { recursive: true });
  await writeFile(join(openclawDir, 'openclaw.json'), JSON.stringify(config, null, 2), 'utf8');
}

async function readOpenClawJson(): Promise<Record<string, unknown>> {
  const content = await readFile(join(testHome, '.openclaw', 'openclaw.json'), 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

describe('createAgent skills selection', () => {
  beforeEach(async () => {
    vi.resetModules();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
  });

  it('does not re-merge defaults when user omits global skills', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: { skills: ['find-skills', 'browser-use'] },
        list: [{ id: 'main', name: 'Main', default: true, skills: ['find-skills', 'browser-use'] }],
      },
    });

    const { createAgent } = await import('@electron/utils/agent-config');
    await createAgent('Opt Out Bot', { skills: ['browser-use'] });

    const written = await readOpenClawJson();
    const list = (written.agents as { list: Array<{ id: string; skills?: string[] }> }).list;
    const created = list.find((entry) => entry.id.startsWith('opt-out-bot'));
    expect(created?.skills).toEqual(['browser-use']);
  });
});
