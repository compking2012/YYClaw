import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { OfficeDataStore, OfficeTempProject } from '../../electron/services/office/types';

const persistEnv = vi.hoisted(() => ({ dataDir: '' }));

vi.mock('../../electron/services/office/paths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../electron/services/office/paths')>();
  return {
    ...actual,
    getOfficeDataDir: () => persistEnv.dataDir,
    getOfficeDataPath: () => join(persistEnv.dataDir, 'data.json'),
  };
});

function baseProject(overrides: Partial<OfficeTempProject> = {}): OfficeTempProject {
  const now = Date.now();
  return {
    id: 'project-1',
    title: '示例项目',
    origin: 'standalone',
    agentIds: ['agent-a'],
    coordinatorAgentId: 'agent-a',
    lifecycle: 'active',
    featureDescription: '旧功能描述',
    description: '',
    status: 'pending',
    executionMode: 'smart',
    workflowEngine: 'dag',
    workflow: { mode: 'dag', nodes: [], edges: [] },
    nodeRuns: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('office project featureDescription save', () => {
  beforeEach(async () => {
    persistEnv.dataDir = await mkdtemp(join(tmpdir(), 'office-feat-save-'));
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
  });

  it('persists featureDescription via upsertTempProject', async () => {
    const { saveStore, upsertTempProject, getSnapshot, drainOfficeStoreOpsForTests } = await import(
      '@electron/services/office/store'
    );
    const store: OfficeDataStore = {
      version: 2,
      fixedGroups: [],
      tempProjects: [baseProject()],
      agentBindings: {},
      roomMessages: {},
      settings: { agentToAgentEnabled: false, agentToAgentAllow: [] },
    };
    await saveStore(store);
    await drainOfficeStoreOpsForTests();

    const updated = await upsertTempProject({
      ...baseProject(),
      featureDescription: '新功能描述',
    });
    expect(updated.featureDescription).toBe('新功能描述');

    const snapshot = await getSnapshot();
    expect(snapshot.tempProjects.find((p) => p.id === 'project-1')?.featureDescription).toBe(
      '新功能描述',
    );
  });

  it('preserves featureDescription on archived-restart active project', async () => {
    const { saveStore, upsertTempProject, getSnapshot, drainOfficeStoreOpsForTests } = await import(
      '@electron/services/office/store'
    );
    const restartedAt = Date.now();
    const store: OfficeDataStore = {
      version: 2,
      fixedGroups: [],
      tempProjects: [
        baseProject({
          archivedRestartedAt: restartedAt,
          status: 'pending',
          executionMode: 'workflow',
          description: '1. 开发\n2. 测试',
          workflow: {
            mode: 'dag',
            nodes: [{ id: 'n1', title: '开发', agentIds: ['agent-a'] }],
            edges: [],
          },
        }),
      ],
      agentBindings: {},
      roomMessages: {},
      settings: { agentToAgentEnabled: false, agentToAgentAllow: [] },
    };
    await saveStore(store);
    await drainOfficeStoreOpsForTests();

    await upsertTempProject({
      ...store.tempProjects[0]!,
      featureDescription: '归档重启后更新的功能描述',
    });

    const snapshot = await getSnapshot();
    expect(snapshot.tempProjects[0]?.featureDescription).toBe('归档重启后更新的功能描述');
    expect(snapshot.tempProjects[0]?.archivedRestartedAt).toBe(restartedAt);
  });
});
