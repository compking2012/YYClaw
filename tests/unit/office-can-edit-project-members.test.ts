import { describe, expect, it } from 'vitest';
import {
  canEditProjectMembers,
  canUnbindMissingSpawnedProjectMembers,
} from '../../src/lib/office-task-edit-form';
import type { OfficeTempProject } from '../../src/types/office';

function project(
  partial: Pick<OfficeTempProject, 'origin' | 'executionMode' | 'parentGroupId'> & {
    lifecycle?: OfficeTempProject['lifecycle'];
  },
): OfficeTempProject {
  return {
    id: 'p1',
    title: 't',
    origin: partial.origin,
    parentGroupId: partial.parentGroupId,
    executionMode: partial.executionMode,
    lifecycle: partial.lifecycle ?? 'active',
    agentIds: ['a1'],
    coordinatorAgentId: 'a1',
    featureDescription: 'f',
    status: 'draft',
  } as OfficeTempProject;
}

const parentGroup = { id: 'g1' };

describe('canEditProjectMembers', () => {
  it('allows all self-built projects when not read-only', () => {
    expect(
      canEditProjectMembers(project({ origin: 'standalone', executionMode: 'workflow' }), {
        parentGroup: null,
      }),
    ).toBe(true);
    expect(
      canEditProjectMembers(
        project({ origin: 'fixed_group', parentGroupId: 'g-missing', executionMode: 'workflow' }),
        { parentGroup: null },
      ),
    ).toBe(true);
    expect(
      canEditProjectMembers(
        project({ origin: 'standalone', executionMode: 'smart' }),
        { parentGroup: null },
      ),
    ).toBe(true);
  });

  it('allows smart spawned projects with active parent group', () => {
    expect(
      canEditProjectMembers(
        project({ origin: 'fixed_group', parentGroupId: 'g1', executionMode: 'smart' }),
        { parentGroup },
      ),
    ).toBe(true);
  });

  it('blocks workflow spawned projects with active parent group', () => {
    expect(
      canEditProjectMembers(
        project({ origin: 'fixed_group', parentGroupId: 'g1', executionMode: 'workflow' }),
        { parentGroup },
      ),
    ).toBe(false);
  });

  it('blocks when read-only', () => {
    expect(
      canEditProjectMembers(project({ origin: 'standalone', executionMode: 'smart' }), {
        readOnly: true,
        parentGroup: null,
      }),
    ).toBe(false);
  });

  it('allows self-built members even with archived restart badge', () => {
    expect(
      canEditProjectMembers(project({ origin: 'standalone', executionMode: 'workflow' }), {
        archivedRestartLocked: true,
        parentGroup: null,
      }),
    ).toBe(true);
  });
});

describe('canUnbindMissingSpawnedProjectMembers', () => {
  it('allows active spawned workflow projects when full member edit is locked', () => {
    expect(
      canUnbindMissingSpawnedProjectMembers(
        project({ origin: 'fixed_group', parentGroupId: 'g1', executionMode: 'workflow' }),
        { parentGroup },
      ),
    ).toBe(true);
  });

  it('blocks smart spawned (full edit already available)', () => {
    expect(
      canUnbindMissingSpawnedProjectMembers(
        project({ origin: 'fixed_group', parentGroupId: 'g1', executionMode: 'smart' }),
        { parentGroup },
      ),
    ).toBe(false);
  });

  it('blocks read-only / completed lifecycles, but not archived-restart badge', () => {
    expect(
      canUnbindMissingSpawnedProjectMembers(
        project({ origin: 'fixed_group', parentGroupId: 'g1', executionMode: 'workflow' }),
        { parentGroup, readOnly: true },
      ),
    ).toBe(false);
    expect(
      canUnbindMissingSpawnedProjectMembers(
        project({ origin: 'fixed_group', parentGroupId: 'g1', executionMode: 'workflow' }),
        { parentGroup, archivedRestartLocked: true },
      ),
    ).toBe(true);
    expect(
      canUnbindMissingSpawnedProjectMembers(
        project({
          origin: 'fixed_group',
          parentGroupId: 'g1',
          executionMode: 'workflow',
          lifecycle: 'completed',
        }),
        { parentGroup },
      ),
    ).toBe(false);
  });

  it('blocks standalone projects', () => {
    expect(
      canUnbindMissingSpawnedProjectMembers(
        project({ origin: 'standalone', executionMode: 'workflow' }),
        { parentGroup: null },
      ),
    ).toBe(false);
  });
});
