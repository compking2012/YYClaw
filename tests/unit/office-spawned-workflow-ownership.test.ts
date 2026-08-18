import { describe, expect, it } from 'vitest';
import {
  buildWorkflowFreezeSnapshot,
  clearWorkflowFreezeForRerun,
  decideInheritsGroupTemplateOnSave,
  materializeOwnedWorkflowPayload,
  noOwnWorkflowPersistFields,
  projectHasNoOwnWorkflow,
  projectOwnsWorkflow,
  resolveEffectiveWorkflow,
  shouldApplyTerminalWorkflowFreeze,
  shouldInheritGroupWorkflowOnSpawn,
  shouldPersistResolvedWorkflowToOwnedProject,
  shouldSyncInheritingChildOnGroupUpdate,
  spawnedWorkflowDirtyVsGroup,
  workflowsStructurallyEqual,
} from '@/lib/office-spawned-workflow-ownership';
import type { OfficeFixedGroup, OfficeTempProject, WorkflowDefinition } from '@/types/office';

const groupWorkflow: WorkflowDefinition = {
  mode: 'dag',
  nodes: [
    { id: 'gen-0', title: '计划', agentIds: ['pm'] },
    { id: 'gen-1', title: '开发', agentIds: ['dev'] },
  ],
  edges: [{ from: 'gen-0', to: 'gen-1' }],
};

const groupDrafts = [
  { input: '', agentIds: ['pm'], task: '计划', output: '', linkMode: 'serial' as const },
  { input: '', agentIds: ['dev'], task: '开发', output: '', linkMode: 'serial' as const },
];

function makeGroup(overrides: Partial<OfficeFixedGroup> = {}): OfficeFixedGroup {
  return {
    id: 'g1',
    name: '软件开发小组',
    agentIds: ['pm', 'dev'],
    coordinatorAgentId: 'pm',
    workflow: groupWorkflow,
    workflowDescription: '',
    workflowStepDrafts: groupDrafts,
    workflowOrchestrationMode: 'rule',
    createdAt: 1,
    updatedAt: 100,
    ...overrides,
  };
}

function makeProject(
  overrides: Partial<OfficeTempProject> = {},
): Pick<
  OfficeTempProject,
  | 'origin'
  | 'parentGroupId'
  | 'inheritsGroupTemplate'
  | 'workflow'
  | 'executionMode'
  | 'status'
  | 'lifecycle'
  | 'workflowFreezeSnapshot'
  | 'agentIds'
  | 'coordinatorAgentId'
  | 'description'
> {
  return {
    origin: 'fixed_group',
    parentGroupId: 'g1',
    inheritsGroupTemplate: true,
    workflow: { mode: 'dag', nodes: [], edges: [] },
    executionMode: 'workflow',
    status: 'pending',
    lifecycle: 'active',
    agentIds: ['pm', 'dev'],
    coordinatorAgentId: 'pm',
    description: '',
    ...overrides,
  };
}

