import { describe, expect, it } from 'vitest';
import {
  childInheritsGroupTemplate,
  groupChildWorkflowFieldsAfterGroupUpdate,
  workflowForProject,
} from '@/lib/office-task-workflow';
import {
  shouldSyncInheritingChildOnGroupUpdate,
  buildWorkflowFreezeSnapshot,
} from '@/lib/office-spawned-workflow-ownership';
import type { OfficeFixedGroup, OfficeTempProject, WorkflowDefinition } from '@/types/office';

const groupA: WorkflowDefinition = {
  mode: 'dag',
  nodes: [
    { id: 'gen-0', title: '计划', agentIds: ['pm'] },
    { id: 'gen-1', title: '总结', agentIds: ['pm'] },
  ],
  edges: [{ from: 'gen-0', to: 'gen-1' }],
};

const groupB: WorkflowDefinition = {
  mode: 'dag',
  nodes: [{ id: 'gen-0', title: '计划', agentIds: ['pm'] }],
  edges: [],
};

function project(overrides: Partial<OfficeTempProject> = {}): OfficeTempProject {
  return {
    id: 'p1',
    title: '象棋',
    origin: 'fixed_group',
    parentGroupId: 'g1',
    inheritsGroupTemplate: true,
    workflow: { mode: 'dag', nodes: [], edges: [] },
    executionMode: 'workflow',
    status: 'pending',
    lifecycle: 'active',
    agentIds: ['pm'],
    coordinatorAgentId: 'pm',
    featureDescription: 'x',
    description: '',
    nodeRuns: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('Step4 group sync scope', () => {
  it('syncs no-own pending children and preview follows new group workflow', () => {
    const p = project();
    expect(shouldSyncInheritingChildOnGroupUpdate(p)).toBe(true);
    expect(childInheritsGroupTemplate(p, { workflow: groupA } as OfficeFixedGroup)).toBe(true);

    const fields = groupChildWorkflowFieldsAfterGroupUpdate(p, {
      workflowOrchestrationMode: 'rule',
      workflowDescription: '',
      workflowStepDrafts: undefined,
    });
    expect(fields.inheritsGroupTemplate).toBe(true);
    expect(fields.workflow?.nodes).toEqual([]);

    const after = { ...p, ...fields };
    expect(workflowForProject(after, { workflow: groupB }).nodes).toHaveLength(1);
    expect(workflowForProject(after, { workflow: groupA }).nodes).toHaveLength(2);
  });

  it('skips owned projects', () => {
    expect(
      shouldSyncInheritingChildOnGroupUpdate(
        project({ inheritsGroupTemplate: false, workflow: groupA }),
      ),
    ).toBe(false);
  });

  it('skips completed freeze but syncs failed/aborted no-own', () => {
    expect(shouldSyncInheritingChildOnGroupUpdate(project({ status: 'aborted' }))).toBe(true);
    expect(shouldSyncInheritingChildOnGroupUpdate(project({ status: 'failed' }))).toBe(true);
    expect(shouldSyncInheritingChildOnGroupUpdate(project({ status: 'completed' }))).toBe(false);
    expect(
      shouldSyncInheritingChildOnGroupUpdate(
        project({
          status: 'completed',
          workflowFreezeSnapshot: buildWorkflowFreezeSnapshot({
            group: {
              workflow: groupA,
              workflowDescription: '',
              workflowStepDrafts: undefined,
              workflowOrchestrationMode: 'rule',
              agentIds: ['pm'],
              coordinatorAgentId: 'pm',
              updatedAt: 1,
            },
          }),
        }),
      ),
    ).toBe(false);
  });

  it('skips archived lifecycle', () => {
    expect(
      shouldSyncInheritingChildOnGroupUpdate(project({ lifecycle: 'archived' })),
    ).toBe(false);
  });
});
