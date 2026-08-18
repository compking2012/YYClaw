import { describe, expect, it } from 'vitest';
import {
  alignNoOwnSpawnedProjectForRerun,
  materializeWorkflowForProjectRun,
  projectInheritsGroupTemplateOnSave,
} from '@/lib/office-task-workflow';
import {
  materializeOwnedWorkflowPayload,
  resolveEffectiveWorkflow,
  shouldReapplyTerminalWorkflowFreezeOnUpsert,
  shouldUseWorkflowFreezeSnapshot,
  withTerminalWorkflowFreeze,
  workflowFreezeSnapshotAsCompareGroup,
} from '@/lib/office-spawned-workflow-ownership';
import { buildTaskEditFormStateFromProject } from '@/lib/office-task-edit-form';
import {
  orchestrationModeFromGroup,
} from '@/lib/office-workflow-orchestration-mode';
import { orchestrationBaselineSnapshot } from '@/lib/office-orchestration-baseline';
import { orchestrationChangedFromBaseline } from '@/lib/office-workflow-preview-state';
import type { OfficeFixedGroup, OfficeTempProject, WorkflowDefinition } from '@/types/office';

const freezeWf: WorkflowDefinition = {
  mode: 'dag',
  nodes: [
    { id: 'gen-0', title: '计划', agentIds: ['pm'] },
    { id: 'gen-1', title: '总结', agentIds: ['pm'] },
  ],
  edges: [{ from: 'gen-0', to: 'gen-1' }],
};

const groupAtComplete: OfficeFixedGroup = {
  id: 'g1',
  name: 'g',
  agentIds: ['pm'],
  coordinatorAgentId: 'pm',
  workflow: freezeWf,
  workflowDescription: 'plan then summarize',
  workflowOrchestrationMode: 'heuristic',
  createdAt: 1,
  updatedAt: 1,
};

const liveLockedRule: OfficeFixedGroup = {
  ...groupAtComplete,
  workflow: {
    mode: 'dag',
    nodes: [{ id: 'gen-0', title: '计划', agentIds: ['pm'] }],
    edges: [],
  },
  workflowDescription: '',
  workflowOrchestrationMode: 'rule',
  workflowStepDrafts: [
    { input: '', agentIds: ['pm'], task: '计划', output: '', linkMode: 'serial' },
  ],
  updatedAt: 99,
};

function completedFrozen(): OfficeTempProject {
  return withTerminalWorkflowFreeze(
    {
      id: 'p1',
      title: '派出',
      origin: 'fixed_group',
      parentGroupId: 'g1',
      inheritsGroupTemplate: true,
      workflow: { mode: 'dag', nodes: [], edges: [] },
      executionMode: 'workflow',
      status: 'completed',
      lifecycle: 'active',
      agentIds: ['pm'],
      coordinatorAgentId: 'pm',
      featureDescription: 'f',
      description: '',
      nodeRuns: [
        { nodeId: 'gen-0', agentId: 'pm', status: 'completed' },
        { nodeId: 'gen-1', agentId: 'pm', status: 'completed' },
      ],
      createdAt: 1,
      updatedAt: 1,
    },
    groupAtComplete,
  );
}

describe('HOLE fix: rerun / freeze / edit integrity', () => {
  it('HOLE-H1: align clear freeze demotes completed so materialize follows live group', () => {
    const project = completedFrozen();
    const aligned = alignNoOwnSpawnedProjectForRerun(project, liveLockedRule);
    expect(aligned.workflowFreezeSnapshot).toBeUndefined();
    expect(aligned.status).toBe('pending');

    const effective = resolveEffectiveWorkflow(aligned, liveLockedRule);
    const materialized = materializeWorkflowForProjectRun(aligned, liveLockedRule, [
      { agentId: 'pm', displayName: 'PM' },
    ]);
    expect(effective.nodes.length).toBeGreaterThan(0);
    expect(materialized.nodes.length).toBeGreaterThan(0);
    expect(materialized.nodes[0]?.title).toBe('计划');
  });

  it('HOLE-H2: already-completed upsert never re-freezes (prune-safe)', () => {
    const project = completedFrozen();
    const cleared = { ...project, workflowFreezeSnapshot: undefined, status: 'completed' as const };
    expect(shouldReapplyTerminalWorkflowFreezeOnUpsert(cleared, project)).toBe(false);
    expect(shouldReapplyTerminalWorkflowFreezeOnUpsert(cleared, cleared)).toBe(false);
    expect(
      shouldReapplyTerminalWorkflowFreezeOnUpsert(
        { ...cleared, status: 'completed', workflowFreezeSnapshot: undefined },
        { status: 'running', workflowFreezeSnapshot: undefined },
      ),
    ).toBe(true);
  });

  it('HOLE-H3: freeze form orchestration stays clean vs baseline (not live locked)', () => {
    const project = completedFrozen();
    const form = buildTaskEditFormStateFromProject(project, liveLockedRule, (id) => id);
    expect(shouldUseWorkflowFreezeSnapshot(project)).toBe(true);
    expect(form.workflowOrchestrationMode).toBe('heuristic');

    const baseline = orchestrationBaselineSnapshot({
      orchestrationMode: form.workflowOrchestrationMode,
      heuristicDescription: form.heuristicWorkflowDescription,
      workflowStepDrafts: form.workflowStepDrafts,
    });
    // Freeze path effective mode = form mode (not live rule)
    expect(orchestrationModeFromGroup(liveLockedRule)).toBe('rule');
    expect(
      orchestrationChangedFromBaseline(
        {
          orchestrationMode: form.workflowOrchestrationMode,
          heuristicDescription: form.heuristicWorkflowDescription,
          workflowStepDrafts: form.workflowStepDrafts,
        },
        baseline,
      ),
    ).toBe(false);
  });

  it('HOLE-H4: elevating from freeze materializes with freeze compare group mode', () => {
    const project = completedFrozen();
    const form = buildTaskEditFormStateFromProject(project, liveLockedRule, (id) => id);
    const freezeCompare = workflowFreezeSnapshotAsCompareGroup(project.workflowFreezeSnapshot!);
    expect(
      projectInheritsGroupTemplateOnSave(freezeCompare, {
        parentGroupId: 'g1',
        executionMode: 'workflow',
        description: 'user edited freeze text',
        heuristicWorkflowDescription: 'user edited freeze text',
        workflow: form.workflow,
        workflowOrchestrationMode: 'heuristic',
        agentIds: ['pm'],
        coordinatorAgentId: 'pm',
        previousOwnsWorkflow: false,
      }),
    ).toBe(false);

    const owned = materializeOwnedWorkflowPayload({
      workflow: form.workflow,
      description: 'user edited freeze text',
      workflowOrchestrationMode: 'heuristic',
      agentIds: ['pm'],
      coordinatorAgentId: 'pm',
      group: { ...liveLockedRule, ...freezeCompare },
    });
    expect(owned.workflowOrchestrationMode).toBe('heuristic');
    expect(owned.inheritsGroupTemplate).toBe(false);
  });
});
