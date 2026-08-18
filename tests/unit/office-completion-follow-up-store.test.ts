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
    featureDescription: 'feat',
    description: '',
    status: 'running',
    executionMode: 'smart',
    workflowEngine: 'dag',
    workflow: { mode: 'dag', nodes: [], edges: [] },
    nodeRuns: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('office completion follow-up store', () => {
  beforeEach(async () => {
    persistEnv.dataDir = await mkdtemp(join(tmpdir(), 'office-completion-store-'));
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

  it('stamps lastRunCompletedAt on upsert when status becomes completed', async () => {
    const { saveStore, upsertTempProject, drainOfficeStoreOpsForTests } = await import(
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

    const saved = await upsertTempProject({
      ...baseProject(),
      status: 'completed',
    });
    expect(saved.lastRunCompletedAt).toBeGreaterThan(0);
    expect(saved.completionFollowUpHandledAt).toBeUndefined();
  });

  it('dismissCompletionFollowUp marks handledAt for current run', async () => {
    const { saveStore, upsertTempProject, dismissCompletionFollowUp, drainOfficeStoreOpsForTests } =
      await import('@electron/services/office/store');
    const store: OfficeDataStore = {
      version: 2,
      fixedGroups: [],
      tempProjects: [baseProject({ status: 'completed', lastRunCompletedAt: 5_000 })],
      agentBindings: {},
      roomMessages: {},
      settings: { agentToAgentEnabled: false, agentToAgentAllow: [] },
    };
    await saveStore(store);
    await drainOfficeStoreOpsForTests();

    const completed = await upsertTempProject({
      ...store.tempProjects[0]!,
      status: 'completed',
    });
    const dismissed = await dismissCompletionFollowUp(completed.id);
    expect(dismissed.completionFollowUpHandledAt).toBeGreaterThanOrEqual(
      dismissed.lastRunCompletedAt ?? 0,
    );
  });
});
