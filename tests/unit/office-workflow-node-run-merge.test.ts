import { describe, expect, it } from 'vitest';
import {
  mergeNodeRunLists,
  mergeNodeRunRecord,
  nodeRunProgressRank,
} from '@/lib/office-workflow-node-run-merge';
import type { NodeRunRecord } from '@/types/office';

describe('office-workflow-node-run-merge', () => {
  it('ranks running ahead of pending', () => {
    expect(nodeRunProgressRank('pending')).toBeLessThan(nodeRunProgressRank('running'));
    expect(nodeRunProgressRank('running')).toBeLessThan(nodeRunProgressRank('completed'));
  });

  it('keeps running sibling when parallel branch persists pending snapshot', () => {
    const devRunning: NodeRunRecord = {
      nodeId: 'lg-5',
      roleId: 'dev',
      status: 'running',
      runId: 'run-dev-1',
      startedAt: 1000,
    };
    const devPending: NodeRunRecord = {
      nodeId: 'lg-5',
      roleId: 'dev',
      status: 'pending',
    };
    expect(mergeNodeRunRecord(devPending, devRunning)).toMatchObject({
      status: 'running',
      runId: 'run-dev-1',
    });
  });

  it('mergeNodeRunLists preserves both parallel branches', () => {
    const testRunning: NodeRunRecord = {
      nodeId: 'lg-4',
      roleId: 'qa',
      status: 'running',
      runId: 'run-qa-1',
    };
    const devRunning: NodeRunRecord = {
      nodeId: 'lg-5',
      roleId: 'dev',
      status: 'running',
      runId: 'run-dev-1',
    };
    const staleSnapshot: NodeRunRecord[] = [
      testRunning,
      { nodeId: 'lg-5', roleId: 'dev', status: 'pending' },
    ];
    const merged = mergeNodeRunLists([devRunning], staleSnapshot);
    expect(merged.find((run) => run.nodeId === 'lg-4')).toMatchObject({ status: 'running' });
    expect(merged.find((run) => run.nodeId === 'lg-5')).toMatchObject({
      status: 'running',
      runId: 'run-dev-1',
    });
  });

  it('prefers higher reworkGeneration even when status resets to pending', () => {
    const beforeRollback: NodeRunRecord = {
      nodeId: 'lg-5',
      roleId: 'dev',
      status: 'completed',
      completedAt: 2000,
      reworkGeneration: 1,
    };
    const reopened: NodeRunRecord = {
      nodeId: 'lg-5',
      roleId: 'dev',
      status: 'pending',
      reworkGeneration: 2,
      reworkReason: '审计不通过，要求重做',
    };
    expect(mergeNodeRunRecord(beforeRollback, reopened)).toMatchObject({
      status: 'pending',
      reworkGeneration: 2,
      reworkReason: '审计不通过，要求重做',
    });
  });
});
