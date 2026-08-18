import { describe, expect, it } from 'vitest';
import {
  resolveEffectiveWorkflow,
  shouldApplyTerminalWorkflowFreeze,
  shouldSyncInheritingChildOnGroupUpdate,
  shouldUseWorkflowFreezeSnapshot,
  withTerminalWorkflowFreeze,
  buildWorkflowFreezeSnapshot,
} from '@/lib/office-spawned-workflow-ownership';
import { buildTaskEditFormStateFromProject } from '@/lib/office-task-edit-form';
import type { OfficeFixedGroup, OfficeTempProject, WorkflowDefinition } from '@/types/office';

const liveWf: WorkflowDefinition = {
  mode: 'dag',
  nodes: [
    { id: 'gen-0', title: '计划', agentIds: ['pm'] },
    { id: 'gen-1', title: '实现', agentIds: ['pm'] },
  ],
  edges: [{ from: 'gen-0', to: 'gen-1' }],
};

const frozenWf: WorkflowDefinition = {
  mode: 'dag',
  nodes: [
    ...liveWf.nodes,
    { id: 'gen-2', title: '项目总结', agentIds: ['pm'] },
  ],
  edges: [
    { from: 'gen-0', to: 'gen-1' },
    { from: 'gen-1', to: 'gen-2' },
  ],
};

const group: OfficeFixedGroup = {
  id: 'g1',
  name: 'g',
  agentIds: ['pm'],
  coordinatorAgentId: 'pm',
  workflow: liveWf,
  workflowDescription: 'live',
  workflowOrchestrationMode: 'heuristic',
  createdAt: 1,
  updatedAt: 99,
};

function project(overrides: Partial<OfficeTempProject> = {}): OfficeTempProject {
  return {
    id: 'p1',
    title: 't',
    origin: 'fixed_group',
    parentGroupId: 'g1',
    inheritsGroupTemplate: true,
    workflow: { mode: 'dag', nodes: [], edges: [] },
    executionMode: 'workflow',
    status: 'aborted',
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

describe('failed/aborted excluded from workflow freeze', () => {
  it.each(['aborted', 'failed'] as const)(
    '%s no-own must not apply freeze and must follow live group even with leftover snapshot',
    (status) => {
      const leftover = buildWorkflowFreezeSnapshot({
        group: { ...group, workflow: frozenWf, updatedAt: 1 },
      });
      const p = project({ status, workflowFreezeSnapshot: leftover });
      expect(shouldApplyTerminalWorkflowFreeze(p)).toBe(false);
      expect(shouldUseWorkflowFreezeSnapshot(p)).toBe(false);
      expect(withTerminalWorkflowFreeze(p, group).workflowFreezeSnapshot).toEqual(leftover);
      expect(resolveEffectiveWorkflow(p, group).nodes.map((n) => n.title)).toEqual([
        '计划',
        '实现',
      ]);
      expect(shouldSyncInheritingChildOnGroupUpdate(p)).toBe(true);

      const form = buildTaskEditFormStateFromProject(p, group, (id) => id);
      expect(form.workflow.nodes.map((n) => n.title)).toEqual(['计划', '实现']);
    },
  );

  it('completed still freezes and does not follow live group edits', () => {
    const completed = project({ status: 'completed' });
    expect(shouldApplyTerminalWorkflowFreeze(completed)).toBe(true);
    const frozen = withTerminalWorkflowFreeze(completed, {
      ...group,
      workflow: frozenWf,
      updatedAt: 1,
    });
    expect(shouldUseWorkflowFreezeSnapshot(frozen)).toBe(true);
    const liveAfterDelete = { ...group, workflow: liveWf, updatedAt: 99 };
    expect(resolveEffectiveWorkflow(frozen, liveAfterDelete).nodes).toHaveLength(3);
    expect(shouldSyncInheritingChildOnGroupUpdate(frozen)).toBe(false);
  });
});
