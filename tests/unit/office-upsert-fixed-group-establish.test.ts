import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rebuildAgentBindings } from '../../electron/services/office/agent-binding';
import type { OfficeDataStore, OfficeFixedGroup } from '../../electron/services/office/types';

const persistEnv = vi.hoisted(() => ({ dataDir: '', openclawHome: '' }));
const establishOfficeAgentsInOpenClaw = vi.hoisted(() => vi.fn(async () => {}));

vi.mock('@electron/services/office/office-openclaw-establish', () => ({
  establishOfficeAgentsInOpenClaw,
}));

vi.mock('@electron/utils/openclaw-paths', () => ({
  OPENCLAW_HOME: persistEnv.openclawHome,
}));

vi.mock('../../electron/utils/agent-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../electron/utils/agent-config')>();
  return {
    ...actual,
    readAgentIdsFromOpenClawConfig: vi.fn(async () => new Set(['agent-a', 'agent-b'])),
  };
});

vi.mock('../../electron/services/office/paths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../electron/services/office/paths')>();
  return {
    ...actual,
    getOfficeDataDir: () => persistEnv.dataDir,
    getOfficeDataPath: () => join(persistEnv.dataDir, 'data.json'),
  };
});

const now = Date.now();

function baseGroup(overrides: Partial<OfficeFixedGroup> = {}): OfficeFixedGroup {
  return {
    id: 'group-1',
    name: '研发团队',
    agentIds: ['agent-a'],
    coordinatorAgentId: 'agent-a',
    workflowDescription: '组工作流描述',
    workflow: {
      mode: 'dag',
      nodes: [{ id: 'n1', title: '组步骤', agentIds: ['agent-a'] }],
      edges: [],
    },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function baseStore(overrides: Partial<OfficeDataStore> = {}): OfficeDataStore {
  const merged: OfficeDataStore = {
    version: 2,
    fixedGroups: [baseGroup()],
    tempProjects: [],
    agentBindings: {},
    roomMessages: {},
    settings: { agentToAgentEnabled: false, agentToAgentAllow: [] },
    ...overrides,
  };
  merged.agentBindings = rebuildAgentBindings(merged);
  return merged;
}

describe('upsertFixedGroup openclaw write policy', () => {
  beforeEach(async () => {
    persistEnv.dataDir = await mkdtemp(join(tmpdir(), 'office-upsert-group-'));
    persistEnv.openclawHome = await mkdtemp(join(tmpdir(), 'office-upsert-openclaw-'));
    establishOfficeAgentsInOpenClaw.mockClear();
    const { clearOfficeStoreCacheForTests, drainOfficeStoreOpsForTests } = await import(
      '@electron/services/office/store'
    );
    clearOfficeStoreCacheForTests();
    await drainOfficeStoreOpsForTests();
  });

  afterEach(async () => {
    const { clearOfficeStoreCacheForTests, drainOfficeStoreOpsForTests } = await import(
      '@electron/services/office/store'
    );
    clearOfficeStoreCacheForTests();
    await drainOfficeStoreOpsForTests();
    await rm(persistEnv.dataDir, { recursive: true, force: true });
    await rm(persistEnv.openclawHome, { recursive: true, force: true });
  });

  it('does not establish agents when creating a new fixed group', async () => {
    const { saveStore, upsertFixedGroup } = await import('@electron/services/office/store');
    await saveStore(baseStore({ fixedGroups: [] }));

    await upsertFixedGroup(baseGroup({ id: 'group-new', agentIds: ['agent-a', 'agent-b'] }));

    expect(establishOfficeAgentsInOpenClaw).not.toHaveBeenCalled();
  });

  it('does not establish when editing a group to add agents', async () => {
    const { saveStore, upsertFixedGroup } = await import('@electron/services/office/store');
    await saveStore(baseStore());

    await upsertFixedGroup(baseGroup({
      agentIds: ['agent-a', 'agent-b'],
      coordinatorAgentId: 'agent-a',
    }));

    expect(establishOfficeAgentsInOpenClaw).not.toHaveBeenCalled();
  });

  it('does not establish when spawning from a group', async () => {
    const { saveStore, spawnProjectFromGroup } = await import('@electron/services/office/store');
    await saveStore(baseStore({
      fixedGroups: [
        baseGroup({
          agentIds: ['agent-a', 'agent-b'],
          coordinatorAgentId: 'agent-a',
        }),
      ],
    }));

    const project = await spawnProjectFromGroup({
      groupId: 'group-1',
      title: '派出项目',
      agentIds: ['agent-b'],
      coordinatorAgentId: 'agent-b',
      featureDescription: '实现一个功能',
    });

    expect(project.agentIds).toEqual(['agent-b']);
    expect(establishOfficeAgentsInOpenClaw).not.toHaveBeenCalled();
  });
});
