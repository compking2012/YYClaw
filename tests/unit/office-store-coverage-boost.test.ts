import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { rebuildAgentBindings } from '../../electron/services/office/agent-binding';
import type { OfficeDataStore, OfficeFixedGroup, OfficeTempProject } from '../../electron/services/office/types';

const persistEnv = vi.hoisted(() => ({ dataDir: '' }));

vi.mock('../../electron/services/office/paths', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../electron/services/office/paths')>();
  return {
    ...actual,
    getOfficeDataDir: () => persistEnv.dataDir,
    getOfficeDataPath: () => join(persistEnv.dataDir, 'data.json'),
  };
});

vi.mock('../../electron/services/office/office-project-session-dir', () => ({
  removeOfficeProjectSessionDir: vi.fn(async () => undefined),
}));

vi.mock('../../electron/services/office/project-room-fs', () => ({
  clearProjectRoomMessages: vi.fn(async () => undefined),
  getProjectRoomMessages: vi.fn(async () => []),
  appendProjectRoomMessage: vi.fn(async (msg: { id?: string; projectId: string; content: string }) => ({
    id: msg.id ?? 'room-msg-1',
    from: 'user',
    timestamp: Date.now(),
    ...msg,
  })),
  updateProjectRoomMessage: vi.fn(
    async (
      projectId: string,
      messageId: string,
      patch: Record<string, unknown>,
    ) => ({
      id: messageId,
      projectId,
      from: 'user',
      content: 'updated',
      timestamp: Date.now(),
      ...patch,
    }),
  ),
}));

vi.mock('../../electron/services/office/store-recovery', () => ({
  officeArtifactsLookRecoverable: async () => false,
  recoverOfficeStoreFromArtifacts: async () => null,
}));

vi.mock('../../electron/services/office/project-context-paths', () => ({
  recordProjectRootAtStart: vi.fn(async (project: { id: string }) =>
    `/tmp/office/projects/${project.id}`,
  ),
}));

vi.mock('../../electron/utils/broadcast-renderer', () => ({
  broadcastToRenderer: vi.fn(),
}));

vi.mock('../../electron/services/office/project-context-reset', () => ({
  resetProjectContextForProject: vi.fn(async () => undefined),
}));

vi.mock('../../electron/utils/agent-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../electron/utils/agent-config')>();
  return {
    ...actual,
    readAgentIdsFromOpenClawConfig: vi.fn(async () => new Set(['agent-a', 'agent-b'])),
  };
});

vi.mock('../../electron/services/office/office-session-new-ledger', () => ({
  clearProjectAgentNewLedger: vi.fn(),
}));

const now = Date.now();

