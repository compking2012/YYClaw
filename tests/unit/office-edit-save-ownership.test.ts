import { describe, expect, it } from 'vitest';
import {
  decideInheritsGroupTemplateOnSave,
  materializeOwnedWorkflowPayload,
  projectOwnsWorkflow,
} from '@/lib/office-spawned-workflow-ownership';
import { projectInheritsGroupTemplateOnSave } from '@/lib/office-task-workflow';
import type { OfficeFixedGroup, WorkflowDefinition } from '@/types/office';

const groupWorkflow: WorkflowDefinition = {
  mode: 'dag',
  nodes: [{ id: 'g1', title: '组步骤', agentIds: ['a1'] }],
  edges: [],
};

const group: OfficeFixedGroup = {
  id: 'g1',
  name: '组',
  agentIds: ['a1', 'a2'],
  coordinatorAgentId: 'a1',
  workflow: groupWorkflow,
  workflowDescription: '',
  workflowStepDrafts: [
    { input: '', agentIds: ['a1'], task: '组步骤', output: '', linkMode: 'serial' },
  ],
  workflowOrchestrationMode: 'rule',
  createdAt: 1,
  updatedAt: 1,
};

describe('Step3 project edit save ownership', () => {
  it('title-only style save keeps inherit when workflow fields match group', () => {
    expect(
      projectInheritsGroupTemplateOnSave(group, {
        parentGroupId: 'g1',
        executionMode: 'workflow',
        description: '',
        workflowStepDrafts: group.workflowStepDrafts,
        workflow: { mode: 'dag', nodes: [], edges: [] },
        workflowOrchestrationMode: 'rule',
        agentIds: ['a1', 'a2'],
        coordinatorAgentId: 'a1',
        previousOwnsWorkflow: false,
      }),
    ).toBe(true);
  });

  it('sticky: already owned never re-inherits even when equal to group', () => {
    expect(
      projectInheritsGroupTemplateOnSave(group, {
        parentGroupId: 'g1',
        executionMode: 'workflow',
        description: '',
        workflowStepDrafts: group.workflowStepDrafts,
        workflow: structuredClone(groupWorkflow),
        workflowOrchestrationMode: 'rule',
        agentIds: ['a1', 'a2'],
        coordinatorAgentId: 'a1',
        previousOwnsWorkflow: true,
      }),
    ).toBe(false);
  });

  it('roster-only change elevates and materialize fills group DAG', () => {
    expect(
      decideInheritsGroupTemplateOnSave({
        previousOwnsWorkflow: false,
        group,
        parentGroupId: 'g1',
        input: {
          executionMode: 'workflow',
          workflow: { mode: 'dag', nodes: [], edges: [] },
          description: '',
          workflowStepDrafts: group.workflowStepDrafts,
          workflowOrchestrationMode: 'rule',
          agentIds: ['a1'],
          coordinatorAgentId: 'a1',
        },
      }),
    ).toBe(false);

    const owned = materializeOwnedWorkflowPayload({
      workflow: { mode: 'dag', nodes: [], edges: [] },
      description: '',
      workflowStepDrafts: group.workflowStepDrafts,
      workflowOrchestrationMode: 'rule',
      agentIds: ['a1'],
      coordinatorAgentId: 'a1',
      group,
    });
    expect(owned.inheritsGroupTemplate).toBe(false);
    expect(owned.workflow.nodes.length).toBe(1);
    expect(owned.agentIds).toEqual(['a1']);
    expect(projectOwnsWorkflow({
      origin: 'fixed_group',
      parentGroupId: 'g1',
      inheritsGroupTemplate: false,
      workflow: owned.workflow,
      executionMode: 'workflow',
    })).toBe(true);
  });

  it('system-equal group DAG on edit save still inherits when not previously owned', () => {
    expect(
      projectInheritsGroupTemplateOnSave(group, {
        parentGroupId: 'g1',
        executionMode: 'workflow',
        description: '',
        workflowStepDrafts: group.workflowStepDrafts,
        workflow: structuredClone(groupWorkflow),
        workflowOrchestrationMode: 'rule',
        agentIds: ['a2', 'a1'],
        coordinatorAgentId: 'a1',
        previousOwnsWorkflow: false,
      }),
    ).toBe(true);
  });
});
