import { describe, expect, it } from 'vitest';
import {
  fixedGroupExecutionMode,
  hasActiveParentFixedGroup,
  isFixedGroupSpawnedProject,
  isSelfBuiltOfficeProject,
} from '@/lib/office-fixed-group';

const parentGroup = { id: 'g-1' };

describe('isFixedGroupSpawnedProject', () => {
  it('returns true only when parent fixed group still exists', () => {
    expect(
      isFixedGroupSpawnedProject({ origin: 'fixed_group', parentGroupId: 'g-1' }, parentGroup),
    ).toBe(true);
    expect(
      isFixedGroupSpawnedProject({ origin: 'standalone', parentGroupId: 'g-1' }, parentGroup),
    ).toBe(false);
  });

  it('returns false for orphan parentGroupId without group record', () => {
    expect(
      isFixedGroupSpawnedProject({ origin: 'fixed_group', parentGroupId: 'g-1' }, null),
    ).toBe(false);
    expect(
      isFixedGroupSpawnedProject({ origin: 'standalone', parentGroupId: 'g-1' }, null),
    ).toBe(false);
  });

  it('returns false for standalone without parent', () => {
    expect(isFixedGroupSpawnedProject({ origin: 'standalone' }, parentGroup)).toBe(false);
  });
});

describe('isSelfBuiltOfficeProject', () => {
  it('is inverse of active parent group link', () => {
    const spawned = { origin: 'fixed_group' as const, parentGroupId: 'g-1' };
    expect(isSelfBuiltOfficeProject(spawned, null)).toBe(true);
    expect(isSelfBuiltOfficeProject(spawned, parentGroup)).toBe(false);

    const staleStandalone = { origin: 'standalone' as const, parentGroupId: 'g-1' };
    expect(isSelfBuiltOfficeProject(staleStandalone, parentGroup)).toBe(true);
  });
});

describe('hasActiveParentFixedGroup', () => {
  it('requires matching parent id and fixed_group origin', () => {
    expect(
      hasActiveParentFixedGroup({ origin: 'fixed_group', parentGroupId: 'g-1' }, parentGroup),
    ).toBe(true);
    expect(
      hasActiveParentFixedGroup({ origin: 'standalone', parentGroupId: 'g-1' }, parentGroup),
    ).toBe(false);
    expect(hasActiveParentFixedGroup({ parentGroupId: 'g-2' }, parentGroup)).toBe(false);
  });
});

describe('fixedGroupExecutionMode', () => {
  it('defaults to workflow', () => {
    expect(fixedGroupExecutionMode({})).toBe('workflow');
  });

  it('maps smart', () => {
    expect(fixedGroupExecutionMode({ executionMode: 'smart' })).toBe('smart');
  });
});
