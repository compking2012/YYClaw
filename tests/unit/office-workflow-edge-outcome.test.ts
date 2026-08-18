import { describe, expect, it } from 'vitest';
import {
  isWorkflowDeliverableConclusionFailure,
  langGraphNodeRunRoute,
  nodeRunHasFailureConclusion,
  nodeRunRoutesToFailureTargets,
  nodeRunTriggersFailureEdge,
  readWorkflowDeliverableConclusionFromMirrorText,
} from '@/lib/office-workflow-edge-outcome';

describe('office-workflow-edge-outcome', () => {
  it('failure is only deliverable.conclusion === 不通过 (not free-text 失败)', () => {
    expect(isWorkflowDeliverableConclusionFailure('不通过')).toBe(true);
    expect(isWorkflowDeliverableConclusionFailure('通过')).toBe(false);
    expect(
      readWorkflowDeliverableConclusionFromMirrorText(
        '摘要：64通过/0失败\n结论：通过',
      ),
    ).toBe('通过');
    expect(
      nodeRunHasFailureConclusion({
        status: 'completed',
        summary: '摘要：执行73条，0失败，建议验收通过\n结论：通过',
      }),
    ).toBe(false);
    expect(
      nodeRunHasFailureConclusion({
        status: 'completed',
        summary: '路径：a.md\n结论：不通过',
      }),
    ).toBe(true);
  });

  it('nodeRunHasFailureConclusion only matches completed business failure', () => {
    expect(
      nodeRunHasFailureConclusion({
        status: 'completed',
        edgeOutcome: 'failure',
      }),
    ).toBe(true);
    expect(
      nodeRunHasFailureConclusion({
        status: 'failed',
        edgeOutcome: 'failure',
        error: 'No API key',
      }),
    ).toBe(false);
    expect(
      nodeRunHasFailureConclusion({
        status: 'completed',
        edgeOutcome: 'success',
        summary: '结论：不通过',
      }),
    ).toBe(false);
  });

  it('nodeRunRoutesToFailureTargets aligns with business failure only', () => {
    expect(
      nodeRunRoutesToFailureTargets({ status: 'completed', edgeOutcome: 'failure' }),
    ).toBe(true);
    expect(
      nodeRunRoutesToFailureTargets({ status: 'failed', edgeOutcome: 'failure' }),
    ).toBe(false);
    expect(
      nodeRunRoutesToFailureTargets({ status: 'failed', edgeOutcome: undefined }),
    ).toBe(false);
  });

  it('langGraphNodeRunRoute halts technical failed and avoids success misroute', () => {
    expect(
      langGraphNodeRunRoute({ status: 'failed', edgeOutcome: 'failure', error: 'timeout' }),
    ).toBe('halt');
    expect(
      langGraphNodeRunRoute({ status: 'failed', edgeOutcome: undefined }),
    ).toBe('halt');
    expect(
      langGraphNodeRunRoute({ status: 'completed', edgeOutcome: 'failure' }),
    ).toBe('failure');
    expect(
      langGraphNodeRunRoute({ status: 'completed', edgeOutcome: 'success' }),
    ).toBe('success');
    expect(langGraphNodeRunRoute({ status: 'pending' })).toBe('pending');
  });

  it('nodeRunTriggersFailureEdge only for business completed+failure', () => {
    expect(
      nodeRunTriggersFailureEdge({ status: 'failed', edgeOutcome: undefined }),
    ).toBe(false);
    expect(
      nodeRunTriggersFailureEdge({ status: 'failed', edgeOutcome: 'failure' }),
    ).toBe(false);
    expect(
      nodeRunTriggersFailureEdge({ status: 'completed', edgeOutcome: 'failure' }),
    ).toBe(true);
  });
});
