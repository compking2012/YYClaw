import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rebuildAgentBindings } from '../../electron/services/office/agent-binding';
import type { OfficeDataStore, OfficeFixedGroup, OfficeTempProject } from '../../electron/services/office/types';

const persistEnv = vi.hoisted(() => ({ dataDir: '' }));

vi.mock('../../electron/utils/agent-config', () => ({
  listAgentsSnapshot: vi.fn(async () => ({
    agents: [
      { id: 'agent-a', name: 'Agent A' },
      { id: 'agent-b', name: 'Agent B' },
    ],
  })),
  readAgentIdsFromOpenClawConfig: vi.fn(async () => new Set(['agent-a', 'agent-b'])),
}));

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
    agentIds: ['agent-a', 'agent-b'],
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

function spawnedProject(overrides: Partial<OfficeTempProject> = {}): OfficeTempProject {
  return {
    id: 'proj-1',
    title: '派出项目',
    origin: 'fixed_group',
    parentGroupId: 'group-1',
    inheritsGroupTemplate: true,
    agentIds: ['agent-a'],
    coordinatorAgentId: 'agent-a',
    lifecycle: 'archived',
    featureDescription: '功能范围',
    description: '',
    status: 'completed',
    executionMode: 'workflow',
    workflow: { mode: 'dag', nodes: [], edges: [] },
    nodeRuns: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function baseStore(overrides: Partial<OfficeDataStore> = {}): OfficeDataStore {
  const merged: OfficeDataStore = {
    version: 2,
    fixedGroups: [baseGroup()],
    tempProjects: [spawnedProject()],
    agentBindings: {},
    roomMessages: {},
    settings: { agentToAgentEnabled: false, agentToAgentAllow: [] },
    ...overrides,
  };
  merged.agentBindings = rebuildAgentBindings(merged);
  return merged;
}

describe('deleteFixedGroup orphans child projects', () => {
  beforeEach(async () => {
    persistEnv.dataDir = await mkdtemp(join(tmpdir(), 'office-delete-group-'));
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

  it('converts archived spawned projects to standalone when group is deleted', async () => {
    const { saveStore, deleteFixedGroup, getSnapshot, drainOfficeStoreOpsForTests } = await import(
      '@electron/services/office/store'
    );
    await saveStore(baseStore());
    await drainOfficeStoreOpsForTests();

    await deleteFixedGroup('group-1');
    await drainOfficeStoreOpsForTests();

    const snapshot = await getSnapshot();
    expect(snapshot.fixedGroups).toHaveLength(0);
    const project = snapshot.tempProjects.find((p) => p.id === 'proj-1');
    expect(project?.origin).toBe('standalone');
    expect(project?.parentGroupId).toBeUndefined();
    expect(project?.inheritsGroupTemplate).toBe(false);
    expect(project?.description).toBe('组工作流描述');
    expect(project?.workflow.nodes).toHaveLength(1);
    expect(project?.agentIds).toEqual(['agent-a', 'agent-b']);
  });

  it('deleteArchivedTempProject removes an archived standalone project record and leaves its agents unbound', async () => {
    const { saveStore, deleteArchivedTempProject, getSnapshot, drainOfficeStoreOpsForTests } =
      await import('@electron/services/office/store');
    await saveStore(
      baseStore({
        fixedGroups: [],
        tempProjects: [
          spawnedProject({
            origin: 'standalone',
            parentGroupId: undefined,
            inheritsGroupTemplate: false,
            lifecycle: 'completed',
            status: 'completed',
            agentIds: ['agent-a'],
            coordinatorAgentId: 'agent-a',
          }),
          spawnedProject({
            id: 'proj-keep',
            title: '保留项目',
            origin: 'standalone',
            parentGroupId: undefined,
            inheritsGroupTemplate: false,
            lifecycle: 'active',
            status: 'pending',
            agentIds: ['agent-b'],
            coordinatorAgentId: 'agent-b',
          }),
        ],
      }),
    );
    await drainOfficeStoreOpsForTests();

    await deleteArchivedTempProject('proj-1');
    await drainOfficeStoreOpsForTests();

    const after = await getSnapshot();
    expect(after.tempProjects.find((p) => p.id === 'proj-1')).toBeUndefined();
    expect(after.tempProjects.find((p) => p.id === 'proj-keep')).toBeDefined();
    // Archived project gone + no group → agent-a bound to nothing; the kept project keeps agent-b.
    expect(after.agentBindings['agent-a']).toBeUndefined();
    expect(after.agentBindings['agent-b']?.entityId).toBe('proj-keep');
  });

  it('archive → delete group → delete last archived project may empty the store', async () => {
    const {
      saveStore,
      deleteFixedGroup,
      deleteArchivedTempProject,
      getSnapshot,
      drainOfficeStoreOpsForTests,
    } = await import('@electron/services/office/store');
    await saveStore(baseStore());
    await drainOfficeStoreOpsForTests();

    await deleteFixedGroup('group-1');
    await drainOfficeStoreOpsForTests();
    await deleteArchivedTempProject('proj-1');
    await drainOfficeStoreOpsForTests();

    const after = await getSnapshot();
    expect(after.fixedGroups).toHaveLength(0);
    expect(after.tempProjects).toHaveLength(0);
  });

  it('deleteArchivedTempProject can remove the sole archived project leaving an empty store', async () => {
    const { saveStore, deleteArchivedTempProject, getSnapshot, drainOfficeStoreOpsForTests } =
      await import('@electron/services/office/store');
    await saveStore(
      baseStore({
        fixedGroups: [],
        tempProjects: [
          spawnedProject({
            origin: 'standalone',
            parentGroupId: undefined,
            inheritsGroupTemplate: false,
            lifecycle: 'completed',
            status: 'completed',
          }),
        ],
      }),
    );
    await drainOfficeStoreOpsForTests();

    await deleteArchivedTempProject('proj-1');
    await drainOfficeStoreOpsForTests();

    const after = await getSnapshot();
    expect(after.fixedGroups).toHaveLength(0);
    expect(after.tempProjects).toHaveLength(0);
  });

  it('deleteFixedGroup can remove the sole empty group leaving an empty store', async () => {
    const { saveStore, deleteFixedGroup, getSnapshot, drainOfficeStoreOpsForTests } = await import(
      '@electron/services/office/store'
    );
    await saveStore(baseStore({ tempProjects: [] }));
    await drainOfficeStoreOpsForTests();

    await deleteFixedGroup('group-1');
    await drainOfficeStoreOpsForTests();

    const after = await getSnapshot();
    expect(after.fixedGroups).toHaveLength(0);
    expect(after.tempProjects).toHaveLength(0);
  });

  it('saveStore still refuses to overwrite non-empty disk data with an empty store', async () => {
    const { saveStore, drainOfficeStoreOpsForTests } = await import('@electron/services/office/store');
    await saveStore(baseStore());
    await drainOfficeStoreOpsForTests();

    await expect(
      saveStore(
        baseStore({
          fixedGroups: [],
          tempProjects: [],
          agentBindings: {},
        }),
      ),
    ).rejects.toThrow(/Refusing to overwrite non-empty office data with an empty store/);
    await drainOfficeStoreOpsForTests();
  });

  it('deleteArchivedTempProject refuses a non-archived (active) project and keeps the record', async () => {
    const { saveStore, deleteArchivedTempProject, getSnapshot, drainOfficeStoreOpsForTests } =
      await import('@electron/services/office/store');
    await saveStore(
      baseStore({
        fixedGroups: [],
        tempProjects: [
          spawnedProject({
            origin: 'standalone',
            parentGroupId: undefined,
            inheritsGroupTemplate: false,
            lifecycle: 'active',
            status: 'pending',
            agentIds: ['agent-a'],
            coordinatorAgentId: 'agent-a',
          }),
        ],
      }),
    );
    await drainOfficeStoreOpsForTests();

    await expect(deleteArchivedTempProject('proj-1')).rejects.toThrow();
    await drainOfficeStoreOpsForTests();

    const after = await getSnapshot();
    expect(after.tempProjects.find((p) => p.id === 'proj-1')).toBeDefined();
  });

  it('converts all archived siblings from the same group', async () => {
    const { saveStore, deleteFixedGroup, getSnapshot, drainOfficeStoreOpsForTests } = await import(
      '@electron/services/office/store'
    );
    await saveStore(
      baseStore({
        tempProjects: [
          spawnedProject({ id: 'proj-1', title: '项目 A', sequence: 1 }),
          spawnedProject({
            id: 'proj-2',
            title: '项目 B',
            sequence: 2,
            inheritsGroupTemplate: false,
            description: '自定义描述',
            workflow: {
              mode: 'dag',
              nodes: [{ id: 'n2', title: '自定义步骤', agentIds: ['agent-a'] }],
              edges: [],
            },
          }),
        ],
      }),
    );
    await drainOfficeStoreOpsForTests();

    await deleteFixedGroup('group-1');
    await drainOfficeStoreOpsForTests();

    const snapshot = await getSnapshot();
    expect(snapshot.tempProjects).toHaveLength(2);
    for (const project of snapshot.tempProjects) {
      expect(project.origin).toBe('standalone');
      expect(project.parentGroupId).toBeUndefined();
    }
    const customized = snapshot.tempProjects.find((p) => p.id === 'proj-2');
    expect(customized?.description).toBe('自定义描述');
    expect(customized?.workflow.nodes[0]?.title).toBe('自定义步骤');
  });

  it('blocks delete when an active spawned project still exists', async () => {
    const { saveStore, deleteFixedGroup, drainOfficeStoreOpsForTests } = await import(
      '@electron/services/office/store'
    );
    await saveStore(
      baseStore({
        tempProjects: [spawnedProject({ lifecycle: 'active', status: 'pending' })],
      }),
    );
    await drainOfficeStoreOpsForTests();

    await expect(deleteFixedGroup('group-1')).rejects.toMatchObject({
      code: 'GROUP_HAS_ACTIVE_CHILD_PROJECT',
    });
  });

  it('blocks delete when active child only has parentGroupId linkage', async () => {
    const { saveStore, deleteFixedGroup, drainOfficeStoreOpsForTests } = await import(
      '@electron/services/office/store'
    );
    await saveStore(
      baseStore({
        tempProjects: [
          spawnedProject({
            origin: 'standalone',
            lifecycle: 'active',
            status: 'pending',
          }),
        ],
      }),
    );
    await drainOfficeStoreOpsForTests();

    await expect(deleteFixedGroup('group-1')).rejects.toMatchObject({
      code: 'GROUP_HAS_ACTIVE_CHILD_PROJECT',
    });
  });

  it('detaches orphaned children when group record is already missing', async () => {
    const { saveStore, deleteFixedGroup, getSnapshot, drainOfficeStoreOpsForTests } = await import(
      '@electron/services/office/store'
    );
    const drafts = [
      {
        input: '',
        agentIds: ['agent-a'],
        task: '已有步骤',
        output: '',
        linkMode: 'serial' as const,
      },
    ];
    await saveStore(
      baseStore({
        fixedGroups: [],
        tempProjects: [
          spawnedProject({
            inheritsGroupTemplate: true,
            description: '',
            workflow: { mode: 'dag', nodes: [], edges: [] },
            workflowStepDrafts: drafts,
          }),
        ],
      }),
    );
    await drainOfficeStoreOpsForTests();

    await deleteFixedGroup('group-1');
    await drainOfficeStoreOpsForTests();

    const project = (await getSnapshot()).tempProjects.find((p) => p.id === 'proj-1');
    expect(project?.origin).toBe('standalone');
    expect(project?.parentGroupId).toBeUndefined();
    expect(project?.workflowStepDrafts?.[0]?.task).toBe('已有步骤');
  });

  it('restart archived spawned project stays under group when group still exists', async () => {
    const { saveStore, restartArchivedTempProject, getSnapshot, drainOfficeStoreOpsForTests } =
      await import('@electron/services/office/store');
    await saveStore(
      baseStore({
        tempProjects: [
          spawnedProject({
            lifecycle: 'completed',
            status: 'completed',
            agentIds: ['agent-a'],
            coordinatorAgentId: 'agent-a',
          }),
        ],
      }),
    );
    await drainOfficeStoreOpsForTests();

    const { project: restarted, agentSync } = await restartArchivedTempProject('proj-1');
    expect(restarted.origin).toBe('fixed_group');
    expect(restarted.parentGroupId).toBe('group-1');
    expect(restarted.lifecycle).toBe('active');
    expect(restarted.agentIds).toEqual(['agent-a', 'agent-b']);
    expect(agentSync).toMatchObject({
      groupId: 'group-1',
      addedAgentIds: ['agent-b'],
      removedAgentIds: [],
      changed: true,
    });

    const snapshot = await getSnapshot();
    expect(snapshot.tempProjects[0]?.origin).toBe('fixed_group');
  });

  it('restart archived spawned project becomes standalone when group was deleted', async () => {
    const { saveStore, deleteFixedGroup, restartArchivedTempProject, getSnapshot, drainOfficeStoreOpsForTests } =
      await import('@electron/services/office/store');
    await saveStore(
      baseStore({
        tempProjects: [
          spawnedProject({
            lifecycle: 'completed',
            status: 'completed',
            agentIds: ['agent-a'],
            coordinatorAgentId: 'agent-a',
          }),
        ],
      }),
    );
    await drainOfficeStoreOpsForTests();
    await deleteFixedGroup('group-1');
    await drainOfficeStoreOpsForTests();

    const { project: restarted } = await restartArchivedTempProject('proj-1');
    expect(restarted.origin).toBe('standalone');
    expect(restarted.parentGroupId).toBeUndefined();
    expect(restarted.lifecycle).toBe('active');

    const snapshot = await getSnapshot();
    const project = snapshot.tempProjects.find((p) => p.id === 'proj-1');
    expect(project?.origin).toBe('standalone');
    expect(project?.lifecycle).toBe('active');
  });

  it('restart orphaned spawned project preserves workflowStepDrafts when group record is gone', async () => {
    const { saveStore, restartArchivedTempProject, getSnapshot, drainOfficeStoreOpsForTests } =
      await import('@electron/services/office/store');
    const drafts = [
      {
        input: '',
        agentIds: ['agent-a'],
        task: '归档步骤',
        output: '',
        linkMode: 'serial' as const,
      },
    ];
    await saveStore(
      baseStore({
        fixedGroups: [],
        tempProjects: [
          spawnedProject({
            lifecycle: 'completed',
            status: 'completed',
            inheritsGroupTemplate: true,
            description: '',
            workflow: { mode: 'dag', nodes: [], edges: [] },
            workflowStepDrafts: drafts,
          }),
        ],
      }),
    );
    await drainOfficeStoreOpsForTests();

    const { project: restarted } = await restartArchivedTempProject('proj-1');
    expect(restarted.origin).toBe('standalone');
    expect(restarted.parentGroupId).toBeUndefined();
    expect(restarted.workflowStepDrafts?.[0]?.task).toBe('归档步骤');
    expect(restarted.lifecycle).toBe('active');

    const snapshot = await getSnapshot();
    expect(snapshot.tempProjects[0]?.origin).toBe('standalone');
  });
});
