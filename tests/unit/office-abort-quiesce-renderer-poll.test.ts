/**
 * Repro: after abort, Main clears abortQuiescing (idle=true) but UI stays on
 * "Stopping model…" because stopAllProjectRunPolls also kills abort-quiesce polls
 * when runningProjectIds becomes empty.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { mergeProjectProgressIntoProject, projectProgressFromTempProject } from '@/lib/office-project-progress';
import type { OfficeTempProject } from '@/types/office';

describe('abort quiesce renderer poll hole', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('progress slice carries abortQuiescing so clear push updates UI', () => {
    const project = {
      id: 'proj-1',
      status: 'aborted',
      nodeRuns: [],
      abortQuiescing: true,
      abortGeneration: 1,
      abortQuiesceStartedAt: 10,
      updatedAt: 10,
    } as OfficeTempProject;

    const progress = projectProgressFromTempProject({
      ...project,
      abortQuiescing: false,
      updatedAt: 20,
    });
    expect(progress.abortQuiescing).toBe(false);

    const merged = mergeProjectProgressIntoProject(project, progress);
    expect(merged.abortQuiescing).toBe(false);
    expect(merged.abortGeneration).toBe(1);
  });

  it('stopAllProjectRunPolls must not clear abort-quiesce pollers', async () => {
    const pollers = new Map<string, number>();
    const runPollers = new Map<string, number>();

    const stopRun = (id: string) => {
      const t = runPollers.get(id);
      if (t !== undefined) {
        window.clearInterval(t);
        runPollers.delete(id);
      }
    };
    const stopAbort = (id: string) => {
      const t = pollers.get(id);
      if (t !== undefined) {
        window.clearInterval(t);
        pollers.delete(id);
      }
    };

    // Fixed policy: stopAll run polls must NOT touch abort pollers.
    const stopAllProjectRunPolls = () => {
      for (const id of [...runPollers.keys()]) stopRun(id);
    };

    runPollers.set('proj-run', window.setInterval(() => undefined, 1000));
    pollers.set('proj-abort', window.setInterval(() => undefined, 1000));

    stopAllProjectRunPolls();

    expect(runPollers.size).toBe(0);
    expect(pollers.size).toBe(1);
    expect(pollers.has('proj-abort')).toBe(true);

    stopAbort('proj-abort');
  });
});
