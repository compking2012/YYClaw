import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  mergeGlobalSkillsIntoAgentSkills,
  readDefaultAgentSkillsFromConfig,
  setDefaultAgentSkills,
} from '@electron/utils/global-agent-skills';

const readOpenClawConfig = vi.fn();
const writeOpenClawConfig = vi.fn();
const listLocalSkills = vi.fn();

vi.mock('@electron/utils/channel-config', () => ({
  readOpenClawConfig: () => readOpenClawConfig(),
  writeOpenClawConfig: (config: unknown) => writeOpenClawConfig(config),
}));

vi.mock('@electron/utils/config-mutex', () => ({
  withConfigLock: async (fn: () => Promise<unknown>) => fn(),
}));

vi.mock('@electron/services/skills/local-skill-service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@electron/services/skills/local-skill-service')>();
  return {
    ...actual,
    listLocalSkills: () => listLocalSkills(),
  };
});

vi.mock('@electron/utils/agent-config', () => ({
  listAgentsSnapshotFromConfig: (config: { agents?: { defaults?: { skills?: string[] } } }) => ({
    agents: [],
    defaultAgentId: 'main',
    defaultModelRef: null,
    defaultImageModelRef: null,
    defaultImageGenerationModelRef: null,
    defaultVideoGenerationModelRef: null,
    defaultMusicGenerationModelRef: null,
    configuredChannelTypes: [],
    channelOwners: {},
    channelAccountOwners: {},
    defaultAgentSkills: config.agents?.defaults?.skills || [],
  }),
}));

const catalog = [
  { id: 'find-skills', name: 'find-skills', description: '', enabled: true, source: 'openclaw-managed' },
  { id: 'browser-use', name: 'browser-use', description: '', enabled: true, source: 'openclaw-managed' },
];

describe('global-agent-skills', () => {
  beforeEach(() => {
    readOpenClawConfig.mockReset();
    writeOpenClawConfig.mockReset();
    listLocalSkills.mockReset();
    listLocalSkills.mockResolvedValue(catalog);
  });

  it('reads defaults.skills from config', () => {
    expect(readDefaultAgentSkillsFromConfig({
      agents: { defaults: { skills: ['Find-Skills', 'browser-use'] } },
    })).toEqual(['find-skills', 'browser-use']);
  });

  it('merges global skills into agent skills without duplicates', () => {
    expect(mergeGlobalSkillsIntoAgentSkills(['browser-use'], ['find-skills', 'browser-use']))
      .toEqual(['find-skills', 'browser-use']);
  });

  it('setDefaultAgentSkills updates defaults and syncs all agents while keeping per-agent extras', async () => {
    const config = {
      agents: {
        defaults: { skills: ['find-skills'] },
        list: [
          { id: 'main', skills: ['find-skills', 'browser-use'] },
          { id: 'bot-a', skills: ['find-skills'] },
        ],
      },
      skills: {
        entries: {
          'find-skills': { enabled: true },
          'browser-use': { enabled: true },
        },
      },
    };
    readOpenClawConfig.mockResolvedValue(structuredClone(config));

    await setDefaultAgentSkills(['browser-use']);

    expect(writeOpenClawConfig).toHaveBeenCalledTimes(1);
    const written = writeOpenClawConfig.mock.calls[0][0] as typeof config;
    expect(written.agents?.defaults?.skills).toEqual(['browser-use']);
    expect(written.agents?.list?.[0]?.skills).toEqual(['browser-use']);
    expect(written.agents?.list?.[1]?.skills).toEqual(['browser-use']);
    expect(written.skills?.entries?.['browser-use']?.enabled).toBe(true);
    expect(written.skills?.entries?.['find-skills']?.enabled).toBe(false);
  });

  it('removes global skill from all agents when unset in defaults', async () => {
    const config = {
      agents: {
        defaults: { skills: ['find-skills', 'browser-use'] },
        list: [
          { id: 'main', skills: ['find-skills', 'browser-use', 'extra-only'] },
        ],
      },
      skills: { entries: {} },
    };
    readOpenClawConfig.mockResolvedValue(structuredClone(config));

    await setDefaultAgentSkills(['browser-use']);

    const written = writeOpenClawConfig.mock.calls[0][0] as typeof config;
    expect(written.agents?.defaults?.skills).toEqual(['browser-use']);
    expect(written.agents?.list?.[0]?.skills).toEqual(['extra-only', 'browser-use']);
  });

  it('preserves per-agent global opt-outs when saving defaults unchanged', async () => {
    const config = {
      agents: {
        defaults: { skills: ['find-skills', 'browser-use'] },
        list: [
          { id: 'main', skills: ['find-skills'] },
          { id: 'bot-a', skills: ['find-skills', 'browser-use'] },
        ],
      },
      skills: { entries: {} },
    };
    readOpenClawConfig.mockResolvedValue(structuredClone(config));

    await setDefaultAgentSkills(['find-skills', 'browser-use']);

    const written = writeOpenClawConfig.mock.calls[0][0] as typeof config;
    expect(written.agents?.list?.find((entry) => entry.id === 'main')?.skills).toEqual(['find-skills']);
    expect(written.agents?.list?.find((entry) => entry.id === 'bot-a')?.skills).toEqual(
      expect.arrayContaining(['find-skills', 'browser-use']),
    );
  });
});
