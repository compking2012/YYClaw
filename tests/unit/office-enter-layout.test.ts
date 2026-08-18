import { describe, expect, it } from 'vitest';
import {
  resolveOfficeEnterActiveProject,
  shouldAutoExpandPreferredProject,
  shouldDeferPollRoomAutoExpand,
} from '@/lib/office-enter-layout';

describe('office-enter-layout', () => {
  it('resolveOfficeEnterActiveProject: no preferred keeps collapsed', () => {
    expect(resolveOfficeEnterActiveProject(null, () => true)).toEqual({
      activeProjectId: null,
      pendingAutoExpandId: null,
    });
  });

  it('resolveOfficeEnterActiveProject: cache hit expands immediately', () => {
    expect(resolveOfficeEnterActiveProject('p1', (id) => id === 'p1')).toEqual({
      activeProjectId: 'p1',
      pendingAutoExpandId: null,
    });
  });

  it('resolveOfficeEnterActiveProject: cache miss waits with pending', () => {
    expect(resolveOfficeEnterActiveProject('p1', () => false)).toEqual({
      activeProjectId: null,
      pendingAutoExpandId: 'p1',
    });
  });

  it('shouldDeferPollRoomAutoExpand while pending preferred prefetch', () => {
    expect(shouldDeferPollRoomAutoExpand('p1')).toBe(true);
    expect(shouldDeferPollRoomAutoExpand(null)).toBe(false);
  });

  it('shouldAutoExpandPreferredProject when ready and nothing expanded', () => {
    expect(shouldAutoExpandPreferredProject('p1', null, () => true)).toBe(true);
    expect(shouldAutoExpandPreferredProject('p1', 'other', () => true)).toBe(false);
    expect(shouldAutoExpandPreferredProject('p1', null, () => false)).toBe(false);
    expect(shouldAutoExpandPreferredProject(null, null, () => true)).toBe(false);
  });
});
