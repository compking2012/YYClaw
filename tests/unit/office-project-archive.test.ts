import { describe, expect, it } from 'vitest';
import {
  resolveProjectArchiveTransition,
  isWorkflowResumeEligible,
  shouldPreserveArchivedCompletedExecution,
  shouldPreserveArchivedWorkflowProgress,
  shouldPreserveChildProjectNodeRunsOnGroupSync,
} from '@/lib/office-project-archive';

describe('resolveProjectArchiveTransition', () => {
  it('maps successful completion to completed lifecycle', () => {
    expect(
      resolveProjectArchiveTransition({ status: 'completed', nodeRuns: [] }),
    ).toEqual({ lifecycle: 'completed', status: 'completed' });
  });

  it('maps forced running archive to dissolved + aborted', () => {
    expect(
      resolveProjectArchiveTransition(
        { status: 'running', nodeRuns: [{ nodeId: 'n1', agentId: 'a', status: 'running' }] },
        { forcedWhileExecuting: true },
      ),
    ).toEqual({ lifecycle: 'dissolved', status: 'aborted' });
  });

  it('maps never-started archive to dissolved + pending', () => {
    expect(
      resolveProjectArchiveTransition({ status: 'pending', nodeRuns: [] }),
    ).toEqual({ lifecycle: 'dissolved', status: 'pending' });
  });

  it('maps already-aborted archive to dissolved + aborted', () => {
    expect(
      resolveProjectArchiveTransition({ status: 'aborted', nodeRuns: [] }),
    ).toEqual({ lifecycle: 'dissolved', status: 'aborted' });
  });

  it('maps failed manual archive to dissolved + aborted', () => {
    expect(
      resolveProjectArchiveTransition({ status: 'failed', nodeRuns: [] }),
    ).toEqual({ lifecycle: 'dissolved', status: 'aborted' });
  });

  it('detects workflow archives that should preserve nodeRuns for resume', () => {
    expect(
      shouldPreserveArchivedWorkflowProgress({
        lifecycle: 'dissolved',
        status: 'aborted',
        executionMode: 'workflow',
        nodeRuns: [{ nodeId: 'n1', agentId: 'a', status: 'failed' }],
      }),
    ).toBe(true);
    expect(
      shouldPreserveArchivedWorkflowProgress({
        lifecycle: 'dissolved',
        status: 'aborted',
        executionMode: 'workflow',
        nodeRuns: [],
      }),
    ).toBe(false);
    expect(
      shouldPreserveArchivedWorkflowProgress({
        lifecycle: 'dissolved',
        status: 'pending',
        executionMode: 'workflow',
        nodeRuns: [{ nodeId: 'n1', agentId: 'a', status: 'pending' }],
      }),
    ).toBe(false);
  });

  it('detects completed archives that should preserve execution on restart', () => {
    expect(
      shouldPreserveArchivedCompletedExecution({
        lifecycle: 'completed',
        status: 'completed',
      }),
    ).toBe(true);
    expect(
      shouldPreserveArchivedCompletedExecution({
        lifecycle: 'dissolved',
        status: 'completed',
      }),
    ).toBe(false);
  });

  it('detects active restarted workflow projects eligible for continue', () => {
    expect(
      isWorkflowResumeEligible({
        lifecycle: 'active',
        status: 'aborted',
        executionMode: 'workflow',
        nodeRuns: [{ nodeId: 'n1', agentId: 'a', status: 'failed' }],
      }),
    ).toBe(true);
    expect(
      isWorkflowResumeEligible({
        lifecycle: 'dissolved',
        status: 'aborted',
        executionMode: 'workflow',
        nodeRuns: [{ nodeId: 'n1', agentId: 'a', status: 'failed' }],
      }),
    ).toBe(false);
    expect(
      isWorkflowResumeEligible({
        lifecycle: 'active',
        status: 'running',
        executionMode: 'workflow',
        nodeRuns: [{ nodeId: 'n1', agentId: 'a', status: 'running' }],
      }),
    ).toBe(false);
  });

  it('preserves nodeRuns on group sync for completed and resumable child projects', () => {
    const nodeRuns = [{ nodeId: 'n1', agentId: 'a', status: 'completed' as const }];
    expect(
      shouldPreserveChildProjectNodeRunsOnGroupSync({
        lifecycle: 'active',
        status: 'completed',
        executionMode: 'workflow',
        nodeRuns,
      }),
    ).toBe(true);
    expect(
      shouldPreserveChildProjectNodeRunsOnGroupSync({
        lifecycle: 'completed',
        status: 'completed',
        executionMode: 'workflow',
        nodeRuns,
      }),
    ).toBe(true);
    expect(
      shouldPreserveChildProjectNodeRunsOnGroupSync({
        lifecycle: 'active',
        status: 'aborted',
        executionMode: 'workflow',
        nodeRuns,
      }),
    ).toBe(true);
    expect(
      shouldPreserveChildProjectNodeRunsOnGroupSync({
        lifecycle: 'active',
        status: 'pending',
        executionMode: 'workflow',
        nodeRuns: [],
      }),
    ).toBe(false);
  });
});
