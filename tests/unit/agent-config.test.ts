// @vitest-environment node

import { access, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testUserData } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/clawx-agent-config-${suffix}`,
    testUserData: `/tmp/clawx-agent-config-user-data-${suffix}`,
  };
});

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

async function writeOpenClawJson(config: unknown): Promise<void> {
  const openclawDir = join(testHome, '.openclaw');
  await mkdir(openclawDir, { recursive: true });
  await writeFile(join(openclawDir, 'openclaw.json'), JSON.stringify(config, null, 2), 'utf8');
}

async function readOpenClawJson(): Promise<Record<string, unknown>> {
  const content = await readFile(join(testHome, '.openclaw', 'openclaw.json'), 'utf8');
  return JSON.parse(content) as Record<string, unknown>;
}

/**
 * Point the mocked provider store at a set of configured accounts. Must run
 * before importing agent-config so its `listProviderAccounts` resolves to these.
 * The prune logic keys "is this provider still configured?" off real accounts.
 */
async function setProviderAccounts(
  accounts: Array<{ vendorId: string; id: string; authMode?: string }>,
): Promise<void> {
  const store = await import('@electron/services/providers/provider-store');
  const full = accounts.map((account) => ({
    id: account.id,
    vendorId: account.vendorId,
    label: account.id,
    authMode: account.authMode ?? 'api_key',
    enabled: true,
    isDefault: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  }));
  vi.mocked(store.listProviderAccounts).mockResolvedValue(full as never);
}

describe('agent config lifecycle', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.restoreAllMocks();
    await rm(testHome, { recursive: true, force: true });
    await rm(testUserData, { recursive: true, force: true });
    // The mocked provider store fn persists across tests; reset it to no accounts
    // so each test starts clean (prune is skipped when no accounts are loaded).
    const { listProviderAccounts } = await import('@electron/services/providers/provider-store');
    vi.mocked(listProviderAccounts).mockReset();
    vi.mocked(listProviderAccounts).mockResolvedValue([]);
  });

  it('lists configured agent ids from openclaw.json', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'test3', name: 'test3' },
        ],
      },
    });

    const { listConfiguredAgentIds } = await import('@electron/utils/agent-config');

    await expect(listConfiguredAgentIds()).resolves.toEqual(['main', 'test3']);
  });

  it('falls back to the implicit main agent when no list exists', async () => {
    await writeOpenClawJson({});

    const { listConfiguredAgentIds } = await import('@electron/utils/agent-config');

    await expect(listConfiguredAgentIds()).resolves.toEqual(['main']);
  });

  it('migrates globally enabled skills into every existing agent allowlist', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'writer', name: 'Writer' },
        ],
      },
      skills: {
        entries: {
          pdf: { enabled: true },
          docx: { enabled: true },
          disabledSkill: { enabled: false },
        },
      },
    });

    const { listAgentsSnapshot } = await import('@electron/utils/agent-config');
    const snapshot = await listAgentsSnapshot();
    const main = snapshot.agents.find((agent) => agent.id === 'main');
    const writer = snapshot.agents.find((agent) => agent.id === 'writer');
    expect(main?.skills?.sort()).toEqual(['docx', 'pdf']);
    expect(writer?.skills?.sort()).toEqual(['docx', 'pdf']);
    expect(snapshot.defaultAgentSkills?.sort()).toEqual(['docx', 'pdf']);

    const persisted = await readOpenClawJson();
    const agents = persisted.agents as { defaults?: { skills?: string[] } };
    expect(agents.defaults?.skills?.sort()).toEqual(['docx', 'pdf']);
    const entries = ((persisted.skills as { entries?: Record<string, { enabled?: boolean }> }).entries) || {};
    expect(entries.pdf?.enabled).toBe(true);
    expect(entries.docx?.enabled).toBe(true);
    expect(entries.disabledSkill?.enabled).toBe(false);
  });

  it('syncs stale legacy entries.enabled without re-broadcasting to agent allowlists', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true, skills: [] },
          { id: 'writer', name: 'Writer', skills: [] },
        ],
      },
      skills: {
        entries: {
          pdf: { enabled: true },
        },
      },
    });

    const { listAgentsSnapshot } = await import('@electron/utils/agent-config');
    const snapshot = await listAgentsSnapshot();
    expect(snapshot.agents.find((agent) => agent.id === 'main')?.skills).toEqual([]);
    expect(snapshot.agents.find((agent) => agent.id === 'writer')?.skills).toEqual([]);

    const persisted = await readOpenClawJson();
    const entries = ((persisted.skills as { entries?: Record<string, { enabled?: boolean }> }).entries) || {};
    expect(entries.pdf?.enabled).toBe(false);
  });

  it('does not migrate from skills.entries when defaults.skills is already populated', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: { skills: ['pdf'] },
        list: [
          { id: 'main', name: 'Main', default: true, skills: ['pdf'] },
          { id: 'writer', name: 'Writer' },
        ],
      },
      skills: {
        entries: {
          pdf: { enabled: true },
          docx: { enabled: true },
        },
      },
    });

    const { listAgentsSnapshot } = await import('@electron/utils/agent-config');
    const snapshot = await listAgentsSnapshot();

    expect(snapshot.defaultAgentSkills).toEqual(['pdf']);
    expect(snapshot.agents.find((agent) => agent.id === 'main')?.skills).toEqual(['pdf']);
    expect(snapshot.agents.find((agent) => agent.id === 'writer')?.skills).toEqual([]);

    const persisted = await readOpenClawJson();
    const agents = persisted.agents as {
      defaults?: { skills?: string[] };
      list?: Array<{ id: string; skills?: string[] }>;
    };
    expect(agents.defaults?.skills).toEqual(['pdf']);
    expect(agents.list?.find((entry) => entry.id === 'writer')?.skills).toBeUndefined();
    const entries = ((persisted.skills as { entries?: Record<string, { enabled?: boolean }> }).entries) || {};
    expect(entries.docx?.enabled).toBe(false);
  });

  it('applies legacy global-skill migration once and does not re-broadcast later toggles', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'writer', name: 'Writer' },
        ],
      },
      skills: {
        entries: {
          pdf: { enabled: true },
        },
      },
    });

    const { listAgentsSnapshot } = await import('@electron/utils/agent-config');
    const firstSnapshot = await listAgentsSnapshot();
    expect(firstSnapshot.agents.find((agent) => agent.id === 'main')?.skills).toEqual(['pdf']);
    expect(firstSnapshot.agents.find((agent) => agent.id === 'writer')?.skills).toEqual(['pdf']);
    expect(firstSnapshot.defaultAgentSkills).toEqual(['pdf']);

    const persistedAfterFirst = await readOpenClawJson();
    const skillsConfig = (persistedAfterFirst.skills as { entries?: Record<string, { enabled?: boolean }> }) || {};
    const entries = skillsConfig.entries || {};
    entries.docx = { enabled: true };
    await writeOpenClawJson({
      ...persistedAfterFirst,
      skills: {
        ...skillsConfig,
        entries,
      },
    });

    const secondSnapshot = await listAgentsSnapshot();
    expect(secondSnapshot.agents.find((agent) => agent.id === 'main')?.skills).toEqual(['pdf']);
    expect(secondSnapshot.agents.find((agent) => agent.id === 'writer')?.skills).toEqual(['pdf']);

    const persistedAfterSecond = await readOpenClawJson();
    const secondEntries = ((persistedAfterSecond.skills as { entries?: Record<string, { enabled?: boolean }> }).entries) || {};
    expect(secondEntries.docx?.enabled).toBe(false);
  });

  it('reconciles agents.list from on-disk agent directories when config list is missing', async () => {
    await writeOpenClawJson({
      skills: {},
      gateway: { port: 18789 },
    });
    const agentsDir = join(testHome, '.openclaw', 'agents');
    await mkdir(join(agentsDir, 'main'), { recursive: true });
    await mkdir(join(agentsDir, 'agent-7'), { recursive: true });
    await mkdir(join(agentsDir, 'agent-8'), { recursive: true });

    const { listAgentsSnapshot } = await import('@electron/utils/agent-config');
    const snapshot = await listAgentsSnapshot();
    expect(snapshot.agents.map((a) => a.id).sort()).toEqual(['agent-7', 'agent-8', 'main']);

    const persisted = await readOpenClawJson();
    const list = (persisted.agents as { list?: Array<{ id: string }> })?.list ?? [];
    expect(list.map((e) => e.id).sort()).toEqual(['agent-7', 'agent-8', 'main']);
  });

  it('listAgentsSnapshotReadOnly does not reconcile or write openclaw.json', async () => {
    await writeOpenClawJson({
      skills: {},
      gateway: { port: 18789 },
    });
    const agentsDir = join(testHome, '.openclaw', 'agents');
    await mkdir(join(agentsDir, 'main'), { recursive: true });
    await mkdir(join(agentsDir, 'agent-7'), { recursive: true });

    const before = JSON.stringify(await readOpenClawJson());
    const { listAgentsSnapshotReadOnly } = await import('@electron/utils/agent-config');
    await listAgentsSnapshotReadOnly();
    const after = JSON.stringify(await readOpenClawJson());
    expect(after).toBe(before);
  });

  it('listAgentsSnapshotReadOnly does not prune stale agent model overrides', async () => {
    const accountId = 'clawserverglm51-clawserv';
    await writeOpenClawJson({
      agents: {
        defaults: { model: { primary: 'glm52/GLM52' } },
        list: [
          {
            id: 'dev-agent',
            name: 'Dev',
            model: { primary: `${accountId}/Kimi-K2.6` },
          },
        ],
      },
    });

    await setProviderAccounts([]);

    const { listAgentsSnapshotReadOnly, listAgentsSnapshot } = await import('@electron/utils/agent-config');
    const readOnlySnapshot = await listAgentsSnapshotReadOnly();
    expect(readOnlySnapshot.agents.find((agent) => agent.id === 'dev-agent')?.overrideModelRef)
      .toBe(`${accountId}/Kimi-K2.6`);

    await setProviderAccounts([{ vendorId: 'custom', id: accountId }]);
    await listAgentsSnapshot();
    const config = await readOpenClawJson();
    const devEntry = ((config.agents as { list: Array<{ id: string; model?: { primary?: string } }> }).list)
      .find((agent) => agent.id === 'dev-agent');
    expect(devEntry?.model?.primary).toBe(`${accountId}/Kimi-K2.6`);
  });

  it('includes canonical per-agent main session keys in the snapshot', async () => {
    await writeOpenClawJson({
      session: {
        mainKey: 'desk',
      },
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'research', name: 'Research' },
        ],
      },
    });

    const { listAgentsSnapshot } = await import('@electron/utils/agent-config');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.agents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'main',
          mainSessionKey: 'agent:main:desk',
        }),
        expect.objectContaining({
          id: 'research',
          mainSessionKey: 'agent:research:desk',
        }),
      ]),
    );
  });

  it('exposes effective and override model refs in the snapshot', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: {
            primary: 'moonshot/kimi-k2.6',
          },
        },
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'coder', name: 'Coder', model: { primary: 'ark/ark-code-latest' } },
        ],
      },
    });

    const { listAgentsSnapshot } = await import('@electron/utils/agent-config');
    const snapshot = await listAgentsSnapshot();
    const main = snapshot.agents.find((agent) => agent.id === 'main');
    const coder = snapshot.agents.find((agent) => agent.id === 'coder');

    expect(snapshot.defaultModelRef).toBe('moonshot/kimi-k2.6');
    expect(main).toMatchObject({
      modelRef: 'moonshot/kimi-k2.6',
      overrideModelRef: null,
      inheritedModel: true,
      modelDisplay: 'kimi-k2.6',
    });
    expect(coder).toMatchObject({
      modelRef: 'ark/ark-code-latest',
      overrideModelRef: 'ark/ark-code-latest',
      inheritedModel: false,
      modelDisplay: 'ark-code-latest',
    });
  });

  it('updates and clears per-agent model overrides', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: {
            primary: 'moonshot/kimi-k2.6',
          },
        },
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'coder', name: 'Coder' },
        ],
      },
    });

    const { listAgentsSnapshot, updateAgentModel } = await import('@electron/utils/agent-config');

    await updateAgentModel('coder', 'ark/ark-code-latest');
    let config = await readOpenClawJson();
    let coder = ((config.agents as { list: Array<{ id: string; model?: { primary?: string } }> }).list)
      .find((agent) => agent.id === 'coder');
    expect(coder?.model?.primary).toBe('ark/ark-code-latest');

    let snapshot = await listAgentsSnapshot();
    let snapshotCoder = snapshot.agents.find((agent) => agent.id === 'coder');
    expect(snapshotCoder).toMatchObject({
      modelRef: 'ark/ark-code-latest',
      overrideModelRef: 'ark/ark-code-latest',
      inheritedModel: false,
    });

    await updateAgentModel('coder', null);
    config = await readOpenClawJson();
    coder = ((config.agents as { list: Array<{ id: string; model?: unknown }> }).list)
      .find((agent) => agent.id === 'coder');
    expect(coder?.model).toBeUndefined();

    snapshot = await listAgentsSnapshot();
    snapshotCoder = snapshot.agents.find((agent) => agent.id === 'coder');
    expect(snapshotCoder).toMatchObject({
      modelRef: 'moonshot/kimi-k2.6',
      overrideModelRef: null,
      inheritedModel: true,
    });
  });

  it('updates the shared compaction floor only when the default conversation model changes', async () => {
    await writeOpenClawJson({
      models: { providers: {
        openai: { models: [{ id: 'gpt-5.6-luna', contextWindow: 272_000 }] },
        deepseek: { models: [{ id: 'deepseek-chat', contextWindow: 400_000 }] },
      } },
      agents: {
        defaults: {
          model: { primary: 'openai/gpt-5.6-luna' },
          compaction: { mode: 'safeguard', reserveTokensFloor: 68_000 },
        },
        list: [{ id: 'main', default: true }, { id: 'coder' }],
      },
    });
    const { updateAgentModel, updateDefaultModels } = await import('@electron/utils/agent-config');
    const readFloor = async () => {
      const config = await readOpenClawJson();
      return (config.agents as { defaults: { compaction: { reserveTokensFloor: number } } })
        .defaults.compaction.reserveTokensFloor;
    };

    const overridden = await updateAgentModel('coder', 'deepseek/deepseek-chat');
    expect(overridden.agents.find((agent) => agent.id === 'coder')?.contextWindow).toBe(400_000);
    expect(await readFloor()).toBe(68_000);
    const inherited = await updateAgentModel('coder', null);
    expect(inherited.agents.find((agent) => agent.id === 'coder')?.contextWindow).toBe(272_000);
    expect(await readFloor()).toBe(68_000);
    await updateAgentModel('main', 'deepseek/deepseek-chat');
    expect(await readFloor()).toBe(68_000);
    await updateAgentModel('coder', 'deepseek/deepseek-chat', 'imageModel');
    expect(await readFloor()).toBe(68_000);
    await updateDefaultModels({ imageModel: 'deepseek/deepseek-chat' });
    expect(await readFloor()).toBe(68_000);
    await updateDefaultModels({ model: 'deepseek/deepseek-chat' });
    expect(await readFloor()).toBe(100_000);
    await updateDefaultModels({ model: 'openai/gpt-5.6-luna' });
    expect(await readFloor()).toBe(68_000);
    await updateDefaultModels({ model: null });
    expect(await readFloor()).toBe(50_000);
  });

  it('updates skills on a single agent without affecting others', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true, skills: ['pdf'] },
          { id: 'coder', name: 'Coder', skills: ['docx'] },
        ],
      },
    });

    const { updateAgentSkills, listAgentsSnapshot } = await import('@electron/utils/agent-config');
    await updateAgentSkills('coder', ['pdf', 'xlsx']);

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.agents.find((agent) => agent.id === 'main')?.skills).toEqual(['pdf']);
    expect(snapshot.agents.find((agent) => agent.id === 'coder')?.skills).toEqual(['pdf', 'xlsx']);
  });

  it('rejects invalid model ref formats when updating agent model', async () => {
    await writeOpenClawJson({
      agents: {
        list: [{ id: 'main', name: 'Main', default: true }],
      },
    });

    const { updateAgentModel } = await import('@electron/utils/agent-config');

    await expect(updateAgentModel('main', 'invalid-model-ref')).rejects.toThrow(
      'modelRef must be in "provider/model" format',
    );
  });

  it('prunes stale custom runtime model overrides when listing agents', async () => {
    await writeOpenClawJson({
      models: {
        providers: {
          'minimax-portal': {
            baseUrl: 'https://api.minimax.io/anthropic',
            api: 'anthropic-messages',
          },
        },
      },
      agents: {
        defaults: {
          model: {
            primary: 'minimax-portal/MiniMax-M3',
          },
        },
        list: [
          { id: 'main', name: 'Main', default: true, model: { primary: 'custom-custom0a/gpt-5.5' } },
          { id: 'coder', name: 'Coder', model: { primary: 'ark/ark-code-latest' } },
        ],
      },
    });

    // minimax-portal + ark are configured; custom-custom0a was deleted.
    await setProviderAccounts([
      { vendorId: 'minimax-portal', id: 'minimax-portal' },
      { vendorId: 'ark', id: 'ark' },
    ]);

    const { listAgentsSnapshot } = await import('@electron/utils/agent-config');
    const snapshot = await listAgentsSnapshot();
    const config = await readOpenClawJson();
    const main = snapshot.agents.find((agent) => agent.id === 'main');
    const coder = snapshot.agents.find((agent) => agent.id === 'coder');
    const mainEntry = ((config.agents as { list: Array<{ id: string; model?: unknown }> }).list)
      .find((agent) => agent.id === 'main');
    const coderEntry = ((config.agents as { list: Array<{ id: string; model?: { primary?: string } }> }).list)
      .find((agent) => agent.id === 'coder');

    expect(main).toMatchObject({
      modelRef: 'minimax-portal/MiniMax-M3',
      overrideModelRef: null,
      inheritedModel: true,
    });
    expect(coder).toMatchObject({
      modelRef: 'ark/ark-code-latest',
      overrideModelRef: 'ark/ark-code-latest',
    });
    expect(mainEntry?.model).toBeUndefined();
    expect(coderEntry?.model?.primary).toBe('ark/ark-code-latest');
  });

  it('prunes stale global default refs for a deleted built-in provider across all model kinds', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: { primary: 'ark/ark-text' },
          musicGenerationModel: { primary: 'minimax-portal/music-2.6' },
          videoGenerationModel: { primary: 'minimax-portal/MiniMax-Hailuo-2.3' },
        },
        list: [{ id: 'main', name: 'Main', default: true }],
      },
    });

    // ark stays configured; minimax-portal was deleted.
    await setProviderAccounts([{ vendorId: 'ark', id: 'ark' }]);

    const { listAgentsSnapshot } = await import('@electron/utils/agent-config');
    const snapshot = await listAgentsSnapshot();
    const config = await readOpenClawJson();
    const defaults = (config.agents as { defaults?: Record<string, unknown> }).defaults ?? {};

    expect(snapshot.defaultModelRef).toBe('ark/ark-text');
    expect(snapshot.defaultMusicGenerationModelRef).toBeNull();
    expect(snapshot.defaultVideoGenerationModelRef).toBeNull();
    expect(defaults.model).toBeDefined();
    expect(defaults.musicGenerationModel).toBeUndefined();
    expect(defaults.videoGenerationModel).toBeUndefined();
  });

  it('prunes a deleted custom provider from both defaults and per-agent overrides', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: { imageGenerationModel: { primary: 'custom-deadbeef/img' } },
        list: [
          { id: 'main', name: 'Main', default: true, model: { primary: 'custom-deadbeef/chat' } },
          { id: 'coder', name: 'Coder', model: { primary: 'ark/ark-code-latest' } },
        ],
      },
    });

    await setProviderAccounts([{ vendorId: 'ark', id: 'ark' }]);

    const { listAgentsSnapshot } = await import('@electron/utils/agent-config');
    const snapshot = await listAgentsSnapshot();
    const config = await readOpenClawJson();
    const defaults = (config.agents as { defaults?: Record<string, unknown> }).defaults ?? {};
    const main = snapshot.agents.find((agent) => agent.id === 'main');
    const coder = snapshot.agents.find((agent) => agent.id === 'coder');

    expect(snapshot.defaultImageGenerationModelRef).toBeNull();
    expect(defaults.imageGenerationModel).toBeUndefined();
    expect(main?.overrideModelRef).toBeNull();
    expect(coder?.overrideModelRef).toBe('ark/ark-code-latest');
  });

  it('keeps refs when another account still maps to the same runtime key', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: { model: { primary: 'ark/ark-text' } },
        list: [{ id: 'main', name: 'Main', default: true, model: { primary: 'ark/ark-text' } }],
      },
    });

    // Two ark accounts share runtime key 'ark'; deleting one leaves it valid.
    await setProviderAccounts([
      { vendorId: 'ark', id: 'ark' },
      { vendorId: 'ark', id: 'ark' },
    ]);

    const { listAgentsSnapshot } = await import('@electron/utils/agent-config');
    const snapshot = await listAgentsSnapshot();

    expect(snapshot.defaultModelRef).toBe('ark/ark-text');
    expect(snapshot.agents.find((agent) => agent.id === 'main')?.overrideModelRef).toBe('ark/ark-text');
  });

  it('does not prune agent overrides keyed by provider account id', async () => {
    const accountId = 'clawserverglm51-clawserv';
    await writeOpenClawJson({
      agents: {
        defaults: { model: { primary: 'glm52/GLM52' } },
        list: [
          {
            id: 'dev-agent',
            name: 'Dev',
            model: { primary: `${accountId}/Kimi-K2.6` },
          },
        ],
      },
    });

    await setProviderAccounts([{ vendorId: 'custom', id: accountId }]);

    const { listAgentsSnapshot } = await import('@electron/utils/agent-config');
    const snapshot = await listAgentsSnapshot();
    const config = await readOpenClawJson();
    const devEntry = ((config.agents as { list: Array<{ id: string; model?: { primary?: string } }> }).list)
      .find((agent) => agent.id === 'dev-agent');

    expect(snapshot.agents.find((agent) => agent.id === 'dev-agent')?.overrideModelRef)
      .toBe(`${accountId}/Kimi-K2.6`);
    expect(devEntry?.model?.primary).toBe(`${accountId}/Kimi-K2.6`);
  });

  it('removes stale fallbacks while keeping a valid primary', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: {
            primary: 'ark/ark-text',
            fallbacks: ['custom-deadbeef/old', 'ark/ark-text-mini'],
          },
        },
        list: [{ id: 'main', name: 'Main', default: true }],
      },
    });

    await setProviderAccounts([{ vendorId: 'ark', id: 'ark' }]);

    const { listAgentsSnapshot } = await import('@electron/utils/agent-config');
    await listAgentsSnapshot();
    const config = await readOpenClawJson();
    const modelCfg = (config.agents as { defaults?: { model?: { primary?: string; fallbacks?: string[] } } })
      .defaults?.model;

    expect(modelCfg?.primary).toBe('ark/ark-text');
    expect(modelCfg?.fallbacks).toEqual(['ark/ark-text-mini']);
  });

  it('does not prune any refs when no provider accounts are loaded', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: { model: { primary: 'custom-deadbeef/chat' } },
        list: [{ id: 'main', name: 'Main', default: true, model: { primary: 'custom-deadbeef/chat' } }],
      },
    });

    // Default mock returns [] — the guard must skip pruning entirely.
    const { listAgentsSnapshot } = await import('@electron/utils/agent-config');
    const snapshot = await listAgentsSnapshot();
    const config = await readOpenClawJson();
    const mainEntry = ((config.agents as { list: Array<{ id: string; model?: { primary?: string } }> }).list)
      .find((agent) => agent.id === 'main');

    expect(snapshot.defaultModelRef).toBe('custom-deadbeef/chat');
    expect(mainEntry?.model?.primary).toBe('custom-deadbeef/chat');
  });

  it('deletes the config entry, bindings, runtime directory, and managed workspace for a removed agent', async () => {
    await writeOpenClawJson({
      agents: {
        defaults: {
          model: {
            primary: 'custom-custom27/MiniMax-M2.7',
            fallbacks: [],
          },
        },
        list: [
          {
            id: 'main',
            name: 'Main',
            default: true,
            workspace: '~/.openclaw/workspace',
            agentDir: '~/.openclaw/agents/main/agent',
          },
          {
            id: 'test2',
            name: 'test2',
            workspace: '~/.openclaw/workspace-test2',
            agentDir: '~/.openclaw/agents/test2/agent',
          },
          {
            id: 'test3',
            name: 'test3',
            workspace: '~/.openclaw/workspace-test3',
            agentDir: '~/.openclaw/agents/test3/agent',
          },
        ],
      },
      channels: {
        feishu: {
          enabled: true,
        },
      },
      bindings: [
        {
          agentId: 'test2',
          match: {
            channel: 'feishu',
          },
        },
      ],
    });

    const test2RuntimeDir = join(testHome, '.openclaw', 'agents', 'test2');
    const test2WorkspaceDir = join(testHome, '.openclaw', 'workspace-test2');
    await mkdir(join(test2RuntimeDir, 'agent'), { recursive: true });
    await mkdir(join(test2RuntimeDir, 'sessions'), { recursive: true });
    await mkdir(join(test2WorkspaceDir, '.openclaw'), { recursive: true });
    await writeFile(
      join(test2RuntimeDir, 'agent', 'auth-profiles.json'),
      JSON.stringify({ version: 1, profiles: {} }, null, 2),
      'utf8',
    );
    await writeFile(join(test2WorkspaceDir, 'AGENTS.md'), '# test2', 'utf8');

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const {
      deleteAgentConfig,
      removeAgentWorkspaceDirectory,
    } = await import('@electron/utils/agent-config');

    const { snapshot, removedEntry } = await deleteAgentConfig('test2');

    expect(snapshot.agents.map((agent) => agent.id)).toEqual(['main', 'test3']);
    expect(snapshot.channelOwners.feishu).toBe('main');

    const config = await readOpenClawJson();
    expect((config.agents as { list: Array<{ id: string }> }).list.map((agent) => agent.id)).toEqual([
      'main',
      'test3',
    ]);
    expect(config.bindings).toEqual([]);
    await expect(access(test2RuntimeDir)).rejects.toThrow();
    // Workspace deletion is intentionally deferred by `deleteAgentConfig` to avoid
    // ENOENT errors during Gateway restart, so it should still exist here.
    await expect(access(test2WorkspaceDir)).resolves.toBeUndefined();

    await expect(removeAgentWorkspaceDirectory(removedEntry))
      .resolves.toBe(test2WorkspaceDir);
    await expect(access(test2WorkspaceDir)).rejects.toThrow();

    infoSpy.mockRestore();
  });

  it('treats an explicit empty agents.list as an empty snapshot', async () => {
    await writeOpenClawJson({
      agents: {
        list: [],
      },
    });

    const { listAgentsSnapshot, listConfiguredAgentIds } = await import('@electron/utils/agent-config');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.agents).toEqual([]);
    expect(snapshot.defaultAgentId).toBe('');
    await expect(listConfiguredAgentIds()).resolves.toEqual([]);
  });

  it('allows deleting the last main agent and persists an empty list', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          {
            id: 'main',
            name: 'Main',
            default: true,
            workspace: '~/.openclaw/workspace',
            agentDir: '~/.openclaw/agents/main/agent',
          },
        ],
      },
    });
    await mkdir(join(testHome, '.openclaw', 'agents', 'main', 'agent'), { recursive: true });

    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const { deleteAgentConfig } = await import('@electron/utils/agent-config');

    const { snapshot } = await deleteAgentConfig('main');

    expect(snapshot.agents).toEqual([]);
    expect(snapshot.defaultAgentId).toBe('');
    const config = await readOpenClawJson();
    expect((config.agents as { list?: unknown[] }).list).toEqual([]);
    await expect(access(join(testHome, '.openclaw', 'agents', 'main'))).rejects.toThrow();

    infoSpy.mockRestore();
  });

  it('marks the first agent created from an empty list as default', async () => {
    await writeOpenClawJson({
      agents: {
        list: [],
      },
    });

    const { createAgent } = await import('@electron/utils/agent-config');

    const snapshot = await createAgent('First Agent');

    expect(snapshot.agents.map((agent) => ({ id: agent.id, isDefault: agent.isDefault }))).toEqual([
      { id: 'first-agent', isDefault: true },
    ]);
    expect(snapshot.defaultAgentId).toBe('first-agent');
    const config = await readOpenClawJson();
    expect((config.agents as { list?: Array<{ id: string; default?: boolean }> }).list).toEqual([
      expect.objectContaining({ id: 'first-agent', default: true }),
    ]);
  });

  it('preserves unmanaged custom workspaces when deleting an agent', async () => {
    const customWorkspaceDir = join(testHome, 'custom-workspace-test2');

    await writeOpenClawJson({
      agents: {
        list: [
          {
            id: 'main',
            name: 'Main',
            default: true,
            workspace: '~/.openclaw/workspace',
            agentDir: '~/.openclaw/agents/main/agent',
          },
          {
            id: 'test2',
            name: 'test2',
            workspace: customWorkspaceDir,
            agentDir: '~/.openclaw/agents/test2/agent',
          },
        ],
      },
    });

    await mkdir(join(testHome, '.openclaw', 'agents', 'test2', 'agent'), { recursive: true });
    await mkdir(customWorkspaceDir, { recursive: true });
    await writeFile(join(customWorkspaceDir, 'AGENTS.md'), '# custom', 'utf8');

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const {
      deleteAgentConfig,
      removeAgentWorkspaceDirectory,
    } = await import('@electron/utils/agent-config');

    const { removedEntry } = await deleteAgentConfig('test2');
    await expect(removeAgentWorkspaceDirectory(removedEntry)).resolves.toBeNull();

    await expect(access(customWorkspaceDir)).resolves.toBeUndefined();

    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it('does not delete a legacy-named account when it is owned by another agent', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'test2', name: 'test2' },
          { id: 'test3', name: 'test3' },
        ],
      },
      channels: {
        feishu: {
          enabled: true,
          defaultAccount: 'default',
          accounts: {
            default: { enabled: true, appId: 'main-app' },
            test2: { enabled: true, appId: 'legacy-test2-app' },
          },
        },
      },
      bindings: [
        {
          agentId: 'test3',
          match: {
            channel: 'feishu',
            accountId: 'test2',
          },
        },
      ],
    });

    const { deleteAgentConfig } = await import('@electron/utils/agent-config');
    await deleteAgentConfig('test2');

    const config = await readOpenClawJson();
    const feishu = (config.channels as Record<string, unknown>).feishu as {
      accounts?: Record<string, unknown>;
    };
    expect(feishu.accounts?.test2).toBeDefined();
  });

  it('allows the same agent to bind multiple different channels', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
        ],
      },
      channels: {
        feishu: { enabled: true },
        telegram: { enabled: true },
      },
    });

    const { assignChannelAccountToAgent, listAgentsSnapshot } = await import('@electron/utils/agent-config');

    await assignChannelAccountToAgent('main', 'feishu', 'default');
    await assignChannelAccountToAgent('main', 'telegram', 'default');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.channelAccountOwners['feishu:default']).toBe('main');
    expect(snapshot.channelAccountOwners['telegram:default']).toBe('main');
  });

  it('keeps sibling account bindings for the same agent and channel', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
        ],
      },
      channels: {
        feishu: {
          enabled: true,
          defaultAccount: 'default',
          accounts: {
            default: { enabled: true, appId: 'main-app' },
            alt: { enabled: true, appId: 'alt-app' },
          },
        },
      },
    });

    const { assignChannelAccountToAgent, listAgentsSnapshot } = await import('@electron/utils/agent-config');

    await assignChannelAccountToAgent('main', 'feishu', 'default');
    await assignChannelAccountToAgent('main', 'feishu', 'alt');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.channelAccountOwners['feishu:default']).toBe('main');
    expect(snapshot.channelAccountOwners['feishu:alt']).toBe('main');
  });

  it('preserves original agentId casing when persisting bindings', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'MainAgent', name: 'Main Agent', default: true },
        ],
      },
      channels: {
        feishu: {
          enabled: true,
          accounts: {
            default: { enabled: true, appId: 'main-app' },
          },
        },
      },
    });

    const { assignChannelAccountToAgent } = await import('@electron/utils/agent-config');

    await assignChannelAccountToAgent('MainAgent', 'feishu', 'default');

    const config = await readOpenClawJson();
    expect(config.bindings).toEqual([
      {
        agentId: 'MainAgent',
        match: { channel: 'feishu', accountId: 'default' },
      },
    ]);
  });

  it('keeps a single owner for the same channel account', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'test2', name: 'test2' },
        ],
      },
      channels: {
        feishu: {
          enabled: true,
          accounts: {
            default: { enabled: true, appId: 'main-app' },
          },
        },
      },
    });

    const { assignChannelAccountToAgent, listAgentsSnapshot } = await import('@electron/utils/agent-config');

    await assignChannelAccountToAgent('main', 'feishu', 'default');
    await assignChannelAccountToAgent('test2', 'feishu', 'default');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.channelAccountOwners['feishu:default']).toBe('test2');
  });

  it('can clear one channel account binding without affecting another channel on the same agent', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
        ],
      },
      channels: {
        feishu: { enabled: true },
        telegram: { enabled: true },
      },
    });

    const { assignChannelAccountToAgent, clearChannelBinding, listAgentsSnapshot } = await import('@electron/utils/agent-config');

    await assignChannelAccountToAgent('main', 'feishu', 'default');
    await assignChannelAccountToAgent('main', 'telegram', 'default');
    await clearChannelBinding('feishu', 'default');

    const snapshot = await listAgentsSnapshot();
    expect(snapshot.channelAccountOwners['feishu:default']).toBeUndefined();
    expect(snapshot.channelAccountOwners['telegram:default']).toBe('main');
  });

  it('avoids numeric-only ids when creating agents from CJK names', async () => {
    await writeOpenClawJson({
      agents: {
        list: [{ id: 'main', name: 'Main', default: true }],
      },
    });

    const { createAgent, listAgentsSnapshot } = await import('@electron/utils/agent-config');

    await createAgent('测试2');
    await createAgent('测试1');

    const snapshot = await listAgentsSnapshot();
    const agentIds = snapshot.agents.map((agent) => agent.id);

    expect(agentIds).toContain('ce-shi-2');
    expect(agentIds).toContain('ce-shi-1');
    expect(agentIds).not.toContain('2');
    expect(agentIds).not.toContain('1');
  });

  it('moves default flag when setDefaultAgent is called', async () => {
    await writeOpenClawJson({
      agents: {
        list: [
          { id: 'main', name: 'Main', default: true },
          { id: 'coding-helper', name: 'Coding helper' },
        ],
      },
    });

    const { setDefaultAgent, listAgentsSnapshot } = await import('@electron/utils/agent-config');

    const after = await setDefaultAgent('coding-helper');
    expect(after.defaultAgentId).toBe('coding-helper');
    expect(after.agents.find((a) => a.id === 'main')?.isDefault).toBe(false);
    expect(after.agents.find((a) => a.id === 'coding-helper')?.isDefault).toBe(true);

    const disk = await readOpenClawJson();
    const list = (disk.agents as { list: Array<{ id: string; default?: boolean }> }).list;
    expect(list.find((e) => e.id === 'coding-helper')?.default).toBe(true);
    expect(list.find((e) => e.id === 'main')?.default).toBeUndefined();

    const snap = await listAgentsSnapshot();
    expect(snap.defaultAgentId).toBe('coding-helper');
  });
});