function baseGroup(overrides: Partial<OfficeFixedGroup> = {}): OfficeFixedGroup {
  return {
    id: 'group-1',
    name: '研发团队',
    agentIds: ['agent-a', 'agent-b'],
    coordinatorAgentId: 'agent-a',
    executionMode: 'workflow',
    workflowDescription: '组工作流',
    workflow: {
      mode: 'dag',
      nodes: [{ id: 'n1', title: '组步骤', agentIds: ['agent-a'] }],
      edges: [],
    },
    sequence: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function standaloneCompleted(overrides: Partial<OfficeTempProject> = {}): OfficeTempProject {
  return {
    id: 'proj-standalone',
    title: '已完成自建',
    origin: 'standalone',
    agentIds: ['agent-a'],
    coordinatorAgentId: 'agent-a',
    lifecycle: 'active',
    status: 'completed',
    featureDescription: 'feat',
    description: 'desc',
    executionMode: 'workflow',
    workflow: { mode: 'dag', nodes: [], edges: [] },
    nodeRuns: [{ nodeId: 'n1', agentId: 'agent-a', status: 'completed' }],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function spawnedRunning(overrides: Partial<OfficeTempProject> = {}): OfficeTempProject {
  return {
    id: 'proj-running',
    title: '运行中派出',
    origin: 'fixed_group',
    parentGroupId: 'group-1',
    inheritsGroupTemplate: true,
    agentIds: ['agent-a'],
    coordinatorAgentId: 'agent-a',
    lifecycle: 'active',
    status: 'running',
    featureDescription: 'feat',
    description: 'desc',
    executionMode: 'workflow',
    workflow: { mode: 'dag', nodes: [{ id: 'n1', title: 'S', agentIds: ['agent-a'] }], edges: [] },
    nodeRuns: [{ nodeId: 'n1', agentId: 'agent-a', status: 'running' }],
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

async function resetStoreModule() {
  const { clearOfficeStoreCacheForTests, drainOfficeStoreOpsForTests } = await import(
    '../../electron/services/office/store'
  );
  clearOfficeStoreCacheForTests();
  await drainOfficeStoreOpsForTests();
}

describe('office store coverage boost', () => {
  beforeEach(async () => {
    persistEnv.dataDir = await mkdtemp(join(tmpdir(), 'office-store-cov-'));
    await resetStoreModule();
  });

  afterEach(async () => {
    await resetStoreModule();
    await rm(persistEnv.dataDir, { recursive: true, force: true });
  });

  it('reorderFixedGroups updates sequence and persists', async () => {
    const { saveStore, reorderFixedGroups, listFixedGroups, drainOfficeStoreOpsForTests } =
      await import('../../electron/services/office/store');
    const g2 = baseGroup({ id: 'group-2', name: 'B组', sequence: 2, agentIds: ['agent-b'] });
    await saveStore(baseStore({ fixedGroups: [baseGroup(), g2] }));
    await drainOfficeStoreOpsForTests();

    const ordered = await reorderFixedGroups(['group-2', 'group-1']);
    await drainOfficeStoreOpsForTests();

    expect(ordered.map((g) => g.id)).toEqual(['group-2', 'group-1']);
    expect(ordered[0]?.sequence).toBe(1);
    const fromDisk = await listFixedGroups();
    expect(fromDisk[0]?.id).toBe('group-2');
  });

  it('deleteTempProject removes project record from store', async () => {
    const { saveStore, deleteTempProject, getTempProject, drainOfficeStoreOpsForTests } =
      await import('../../electron/services/office/store');
    await saveStore(baseStore({ tempProjects: [standaloneCompleted({ id: 'proj-del' })] }));
    await drainOfficeStoreOpsForTests();

    await deleteTempProject('proj-del');
    await drainOfficeStoreOpsForTests();

    expect(await getTempProject('proj-del')).toBeUndefined();
    const raw = await readFile(join(persistEnv.dataDir, 'data.json'), 'utf8');
    expect(raw).not.toContain('proj-del');
  });

  it('upgradeTempProjectToGroup binds completed standalone and creates group', async () => {
    const {
      saveStore,
      upgradeTempProjectToGroup,
      getTempProject,
      listFixedGroups,
      drainOfficeStoreOpsForTests,
    } = await import('../../electron/services/office/store');
    await saveStore(baseStore({ fixedGroups: [], tempProjects: [standaloneCompleted()] }));
    await drainOfficeStoreOpsForTests();

    const { group, project } = await upgradeTempProjectToGroup('proj-standalone');
    await drainOfficeStoreOpsForTests();

    expect(group.agentIds).toEqual(['agent-a']);
    expect(project.parentGroupId).toBe(group.id);
    expect(project.lifecycle).toBe('completed');
    expect((await listFixedGroups()).some((g) => g.id === group.id)).toBe(true);
    expect((await getTempProject('proj-standalone'))?.origin).toBe('fixed_group');
  });

  it('upsertFixedGroup with upgradeFromProjectId atomically links project', async () => {
    const { saveStore, upsertFixedGroup, getTempProject, drainOfficeStoreOpsForTests } =
      await import('../../electron/services/office/store');
    await saveStore(baseStore({ fixedGroups: [], tempProjects: [standaloneCompleted()] }));
    await drainOfficeStoreOpsForTests();

    const group = await upsertFixedGroup(
      baseGroup({ id: 'group-new', agentIds: ['agent-a'] }),
      { upgradeFromProjectId: 'proj-standalone' },
    );
    await drainOfficeStoreOpsForTests();

    const linked = await getTempProject('proj-standalone');
    expect(linked?.parentGroupId).toBe(group.id);
    expect(linked?.lifecycle).toBe('completed');
  });

  it('markTempProjectUpgraded is idempotent when already linked', async () => {
    const { saveStore, upsertFixedGroup, markTempProjectUpgraded, getTempProject, drainOfficeStoreOpsForTests } =
      await import('../../electron/services/office/store');
    await saveStore(baseStore({ fixedGroups: [], tempProjects: [standaloneCompleted()] }));
    await drainOfficeStoreOpsForTests();

    const group = await upsertFixedGroup(
      baseGroup({ id: 'group-new', agentIds: ['agent-a'] }),
      { upgradeFromProjectId: 'proj-standalone' },
    );
    await drainOfficeStoreOpsForTests();
    const before = await getTempProject('proj-standalone');

    const again = await markTempProjectUpgraded('proj-standalone', group.id);
    await drainOfficeStoreOpsForTests();

    expect(again.parentGroupId).toBe(before?.parentGroupId);
    expect(again.lifecycle).toBe('completed');
  });

  it('editing group syncs agentIds on pending inheriting child', async () => {
    const { saveStore, upsertFixedGroup, getTempProject, drainOfficeStoreOpsForTests } =
      await import('../../electron/services/office/store');
    await saveStore(
      baseStore({
        tempProjects: [
          spawnedRunning({
            id: 'proj-pending',
            status: 'pending',
            nodeRuns: [],
            workflow: { mode: 'dag', nodes: [], edges: [] },
          }),
        ],
      }),
    );
    await drainOfficeStoreOpsForTests();

    await upsertFixedGroup(
      baseGroup({
        agentIds: ['agent-a', 'agent-b'],
        coordinatorAgentId: 'agent-a',
      }),
    );
    await drainOfficeStoreOpsForTests();

    const child = await getTempProject('proj-pending');
    expect(child?.agentIds).toEqual(['agent-a', 'agent-b']);
  });

  it('prepareTempProjectForRun revives archived standalone project to pending', async () => {
    const { saveStore, prepareTempProjectForRun, drainOfficeStoreOpsForTests } =
      await import('../../electron/services/office/store');
    await saveStore(
      baseStore({
        fixedGroups: [],
        tempProjects: [
          standaloneCompleted({
            lifecycle: 'completed',
            status: 'completed',
          }),
        ],
      }),
    );
    await drainOfficeStoreOpsForTests();

    const revived = await prepareTempProjectForRun('proj-standalone');
    await drainOfficeStoreOpsForTests();

    expect(revived.lifecycle).toBe('active');
    expect(revived.status).toBe('pending');
  });

  it('dissolveTempProject sets lifecycle dissolved', async () => {
    const { saveStore, dissolveTempProject, getTempProject, drainOfficeStoreOpsForTests } =
      await import('../../electron/services/office/store');
    await saveStore(
      baseStore({
        tempProjects: [
          standaloneCompleted({
            lifecycle: 'active',
            status: 'failed',
          }),
        ],
      }),
    );
    await drainOfficeStoreOpsForTests();

    const dissolved = await dissolveTempProject('proj-standalone');
    await drainOfficeStoreOpsForTests();

    expect(dissolved?.lifecycle).toBe('dissolved');
    expect((await getTempProject('proj-standalone'))?.lifecycle).toBe('dissolved');
  });

  it('spawnProjectFromGroup creates child with parentGroupId', async () => {
    const { saveStore, spawnProjectFromGroup, drainOfficeStoreOpsForTests } =
      await import('../../electron/services/office/store');
    await saveStore(baseStore());
    await drainOfficeStoreOpsForTests();

    const child = await spawnProjectFromGroup({
      groupId: 'group-1',
      title: '新派出',
      agentIds: ['agent-a', 'agent-b'],
      coordinatorAgentId: 'agent-a',
      featureDescription: '实现功能',
    });
    await drainOfficeStoreOpsForTests();

    expect(child.parentGroupId).toBe('group-1');
    expect(child.origin).toBe('fixed_group');
    expect(child.inheritsGroupTemplate).toBe(true);
  });

  it('spawnProjectFromGroup rejects when group references missing agents', async () => {
    const { saveStore, spawnProjectFromGroup, drainOfficeStoreOpsForTests } =
      await import('../../electron/services/office/store');
    await saveStore(
      baseStore({
        fixedGroups: [
          baseGroup({
            agentIds: ['agent-a', 'ghost-agent'],
            coordinatorAgentId: 'agent-a',
          }),
        ],
      }),
    );
    await drainOfficeStoreOpsForTests();

    await expect(
      spawnProjectFromGroup({
        groupId: 'group-1',
        title: '应失败',
        featureDescription: '实现功能',
      }),
    ).rejects.toThrow(/ghost-agent/);
  });

  it('archiveTempProject transitions failed standalone to archived', async () => {
    const { saveStore, archiveTempProject, getTempProject, drainOfficeStoreOpsForTests } =
      await import('../../electron/services/office/store');
    await saveStore(
      baseStore({
        fixedGroups: [],
        tempProjects: [
          standaloneCompleted({
            lifecycle: 'active',
            status: 'failed',
            nodeRuns: [{ nodeId: 'n1', agentId: 'agent-a', status: 'failed' }],
          }),
        ],
      }),
    );
    await drainOfficeStoreOpsForTests();

    const archived = await archiveTempProject('proj-standalone');
    await drainOfficeStoreOpsForTests();

    expect(archived.lifecycle).toBe('dissolved');
    expect((await getTempProject('proj-standalone'))?.lifecycle).toBe('dissolved');
  });

  it('markProjectRunCompleted sets status completed', async () => {
    const { saveStore, markProjectRunCompleted, drainOfficeStoreOpsForTests } =
      await import('../../electron/services/office/store');
    await saveStore(
      baseStore({
        fixedGroups: [],
        tempProjects: [standaloneCompleted({ status: 'running', lifecycle: 'active' })],
      }),
    );
    await drainOfficeStoreOpsForTests();

    const done = await markProjectRunCompleted('proj-standalone');
    await drainOfficeStoreOpsForTests();

    expect(done?.status).toBe('completed');
  });

  it('dismissCompletionFollowUp stamps handledAt', async () => {
    const { saveStore, dismissCompletionFollowUp, drainOfficeStoreOpsForTests } =
      await import('../../electron/services/office/store');
    await saveStore(
      baseStore({
        fixedGroups: [],
        tempProjects: [
          standaloneCompleted({
            lifecycle: 'completed',
            status: 'completed',
          }),
        ],
      }),
    );
    await drainOfficeStoreOpsForTests();

    const stamped = await dismissCompletionFollowUp('proj-standalone');
    await drainOfficeStoreOpsForTests();

    expect(stamped.completionFollowUpHandledAt).toBeTypeOf('number');
  });

  it('listTempProjects filters standalone and parent group', async () => {
    const { saveStore, listTempProjects, drainOfficeStoreOpsForTests } =
      await import('../../electron/services/office/store');
    await saveStore(
      baseStore({
        tempProjects: [
          standaloneCompleted({ id: 'solo' }),
          spawnedRunning({ id: 'child', status: 'completed', lifecycle: 'completed' }),
        ],
      }),
    );
    await drainOfficeStoreOpsForTests();

    const standalone = await listTempProjects({ standaloneOnly: true });
    const grouped = await listTempProjects({ parentGroupId: 'group-1' });
    expect(standalone.map((p) => p.id)).toEqual(['solo']);
    expect(grouped.map((p) => p.id)).toEqual(['child']);
  });

  it('getSnapshot returns normalized projects and groups', async () => {
    const { saveStore, getSnapshot, drainOfficeStoreOpsForTests } =
      await import('../../electron/services/office/store');
    await saveStore(baseStore({ tempProjects: [standaloneCompleted()] }));
    await drainOfficeStoreOpsForTests();

    const snap = await getSnapshot();
    expect(snap.tempProjects.some((p) => p.id === 'proj-standalone')).toBe(true);
    expect(snap.fixedGroups.some((g) => g.id === 'group-1')).toBe(true);
  });

  it('insertStandaloneTempProject creates standalone draft on disk', async () => {
    const { saveStore, insertStandaloneTempProject, getTempProject, drainOfficeStoreOpsForTests } =
      await import('../../electron/services/office/store');
    await saveStore(baseStore({ fixedGroups: [], tempProjects: [] }));
    await drainOfficeStoreOpsForTests();

    const created = await insertStandaloneTempProject({
      title: '新建自建',
      agentIds: ['agent-a'],
      coordinatorAgentId: 'agent-a',
      featureDescription: 'scope',
      description: 'desc',
      executionMode: 'smart',
    });
    await drainOfficeStoreOpsForTests();

    expect(created.origin).toBe('standalone');
    expect(created.projectRootPath).toContain('proj');
    expect((await getTempProject(created.id))?.title).toBe('新建自建');
  });

  it('upsertTempProject updates existing record', async () => {
    const { saveStore, upsertTempProject, getTempProject, drainOfficeStoreOpsForTests } =
      await import('../../electron/services/office/store');
    await saveStore(
      baseStore({
        fixedGroups: [],
        tempProjects: [standaloneCompleted({ title: '旧标题' })],
      }),
    );
    await drainOfficeStoreOpsForTests();

    const updated = await upsertTempProject({
      ...standaloneCompleted({ title: '新标题' }),
    });
    await drainOfficeStoreOpsForTests();

    expect(updated.title).toBe('新标题');
    expect((await getTempProject('proj-standalone'))?.title).toBe('新标题');
  });

  it('persistTempProjectProgress and getProjectProgress round-trip', async () => {
    const { saveStore, persistTempProjectProgress, getProjectProgress, drainOfficeStoreOpsForTests } =
      await import('../../electron/services/office/store');
    const base = standaloneCompleted({ status: 'running', lifecycle: 'active' });
    await saveStore(baseStore({ fixedGroups: [], tempProjects: [base] }));
    await drainOfficeStoreOpsForTests();

    const saved = await persistTempProjectProgress({
      ...base,
      nodeRuns: [{ nodeId: 'n1', agentId: 'agent-a', status: 'running' }],
    });
    await drainOfficeStoreOpsForTests();

    const progress = await getProjectProgress('proj-standalone');
    expect(saved.nodeRuns[0]?.status).toBe('running');
    expect(progress?.status).toBe('running');
  });

  it('upsertTempProject ignores archived project when ifArchived=ignore', async () => {
    const { saveStore, upsertTempProject, drainOfficeStoreOpsForTests } =
      await import('../../electron/services/office/store');
    const archived = standaloneCompleted({ lifecycle: 'completed', status: 'completed', title: '归档' });
    await saveStore(baseStore({ fixedGroups: [], tempProjects: [archived] }));
    await drainOfficeStoreOpsForTests();

    const result = await upsertTempProject(
      { ...archived, title: '不应写入' },
      { ifArchived: 'ignore' },
    );
    await drainOfficeStoreOpsForTests();
    expect(result.title).toBe('归档');
  });

  it('createFixedGroupDraft and updateSettings', async () => {
    const { saveStore, createFixedGroupDraft, updateSettings, drainOfficeStoreOpsForTests } =
      await import('../../electron/services/office/store');
    await saveStore(baseStore());
    await drainOfficeStoreOpsForTests();

    const smartGroup = createFixedGroupDraft({
      name: 'Smart组',
      agentIds: ['agent-a'],
      coordinatorAgentId: 'agent-a',
      executionMode: 'smart',
    });
    expect(smartGroup.executionMode).toBe('smart');
    expect(smartGroup.workflow?.nodes).toEqual([]);

    const settings = await updateSettings({ agentToAgentEnabled: true });
    await drainOfficeStoreOpsForTests();
    expect(settings.agentToAgentEnabled).toBe(true);
  });

  it('archive completed standalone project to completed lifecycle', async () => {
    const { saveStore, archiveTempProject, getTempProject, drainOfficeStoreOpsForTests } =
      await import('../../electron/services/office/store');
    await saveStore(
      baseStore({
        fixedGroups: [],
        tempProjects: [
          standaloneCompleted({
            lifecycle: 'active',
            status: 'completed',
          }),
        ],
      }),
    );
    await drainOfficeStoreOpsForTests();

    const archived = await archiveTempProject('proj-standalone');
    await drainOfficeStoreOpsForTests();
    expect(archived.lifecycle).toBe('completed');
    expect((await getTempProject('proj-standalone'))?.lifecycle).toBe('completed');
  });

  it('legacy listProjectAgents, listRoles, listScenarios and listTasks', async () => {
    const {
      saveStore,
      listProjectAgents,
      listRoles,
      listScenarios,
      listTasks,
      drainOfficeStoreOpsForTests,
    } = await import('../../electron/services/office/store');
    await saveStore(
      baseStore({
        tempProjects: [standaloneCompleted(), spawnedRunning({ id: 'child' })],
      }),
    );
    await drainOfficeStoreOpsForTests();

    const agents = await listProjectAgents();
    expect(agents.some((a) => a.agentId === 'agent-a')).toBe(true);
    const roles = await listRoles();
    expect(roles.some((r) => r.agentId === 'agent-a')).toBe(true);
    const scenarios = await listScenarios();
    expect(scenarios.some((s) => s.id === 'group-1')).toBe(true);
    const tasks = await listTasks('group-1');
    expect(tasks.some((t) => t.id === 'child')).toBe(true);
  });

  it('createTaskDraft and defaultWorkflowForAgents', async () => {
    const { createTaskDraft, defaultWorkflowForAgents } = await import(
      '../../electron/services/office/store'
    );
    const draft = createTaskDraft({ title: '草稿', scenarioId: 'group-1' });
    expect(draft.title).toBe('草稿');
    expect(draft.status).toBe('pending');
    const wf = defaultWorkflowForAgents(['agent-a', 'agent-b']);
    expect(wf.nodes.length).toBeGreaterThan(0);
  });

  it('upsertTask round-trips through temp project store', async () => {
    const { saveStore, upsertTask, listTasks, drainOfficeStoreOpsForTests } = await import(
      '../../electron/services/office/store'
    );
    await saveStore(baseStore({ tempProjects: [] }));
    await drainOfficeStoreOpsForTests();

    const saved = await upsertTask({
      id: 'task-new',
      title: '新任务',
      scenarioId: 'group-1',
      featureDescription: 'feat',
      description: 'desc',
      status: 'pending',
      assignedRoleIds: ['agent-a'],
      executionMode: 'workflow',
      workflow: { mode: 'dag', nodes: [], edges: [] },
      nodeRuns: [],
      createdAt: now,
      updatedAt: now,
    });
    await drainOfficeStoreOpsForTests();

    expect(saved.title).toBe('新任务');
    const tasks = await listTasks('group-1');
    expect(tasks.some((t) => t.id === 'task-new')).toBe(true);
  });

  it('insertScenarioTask spawns child under scenario', async () => {
    const { saveStore, insertScenarioTask, drainOfficeStoreOpsForTests } = await import(
      '../../electron/services/office/store'
    );
    await saveStore(baseStore());
    await drainOfficeStoreOpsForTests();

    const task = await insertScenarioTask('group-1', {
      title: '场景任务',
      agentIds: ['agent-a'],
      coordinatorAgentId: 'agent-a',
      featureDescription: 'scope',
    });
    await drainOfficeStoreOpsForTests();

    expect(task.scenarioId).toBe('group-1');
    expect(task.title).toBe('场景任务');
  });

  it('resetProjectRunState clears nodeRuns and sets pending', async () => {
    const { saveStore, resetProjectRunState, getTempProject, drainOfficeStoreOpsForTests } =
      await import('../../electron/services/office/store');
    await saveStore(
      baseStore({
        fixedGroups: [],
        tempProjects: [
          standaloneCompleted({
            status: 'running',
            lifecycle: 'active',
            nodeRuns: [{ nodeId: 'n1', agentId: 'agent-a', status: 'running' }],
            workflowRunId: 'run-1',
          }),
        ],
      }),
    );
    await drainOfficeStoreOpsForTests();

    await resetProjectRunState('proj-standalone');
    await drainOfficeStoreOpsForTests();

    const project = await getTempProject('proj-standalone');
    expect(project?.status).toBe('pending');
    expect(project?.nodeRuns).toEqual([]);
    expect(project?.workflowRunId).toBeUndefined();
  });

  it('clearProjectRoomChat wipes room messages bucket', async () => {
    const { saveStore, clearProjectRoomChat, loadStore, drainOfficeStoreOpsForTests } =
      await import('../../electron/services/office/store');
    await saveStore(
      baseStore({
        fixedGroups: [],
        tempProjects: [standaloneCompleted()],
        roomMessages: {
          'proj-standalone': [
            {
              id: 'm1',
              projectId: 'proj-standalone',
              from: 'user',
              content: 'hello',
              timestamp: now,
            },
          ],
        },
      }),
    );
    await drainOfficeStoreOpsForTests();

    await clearProjectRoomChat('proj-standalone');
    await drainOfficeStoreOpsForTests();

    const s = await loadStore();
    expect(s.roomMessages['proj-standalone']).toBeUndefined();
  });

  it('clearProjectRunArtifacts chains room clear and reset', async () => {
    const { saveStore, clearProjectRunArtifacts, getTempProject, drainOfficeStoreOpsForTests } =
      await import('../../electron/services/office/store');
    await saveStore(
      baseStore({
        fixedGroups: [],
        tempProjects: [
          standaloneCompleted({
            status: 'running',
            lifecycle: 'active',
            nodeRuns: [{ nodeId: 'n1', agentId: 'agent-a', status: 'running' }],
          }),
        ],
        roomMessages: {
          'proj-standalone': [
            { id: 'm1', projectId: 'proj-standalone', from: 'user', content: 'x', timestamp: now },
          ],
        },
      }),
    );
    await drainOfficeStoreOpsForTests();

    await clearProjectRunArtifacts('proj-standalone');
    await drainOfficeStoreOpsForTests();

    const project = await getTempProject('proj-standalone');
    expect(project?.status).toBe('pending');
    expect(project?.nodeRuns).toEqual([]);
  });

  it('normalizeTempProjectRecord coerces smart execution mode', async () => {
    const { normalizeTempProjectRecord } = await import('../../electron/services/office/store');
    const smart = normalizeTempProjectRecord(
      standaloneCompleted({
        executionMode: 'smart',
        workflow: { mode: 'dag', nodes: [{ id: 'n1', title: 'S', agentIds: ['agent-a'] }], edges: [] },
        smartRevivedAt: Date.now(),
      }),
    );
    expect(smart.executionMode).toBe('smart');
    expect(smart.workflow?.nodes).toEqual([]);
    expect(smart.smartRevivedAt).toBeTypeOf('number');

    const trimmed = normalizeTempProjectRecord(
      standaloneCompleted({ title: '  标题  ', origin: 'fixed_group' as const }),
    );
    expect(trimmed.title).toBe('标题');
    expect(trimmed.origin).toBe('fixed_group');
  });

  it('getFixedGroup and deleteFixedGroup convert children to standalone', async () => {
    const { saveStore, getFixedGroup, deleteFixedGroup, getTempProject, drainOfficeStoreOpsForTests } =
      await import('../../electron/services/office/store');
    await saveStore(
      baseStore({
        tempProjects: [
          spawnedRunning({
            id: 'child',
            status: 'completed',
            lifecycle: 'completed',
          }),
        ],
      }),
    );
    await drainOfficeStoreOpsForTests();

    expect((await getFixedGroup('group-1'))?.id).toBe('group-1');
    await deleteFixedGroup('group-1');
    await drainOfficeStoreOpsForTests();

    expect(await getFixedGroup('group-1')).toBeUndefined();
    const child = await getTempProject('child');
    expect(child?.origin).toBe('standalone');
    expect(child?.parentGroupId).toBeUndefined();
  });

  it('markTempProjectCompleted sets completed status', async () => {
    const { saveStore, markTempProjectCompleted, drainOfficeStoreOpsForTests } =
      await import('../../electron/services/office/store');
    await saveStore(
      baseStore({
        fixedGroups: [],
        tempProjects: [
          standaloneCompleted({
            status: 'running',
            lifecycle: 'active',
          }),
        ],
      }),
    );
    await drainOfficeStoreOpsForTests();

    const completed = await markTempProjectCompleted('proj-standalone');
    await drainOfficeStoreOpsForTests();
    expect(completed?.status).toBe('completed');
  });

  it('legacy resetTaskRunState and createScenarioDraft', async () => {
    const {
      saveStore,
      resetTaskRunState,
      createScenarioDraft,
      getTempProject,
      drainOfficeStoreOpsForTests,
    } = await import('../../electron/services/office/store');
    await saveStore(
      baseStore({
        fixedGroups: [],
        tempProjects: [
          standaloneCompleted({
            status: 'running',
            lifecycle: 'active',
            nodeRuns: [{ nodeId: 'n1', agentId: 'agent-a', status: 'running' }],
          }),
        ],
      }),
    );
    await drainOfficeStoreOpsForTests();

    await resetTaskRunState('proj-standalone', 'group-1');
    await drainOfficeStoreOpsForTests();
    expect((await getTempProject('proj-standalone'))?.nodeRuns).toEqual([]);

    const scenario = createScenarioDraft({
      name: '新场景',
      roleIds: ['agent-a'],
      coordinatorRoleId: 'agent-a',
    });
    expect(scenario.name).toBe('新场景');
    expect(scenario.roleIds).toEqual(['agent-a']);
  });

  it('appendRoomMessage and updateRoomMessage persist and run side effects', async () => {
    const { saveStore, appendRoomMessage, updateRoomMessage, drainOfficeStoreOpsForTests } =
      await import('../../electron/services/office/store');
    await saveStore(
      baseStore({
        fixedGroups: [],
        tempProjects: [standaloneCompleted({ status: 'running', lifecycle: 'active' })],
      }),
    );
    await drainOfficeStoreOpsForTests();

    const saved = await appendRoomMessage(
      {
        id: 'm-append',
        projectId: 'proj-standalone',
        groupId: 'group-1',
        from: 'user',
        fromAgentId: 'agent-a',
        content: '进展更新',
        timestamp: now,
      },
      { deferSideEffects: true, notifyRenderer: true },
    );
    await drainOfficeStoreOpsForTests();
    expect(saved.content).toBe('进展更新');

    const updated = await updateRoomMessage('proj-standalone', 'm-append', {
      content: '已修订',
      progressText: '50%',
    });
    await drainOfficeStoreOpsForTests();
    expect(updated?.content).toBe('已修订');
    expect(updated?.progressText).toBe('50%');
  });
});
