import { describe, expect, it } from 'vitest';
import { reactivateArchivedProjectRecord } from '../../electron/services/office/agent-binding';
import {
  projectShowsArchivedRestartBadge,
  projectSourceGroupName,
  resolveProjectSourceBadgeKind,
  truncateProjectSourceGroupName,
} from '@/lib/office-project-source-badge';
import type { OfficeTempProject } from '@/types/office';

function project(overrides: Partial<OfficeTempProject> = {}): OfficeTempProject {
  return {
    id: 'p1',
    title: 'T',
    origin: 'standalone',
    agentIds: ['a'],
    coordinatorAgentId: 'a',
    lifecycle: 'active',
    featureDescription: '',
    description: '',
    status: 'pending',
    nodeRuns: [],
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe('office-project-source-badge', () => {
  it('truncates group name to 8 chars with ellipsis', () => {
    expect(truncateProjectSourceGroupName('短名')).toBe('短名');
    expect(truncateProjectSourceGroupName('一二三四五六七八九')).toBe('一二三四五六七八…');
  });

  it('resolves source badge kinds', () => {
    expect(resolveProjectSourceBadgeKind(project())).toBe('standalone');
    expect(
      resolveProjectSourceBadgeKind(project({ lifecycle: 'upgraded' })),
    ).toBe('standalone-upgraded');
    expect(
      resolveProjectSourceBadgeKind(
        project({ origin: 'fixed_group', parentGroupId: 'g1' }),
      ),
    ).toBe('spawn');
  });

  it('shows archived restart badge only for active projects with timestamp', () => {
    expect(
      projectShowsArchivedRestartBadge({ lifecycle: 'active', archivedRestartedAt: 100 }),
    ).toBe(true);
    expect(
      projectShowsArchivedRestartBadge({ lifecycle: 'completed', archivedRestartedAt: 100 }),
    ).toBe(false);
    expect(projectShowsArchivedRestartBadge({ lifecycle: 'active' })).toBe(false);
  });

  it('reactivateArchivedProjectRecord sets archivedRestartedAt', () => {
    const archived = project({
      lifecycle: 'dissolved',
      status: 'aborted',
      executionMode: 'workflow',
      nodeRuns: [{ nodeId: 'n1', agentId: 'a', status: 'failed' }],
    });
    const reactivated = reactivateArchivedProjectRecord(archived);
    expect(reactivated.archivedRestartedAt).toBeGreaterThan(0);
    expect(projectShowsArchivedRestartBadge(reactivated)).toBe(true);
  });

  it('projectSourceGroupName uses group name when provided', () => {
    expect(
      projectSourceGroupName({ parentGroupId: 'g1' }, { name: '研发团队Alpha' }),
    ).toBe('研发团队Alph…');
  });
});
