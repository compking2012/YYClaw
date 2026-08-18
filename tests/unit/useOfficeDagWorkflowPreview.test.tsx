import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const previewDagWorkflow = vi.fn();
vi.mock('@/lib/office-workflow-preview', () => ({
  previewDagWorkflow: (...args: unknown[]) => previewDagWorkflow(...args),
}));

import { useOfficeDagWorkflowPreview } from '@/hooks/useOfficeDagWorkflowPreview';
import { buildOrchestrationInputKey } from '@/lib/office-workflow-preview-state';
import { emptyWorkflow } from '@/lib/office-workflow-roles';

const members = [{ agentId: 'a1', name: 'Alice' }];
const baseline = {
  orchestrationMode: 'heuristic' as const,
  workflowStepDrafts: [],
  heuristicDescription: 'Initial flow',
};

beforeEach(() => {
  previewDagWorkflow.mockReset();
});

describe('useOfficeDagWorkflowPreview', () => {
  it('marks preview stale when orchestration inputs change', () => {
    const workflow = {
      mode: 'dag' as const,
      nodes: [{ id: 'n1', title: 'Step', agentIds: ['a1'] }],
      edges: [],
    };
    const { result, rerender } = renderHook(
      (props: { description: string }) =>
        useOfficeDagWorkflowPreview({
          executionMode: 'workflow',
          orchestrationMode: 'heuristic',
          workflowStepDrafts: [],
          heuristicDescription: props.description,
          workflow,
          members,
          agentIds: ['a1'],
          orchestrationBaseline: baseline,
          baselineHasMaterializedWorkflow: true,
        }),
      { initialProps: { description: 'Initial flow' } },
    );

    expect(result.current.isStale).toBe(false);

    rerender({ description: 'Updated flow' });
    expect(result.current.isStale).toBe(true);
  });

  it('runPreview syncs key and clears stale state', async () => {
    previewDagWorkflow.mockResolvedValue({
      ok: true,
      workflow: {
        mode: 'dag',
        nodes: [{ id: 'n1', title: 'Preview step', agentIds: ['a1'] }],
        edges: [],
      },
      source: 'ai',
    });

    const { result, rerender } = renderHook(
      (props: { description: string; workflowNodes: number }) =>
        useOfficeDagWorkflowPreview({
          executionMode: 'workflow',
          orchestrationMode: 'heuristic',
          workflowStepDrafts: [],
          heuristicDescription: props.description,
          workflow:
            props.workflowNodes > 0
              ? {
                mode: 'dag',
                nodes: [{ id: 'n1', title: 'Preview step', agentIds: ['a1'] }],
                edges: [],
              }
              : emptyWorkflow('dag'),
          members,
          agentIds: ['a1'],
          orchestrationBaseline: baseline,
          baselineHasMaterializedWorkflow: false,
        }),
      { initialProps: { description: 'Initial flow', workflowNodes: 0 } },
    );

    rerender({ description: 'Updated flow', workflowNodes: 0 });
    expect(result.current.isStale).toBe(true);

    await act(async () => {
      const preview = await result.current.runPreview();
      expect(preview.ok).toBe(true);
    });

    rerender({ description: 'Updated flow', workflowNodes: 1 });

    await waitFor(() => {
      expect(result.current.isStale).toBe(false);
    });
    expect(result.current.previewSyncedKey).toBe(
      buildOrchestrationInputKey({
        orchestrationMode: 'heuristic',
        workflowStepDrafts: [],
        heuristicDescription: 'Updated flow',
      }),
    );
  });

  it('resets preview sync when orchestration baseline changes', () => {
    const workflow = {
      mode: 'dag' as const,
      nodes: [{ id: 'n1', title: 'Step', agentIds: ['a1'] }],
      edges: [],
    };
    const { result, rerender } = renderHook(
      (props: { baseline: typeof baseline }) =>
        useOfficeDagWorkflowPreview({
          executionMode: 'workflow',
          orchestrationMode: 'heuristic',
          workflowStepDrafts: [],
          heuristicDescription: 'Initial flow',
          workflow,
          members,
          agentIds: ['a1'],
          orchestrationBaseline: props.baseline,
          baselineHasMaterializedWorkflow: true,
        }),
      { initialProps: { baseline } },
    );

    act(() => {
      result.current.markPreviewSynced('custom-key');
    });
    expect(result.current.previewSyncedKey).toBe('custom-key');

    rerender({
      baseline: {
        orchestrationMode: 'heuristic',
        workflowStepDrafts: [],
        heuristicDescription: 'Different baseline',
      },
    });
    expect(result.current.previewSyncedKey).toBe('Different baseline');
  });
});
