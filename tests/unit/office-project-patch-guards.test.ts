import { describe, expect, it } from 'vitest';
import {
  assertProjectEditableForPatch,
  assertProjectMemberPatch,
  AgentBindingError,
} from '../../electron/services/office/agent-binding';
import type { OfficeDataStore, OfficeFixedGroup, OfficeTempProject } from '../../electron/services/office/types';

function project(overrides: Partial<OfficeTempProject> = {}): OfficeTempProject {
  return {
    id: 'project-1',
    title: 'Test',
    status: 'pending',
    agentIds: ['a1'],
    coordinatorAgentId: 'a1',
    origin: 'standalone',
    nodeRuns: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as OfficeTempProject;
}

function store(
  overrides: Partial<OfficeDataStore> = {},
): Pick<OfficeDataStore, 'agentBindings' | 'fixedGroups'> {
  return {
    agentBindings: {},
    fixedGroups: [],
    ...overrides,
  };
}

describe('assertProjectEditableForPatch', () => {
  it('rejects when project is executing (not only status=running)', () => {
    const executing = project({
      status: 'pending',
      workflowRunId: 'run-1',
      nodeRuns: [{ nodeId: 'gen-0', status: 'running' }],
    } as Partial<OfficeTempProject>);
    expect(() => assertProjectEditableForPatch(executing)).toThrow(AgentBindingError);
    try {
      assertProjectEditableForPatch(executing);
    } catch (e) {
      expect((e as AgentBindingError).code).toBe('PROJECT_STILL_RUNNING');
    }
  });

  it('allows edit when idle', () => {
    expect(() => assertProjectEditableForPatch(project())).not.toThrow();
  });
});

describe('assertProjectMemberPatch', () => {
  const group: OfficeFixedGroup = {
    id: 'group-1',
    name: 'G',
    agentIds: ['a1', 'a2'],
    coordinatorAgentId: 'a1',
    createdAt: 1,
    updatedAt: 1,
  } as OfficeFixedGroup;

  it('rejects agent outside fixed group on spawned project', () => {
    const p = project({
      origin: 'fixed_group',
      parentGroupId: 'group-1',
      agentIds: ['a1'],
    });
    expect(() =>
      assertProjectMemberPatch(p, ['a1', 'a3'], store({ fixedGroups: [group] }), group),
    ).toThrow(AgentBindingError);
  });

  it('rejects binding agent already used by another entity', () => {
    const p = project({ agentIds: ['a1'] });
    const bindings = {
      a2: { kind: 'temp_project' as const, entityId: 'other', entityName: 'Other' },
    };
    expect(() =>
      assertProjectMemberPatch(p, ['a1', 'a2'], store({ agentBindings: bindings })),
    ).toThrow(AgentBindingError);
  });

  it('allows re-binding same project agents', () => {
    const p = project({ id: 'project-1', agentIds: ['a1'] });
    const bindings = {
      a1: { kind: 'temp_project' as const, entityId: 'project-1', entityName: 'Test' },
    };
    expect(() =>
      assertProjectMemberPatch(p, ['a1', 'a2'], store({ agentBindings: bindings })),
    ).not.toThrow();
  });
});
