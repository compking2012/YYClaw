import { describe, expect, it } from 'vitest';
import {
  clearWorkflowFreezeForRerun,
  withTerminalWorkflowFreeze,
  projectHasNoOwnWorkflow,
} from '@/lib/office-spawned-workflow-ownership';
import {
  alignNoOwnSpawnedProjectForRerun,
  displayAgentsForProject,
  workflowDescriptionForProject,
  workflowStepDraftsForProject,
} from '@/lib/office-task-workflow';
import type { OfficeFixedGroup, OfficeTempProject, WorkflowDefinition } from '@/types/office';

const groupWf: WorkflowDefinition = {
  mode: 'dag',
  nodes: [
    { id: 'gen-0', title: '计划', agentIds: ['pm'] },
    { id: 'gen-1', title: '总结', agentIds: ['writer'] },
  ],
  edges: [{ from: 'gen-0', to: 'gen-1' }],
};

function group(overrides: Partial<OfficeFixedGroup> = {}): OfficeFixedGroup {
  return {
    id: 'g1',
    name: 'g',
    agentIds: ['pm', 'writer'],
    coordinatorAgentId: 'pm',
    workflow: groupWf,
    workflowDescription: '',
    workflowOrchestrationMode: 'rule',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function project(overrides: Partial<OfficeTempProject> = {}): OfficeTempProject {
  return {
    id: 'p1',
    title: 't',
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
    ...overrides,
  };
}

describe('ownership medium-high hole reproductions', () => {
  it('HOLE-G: alignNoOwnSpawnedProjectForRerun syncs roster after terminal group edits', () => {
    const g0 = group({
      agentIds: ['pm'],
      coordinatorAgentId: 'pm',
      workflow: {
        mode: 'dag',
        nodes: [{ id: 'gen-0', title: '计划', agentIds: ['pm'] }],
        edges: [],
      },
    });
    const frozen = withTerminalWorkflowFreeze(project({ agentIds: ['pm'], coordinatorAgentId: 'pm' }), g0);
    expect(projectHasNoOwnWorkflow(frozen)).toBe(true);

    const live = group({
      agentIds: ['pm', 'writer'],
      coordinatorAgentId: 'pm',
      workflow: groupWf,
      updatedAt: 99,
    });
    const clearedOnly = clearWorkflowFreezeForRerun({ ...frozen, status: 'pending' });
    expect(clearedOnly.agentIds).toEqual(['pm']);
    expect(displayAgentsForProject(clearedOnly, live).agentIds).toContain('writer');

    const aligned = alignNoOwnSpawnedProjectForRerun(frozen, live);
    expect(aligned.workflowFreezeSnapshot).toBeUndefined();
    expect(aligned.agentIds).toEqual(['pm', 'writer']);
    expect(aligned.coordinatorAgentId).toBe('pm');
  });

  it('HOLE-H: freeze with empty description must not fall back to live group description', () => {
    const g0 = group({ workflowDescription: '' });
    const frozen = withTerminalWorkflowFreeze(project(), g0);
    expect(frozen.workflowFreezeSnapshot).toBeTruthy();
    expect(frozen.workflowFreezeSnapshot!.description).toBe('');

    const live = group({ workflowDescription: 'new template text', updatedAt: 99 });
    expect(workflowDescriptionForProject(frozen, live)).toBe('');

    const liveWithDrafts = group({
      workflowDescription: '',
      workflowStepDrafts: [{ task: '新草稿', agentIds: ['pm'] }],
      updatedAt: 100,
    });
    expect(workflowStepDraftsForProject(frozen, liveWithDrafts)).toBeUndefined();
  });
});
