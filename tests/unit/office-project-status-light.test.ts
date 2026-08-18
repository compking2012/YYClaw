import { describe, expect, it } from 'vitest';
import {
  officeFixedGroupStatusLight,
  officeProjectStatusLight,
  officeProjectStatusLightDotStyle,
} from '@/lib/office-project-status-light';
import type { OfficeTempProject } from '@/types/office';

describe('officeProjectStatusLight', () => {
  it('maps pending to gray light', () => {
    expect(officeProjectStatusLight({ status: 'pending', nodeRuns: [] })).toBe('pending');
  });

  it('maps running project or node to green light', () => {
    expect(officeProjectStatusLight({ status: 'running', nodeRuns: [] })).toBe('running');
    expect(
      officeProjectStatusLight({
        status: 'pending',
        nodeRuns: [{ nodeId: 'n', agentId: 'a', status: 'running' }],
      }),
    ).toBe('running');
  });

  it('maps aborted and blocked to yellow light', () => {
    expect(officeProjectStatusLight({ status: 'aborted', nodeRuns: [] })).toBe('aborted');
    expect(officeProjectStatusLight({ status: 'blocked', nodeRuns: [] })).toBe('blocked');
  });

  it('maps completed to blue light', () => {
    expect(officeProjectStatusLight({ status: 'completed', nodeRuns: [] })).toBe('completed');
  });

  it('maps failed to red light', () => {
    expect(officeProjectStatusLight({ status: 'failed', nodeRuns: [] })).toBe('failed');
  });

  it('maps ready_to_settle review batch to awaiting_review', () => {
    expect(
      officeProjectStatusLight({
        status: 'running',
        nodeRuns: [{ nodeId: 'n', agentId: 'a', status: 'completed' }],
        workflowReviewBatch: {
          id: 'b',
          settleGeneration: 0,
          parallelGroup: 'serial:n',
          expectedNodeIds: ['n'],
          phase: 'ready_to_settle',
          items: { n: { nodeId: 'n', state: 'submitted' } },
          createdAt: 1,
          updatedAt: 1,
        },
      }),
    ).toBe('awaiting_review');
  });

  it('maps collecting review batch to awaiting_review', () => {
    expect(
      officeProjectStatusLight({
        status: 'running',
        nodeRuns: [{ nodeId: 'n', agentId: 'a', status: 'completed' }],
        workflowReviewBatch: {
          id: 'b',
          settleGeneration: 0,
          parallelGroup: 'serial:n',
          expectedNodeIds: ['n'],
          phase: 'collecting',
          items: { n: { nodeId: 'n', state: 'awaiting_decision' } },
          createdAt: 1,
          updatedAt: 1,
        },
      }),
    ).toBe('awaiting_review');
  });
});

describe('officeFixedGroupStatusLight', () => {
  const base = {
    origin: 'fixed_group' as const,
    parentGroupId: 'g1',
    lifecycle: 'active' as const,
    nodeRuns: [],
  };

  it('returns null when group has no active spawn projects', () => {
    expect(officeFixedGroupStatusLight('g1', [])).toBeNull();
    expect(
      officeFixedGroupStatusLight('g1', [
        {
          ...base,
          status: 'completed',
          lifecycle: 'completed',
        },
      ]),
    ).toBeNull();
  });

  it('prioritizes running over other child states', () => {
    const projects: Pick<OfficeTempProject, 'parentGroupId' | 'origin' | 'lifecycle' | 'status' | 'nodeRuns'>[] = [
      { ...base, status: 'completed' },
      { ...base, status: 'running' },
    ];
    expect(officeFixedGroupStatusLight('g1', projects)).toBe('running');
  });

  it('returns completed when all active children completed', () => {
    const projects = [
      { ...base, status: 'completed' as const },
      { ...base, status: 'completed' as const },
    ];
    expect(officeFixedGroupStatusLight('g1', projects)).toBe('completed');
  });

  it('returns aborted when a child is aborted', () => {
    const projects = [{ ...base, status: 'aborted' as const }];
    expect(officeFixedGroupStatusLight('g1', projects)).toBe('aborted');
  });
});

describe('officeProjectStatusLightDotStyle', () => {
  it('uses gray, green, yellow, and blue classes', () => {
    expect(officeProjectStatusLightDotStyle('pending').dotClass).toContain('muted');
    expect(officeProjectStatusLightDotStyle('running').dotClass).toBe('bg-emerald-500');
    expect(officeProjectStatusLightDotStyle('awaiting_review').dotClass).toBe('bg-violet-500');
    expect(officeProjectStatusLightDotStyle('aborted').dotClass).toBe('bg-amber-400');
    expect(officeProjectStatusLightDotStyle('completed').dotClass).toBe('bg-sky-500');
  });
});
