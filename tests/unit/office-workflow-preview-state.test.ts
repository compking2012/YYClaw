import { describe, expect, it } from 'vitest';
import {
  buildOrchestrationInputKey,
  initialPreviewSyncedKey,
  isOrchestrationPreviewStale,
  orchestrationChangedFromBaseline,
  shouldReuseGroupWorkflowOnSave,
  spawnedProjectHasNoOwnOrchestration,
} from '@/lib/office-workflow-preview-state';
import { emptyWorkflowStepDraftRow } from '@/lib/office-workflow-step-drafts';

describe('office-workflow-preview-state', () => {
  it('buildOrchestrationInputKey distinguishes heuristic description', () => {
    expect(
      buildOrchestrationInputKey({
        orchestrationMode: 'heuristic',
        workflowStepDrafts: [],
        heuristicDescription: 'Flow A',
      }),
    ).toBe('Flow A');
  });

  it('orchestrationChangedFromBaseline detects description edits', () => {
    const baseline = {
      orchestrationMode: 'heuristic' as const,
      workflowStepDrafts: [],
      heuristicDescription: 'Old',
    };
    const current = { ...baseline, heuristicDescription: 'New' };
    expect(orchestrationChangedFromBaseline(current, baseline)).toBe(true);
    expect(orchestrationChangedFromBaseline(baseline, baseline)).toBe(false);
  });

  it('isOrchestrationPreviewStale when preview key lags current inputs', () => {
    const current = {
      orchestrationMode: 'heuristic' as const,
      workflowStepDrafts: [],
      heuristicDescription: 'Updated',
    };
    expect(isOrchestrationPreviewStale('Old', current)).toBe(true);
    expect(isOrchestrationPreviewStale('Updated', current)).toBe(false);
  });

  it('isOrchestrationPreviewStale for create form with new description', () => {
    expect(
      isOrchestrationPreviewStale(null, {
        orchestrationMode: 'heuristic',
        workflowStepDrafts: [],
        heuristicDescription: 'New task flow',
      }),
    ).toBe(true);
    expect(
      isOrchestrationPreviewStale(null, {
        orchestrationMode: 'heuristic',
        workflowStepDrafts: [],
        heuristicDescription: '',
      }),
    ).toBe(false);
  });

  it('spawnedProjectHasNoOwnOrchestration when no description and no drafts', () => {
    expect(
      spawnedProjectHasNoOwnOrchestration({
        orchestrationMode: 'heuristic',
        workflowStepDrafts: [],
        heuristicDescription: '',
      }),
    ).toBe(true);
    expect(
      spawnedProjectHasNoOwnOrchestration({
        orchestrationMode: 'rule',
        workflowStepDrafts: [],
        heuristicDescription: '',
      }),
    ).toBe(true);
    expect(
      spawnedProjectHasNoOwnOrchestration({
        orchestrationMode: 'rule',
        workflowStepDrafts: [{ ...emptyWorkflowStepDraftRow(), task: 'Step', agentIds: ['a1'] }],
        heuristicDescription: '',
      }),
    ).toBe(false);
  });

  it('shouldReuseGroupWorkflowOnSave requires spawn + group and not dirty', () => {
    const orchestration = {
      orchestrationMode: 'heuristic' as const,
      workflowStepDrafts: [],
      heuristicDescription: '',
    };
    const group = {
      workflow: { mode: 'dag' as const, nodes: [], edges: [] },
      workflowDescription: '',
      workflowStepDrafts: [],
      workflowOrchestrationMode: 'heuristic' as const,
      agentIds: ['a1'],
      coordinatorAgentId: 'a1',
    };
    expect(shouldReuseGroupWorkflowOnSave({ spawnFromGroup: true, orchestration })).toBe(false);
    expect(
      shouldReuseGroupWorkflowOnSave({
        spawnFromGroup: true,
        orchestration,
        group,
        agentIds: ['a1'],
        coordinatorAgentId: 'a1',
      }),
    ).toBe(true);
    expect(shouldReuseGroupWorkflowOnSave({ spawnFromGroup: false, orchestration, group })).toBe(
      false,
    );
    expect(
      shouldReuseGroupWorkflowOnSave({
        spawnFromGroup: true,
        orchestration: { ...orchestration, heuristicDescription: 'Custom' },
        group: { ...group, workflowDescription: '' },
        agentIds: ['a1'],
        coordinatorAgentId: 'a1',
      }),
    ).toBe(false);
  });

  it('initialPreviewSyncedKey seeds from materialized workflow', () => {
    const orchestration = {
      orchestrationMode: 'heuristic' as const,
      workflowStepDrafts: [],
      heuristicDescription: 'Saved flow',
    };
    expect(
      initialPreviewSyncedKey({ orchestration, hasMaterializedWorkflow: true }),
    ).toBe('Saved flow');
    expect(initialPreviewSyncedKey({ orchestration, hasMaterializedWorkflow: false })).toBeNull();
  });
});
