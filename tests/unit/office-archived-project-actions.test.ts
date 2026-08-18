import { describe, expect, it } from 'vitest';
import {
  canDeleteArchivedProject,
  canRestartArchivedProject,
  canUpgradeArchivedStandaloneProject,
} from '@/lib/office-archived-project-actions';

describe('office-archived-project-actions', () => {
  it('allows delete for any archived project (with a handler), not for active', () => {
    expect(canDeleteArchivedProject({ lifecycle: 'completed' }, true)).toBe(true);
    expect(canDeleteArchivedProject({ lifecycle: 'dissolved' }, true)).toBe(true);
    expect(canDeleteArchivedProject({ lifecycle: 'upgraded' }, true)).toBe(true);
    expect(canDeleteArchivedProject({ lifecycle: 'active' }, true)).toBe(false);
    expect(canDeleteArchivedProject({ lifecycle: 'completed' }, false)).toBe(false);
  });

  it('allows restart for archived non-upgraded projects', () => {
    expect(
      canRestartArchivedProject({ lifecycle: 'completed' }, true),
    ).toBe(true);
    expect(
      canRestartArchivedProject({ lifecycle: 'dissolved' }, true),
    ).toBe(true);
    expect(
      canRestartArchivedProject({ lifecycle: 'upgraded' }, true),
    ).toBe(false);
    expect(
      canRestartArchivedProject({ lifecycle: 'active' }, true),
    ).toBe(false);
    expect(
      canRestartArchivedProject({ lifecycle: 'completed' }, false),
    ).toBe(false);
  });

  it('allows upgrade for archived standalone projects eligible for promotion', () => {
    expect(
      canUpgradeArchivedStandaloneProject(
        { origin: 'standalone', status: 'completed', lifecycle: 'completed' },
        true,
      ),
    ).toBe(true);
    expect(
      canUpgradeArchivedStandaloneProject(
        { origin: 'standalone', status: 'aborted', lifecycle: 'dissolved' },
        true,
      ),
    ).toBe(true);
    expect(
      canUpgradeArchivedStandaloneProject(
        { origin: 'fixed_group', status: 'completed', lifecycle: 'completed' },
        true,
      ),
    ).toBe(false);
    expect(
      canUpgradeArchivedStandaloneProject(
        { origin: 'standalone', status: 'completed', lifecycle: 'upgraded' },
        true,
      ),
    ).toBe(false);
  });
});
