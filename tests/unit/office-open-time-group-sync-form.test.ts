import { describe, expect, it } from 'vitest';
import { taskCreateFormFromGroup } from '@/components/office/TaskCreateDialog';
import { buildTaskEditFormStateFromProject } from '@/lib/office-task-edit-form';
import {
  buildWorkflowFreezeSnapshot,
  spawnedWorkflowDirtyVsGroup,
} from '@/lib/office-spawned-workflow-ownership';
import type { OfficeFixedGroup, OfficeTempProject, WorkflowDefinition } from '@/types/office';

const groupWorkflow: WorkflowDefinition = {
  mode: 'dag',
  nodes: [
    { id: 'gen-0', title: '计划', agentIds: ['pm'] },
    { id: 'gen-1', title: '总结', agentIds: ['writer'] },
  ],
  edges: [{ from: 'gen-0', to: 'gen-1' }],
};

const group: OfficeFixedGroup = {
  id: 'g1',
  name: '研发',
  agentIds: ['pm', 'writer'],
  coordinatorAgentId: 'pm',
  workflow: groupWorkflow,
  workflowDescription: 'plan then summarize',
  workflowOrchestrationMode: 'heuristic',
  createdAt: 1,
  updatedAt: 1,
};

const agents = [
  { id: 'pm', name: 'PM' },
  { id: 'writer', name: 'Writer' },
];

function noOwnProject(overrides: Partial<OfficeTempProject> = {}): OfficeTempProject {
  return {
    id: 'p1',
    title: '派出',
    origin: 'fixed_group',
    parentGroupId: 'g1',
    inheritsGroupTemplate: true,
    workflow: { mode: 'dag', nodes: [], edges: [] },
    executionMode: 'workflow',
    status: 'pending',
    lifecycle: 'active',
    agentIds: ['pm'], // stale persisted roster vs live group
    coordinatorAgentId: 'pm',
    featureDescription: 'f',
    description: '',
    nodeRuns: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('open-time group workflow sync for create/edit forms', () => {
  it('spawn create form immediately materializes live group DAG (not empty)', () => {
    const form = taskCreateFormFromGroup(group, agents, { title: 't', featureDescription: 'f' });
    expect(form.workflow.nodes.map((n) => n.title)).toEqual(['计划', '总结']);
    expect(form.agentIds).toEqual(['pm', 'writer']);
    expect(form.heuristicWorkflowDescription).toBe('plan then summarize');
    expect(
      spawnedWorkflowDirtyVsGroup(group, {
        executionMode: 'workflow',
        workflow: form.workflow,
        description: form.description,
        heuristicWorkflowDescription: form.heuristicWorkflowDescription,
        workflowOrchestrationMode: form.workflowOrchestrationMode,
        agentIds: form.agentIds,
        coordinatorAgentId: form.coordinatorAgentId,
      }),
    ).toBe(false);
  });

  it('edit form for no-own pending shows live group DAG + roster even if project payload empty/stale', () => {
    const form = buildTaskEditFormStateFromProject(noOwnProject(), group, (id) => id);
    expect(form.workflow.nodes.map((n) => n.title)).toEqual(['计划', '总结']);
    expect(form.description).toBe('plan then summarize');
    expect(form.openAgentRefSnapshot?.agentIds).toEqual(['pm', 'writer']);
    expect(form.openAgentRefSnapshot?.coordinatorAgentId).toBe('pm');
  });

  it('edit form for completed freeze shows freeze snapshot, not live group edits', () => {
    const freeze = buildWorkflowFreezeSnapshot({
      group: {
        ...group,
        workflow: {
          mode: 'dag',
          nodes: [{ id: 'old', title: '冻结步', agentIds: ['pm'] }],
          edges: [],
        },
        workflowDescription: '',
        agentIds: ['pm'],
        coordinatorAgentId: 'pm',
      },
    });
    const form = buildTaskEditFormStateFromProject(
      noOwnProject({
        status: 'completed',
        workflowFreezeSnapshot: freeze,
        agentIds: ['pm'],
      }),
      {
        ...group,
        workflow: groupWorkflow,
        workflowDescription: 'new live text',
        agentIds: ['pm', 'writer'],
        updatedAt: 99,
      },
      (id) => id,
    );
    expect(form.workflow.nodes.map((n) => n.title)).toEqual(['冻结步']);
    expect(form.description).toBe('');
    expect(form.openAgentRefSnapshot?.agentIds).toEqual(['pm']);
  });

  it('edit form for aborted/failed follows live group even with leftover freeze snapshot', () => {
    const freeze = buildWorkflowFreezeSnapshot({
      group: {
        ...group,
        workflow: {
          mode: 'dag',
          nodes: [{ id: 'old', title: '冻结步', agentIds: ['pm'] }],
          edges: [],
        },
        workflowDescription: '',
        agentIds: ['pm'],
        coordinatorAgentId: 'pm',
      },
    });
    for (const status of ['aborted', 'failed'] as const) {
      const form = buildTaskEditFormStateFromProject(
        noOwnProject({
          status,
          workflowFreezeSnapshot: freeze,
          agentIds: ['pm'],
        }),
        {
          ...group,
          workflow: groupWorkflow,
          workflowDescription: 'new live text',
          agentIds: ['pm', 'writer'],
          updatedAt: 99,
        },
        (id) => id,
      );
      expect(form.workflow.nodes.map((n) => n.title)).toEqual(['计划', '总结']);
      expect(form.description).toBe('new live text');
      expect(form.openAgentRefSnapshot?.agentIds).toEqual(['pm', 'writer']);
    }
  });
});
