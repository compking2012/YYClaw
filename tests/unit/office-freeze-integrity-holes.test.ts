import { describe, expect, it } from 'vitest';
import {
  shouldApplyTerminalWorkflowFreeze,
  shouldReapplyTerminalWorkflowFreezeOnUpsert,
  shouldUseWorkflowFreezeSnapshot,
  withTerminalWorkflowFreeze,
  workflowFreezeSnapshotAsCompareGroup,
  spawnedWorkflowDirtyVsGroup,
  workflowsStructurallyEqual,
} from '@/lib/office-spawned-workflow-ownership';
import {
  alignNoOwnSpawnedProjectForRerun,
  projectInheritsGroupTemplateOnSave,
} from '@/lib/office-task-workflow';
import { buildTaskEditFormStateFromProject } from '@/lib/office-task-edit-form';
import type { OfficeFixedGroup, OfficeTempProject, WorkflowDefinition } from '@/types/office';

const freezeWf: WorkflowDefinition = {
  mode: 'dag',
  nodes: [
    { id: 'gen-0', title: '计划', agentIds: ['pm'] },
    { id: 'gen-1', title: '总结', agentIds: ['pm'] },
  ],
  edges: [{ from: 'gen-0', to: 'gen-1' }],
};

const liveWf: WorkflowDefinition = {
  mode: 'dag',
  nodes: [{ id: 'gen-0', title: '计划', agentIds: ['pm'] }],
  edges: [],
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

const liveGroup: OfficeFixedGroup = {
  ...groupAtComplete,
  workflow: liveWf,
  workflowDescription: 'plan only',
  workflowOrchestrationMode: 'rule',
  workflowStepDrafts: [
    { input: '', agentIds: ['pm'], task: '计划', output: '', linkMode: 'serial' },
  ],
  updatedAt: 99,
};

function completedFrozen(overrides: Partial<OfficeTempProject> = {}): OfficeTempProject {
  const frozen = withTerminalWorkflowFreeze(
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
      nodeRuns: [],
      createdAt: 1,
      updatedAt: 1,
    },
    groupAtComplete,
  );
  return { ...frozen, ...overrides };
}

describe('HOLE fix: completed freeze integrity', () => {
  it('HOLE-R1: explicit freeze clear for rerun demotes completed and does not re-apply', () => {
    const project = completedFrozen();
    expect(project.workflowFreezeSnapshot?.workflow.nodes).toHaveLength(2);

    const aligned = alignNoOwnSpawnedProjectForRerun(project, liveGroup);
    expect(aligned.workflowFreezeSnapshot).toBeUndefined();
    expect(aligned.status).toBe('pending');
    // Pending + no freeze: shouldApply is false; gate also blocks if status were still completed.
    expect(shouldApplyTerminalWorkflowFreeze(aligned)).toBe(false);
    expect(shouldReapplyTerminalWorkflowFreezeOnUpsert(aligned, project)).toBe(false);
    expect(
      shouldReapplyTerminalWorkflowFreezeOnUpsert(
        { ...aligned, status: 'completed', workflowFreezeSnapshot: undefined },
        { status: 'running', workflowFreezeSnapshot: undefined },
      ),
    ).toBe(true);
  });

  it('HOLE-R2: untouched completed freeze form keeps inherit vs freeze compare group', () => {
    const project = completedFrozen();
    const form = buildTaskEditFormStateFromProject(project, liveGroup, (id) => id);
    expect(form.workflow.nodes).toHaveLength(2);
    expect(shouldUseWorkflowFreezeSnapshot(project)).toBe(true);

    // Form normalize uses agentId; freeze/group templates often use agentIds.
    expect(
      workflowsStructurallyEqual(form.workflow, project.workflowFreezeSnapshot!.workflow),
    ).toBe(true);

    const freezeCompare = workflowFreezeSnapshotAsCompareGroup(project.workflowFreezeSnapshot!);
    const input = {
      executionMode: 'workflow' as const,
      workflow: form.workflow,
      description: form.description,
      heuristicWorkflowDescription: form.heuristicWorkflowDescription,
      workflowStepDrafts: form.workflowStepDrafts,
      workflowOrchestrationMode: form.workflowOrchestrationMode,
      agentIds: form.openAgentRefSnapshot?.agentIds,
      coordinatorAgentId: form.openAgentRefSnapshot?.coordinatorAgentId,
    };
    expect(spawnedWorkflowDirtyVsGroup(freezeCompare, input)).toBe(false);

    expect(
      projectInheritsGroupTemplateOnSave(freezeCompare, {
        parentGroupId: 'g1',
        executionMode: 'workflow',
        description: form.description,
        workflowStepDrafts: form.workflowStepDrafts,
        workflow: form.workflow,
        workflowOrchestrationMode: form.workflowOrchestrationMode,
        agentIds: form.openAgentRefSnapshot?.agentIds,
        coordinatorAgentId: form.openAgentRefSnapshot?.coordinatorAgentId,
        previousOwnsWorkflow: false,
      }),
    ).toBe(true);

    expect(
      projectInheritsGroupTemplateOnSave(freezeCompare, {
        parentGroupId: 'g1',
        executionMode: 'workflow',
        description: 'user changed description',
        workflowStepDrafts: form.workflowStepDrafts,
        workflow: form.workflow,
        workflowOrchestrationMode: form.workflowOrchestrationMode,
        agentIds: form.openAgentRefSnapshot?.agentIds,
        coordinatorAgentId: form.openAgentRefSnapshot?.coordinatorAgentId,
        previousOwnsWorkflow: false,
      }),
    ).toBe(false);
  });

  it('HOLE-R4: completed freeze prefers freeze orchestration over locked live group', () => {
    const project = completedFrozen();
    const lockedLive: OfficeFixedGroup = {
      ...liveGroup,
      workflowOrchestrationMode: 'rule',
    };
    const form = buildTaskEditFormStateFromProject(project, lockedLive, (id) => id);
    expect(project.workflowFreezeSnapshot?.workflowOrchestrationMode).toBe('heuristic');
    expect(form.workflowOrchestrationMode).toBe('heuristic');
    expect(form.workflow.nodes.map((n) => n.title)).toEqual(['计划', '总结']);
  });

  it('agentId vs agentIds alone must not force ownership dirty vs live group', () => {
    const formLike: WorkflowDefinition = {
      mode: 'dag',
      nodes: [{ id: 'gen-0', title: '计划', agentId: 'pm' }],
      edges: [],
    };
    expect(workflowsStructurallyEqual(formLike, liveWf)).toBe(true);
    expect(
      spawnedWorkflowDirtyVsGroup(liveGroup, {
        executionMode: 'workflow',
        workflow: formLike,
        description: 'plan only',
        heuristicWorkflowDescription: 'plan only',
        workflowStepDrafts: liveGroup.workflowStepDrafts,
        workflowOrchestrationMode: 'rule',
        agentIds: ['pm'],
        coordinatorAgentId: 'pm',
      }),
    ).toBe(false);
  });
});
