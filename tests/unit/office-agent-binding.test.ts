import { describe, expect, it } from 'vitest';
import {
  activeChildProjectForGroup,
  assertAgentsAvailableForProjectRerun,
  assertAgentsIdle,
  assertArchivedProjectCanRestart,
  assertGroupCanDelete,
  assertGroupCanEdit,
  assertGroupCanSpawnProject,
  assertProjectAgentsExist,
  assertOfficeEntityAgentsExist,
  assertProjectCanDissolve,
  assertProjectNotArchived,
  isAgentIdle,
  isProjectCurrentlyRunning,
  isTempProjectActive,
  isTempProjectArchived,
  listIdleAgentIds,
  prepareArchivedProjectForRestart,
  reactivateArchivedProjectRecord,
  rebuildAgentBindings,
  resolveAgentBinding,
  validateArchivedProjectRestart,
} from '../../electron/services/office/agent-binding';
import type { OfficeDataStore, OfficeFixedGroup, OfficeTempProject } from '../../electron/services/office/types';

const now = Date.now();

function group(overrides: Partial<OfficeFixedGroup> = {}): OfficeFixedGroup {
  return {
    id: 'group-1',
    name: '研发团队',
    agentIds: ['agent-a', 'agent-b'],
    coordinatorAgentId: 'agent-a',
    workflow: { mode: 'dag', nodes: [], edges: [] },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function project(overrides: Partial<OfficeTempProject> = {}): OfficeTempProject {
  return {
    id: 'proj-1',
    title: '需求分析',
    origin: 'standalone',
    agentIds: ['agent-c'],
    coordinatorAgentId: 'agent-c',
    lifecycle: 'active',
    featureDescription: 'feat',
    description: 'desc',
    status: 'failed',
    nodeRuns: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function store(overrides: Partial<OfficeDataStore> = {}): OfficeDataStore {
  const base: OfficeDataStore = {
    version: 2,
    fixedGroups: [],
    tempProjects: [],
    agentBindings: {},
    roomMessages: {},
    settings: { agentToAgentEnabled: false, agentToAgentAllow: [] },
  };
  const merged = { ...base, ...overrides };
  merged.agentBindings = rebuildAgentBindings(merged);
  return merged;
}

describe('office-agent-binding', () => {
  it('idle agent: no binding record', () => {
    const s = store({ fixedGroups: [group()], tempProjects: [project()] });
    expect(isAgentIdle('agent-x', s.agentBindings)).toBe(true);
    expect(resolveAgentBinding('agent-x', s.agentBindings)).toEqual({ state: 'pool' });
  });

  it('fixed group agent is bound', () => {
    const s = store({ fixedGroups: [group()], tempProjects: [] });
    expect(isAgentIdle('agent-a', s.agentBindings)).toBe(false);
    expect(resolveAgentBinding('agent-a', s.agentBindings)).toMatchObject({
      kind: 'fixed_group',
      entityId: 'group-1',
      entityName: '研发团队',
    });
  });

  it('active temp project binds agents even when failed/aborted', () => {
    const s = store({
      fixedGroups: [],
      tempProjects: [project({ status: 'failed', lifecycle: 'active' })],
    });
    expect(isAgentIdle('agent-c', s.agentBindings)).toBe(false);
    expect(isTempProjectActive(project({ status: 'failed' }))).toBe(true);
  });

  it('archived project releases agent binding', () => {
    const s = store({
      fixedGroups: [],
      tempProjects: [project({ status: 'completed', lifecycle: 'completed' })],
    });
    expect(isAgentIdle('agent-c', s.agentBindings)).toBe(true);
  });

  it('temp project binding overrides fixed group for same agent', () => {
    const s = store({
      fixedGroups: [group({ agentIds: ['agent-a', 'agent-c'] })],
      tempProjects: [project({ agentIds: ['agent-c'], origin: 'fixed_group', parentGroupId: 'group-1' })],
    });
    expect(resolveAgentBinding('agent-c', s.agentBindings)).toMatchObject({
      kind: 'temp_project',
      entityId: 'proj-1',
    });
  });

  it('listIdleAgentIds filters bound agents', () => {
    const s = store({
      fixedGroups: [group({ agentIds: ['agent-a'] })],
      tempProjects: [project({ agentIds: ['agent-c'] })],
    });
    expect(listIdleAgentIds(['agent-a', 'agent-b', 'agent-c', 'agent-x'], s.agentBindings)).toEqual([
      'agent-b',
      'agent-x',
    ]);
  });

  it('assertAgentsIdle rejects bound agent', () => {
    const s = store({ fixedGroups: [group()], tempProjects: [] });
    expect(() => assertAgentsIdle(['agent-a'], s.agentBindings)).toThrow(/固定组/);
  });

  it('assertAgentsIdle allows binding excluded temp project during standalone upgrade', () => {
    const completed = project({
      id: 'proj-upgrade',
      title: '五子棋开发',
      status: 'completed',
      lifecycle: 'active',
      agentIds: ['agent-c'],
      coordinatorAgentId: 'agent-c',
    });
    const s = store({ fixedGroups: [], tempProjects: [completed] });
    expect(() =>
      assertAgentsIdle(['agent-c'], s.agentBindings, { excludeEntityId: 'proj-upgrade' }),
    ).not.toThrow();
    expect(() => assertAgentsIdle(['agent-c'], s.agentBindings)).toThrow(/项目/);
  });

  it('dissolve blocked while project running', () => {
    expect(() => assertProjectCanDissolve(project({ status: 'running' }))).toThrow(/中止/);
    expect(() => assertProjectCanDissolve(project({ status: 'failed' }))).not.toThrow();
  });

  it('archived rerun checks agent availability', () => {
    const s = store({
      fixedGroups: [group({ agentIds: ['agent-c'] })],
      tempProjects: [project({ lifecycle: 'completed', status: 'completed' })],
    });
    const archived = project({ lifecycle: 'completed', status: 'completed' });
    expect(() => assertAgentsAvailableForProjectRerun(archived, s.agentBindings)).toThrow(/绑定/);
  });

  it('validateArchivedProjectRestart allows restart when agents are missing from catalog', () => {
    const archived = project({
      lifecycle: 'completed',
      status: 'completed',
      agentIds: ['agent-missing'],
    });
    const s = store({ tempProjects: [archived] });
    const known = new Set(['agent-c']);
    expect(() => validateArchivedProjectRestart(archived, s, known)).not.toThrow();
  });

  it('validateArchivedProjectRestart allows idle standalone restart', () => {
    const archived = project({
      id: 'proj-archived',
      lifecycle: 'completed',
      status: 'completed',
      agentIds: ['agent-c'],
      coordinatorAgentId: 'agent-c',
    });
    const s = store({ tempProjects: [archived] });
    const known = new Set(['agent-c']);
    expect(() => validateArchivedProjectRestart(archived, s, known)).not.toThrow();
    const reactivated = reactivateArchivedProjectRecord(archived);
    expect(reactivated.lifecycle).toBe('active');
    expect(reactivated.status).toBe('completed');
    expect(reactivated.nodeRuns).toEqual([]);
  });

  it('reactivateArchivedProjectRecord preserves completed workflow execution on restart', () => {
    const archived = project({
      lifecycle: 'completed',
      status: 'completed',
      executionMode: 'workflow',
      nodeRuns: [{ nodeId: 'n1', agentId: 'agent-c', status: 'completed' }],
      workflowRunId: 'run-1',
      lastRunCompletedAt: 5_000,
    });
    const reactivated = reactivateArchivedProjectRecord(archived);
    expect(reactivated.lifecycle).toBe('active');
    expect(reactivated.status).toBe('completed');
    expect(reactivated.nodeRuns).toHaveLength(1);
    expect(reactivated.workflowRunId).toBe('run-1');
    expect(reactivated.completionFollowUpHandledAt).toBe(5_000);
  });

  it('reactivateArchivedProjectRecord resets smart aborted archive to pending', () => {
    const archived = project({
      lifecycle: 'dissolved',
      status: 'aborted',
      executionMode: 'smart',
      nodeRuns: [],
    });
    const reactivated = reactivateArchivedProjectRecord(archived);
    expect(reactivated.lifecycle).toBe('active');
    expect(reactivated.status).toBe('pending');
    expect(reactivated.nodeRuns).toEqual([]);
  });

  it('reactivateArchivedProjectRecord preserves nodeRuns for dissolved aborted workflow archive', () => {
    const archived = project({
      lifecycle: 'dissolved',
      status: 'aborted',
      executionMode: 'workflow',
      nodeRuns: [{ nodeId: 'n1', agentId: 'agent-c', status: 'completed' }],
    });
    const reactivated = reactivateArchivedProjectRecord(archived);
    expect(reactivated.lifecycle).toBe('active');
    expect(reactivated.status).toBe('aborted');
    expect(reactivated.nodeRuns).toHaveLength(1);
  });

  it('reactivateArchivedProjectRecord preserves nodeRuns for forced-abort workflow without completed steps', () => {
    const archived = project({
      lifecycle: 'dissolved',
      status: 'aborted',
      executionMode: 'workflow',
      nodeRuns: [
        { nodeId: 'n1', agentId: 'agent-c', status: 'failed', error: '用户已手动中止本项目' },
        { nodeId: 'n2', agentId: 'agent-c', status: 'failed', error: '用户已手动中止本项目' },
      ],
    });
    const reactivated = reactivateArchivedProjectRecord(archived);
    expect(reactivated.lifecycle).toBe('active');
    expect(reactivated.status).toBe('aborted');
    expect(reactivated.nodeRuns).toHaveLength(2);
  });

  it('validateArchivedProjectRestart blocks when agent is executing elsewhere', () => {
    const archived = project({
      id: 'proj-archived',
      lifecycle: 'completed',
      status: 'completed',
      agentIds: ['agent-c'],
      coordinatorAgentId: 'agent-c',
    });
    const running = project({
      id: 'proj-running',
      agentIds: ['agent-c'],
      coordinatorAgentId: 'agent-c',
      status: 'running',
      lifecycle: 'active',
    });
    const s = store({ tempProjects: [archived, running] });
    const known = new Set(['agent-c']);
    expect(() => validateArchivedProjectRestart(archived, s, known)).toThrow(/绑定|正在项目/);
  });

  it('assertArchivedProjectCanRestart rejects upgraded lifecycle', () => {
    expect(() =>
      assertArchivedProjectCanRestart(project({ lifecycle: 'upgraded', status: 'completed' })),
    ).toThrow(/不可重启/);
  });

  it('assertProjectAgentsExist lists missing ids', () => {
    expect(() => assertProjectAgentsExist(['agent-a', 'agent-z'], new Set(['agent-a']))).toThrow(
      /agent-z/,
    );
  });

  it('assertOfficeEntityAgentsExist checks workflow and draft refs', () => {
    const known = new Set(['agent-a']);
    expect(() =>
      assertOfficeEntityAgentsExist(
        {
          agentIds: ['agent-a'],
          workflow: {
            mode: 'dag',
            nodes: [{ id: 'n1', agentId: 'ghost', execution: 'serial' }],
            edges: [],
          },
        },
        known,
      ),
    ).toThrow(/ghost/);
    expect(() =>
      assertOfficeEntityAgentsExist(
        {
          agentIds: ['agent-a'],
          workflowStepDrafts: [
            {
              input: '',
              agentIds: ['missing-draft'],
              task: 'x',
              output: '',
              linkMode: 'serial',
            },
          ],
        },
        known,
      ),
    ).toThrow(/missing-draft/);
  });

  it('assertOfficeEntityAgentsExist rejects empty workflow agent assignment', () => {
    expect(() =>
      assertOfficeEntityAgentsExist(
        {
          agentIds: ['agent-a'],
          workflow: {
            mode: 'dag',
            nodes: [{ id: 'n1', agentId: '', execution: 'serial' }],
            edges: [],
          },
        },
        new Set(['agent-a']),
      ),
    ).toThrow(/未指定负责人/);
  });

  it('assertOfficeEntityAgentsExist ignores empty node on the INACTIVE LangGraph branch (only active branch runs)', () => {
    // custom is active + valid; heuristic is stale/empty after an unbind strip.
    // Only the active (custom) branch executes, so this must not block run.
    expect(() =>
      assertOfficeEntityAgentsExist(
        {
          agentIds: ['agent-a'],
          workflow: { mode: 'dag', nodes: [], edges: [] },
          langGraphWorkflowBundle: {
            activeSource: 'custom',
            activeSavedAt: 1,
            heuristic: {
              savedAt: 1,
              workflow: { mode: 'dag', nodes: [{ id: 'h', agentId: '', execution: 'serial' }], edges: [] },
            },
            custom: {
              savedAt: 1,
              workflow: { mode: 'dag', nodes: [{ id: 'c', agentId: 'agent-a', execution: 'serial' }], edges: [] },
            },
          },
        },
        new Set(['agent-a']),
      ),
    ).not.toThrow();
  });

  it('assertOfficeEntityAgentsExist still rejects empty node on the ACTIVE LangGraph branch', () => {
    expect(() =>
      assertOfficeEntityAgentsExist(
        {
          agentIds: ['agent-a'],
          workflow: { mode: 'dag', nodes: [], edges: [] },
          langGraphWorkflowBundle: {
            activeSource: 'custom',
            activeSavedAt: 1,
            heuristic: {
              savedAt: 1,
              workflow: { mode: 'dag', nodes: [{ id: 'h', agentId: 'agent-a', execution: 'serial' }], edges: [] },
            },
            custom: {
              savedAt: 1,
              workflow: { mode: 'dag', nodes: [{ id: 'c', agentId: '', execution: 'serial' }], edges: [] },
            },
          },
        },
        new Set(['agent-a']),
      ),
    ).toThrow(/未指定负责人/);
  });

  it('assertOfficeEntityAgentsExist falls back to DAG mirror when active branch has no nodes', () => {
    // Active branch empty → runner materializes from project.workflow; that mirror
    // still carries an unassigned node, so run must be blocked.
    expect(() =>
      assertOfficeEntityAgentsExist(
        {
          agentIds: ['agent-a'],
          workflow: { mode: 'dag', nodes: [{ id: 'n1', agentId: '', execution: 'serial' }], edges: [] },
          langGraphWorkflowBundle: {
            activeSource: 'custom',
            activeSavedAt: 1,
            heuristic: { savedAt: 1, workflow: { mode: 'dag', nodes: [], edges: [] } },
            custom: { savedAt: 1, workflow: { mode: 'dag', nodes: [], edges: [] } },
          },
        },
        new Set(['agent-a']),
      ),
    ).toThrow(/未指定负责人/);
  });

  it('validateArchivedProjectRestart blocks when fixed group has another active spawn', () => {
    const archived = project({
      id: 'proj-archived',
      origin: 'fixed_group',
      parentGroupId: 'group-1',
      lifecycle: 'completed',
      status: 'completed',
      agentIds: ['agent-a'],
      coordinatorAgentId: 'agent-a',
    });
    const activeSibling = project({
      id: 'proj-active',
      origin: 'fixed_group',
      parentGroupId: 'group-1',
      lifecycle: 'active',
      status: 'pending',
      agentIds: ['agent-b'],
      coordinatorAgentId: 'agent-b',
    });
    const s = store({
      fixedGroups: [group()],
      tempProjects: [archived, activeSibling],
    });
    const known = new Set(['agent-a', 'agent-b']);
    expect(() => validateArchivedProjectRestart(archived, s, known)).toThrow(
      /已有未归档派出项目/,
    );
  });

  it('archived completed child does not block group spawn', () => {
    const projects = [
      project({
        origin: 'fixed_group',
        parentGroupId: 'group-1',
        status: 'completed',
        lifecycle: 'completed',
      }),
    ];
    expect(activeChildProjectForGroup('group-1', projects)).toBeUndefined();
    expect(() => assertGroupCanSpawnProject('group-1', projects)).not.toThrow();
  });

  it('group spawn limit: one active child project', () => {
    const projects = [
      project({
        origin: 'fixed_group',
        parentGroupId: 'group-1',
        status: 'running',
        lifecycle: 'active',
      }),
    ];
    expect(activeChildProjectForGroup('group-1', projects)?.id).toBe('proj-1');
    expect(() => assertGroupCanSpawnProject('group-1', projects)).toThrow(/未归档/);
  });

  it('group delete blocked when active child exists', () => {
    const projects = [
      project({
        origin: 'fixed_group',
        parentGroupId: 'group-1',
        status: 'pending',
        lifecycle: 'active',
      }),
    ];
    expect(() => assertGroupCanDelete('group-1', projects)).toThrow(/无法删除/);
  });

  it('group delete blocked when active child has parentGroupId but standalone origin', () => {
    const projects = [
      project({
        origin: 'standalone',
        parentGroupId: 'group-1',
        status: 'pending',
        lifecycle: 'active',
      }),
    ];
    expect(() => assertGroupCanDelete('group-1', projects)).toThrow(/无法删除/);
  });

  it('activeChildProjectForGroup matches parentGroupId regardless of origin', () => {
    const projects = [
      project({
        id: 'proj-orphan',
        origin: 'standalone',
        parentGroupId: 'group-1',
        lifecycle: 'active',
        status: 'pending',
      }),
    ];
    expect(activeChildProjectForGroup('group-1', projects)?.id).toBe('proj-orphan');
  });

  it('group edit blocked when child project is executing', () => {
    const projects = [
      project({
        origin: 'fixed_group',
        parentGroupId: 'group-1',
        status: 'running',
        lifecycle: 'active',
      }),
    ];
    expect(() => assertGroupCanEdit('group-1', projects)).toThrow(/正在执行/);
  });

  it('group edit allowed when child project is idle', () => {
    const projects = [
      project({
        origin: 'fixed_group',
        parentGroupId: 'group-1',
        status: 'pending',
        lifecycle: 'active',
      }),
    ];
    expect(() => assertGroupCanEdit('group-1', projects)).not.toThrow();
  });

  it('archived project detection', () => {
    expect(isProjectCurrentlyRunning(project({ status: 'running' }))).toBe(true);
    expect(isProjectCurrentlyRunning(project({ status: 'failed' }))).toBe(false);
    expect(isTempProjectArchived(project({ lifecycle: 'completed' }))).toBe(true);
  });

  it('assertProjectNotArchived rejects completed lifecycle', () => {
    expect(() => assertProjectNotArchived(project({ lifecycle: 'completed' }))).toThrow(
      /已归档/,
    );
    expect(() => assertProjectNotArchived(project({ lifecycle: 'active' }))).not.toThrow();
  });

  it('prepareArchivedProjectForRestart syncs spawned project agents with fixed group', () => {
    const archived = project({
      origin: 'fixed_group',
      parentGroupId: 'group-1',
      lifecycle: 'completed',
      status: 'completed',
      agentIds: ['agent-a'],
      coordinatorAgentId: 'agent-a',
    });
    const s = store({ fixedGroups: [group()], tempProjects: [archived] });
    const prepared = prepareArchivedProjectForRestart(archived, s);
    expect(prepared.origin).toBe('fixed_group');
    expect(prepared.parentGroupId).toBe('group-1');
    expect(prepared.agentIds).toEqual(['agent-a', 'agent-b']);
    expect(prepared.coordinatorAgentId).toBe('agent-a');
  });

  it('validateArchivedProjectRestart allows spawned restart after fixed group member drift', () => {
    const archived = project({
      origin: 'fixed_group',
      parentGroupId: 'group-1',
      lifecycle: 'completed',
      status: 'completed',
      agentIds: ['agent-a', 'agent-removed'],
      coordinatorAgentId: 'agent-a',
    });
    const s = store({ fixedGroups: [group()], tempProjects: [archived] });
    const prepared = prepareArchivedProjectForRestart(archived, s);
    const known = new Set(['agent-a', 'agent-b', 'agent-removed']);
    expect(() => validateArchivedProjectRestart(prepared, s, known)).not.toThrow();
    expect(prepared.agentIds).toEqual(['agent-a', 'agent-b']);
  });

  it('prepareArchivedProjectForRestart detaches spawned project when fixed group is gone', () => {
    const archived = project({
      origin: 'fixed_group',
      parentGroupId: 'group-1',
      inheritsGroupTemplate: true,
      lifecycle: 'completed',
      status: 'completed',
      agentIds: ['agent-a'],
      coordinatorAgentId: 'agent-a',
      workflowStepDrafts: [
        {
          input: '',
          agentIds: ['agent-a'],
          task: '组步骤',
          output: '',
          linkMode: 'serial' as const,
        },
      ],
    });
    const s = store({ fixedGroups: [], tempProjects: [archived] });
    const prepared = prepareArchivedProjectForRestart(archived, s);
    expect(prepared.origin).toBe('standalone');
    expect(prepared.parentGroupId).toBeUndefined();
    expect(prepared.inheritsGroupTemplate).toBe(false);
    expect(prepared.workflowStepDrafts?.[0]?.task).toBe('组步骤');
  });

  it('prepareArchivedProjectForRestart clears stale parentGroupId on standalone archived project', () => {
    const archived = project({
      origin: 'standalone',
      parentGroupId: 'group-1',
      lifecycle: 'completed',
      status: 'completed',
      agentIds: ['agent-a'],
      coordinatorAgentId: 'agent-a',
    });
    const s = store({ fixedGroups: [group()], tempProjects: [archived] });
    const prepared = prepareArchivedProjectForRestart(archived, s);
    expect(prepared.origin).toBe('standalone');
    expect(prepared.parentGroupId).toBeUndefined();
    expect(prepared.inheritsGroupTemplate).toBe(false);
  });

  it('validateArchivedProjectRestart allows detached spawned restart after fixed group deletion', () => {
    const archived = project({
      origin: 'fixed_group',
      parentGroupId: 'group-1',
      lifecycle: 'completed',
      status: 'completed',
      agentIds: ['agent-a'],
      coordinatorAgentId: 'agent-a',
    });
    const s = store({ fixedGroups: [], tempProjects: [archived] });
    const prepared = prepareArchivedProjectForRestart(archived, s);
    const known = new Set(['agent-a']);
    expect(() => validateArchivedProjectRestart(prepared, s, known)).not.toThrow();
  });
});
