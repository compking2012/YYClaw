import { beforeEach, describe, expect, it } from 'vitest';
import {
  ProjectAbortQuiescingError,
  assertProjectNotAbortQuiescing,
  clearAbortQuiesceLock,
  getAbortQuiesceLock,
  isAbortQuiescing,
  resetAbortQuiesceLocksForTests,
  setAbortQuiesceLock,
} from '@electron/services/office/project-abort-quiesce';

describe('project-abort-quiesce', () => {
  beforeEach(() => {
    resetAbortQuiesceLocksForTests();
  });

  it('stores and clears locks by generation', () => {
    setAbortQuiesceLock({
      projectId: 'p1',
      generation: 2,
      startedAt: 100,
      staticSessionKeys: ['s1'],
      inflightSessionKeys: ['i1'],
      abortWork: Promise.resolve(),
    });
    expect(isAbortQuiescing('p1')).toBe(true);
    expect(getAbortQuiesceLock('p1')?.generation).toBe(2);

    expect(clearAbortQuiesceLock('p1', 1)).toBeUndefined();
    expect(isAbortQuiescing('p1')).toBe(true);

    expect(clearAbortQuiesceLock('p1', 2)?.generation).toBe(2);
    expect(isAbortQuiescing('p1')).toBe(false);
  });

  it('assertProjectNotAbortQuiescing throws while locked', () => {
    setAbortQuiesceLock({
      projectId: 'p1',
      generation: 1,
      startedAt: 1,
      staticSessionKeys: [],
      inflightSessionKeys: [],
      abortWork: Promise.resolve(),
    });
    expect(() => assertProjectNotAbortQuiescing('p1')).toThrow(ProjectAbortQuiescingError);
    clearAbortQuiesceLock('p1', 1);
    expect(() => assertProjectNotAbortQuiescing('p1')).not.toThrow();
  });
});