describe('Step1 ownership contract', () => {
  it('projectOwnsWorkflow sticky on inheritsGroupTemplate=false even with empty DAG', () => {
    expect(projectOwnsWorkflow(makeProject({ inheritsGroupTemplate: false }))).toBe(true);
    expect(projectHasNoOwnWorkflow(makeProject({ inheritsGroupTemplate: true }))).toBe(true);
  });

  it('legacy non-empty DAG without flag counts as owned', () => {
    expect(
      projectOwnsWorkflow(
        makeProject({
          inheritsGroupTemplate: undefined,
          workflow: groupWorkflow,
        }),
      ),
    ).toBe(true);
  });

  it('spawnedWorkflowDirtyVsGroup is false when form matches group including prefilled drafts', () => {
    const group = makeGroup();
    expect(
      spawnedWorkflowDirtyVsGroup(group, {
        executionMode: 'workflow',
        workflow: { mode: 'dag', nodes: [], edges: [] },
        description: '',
        workflowStepDrafts: groupDrafts,
        workflowOrchestrationMode: 'rule',
        agentIds: ['pm', 'dev'],
        coordinatorAgentId: 'pm',
      }),
    ).toBe(false);
  });

  it('system-materialized group DAG equal to group is NOT dirty', () => {
    const group = makeGroup();
    expect(
      spawnedWorkflowDirtyVsGroup(group, {
        executionMode: 'workflow',
        workflow: structuredClone(groupWorkflow),
        description: '',
        workflowStepDrafts: groupDrafts,
        workflowOrchestrationMode: 'rule',
        agentIds: ['dev', 'pm'],
        coordinatorAgentId: 'pm',
      }),
    ).toBe(false);
  });

  it('dirty when DAG diverges from group', () => {
    const group = makeGroup();
    expect(
      spawnedWorkflowDirtyVsGroup(group, {
        executionMode: 'workflow',
        workflow: {
          mode: 'dag',
          nodes: [{ id: 'x', title: '自定义', agentIds: ['pm'] }],
          edges: [],
        },
        description: '',
        workflowStepDrafts: groupDrafts,
        workflowOrchestrationMode: 'rule',
        agentIds: ['pm', 'dev'],
        coordinatorAgentId: 'pm',
      }),
    ).toBe(true);
  });

  it('dirty when roster diverges', () => {
    const group = makeGroup();
    expect(
      spawnedWorkflowDirtyVsGroup(group, {
        executionMode: 'workflow',
        workflow: { mode: 'dag', nodes: [], edges: [] },
        description: '',
        workflowStepDrafts: groupDrafts,
        workflowOrchestrationMode: 'rule',
        agentIds: ['pm'],
        coordinatorAgentId: 'pm',
      }),
    ).toBe(true);
  });

  it('dirty when step draft task diverges', () => {
    const group = makeGroup();
    expect(
      spawnedWorkflowDirtyVsGroup(group, {
        executionMode: 'workflow',
        workflow: { mode: 'dag', nodes: [], edges: [] },
        description: '',
        workflowStepDrafts: [
          { input: '', agentIds: ['pm'], task: '计划改', output: '', linkMode: 'serial' },
          groupDrafts[1]!,
        ],
        workflowOrchestrationMode: 'rule',
        agentIds: ['pm', 'dev'],
        coordinatorAgentId: 'pm',
      }),
    ).toBe(true);
  });

  it('shouldInheritGroupWorkflowOnSpawn allows materialized group DAG when otherwise equal', () => {
    const group = makeGroup();
    expect(
      shouldInheritGroupWorkflowOnSpawn(
        {
          executionMode: 'workflow',
          workflowEngine: 'dag',
          workflow: structuredClone(groupWorkflow),
          description: '',
          workflowStepDrafts: groupDrafts,
          workflowOrchestrationMode: 'rule',
          agentIds: ['pm', 'dev'],
          coordinatorAgentId: 'pm',
        },
        group,
      ),
    ).toBe(true);
  });

  it('decideInheritsGroupTemplateOnSave never re-inherits once owned', () => {
    const group = makeGroup();
    expect(
      decideInheritsGroupTemplateOnSave({
        previousOwnsWorkflow: true,
        group,
        parentGroupId: 'g1',
        input: {
          executionMode: 'workflow',
          workflow: structuredClone(groupWorkflow),
          description: '',
          workflowStepDrafts: groupDrafts,
          workflowOrchestrationMode: 'rule',
          agentIds: ['pm', 'dev'],
          coordinatorAgentId: 'pm',
        },
      }),
    ).toBe(false);
  });

  it('decideInheritsGroupTemplateOnSave inherits when not owned and not dirty', () => {
    const group = makeGroup();
    expect(
      decideInheritsGroupTemplateOnSave({
        previousOwnsWorkflow: false,
        group,
        parentGroupId: 'g1',
        input: {
          executionMode: 'workflow',
          workflow: { mode: 'dag', nodes: [], edges: [] },
          description: '',
          workflowStepDrafts: groupDrafts,
          workflowOrchestrationMode: 'rule',
          agentIds: ['pm', 'dev'],
          coordinatorAgentId: 'pm',
        },
      }),
    ).toBe(true);
  });

  it('noOwnWorkflowPersistFields clears payload', () => {
    const fields = noOwnWorkflowPersistFields();
    expect(fields.inheritsGroupTemplate).toBe(true);
    expect(fields.workflow?.nodes).toEqual([]);
    expect(fields.workflowStepDrafts).toBeUndefined();
    expect(fields.workflowOrchestrationMode).toBeUndefined();
    expect(fields.workflowFreezeSnapshot).toBeUndefined();
  });

  it('materializeOwnedWorkflowPayload fills from group when form DAG empty', () => {
    const group = makeGroup();
    const owned = materializeOwnedWorkflowPayload({
      workflow: { mode: 'dag', nodes: [], edges: [] },
      description: '',
      workflowStepDrafts: undefined,
      agentIds: ['pm'],
      coordinatorAgentId: 'pm',
      group,
    });
    expect(owned.inheritsGroupTemplate).toBe(false);
    expect(owned.workflow.nodes.length).toBe(2);
    expect(owned.agentIds).toEqual(['pm']);
    expect(workflowsStructurallyEqual(owned.workflow, groupWorkflow)).toBe(true);
  });

  it('resolveEffectiveWorkflow uses group for no-own pending', () => {
    const group = makeGroup();
    const wf = resolveEffectiveWorkflow(makeProject(), group);
    expect(workflowsStructurallyEqual(wf, groupWorkflow)).toBe(true);
  });

  it('resolveEffectiveWorkflow uses freeze snapshot for completed no-own', () => {
    const group = makeGroup();
    const freeze = buildWorkflowFreezeSnapshot({ group });
    const wf = resolveEffectiveWorkflow(
      makeProject({
        status: 'completed',
        workflowFreezeSnapshot: freeze,
      }),
      { workflow: { mode: 'dag', nodes: [{ id: 'new', title: '组已改', agentIds: ['pm'] }], edges: [] } },
    );
    expect(workflowsStructurallyEqual(wf, freeze.workflow)).toBe(true);
  });

  it('resolveEffectiveWorkflow ignores leftover freeze for aborted/failed no-own', () => {
    const freeze = buildWorkflowFreezeSnapshot({ group: makeGroup() });
    const live: WorkflowDefinition = {
      mode: 'dag',
      nodes: [{ id: 'new', title: '组已改', agentIds: ['pm'] }],
      edges: [],
    };
    for (const status of ['aborted', 'failed'] as const) {
      const wf = resolveEffectiveWorkflow(
        makeProject({
          status,
          workflowFreezeSnapshot: freeze,
        }),
        { workflow: live },
      );
      expect(workflowsStructurallyEqual(wf, live)).toBe(true);
    }
  });

  it('resolveEffectiveWorkflow uses project when owned', () => {
    const own: WorkflowDefinition = {
      mode: 'dag',
      nodes: [{ id: 'p1', title: '自有', agentIds: ['pm'] }],
      edges: [],
    };
    const wf = resolveEffectiveWorkflow(
      makeProject({ inheritsGroupTemplate: false, workflow: own, status: 'pending' }),
      makeGroup(),
    );
    expect(wf.nodes[0]?.title).toBe('自有');
  });

  it('shouldApplyTerminalWorkflowFreeze only for no-own completed without snapshot', () => {
    expect(shouldApplyTerminalWorkflowFreeze(makeProject({ status: 'aborted' }))).toBe(false);
    expect(shouldApplyTerminalWorkflowFreeze(makeProject({ status: 'failed' }))).toBe(false);
    expect(shouldApplyTerminalWorkflowFreeze(makeProject({ status: 'completed' }))).toBe(true);
    expect(
      shouldApplyTerminalWorkflowFreeze(
        makeProject({ status: 'completed', inheritsGroupTemplate: false }),
      ),
    ).toBe(false);
    expect(shouldApplyTerminalWorkflowFreeze(makeProject({ status: 'pending' }))).toBe(false);
    expect(
      shouldApplyTerminalWorkflowFreeze(
        makeProject({
          status: 'completed',
          workflowFreezeSnapshot: buildWorkflowFreezeSnapshot({ group: makeGroup() }),
        }),
      ),
    ).toBe(false);
  });

  it('shouldSyncInheritingChildOnGroupUpdate skips owned/completed/archived', () => {
    expect(shouldSyncInheritingChildOnGroupUpdate(makeProject())).toBe(true);
    expect(
      shouldSyncInheritingChildOnGroupUpdate(makeProject({ inheritsGroupTemplate: false })),
    ).toBe(false);
    expect(shouldSyncInheritingChildOnGroupUpdate(makeProject({ status: 'completed' }))).toBe(false);
    expect(shouldSyncInheritingChildOnGroupUpdate(makeProject({ status: 'aborted' }))).toBe(true);
    expect(shouldSyncInheritingChildOnGroupUpdate(makeProject({ status: 'failed' }))).toBe(true);
    expect(
      shouldSyncInheritingChildOnGroupUpdate(makeProject({ lifecycle: 'archived' })),
    ).toBe(false);
    expect(
      shouldSyncInheritingChildOnGroupUpdate(
        makeProject({
          status: 'completed',
          workflowFreezeSnapshot: buildWorkflowFreezeSnapshot({ group: makeGroup() }),
        }),
      ),
    ).toBe(false);
  });

  it('clearWorkflowFreezeForRerun drops snapshot', () => {
    const frozen = makeProject({
      status: 'aborted',
      workflowFreezeSnapshot: buildWorkflowFreezeSnapshot({ group: makeGroup() }),
    });
    const cleared = clearWorkflowFreezeForRerun(frozen);
    expect(cleared.workflowFreezeSnapshot).toBeUndefined();
    expect(frozen.workflowFreezeSnapshot).toBeDefined();
  });

  it('shouldPersistResolvedWorkflowToOwnedProject false for no-own', () => {
    expect(shouldPersistResolvedWorkflowToOwnedProject(makeProject())).toBe(false);
    expect(
      shouldPersistResolvedWorkflowToOwnedProject(
        makeProject({ inheritsGroupTemplate: false }),
      ),
    ).toBe(true);
  });
});
